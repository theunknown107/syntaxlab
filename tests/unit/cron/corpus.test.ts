import { describe, expect, it } from 'vitest';

import { analyzeCron } from '@/domain/cron/analyze';
import type { CronAnalysis } from '@/domain/cron/ast';
import { parseCron } from '@/domain/cron/parser';

/**
 * The cron golden corpus — 13_TEST_PLAN.md, brief §41
 *
 * Every case below was read by a person and its expectation written by hand.
 * That is the point of a golden corpus: it is the only test file where the
 * expected answer is a judgement rather than a derivation, so a change that
 * quietly alters behaviour has to be argued with rather than absorbed.
 *
 * Three groups, and the third is the one that keeps the dialect honest:
 * expressions that are valid in *another* scheduler. If those ever start
 * parsing, SyntaxLab has become dialect-agnostic by accident.
 */

function analyse(source: string): CronAnalysis | null {
  const result = analyzeCron(source, { timezoneMode: 'utc' });
  return result.ok ? result.value : null;
}

/** True when the expression parses AND every field is free of errors. */
function isFullyValid(source: string): boolean {
  const analysis = analyse(source);
  return analysis !== null && analysis.errors.length === 0;
}

/* ------------------------------------------------------------------ *
 * Valid
 * ------------------------------------------------------------------ */

const VALID: readonly [string, string][] = [
  ['* * * * *', 'every minute'],
  ['0 * * * *', 'hourly, on the hour'],
  ['0 0 * * *', 'daily at midnight'],
  ['30 4 * * *', 'daily at 04:30'],
  ['*/15 * * * *', 'every quarter hour'],
  ['*/15 9-17 * * 1-5', 'every quarter hour during office hours on weekdays'],
  ['0 0 1 * *', 'the first of every month'],
  ['0 0 * * 0', 'Sundays, written as 0'],
  ['0 0 * * 7', 'Sundays, written as 7'],
  ['0 0 * * SUN', 'Sundays, written as a name'],
  ['0 0 1 1 *', 'new year'],
  ['0 0 1 JAN *', 'new year, month by name'],
  ['15,45 * * * *', 'twice an hour'],
  ['0 9-17 * * MON-FRI', 'office hours, names and a range'],
  ['0 0 1-7 * 1', 'first Monday-ish — the OR rule case'],
  ['59 23 31 12 *', 'the last minute of the year'],
  ['0 0 29 2 *', '29 February — valid syntax, rare in practice'],
  ['1-10/2 * * * *', 'a step over a range'],
  ['0,15,30,45 * * * *', 'an explicit list'],
  ['0 */6 * * *', 'every six hours'],
  ['@hourly', 'macro'],
  ['@daily', 'macro'],
  ['@midnight', 'macro, alias of daily'],
  ['@weekly', 'macro'],
  ['@monthly', 'macro'],
  ['@yearly', 'macro'],
  ['@annually', 'macro, alias of yearly'],
];

describe('valid expressions', () => {
  it.each(VALID)('accepts %s — %s', (source) => {
    expect(isFullyValid(source), source).toBe(true);
  });

  it('gives every valid expression a non-empty summary and five fields', () => {
    for (const [source] of VALID) {
      const analysis = analyse(source);
      expect(analysis, source).not.toBeNull();
      if (analysis === null) continue;
      expect(analysis.explanation.summary.length, source).toBeGreaterThan(0);
      expect(analysis.fields.length, source).toBe(5);
      expect(analysis.dialect, source).toBe('standard5');
    }
  });
});

/* ------------------------------------------------------------------ *
 * Invalid
 * ------------------------------------------------------------------ */

const INVALID: readonly [string, string][] = [
  ['', 'empty'],
  ['   ', 'whitespace only'],
  ['* * * *', 'four fields'],
  ['* * * * * *', 'six fields'],
  ['0 0 12 * * ?', 'six fields, Quartz seconds-first'],
  ['0 0 12 * * ? 2026', 'seven fields, Quartz with a year'],
  ['60 * * * *', 'minute out of range'],
  ['* 24 * * *', 'hour out of range'],
  ['* * 0 * *', 'day-of-month below range'],
  ['* * 32 * *', 'day-of-month above range'],
  ['* * * 0 *', 'month below range'],
  ['* * * 13 *', 'month above range'],
  ['* * * * 8', 'day-of-week above range'],
  ['5-2 * * * *', 'backwards range'],
  ['1-5/0 * * * *', 'zero step'],
  ['*/ * * * *', 'step with no number'],
  ['/5 * * * *', 'step with no base'],
  ['1- * * * *', 'range with no end'],
  ['-5 * * * *', 'range with no start'],
  ['1,,3 * * * *', 'empty list element'],
  ['0 0 * * MONDAY', 'a weekday name that is not an alias'],
  ['0 0 1 SMARCH *', 'a month name that does not exist'],
  ['@fortnightly', 'a macro that does not exist'],
  ['abc def ghi jkl mno', 'words in every field'],
];

