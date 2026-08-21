import { afterEach, describe, expect, it } from 'vitest';

import { analyzeCron, resolveTimezone } from '@/domain/cron/analyze';
import type { CronAnalysis, CronWarningCode } from '@/domain/cron/ast';
import { parseCron } from '@/domain/cron/parser';
import { tokenize } from '@/domain/cron/tokenizer';

/**
 * Cron semantics — 03_DOMAIN_MODEL.md §5.2, 04_PARSER_ARCHITECTURE.md §4.5–4.7
 *
 * The day-of-month / day-of-week rule is the single most valuable output of
 * the feature and the thing most likely to be got wrong, so it is tested
 * hardest.
 */

function analyse(source: string, utc = false): CronAnalysis {
  const result = analyzeCron(source, utc ? { timezoneMode: 'utc' } : {});
  if (!result.ok) throw new Error(`expected ${source} to analyse: ${result.error.message}`);
  return result.value;
}

const codes = (analysis: CronAnalysis): CronWarningCode[] =>
  analysis.warnings.map((warning) => warning.code);

/* ------------------------------------------------------------------ *
 * The OR rule
 * ------------------------------------------------------------------ */

describe('day-of-month and day-of-week', () => {
  it('warns whenever BOTH day fields are restricted', () => {
    // `0 0 1 * 1` means "the 1st of the month, AND ALSO every Monday" — not
    // "the 1st, if it is a Monday". Approximately every developer reads it the
    // second way, so this warning is unconditional.
    const analysis = analyse('0 0 1 * 1');
    expect(codes(analysis)).toContain('DOM_DOW_OR_RULE');
    const warning = analysis.warnings.find((w) => w.code === 'DOM_DOW_OR_RULE');
    expect(warning?.message).toMatch(/EITHER/);
  });

  it('does not warn when only day-of-week is restricted', () => {
    expect(codes(analyse('0 0 * * 1'))).not.toContain('DOM_DOW_OR_RULE');
  });

  it('does not warn when only day-of-month is restricted', () => {
    expect(codes(analyse('0 0 1 * *'))).not.toContain('DOM_DOW_OR_RULE');
  });

  it('does not warn when neither is restricted', () => {
    expect(codes(analyse('0 0 * * *'))).not.toContain('DOM_DOW_OR_RULE');
  });

  it('spells the OR reading out in the summary, not only in a warning', () => {
    const summary = JSON.stringify(analyse('0 0 1 * 1').explanation.summary);
    expect(summary).toContain('either, not both');
  });

  it('treats a range covering the whole field as unrestricted', () => {
    // `1-31` selects every day, so it restricts nothing and the OR rule does
    // not apply — the warning is about restriction, not about syntax.
    expect(codes(analyse('0 0 1-31 * 1'))).not.toContain('DOM_DOW_OR_RULE');
  });
});

/* ------------------------------------------------------------------ *
 * Day-of-week convention
 * ------------------------------------------------------------------ */

describe('the Sunday convention', () => {
  it('accepts 0 and 7 as the same day', () => {
    expect(analyse('0 0 * * 0').fields.find((f) => f.name === 'dayOfWeek')?.resolved).toEqual([0]);
    expect(analyse('0 0 * * 7').fields.find((f) => f.name === 'dayOfWeek')?.resolved).toEqual([0]);
  });

  it('collapses 0 and 7 written together', () => {
    expect(analyse('0 0 * * 0,7').fields.find((f) => f.name === 'dayOfWeek')?.resolved).toEqual([
      0,
    ]);
  });

  it('states which convention was applied when 7 is used', () => {
    const section = analyse('0 0 * * 7').explanation.details.find((d) => d.id === 'cron-dayOfWeek');
    expect(JSON.stringify(section)).toMatch(/both mean Sunday/);
  });
});

/* ------------------------------------------------------------------ *
 * Timezone
 * ------------------------------------------------------------------ */

