import { describe, expect, it } from 'vitest';

import { analyzeCron } from '@/domain/cron/analyze';
import { CRON_MACROS, parseCron } from '@/domain/cron/parser';
import { LIMITS } from '@/domain/shared/limits';

/**
 * Cron parser — 04_PARSER_ARCHITECTURE.md §4.1–4.3, 13_TEST_PLAN.md
 *
 * The field-count lock is the most important behaviour in the feature, so it
 * gets the most tests. Everything else is ordinary grammar coverage.
 */

/** Convenience: the fields of an expression that is expected to parse. */
function fieldsOf(source: string) {
  const parsed = parseCron(source);
  if (!parsed.ok) throw new Error(`expected ${source} to parse: ${parsed.error.message}`);
  return parsed.value.fields;
}

function resolved(source: string, name: string): readonly number[] {
  return fieldsOf(source).find((field) => field.name === name)?.resolved ?? [];
}

/* ------------------------------------------------------------------ *
 * The dialect lock
 * ------------------------------------------------------------------ */

describe('the 5-field lock', () => {
  it('accepts exactly five fields', () => {
    for (const source of ['* * * * *', '0 0 * * *', '*/15 9-17 * * 1-5', '0 12 1 1 0']) {
      expect(parseCron(source).ok, source).toBe(true);
    }
  });

  it('refuses six fields rather than guessing a dialect', () => {
    // `0 0 12 * * ?` is seconds-first Quartz; other conventions append a year.
    // The two describe different schedules, so guessing is worse than refusing.
    const parsed = parseCron('0 0 12 * * ?');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('UNSUPPORTED');
    expect(parsed.error.message).toContain('6 fields');
    expect(parsed.error.hint).toMatch(/seconds/i);
  });

  it('refuses seven fields', () => {
    const parsed = parseCron('0 0 12 * * ? 2026');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('UNSUPPORTED');
    expect(parsed.error.message).toContain('7 fields');
  });

  it('never reinterprets a 6-field expression as 5 by dropping a field', () => {
    // The failure this guards against: silently treating seconds-first input
    // as if the leading field were minutes.
    for (const source of ['0 0 12 * * ?', '30 0 0 1 1 *', '* * * * * *']) {
      const parsed = parseCron(source);
      expect(parsed.ok, source).toBe(false);
    }
  });

  it('reports too few fields as a plain syntax error, not a dialect refusal', () => {
    const parsed = parseCron('* * *');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('SYNTAX');
    expect(parsed.error.message).toContain('found 3');
  });

  it('tolerates irregular whitespace between fields', () => {
    expect(parseCron('  *   *  *\t* *  ').ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Grammar
 * ------------------------------------------------------------------ */

describe('field grammar', () => {
  it('expands a wildcard to the whole range', () => {
    expect(resolved('* * * * *', 'minute')).toHaveLength(60);
    expect(resolved('* * * * *', 'hour')).toHaveLength(24);
    expect(resolved('* * * * *', 'dayOfMonth')).toHaveLength(31);
    expect(resolved('* * * * *', 'month')).toHaveLength(12);
  });

  it('reads a single value', () => {
    expect(resolved('5 * * * *', 'minute')).toEqual([5]);
  });

  it('reads a list', () => {
    expect(resolved('1,5,10 * * * *', 'minute')).toEqual([1, 5, 10]);
  });

  it('reads a range', () => {
    expect(resolved('1-5 * * * *', 'minute')).toEqual([1, 2, 3, 4, 5]);
  });

  it('reads a step over everything', () => {
    expect(resolved('*/15 * * * *', 'minute')).toEqual([0, 15, 30, 45]);
  });

  it('reads a step over a range', () => {
    expect(resolved('1-10/2 * * * *', 'minute')).toEqual([1, 3, 5, 7, 9]);
  });

  it('combines lists, ranges and steps in one field', () => {
    expect(resolved('0,10-12,*/20 * * * *', 'minute')).toEqual([0, 10, 11, 12, 20, 40]);
  });

  it('sorts and deduplicates, while keeping the terms the user wrote', () => {
    // Source fidelity and semantics are separate: `resolved` collapses the
    // duplicate, `terms` still records that three were written (brief §29).
    expect(resolved('1,2,2,3 * * * *', 'minute')).toEqual([1, 2, 3]);
    const field = fieldsOf('1,2,2,3 * * * *').find((f) => f.name === 'minute');
    expect(field?.terms).toHaveLength(4);
    expect(field?.raw).toBe('1,2,2,3');
  });
});

/* ------------------------------------------------------------------ *
 * Names
 * ------------------------------------------------------------------ */

describe('names', () => {
  it('accepts month names, case-insensitively', () => {
    expect(resolved('0 0 1 JAN *', 'month')).toEqual([1]);
    expect(resolved('0 0 1 dec *', 'month')).toEqual([12]);
  });

  it('accepts weekday names', () => {
    expect(resolved('0 0 * * MON', 'dayOfWeek')).toEqual([1]);
    expect(resolved('0 0 * * mon-fri', 'dayOfWeek')).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects a name in a field that does not take names', () => {
    const field = fieldsOf('MON * * * *').find((f) => f.name === 'minute');
    expect(field?.error?.code).toBe('SYNTAX');
  });

  it('rejects an unrecognised name with the legal values in the hint', () => {
    const field = fieldsOf('0 0 1 SMARCH *').find((f) => f.name === 'month');
    expect(field?.error?.message).toMatch(/not a recognised month/i);
    expect(field?.error?.hint).toContain('JAN');
  });
});

/* ------------------------------------------------------------------ *
 * Ranges and steps
 * ------------------------------------------------------------------ */

describe('validation', () => {
  it('rejects out-of-range values per field', () => {
    const cases: [string, string][] = [
      ['60 * * * *', 'minute'],
      ['* 24 * * *', 'hour'],
      ['* * 32 * *', 'dayOfMonth'],
      ['* * * 13 *', 'month'],
      ['* * * * 8', 'dayOfWeek'],
    ];
    for (const [source, name] of cases) {
      const field = fieldsOf(source).find((f) => f.name === name);
      expect(field?.error?.code, source).toBe('SYNTAX');
      expect(field?.error?.message, source).toMatch(/out of range/i);
    }
  });

  it('accepts the boundaries of every field', () => {
    expect(parseCron('0 0 1 1 0').ok).toBe(true);
    expect(parseCron('59 23 31 12 7').ok).toBe(true);
  });

  it('refuses a backwards range rather than guessing whether it wraps', () => {
    const field = fieldsOf('5-2 * * * *').find((f) => f.name === 'minute');
    expect(field?.error?.message).toMatch(/runs backwards/i);
    expect(field?.error?.hint).toMatch(/wrap/i);
  });

  it('rejects malformed steps', () => {
    const malformed = ['*/ * * * *', '/5 * * * *', '1- * * * *', '-5 * * * *', '1-5/ * * * *'];
    for (const source of malformed) {
      const parsed = parseCron(source);
      // Either the whole parse fails or the minute field carries the error.
      const failed = !parsed.ok || parsed.value.fields.some((f) => f.error !== undefined);
      expect(failed, source).toBe(true);
    }
  });

  it('rejects a zero step, which would never advance', () => {
    const field = fieldsOf('1-5/0 * * * *').find((f) => f.name === 'minute');
    expect(field?.error?.message).toMatch(/never advance/i);
  });

  it('rejects more than one step in a term', () => {
    const field = fieldsOf('1-5/2/3 * * * *').find((f) => f.name === 'minute');
    expect(field?.error?.message).toMatch(/only one step/i);
  });

  it('rejects an empty list element', () => {
    const field = fieldsOf('1,,3 * * * *').find((f) => f.name === 'minute');
    expect(field?.error?.code).toBe('SYNTAX');
  });
});

/* ------------------------------------------------------------------ *
 * Foreign dialects
 * ------------------------------------------------------------------ */

describe('foreign syntax', () => {
  it('names the scheduler each unsupported symbol comes from', () => {
    const cases: [string, RegExp][] = [
      ['0 0 L * *', /Quartz/],
      ['0 0 W * *', /Quartz/],
      ['0 0 * * 6#3', /Quartz/],
      ['0 0 * * ?', /Quartz/],
      ['H 0 * * *', /Jenkins/],
    ];
    for (const [source, scheduler] of cases) {
      const parsed = parseCron(source);
      const errors = parsed.ok
        ? parsed.value.fields.flatMap((f) => (f.error ? [f.error] : []))
        : [parsed.error];
      expect(errors.length, source).toBeGreaterThan(0);
      expect(
        errors.some((e) => scheduler.test(e.message)),
        source,
      ).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Macros
 * ------------------------------------------------------------------ */

describe('macros', () => {
  it('expands every documented macro to its 5-field equivalent', () => {
    for (const [macro, expansion] of Object.entries(CRON_MACROS)) {
      const viaMacro = parseCron(macro);
      const direct = parseCron(expansion);
      expect(viaMacro.ok, macro).toBe(true);
      expect(direct.ok, expansion).toBe(true);
      if (!viaMacro.ok || !direct.ok) continue;
      expect(
        viaMacro.value.fields.map((f) => f.resolved),
        macro,
      ).toEqual(direct.value.fields.map((f) => f.resolved));
      expect(viaMacro.value.macro).toBe(macro);
    }
  });

  it('recognises @reboot without inventing a schedule for it', () => {
    const parsed = parseCron('@reboot');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nonSchedulable).toBe(true);
    expect(parsed.value.fields).toHaveLength(0);
  });

  it('rejects an unknown macro and lists the supported ones', () => {
    const parsed = parseCron('@fortnightly');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.hint).toContain('@daily');
  });
});

/* ------------------------------------------------------------------ *
 * Limits
 * ------------------------------------------------------------------ */

describe('limits', () => {
  it('refuses an expression over the input limit', () => {
    const parsed = parseCron('*'.repeat(LIMITS.cron.input + 1));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('LIMIT_EXCEEDED');
  });

  it('refuses a field with too many terms', () => {
    const many = Array.from({ length: LIMITS.cron.maxTermsPerField + 5 }, () => '1').join(',');
    const field = fieldsOf(`${many} * * * *`).find((f) => f.name === 'minute');
    expect(field?.error?.code).toBe('LIMIT_EXCEEDED');
  });

  it('reports an empty expression as something to fill in', () => {
    const parsed = parseCron('   ');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.hint).toContain('*/15');
  });
});

/* ------------------------------------------------------------------ *
 * Recovery
 * ------------------------------------------------------------------ */

describe('recovery', () => {
  it('still explains the good fields when one is wrong', () => {
    // One bad field costs the user that field, not the whole analysis — the
    // same posture as the regex parser.
    const analysis = analyzeCron('99 12 * * *');
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.value.errors).toHaveLength(1);
    expect(analysis.value.fields.find((f) => f.name === 'hour')?.resolved).toEqual([12]);
  });
});