describe('invalid expressions', () => {
  it.each(INVALID)('rejects %s — %s', (source) => {
    expect(isFullyValid(source), source).toBe(false);
  });

  it('never crashes on any of them', () => {
    for (const [source] of INVALID) {
      expect(() => analyzeCron(source), source).not.toThrow();
    }
  });

  it('always explains why, rather than failing silently', () => {
    for (const [source] of INVALID) {
      const result = analyzeCron(source);
      const messages = result.ok
        ? result.value.errors.map((error) => error.message)
        : [result.error.message];
      expect(messages.length, source).toBeGreaterThan(0);
      for (const message of messages) expect(message.length, source).toBeGreaterThan(10);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Other dialects — the group that keeps this one honest
 * ------------------------------------------------------------------ */

const FOREIGN: readonly [string, string, RegExp][] = [
  ['0 0 L * *', 'Quartz last-day-of-month', /Quartz/],
  ['0 0 LW * *', 'Quartz last weekday', /Quartz/],
  ['0 0 15W * *', 'Quartz nearest weekday to the 15th', /Quartz/],
  ['0 0 * * 6#3', 'Quartz third Saturday', /Quartz/],
  ['0 0 * * ?', 'Quartz no-specific-value', /Quartz/],
  ['0 0 ? * MON', 'Quartz no-specific-value in day-of-month', /Quartz/],
  ['H 0 * * *', 'Jenkins hashed minute', /Jenkins/],
  ['H/15 * * * *', 'Jenkins hashed step', /Jenkins/],
];

describe('expressions from other schedulers', () => {
  it.each(FOREIGN)('refuses %s — %s', (source) => {
    expect(isFullyValid(source), source).toBe(false);
  });

  it.each(FOREIGN)('names the scheduler for %s', (source, _label, scheduler) => {
    const result = analyzeCron(source);
    const messages = result.ok
      ? result.value.errors.map((error) => error.message)
      : [result.error.message];
    expect(
      messages.some((message) => scheduler.test(message)),
      source,
    ).toBe(true);
  });

  it('tells a 6-field user what to try next rather than stopping at "no"', () => {
    const result = parseCron('0 0 12 * * ?');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The refusal has to convert into a next step, or it is a dead end.
    expect(result.error.hint).toMatch(/removing it/i);
  });
});

/* ------------------------------------------------------------------ *
 * Regressions
 *
 * Every entry here was a real defect, found by a test or by review. They stay
 * as named cases so the same mistake cannot return quietly.
 * ------------------------------------------------------------------ */

describe('regressions', () => {
  it('SMARCH is a misspelt month, not Jenkins syntax', () => {
    // The first foreign-syntax scan looked for `H` anywhere in the token and
    // reported Jenkins for any word containing one.
    const result = analyzeCron('0 0 1 SMARCH *');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const message = result.value.errors[0]?.message ?? '';
    expect(message).toMatch(/not a recognised month/i);
    expect(message).not.toMatch(/Jenkins/);
  });

  it('6#3 is caught even though the symbol is embedded, not the whole token', () => {
    const result = analyzeCron('0 0 * * 6#3');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.errors[0]?.message).toMatch(/Quartz/);
  });

  it('a step on a single value runs to the end of the field', () => {
    // It expanded to the base value alone, which is a reading no scheduler
    // implements: `5/10` is `5-59/10` in Vixie cron and cronie.
    const analysis = analyse('5/10 * * * *');
    expect(analysis?.fields.find((f) => f.name === 'minute')?.resolved).toEqual([
      5, 15, 25, 35, 45, 55,
    ]);
    // And the warning says which reading was applied, not just that readings
    // differ — a warning the reader cannot act on is noise.
    const warning = analysis?.warnings.find((w) => w.code === 'NON_STANDARD_STEP_BASE');
    expect(warning?.message).toMatch(/end of the field/);
  });

  it('counts in a step are plural', () => {
    // "every 15 minute" shipped for a while, because the field label is
    // singular and the count was concatenated onto it.
    const body = JSON.stringify(
      analyse('*/15 * * * *')?.explanation.details.find((d) => d.id === 'cron-minute'),
    );
    expect(body).toContain('every 15 minutes');
    expect(body).not.toContain('every 15 minute.');
  });

  it('names the field once per list, not once per term', () => {
    // The section title also carries the field name, so only the body counts.
    const body = JSON.stringify(
      analyse('0 0 1,15 * *')?.explanation.details.find((d) => d.id === 'cron-dayOfMonth')?.body,
    );
    expect(body.match(/day of the month/g)).toHaveLength(1);
  });

  it('reads a contiguous hour range as a window, ending at :59', () => {
    // `9-17` includes the whole of the 17:00 hour. "9 hours of the day" was
    // true and impossible to check against a scheduler.
    const summary = JSON.stringify(analyse('*/15 9-17 * * *')?.explanation.summary);
    expect(summary).toContain('every 15 minutes');
    expect(summary).toContain('between 09:00 and 17:59');
  });

  it('a full-range list does not count as a restriction for the OR rule', () => {
    const analysis = analyse('0 0 1-31 * 1');
    expect(analysis?.warnings.map((w) => w.code)).not.toContain('DOM_DOW_OR_RULE');
  });
});