describe('timezone semantics', () => {
  it('supports exactly two modes and resolves UTC to a zero offset', () => {
    const utc = resolveTimezone('utc');
    expect(utc.mode).toBe('utc');
    expect(utc.ianaZone).toBe('UTC');
    expect(utc.currentOffsetMinutes).toBe(0);
    expect(utc.resolvedFrom).toBe('userSelection');
  });

  it('reports browser-local as resolved rather than chosen', () => {
    const local = resolveTimezone('browserLocal');
    expect(local.mode).toBe('browserLocal');
    expect(local.resolvedFrom).toBe('browserResolvedOptions');
    expect(typeof local.ianaZone).toBe('string');
    expect(local.ianaZone.length).toBeGreaterThan(0);
  });

  it('never produces a named-zone mode, because V1.1 does not implement one', () => {
    // Guards the scope lock: the only way a named zone could appear is if
    // someone widened the union, and this fails when they do.
    for (const source of ['0 0 * * *', '*/5 * * * *']) {
      expect(['browserLocal', 'utc']).toContain(analyse(source).timezone.mode);
      expect(['browserLocal', 'utc']).toContain(analyse(source, true).timezone.mode);
    }
  });

  /**
   * The DST caveat is about the zone, not about the mode.
   *
   * It shipped as an unconditional browser-local warning, which told anyone in
   * `Asia/Kolkata` that their zone observes daylight saving. It does not. A
   * false statement dressed as a caution teaches people to skip the warnings
   * that are true, so the zone is now asked rather than assumed.
   *
   * `process.env.TZ` is honoured by `Date` at runtime in Node, so these run
   * against real zone rules rather than a stub of them.
   */
  describe('the daylight-saving caveat', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      process.env.TZ = originalTz;
    });

    const withZone = <T>(zone: string, read: () => T): T => {
      process.env.TZ = zone;
      return read();
    };

    it.each([
      ['Europe/London', true],
      ['Australia/Sydney', true],
      ['America/New_York', true],
    ])('warns in %s, which transitions', (zone, expected) => {
      const analysis = withZone(zone, () => analyse('0 3 * * *'));
      expect(analysis.timezone.observesDst, zone).toBe(expected);
      expect(codes(analysis), zone).toContain('DST_LOCAL_MODE');
    });

    it.each([['Asia/Kolkata'], ['UTC'], ['Asia/Tokyo']])(
      'stays quiet in %s, which does not',
      (zone) => {
        const analysis = withZone(zone, () => analyse('0 3 * * *'));
        expect(analysis.timezone.observesDst, zone).toBe(false);
        expect(codes(analysis), zone).not.toContain('DST_LOCAL_MODE');
      },
    );

    it('says which of the two it is, in the explanation as well as the warning', () => {
      const read = (zone: string): string => {
        const section = withZone(zone, () =>
          analyse('0 3 * * *').explanation.details.find((d) => d.id === 'cron-timezone'),
        );
        return JSON.stringify(section);
      };
      expect(read('Europe/London')).toMatch(/observes daylight-saving changes/);
      expect(read('Asia/Kolkata')).toMatch(/no daylight-saving transitions/);
    });

    it('never warns in UTC mode, whatever the browser zone is', () => {
      // UTC has no transitions by definition, so the caveat would be wrong
      // even for a reader sitting in a zone that does transition.
      const analysis = withZone('Europe/London', () => analyse('0 3 * * *', true));
      expect(analysis.timezone.observesDst).toBe(false);
      expect(codes(analysis)).not.toContain('DST_LOCAL_MODE');
    });
  });

  it('always says which timezone the reading is in', () => {
    // Invariant C-I1: a cron time without a zone is a confidently wrong answer.
    for (const utc of [false, true]) {
      const section = analyse('0 9 * * *', utc).explanation.details.find(
        (d) => d.id === 'cron-timezone',
      );
      expect(section, `utc=${String(utc)}`).toBeDefined();
      expect(JSON.stringify(section)).toMatch(utc ? /UTC/ : /timezone/);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Other warnings
 * ------------------------------------------------------------------ */

describe('warnings', () => {
  it('flags a step on a bare value as non-portable', () => {
    expect(codes(analyse('5/10 * * * *'))).toContain('NON_STANDARD_STEP_BASE');
  });

  it('does not flag a step on a wildcard or a range', () => {
    expect(codes(analyse('*/10 * * * *'))).not.toContain('NON_STANDARD_STEP_BASE');
    expect(codes(analyse('0-30/10 * * * *'))).not.toContain('NON_STANDARD_STEP_BASE');
  });

  it('notes a very frequent schedule without calling it an error', () => {
    const analysis = analyse('* * * * *');
    expect(codes(analysis)).toContain('HIGH_FREQUENCY');
    expect(analysis.errors).toHaveLength(0);
  });

  it('leaves an ordinary schedule unwarned apart from the timezone note', () => {
    expect(codes(analyse('30 4 * * *', true))).toEqual([]);
  });

  it('explains @reboot rather than scheduling it', () => {
    const analysis = analyse('@reboot');
    expect(codes(analysis)).toContain('NON_SCHEDULABLE_MACRO');
    expect(analysis.fields).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Source spans
 * ------------------------------------------------------------------ */

describe('source spans', () => {
  it('keeps every span inside the source and correctly ordered', () => {
    const source = '*/15 9-17 1,15 JAN-JUN MON-FRI';
    const analysis = analyse(source);

    const check = (span: { start: number; end: number; line: number; column: number }): void => {
      expect(span.start).toBeGreaterThanOrEqual(0);
      expect(span.end).toBeGreaterThanOrEqual(span.start);
      expect(span.end).toBeLessThanOrEqual(source.length);
      expect(span.line).toBeGreaterThanOrEqual(1);
      expect(span.column).toBeGreaterThanOrEqual(1);
    };

    for (const token of analysis.tokens) check(token.span);
    for (const field of analysis.fields) {
      check(field.span);
      // The span must actually cover the text the field reports as its own.
      expect(source.slice(field.span.start, field.span.end)).toBe(field.raw);
      for (const term of field.terms) check(term.span);
    }
  });

  it('tokenizes with no gaps, so every character is accounted for', () => {
    const source = '*/15 9-17 * * 1-5';
    const tokens = tokenize(source);
    let cursor = 0;
    for (const token of tokens) {
      expect(token.span.start).toBe(cursor);
      cursor = token.span.end;
    }
    expect(cursor).toBe(source.length);
  });

  it('points an error at the offending field', () => {
    const parsed = parseCron('0 0 * * 99');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const field = parsed.value.fields.find((f) => f.name === 'dayOfWeek');
    expect(field?.error?.span?.start).toBeGreaterThan(0);
  });
});
