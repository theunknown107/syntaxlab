import { describe, expect, it } from 'vitest';

import { analyzeCron } from '@/domain/cron/analyze';
import { LIMITS } from '@/domain/shared/limits';
import {
  buildSchedule,
  dayMatches,
  nextOccurrence,
  nextOccurrences,
  type ScheduleModel,
} from '@/domain/cron/schedule';

/**
 * Schedule execution — 04_PARSER_ARCHITECTURE.md §4.4, 13_TEST_PLAN.md
 *
 * **Every expected answer below was worked out by hand from the schedule and
 * the calendar, not read off the implementation.** That is the only thing that
 * makes a corpus worth having: a test whose expectation came from the code it
 * tests proves the code has not changed, not that it is right.
 *
 * UTC is used wherever the answer should not depend on the machine, which is
 * almost everywhere. The daylight-saving cases pin `process.env.TZ` instead,
 * because they are precisely about the zone.
 */

/** Builds a schedule from real analysis. No fixtures — the parser is the input. */
function schedule(source: string): ScheduleModel {
  const analysis = analyzeCron(source, { timezoneMode: 'utc' });
  if (!analysis.ok) throw new Error(`${source} did not analyse: ${analysis.error.message}`);
  const built = buildSchedule(analysis.value);
  if (!built.ok) throw new Error(`${source} did not build: ${built.reason}`);
  return built.schedule;
}

/** The next occurrence, as an ISO string, so failures read as dates. */
function nextUtc(source: string, afterIso: string): string | null {
  const occurrence = nextOccurrence(schedule(source), {
    mode: 'utc',
    after: Date.parse(afterIso),
  });
  if (occurrence?.epochMs == null) return null;
  return isoMinute(occurrence.epochMs);
}

/** Minute resolution, because that is the resolution a cron schedule has. */
function isoMinute(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 16)}:00Z`;
}

/* ------------------------------------------------------------------ *
 * The golden corpus
 * ------------------------------------------------------------------ */

describe('next occurrence in UTC', () => {
  it.each([
    // [expression, after, expected] — every row reasoned from the calendar.
    ['* * * * *', '2026-03-10T12:30:00Z', '2026-03-10T12:31:00Z'],
    ['* * * * *', '2026-03-10T12:30:59Z', '2026-03-10T12:31:00Z'],
    // Strictly after: a schedule due exactly now has already been due.
    ['0 * * * *', '2026-03-10T12:00:00Z', '2026-03-10T13:00:00Z'],
    ['0 * * * *', '2026-03-10T12:00:01Z', '2026-03-10T13:00:00Z'],
    ['*/15 * * * *', '2026-03-10T12:07:00Z', '2026-03-10T12:15:00Z'],
    ['*/15 * * * *', '2026-03-10T12:46:00Z', '2026-03-10T13:00:00Z'],
    ['30 4 * * *', '2026-03-10T12:00:00Z', '2026-03-11T04:30:00Z'],
    ['30 4 * * *', '2026-03-10T04:00:00Z', '2026-03-10T04:30:00Z'],
    // Hour rollover into the next day.
    ['0 0 * * *', '2026-03-10T23:59:00Z', '2026-03-11T00:00:00Z'],
    // Month rollover: 31 January to 1 February.
    ['0 0 1 * *', '2026-01-15T00:00:00Z', '2026-02-01T00:00:00Z'],
    // Year rollover.
    ['0 0 1 1 *', '2026-06-01T00:00:00Z', '2027-01-01T00:00:00Z'],
    // A weekday. 2026-03-10 is a Tuesday, so the next Monday is the 16th.
    ['0 9 * * 1', '2026-03-10T12:00:00Z', '2026-03-16T09:00:00Z'],
    // Sunday written as 0 and as 7 must agree. 2026-03-15 is a Sunday.
    ['0 9 * * 0', '2026-03-10T12:00:00Z', '2026-03-15T09:00:00Z'],
    ['0 9 * * 7', '2026-03-10T12:00:00Z', '2026-03-15T09:00:00Z'],
    ['0 9 * * SUN', '2026-03-10T12:00:00Z', '2026-03-15T09:00:00Z'],
    // A range of hours on weekdays. Friday 13 March, then Monday 16 March.
    ['0 9-17 * * 1-5', '2026-03-13T17:30:00Z', '2026-03-16T09:00:00Z'],
    // A list.
    ['15,45 * * * *', '2026-03-10T12:20:00Z', '2026-03-10T12:45:00Z'],
    ['15,45 * * * *', '2026-03-10T12:50:00Z', '2026-03-10T13:15:00Z'],
    // A step over a range.
    ['0 0-12/6 * * *', '2026-03-10T01:00:00Z', '2026-03-10T06:00:00Z'],
    // Month names.
    ['0 0 1 JAN *', '2026-02-01T00:00:00Z', '2027-01-01T00:00:00Z'],
    // 29 February exists in 2028, not 2027.
    ['0 0 29 2 *', '2026-03-01T00:00:00Z', '2028-02-29T00:00:00Z'],
    // 31st of a month: April has 30 days, so April is skipped for May.
    ['0 0 31 * *', '2026-04-01T00:00:00Z', '2026-05-31T00:00:00Z'],
    // The last minute of the year.
    ['59 23 31 12 *', '2026-12-31T23:00:00Z', '2026-12-31T23:59:00Z'],
    // A step on a bare value: 5/10 is 5,15,25,35,45,55.
    ['5/10 * * * *', '2026-03-10T12:06:00Z', '2026-03-10T12:15:00Z'],
  ])('%s after %s', (source, after, expected) => {
    expect(nextUtc(source, after)).toBe(expected);
  });
});

describe('macros execute as their expansion', () => {
  it.each([
    ['@hourly', '2026-03-10T12:30:00Z', '2026-03-10T13:00:00Z'],
    ['@daily', '2026-03-10T12:30:00Z', '2026-03-11T00:00:00Z'],
    ['@midnight', '2026-03-10T12:30:00Z', '2026-03-11T00:00:00Z'],
    // 2026-03-10 is a Tuesday; the next Sunday is the 15th.
    ['@weekly', '2026-03-10T12:30:00Z', '2026-03-15T00:00:00Z'],
    ['@monthly', '2026-03-10T12:30:00Z', '2026-04-01T00:00:00Z'],
    ['@yearly', '2026-03-10T12:30:00Z', '2027-01-01T00:00:00Z'],
    ['@annually', '2026-03-10T12:30:00Z', '2027-01-01T00:00:00Z'],
  ])('%s after %s', (source, after, expected) => {
    expect(nextUtc(source, after)).toBe(expected);
  });

  it('refuses to schedule @reboot rather than inventing a time', () => {
    const analysis = analyzeCron('@reboot', { timezoneMode: 'utc' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    const built = buildSchedule(analysis.value);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe('NOT_SCHEDULABLE');
  });
});

describe('hostile arguments', () => {
  /**
   * Found by the M16 final audit, not by a user: an `after` outside the range
   * `Date` can represent used to produce "occurrences" whose year was `NaN` and
   * whose instant was `null` — without the `skipped` anomaly that is the only
   * thing allowed to carry a null instant. A run that does not exist, presented
   * as a run, which is the single output this engine must never produce.
   *
   * The worker-result validator rejected those, so nothing ever reached a
   * screen. That is the net; this is the fix.
   */
  it.each([
    ['beyond the end of representable time', Number.MAX_SAFE_INTEGER],
    ['before the beginning of it', -Number.MAX_SAFE_INTEGER],
    ['not a number at all', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('refuses a start instant that is %s', (_label, after) => {
    const search = nextOccurrences(schedule('* * * * *'), { mode: 'utc', after, count: 5 });

    expect(search.ok).toBe(false);
    if (search.ok) return;
    expect(search.reason).toBe('NO_OCCURRENCE_IN_HORIZON');
    // Refused before searching, rather than after walking a calendar of NaN.
    expect(search.steps).toBe(0);
  });

  it('still answers at the very edge of representable time', () => {
    // One day inside the boundary, so the search itself is ordinary.
    const search = nextOccurrences(schedule('* * * * *'), {
      mode: 'utc',
      after: 8.64e15 - 86_400_000,
      count: 2,
    });
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    for (const occurrence of search.occurrences) {
      expect(Number.isFinite(occurrence.wall.year)).toBe(true);
      // Either a real instant, or the one anomaly allowed to have none.
      if (occurrence.epochMs === null) expect(occurrence.anomaly).toBe('skipped');
      else expect(Number.isFinite(occurrence.epochMs)).toBe(true);
    }
  });

  it('clamps a count no UI would ask for, rather than allocating it', () => {
    const started = performance.now();
    const search = nextOccurrences(schedule('* * * * *'), {
      mode: 'utc',
      after: Date.parse('2026-03-10T12:00:00Z'),
      count: Number.MAX_SAFE_INTEGER,
    });
    const elapsed = performance.now() - started;

    expect(search.ok).toBe(true);
    if (!search.ok) return;
    expect(search.occurrences).toHaveLength(LIMITS.cron.maxOccurrences);
    expect(elapsed).toBeLessThan(100);
  });
});

/* ------------------------------------------------------------------ *
 * The day rule — the correctness gate
 * ------------------------------------------------------------------ */

describe('day-of-month and day-of-week', () => {
  it('runs on either day when both are restricted, not on the intersection', () => {
    // `0 0 1 * 1` is "the 1st, AND ALSO every Monday". March 2026: the 1st is
    // a Sunday, and the Mondays are the 2nd, 9th, 16th, 23rd, 30th. Starting
    // on the 3rd, the next run is Monday the 9th — an AND reading would find
    // nothing in March at all.
    expect(nextUtc('0 0 1 * 1', '2026-03-03T00:00:00Z')).toBe('2026-03-09T00:00:00Z');
    // And the 1st itself runs even though it is a Sunday.
    expect(nextUtc('0 0 1 * 1', '2026-02-25T00:00:00Z')).toBe('2026-03-01T00:00:00Z');
  });

  it('uses only day-of-week when day-of-month is unrestricted', () => {
    // 2026-03-10 is a Tuesday. Next Monday: the 16th.
    expect(nextUtc('0 0 * * 1', '2026-03-10T00:00:00Z')).toBe('2026-03-16T00:00:00Z');
  });

  it('uses only day-of-month when day-of-week is unrestricted', () => {
    expect(nextUtc('0 0 1 * *', '2026-03-10T00:00:00Z')).toBe('2026-04-01T00:00:00Z');
  });

  it('runs every day when neither is restricted', () => {
    expect(nextUtc('0 0 * * *', '2026-03-10T01:00:00Z')).toBe('2026-03-11T00:00:00Z');
  });

  it('treats a full-range day field as unrestricted, so the OR rule does not fire', () => {
    // `1-31` selects every day, so it restricts nothing: this must behave as
    // "every Monday", not as "every day or Monday".
    expect(nextUtc('0 0 1-31 * 1', '2026-03-10T00:00:00Z')).toBe('2026-03-16T00:00:00Z');
  });

  it('exposes the rule directly, for every combination', () => {
    const both = schedule('0 0 1 * 1');
    expect(dayMatches(both, 1, 3)).toBe(true); // the 1st, a Wednesday
    expect(dayMatches(both, 9, 1)).toBe(true); // a Monday
    expect(dayMatches(both, 10, 2)).toBe(false); // neither

    const domOnly = schedule('0 0 1 * *');
    expect(dayMatches(domOnly, 1, 3)).toBe(true);
    expect(dayMatches(domOnly, 9, 1)).toBe(false);

    const dowOnly = schedule('0 0 * * 1');
    expect(dayMatches(dowOnly, 1, 3)).toBe(false);
    expect(dayMatches(dowOnly, 9, 1)).toBe(true);

    const neither = schedule('0 0 * * *');
    expect(dayMatches(neither, 1, 3)).toBe(true);
    expect(dayMatches(neither, 17, 5)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Schedules that never run
 * ------------------------------------------------------------------ */

describe('unsatisfiable schedules', () => {
  it('reports that 30 February never runs, rather than searching forever', () => {
    const search = nextOccurrences(schedule('0 0 30 2 *'), {
      mode: 'utc',
      after: Date.parse('2026-01-01T00:00:00Z'),
    });
    expect(search.ok).toBe(false);
    if (search.ok) return;
    expect(search.reason).toBe('NO_OCCURRENCE_IN_HORIZON');
    expect(search.horizonYears).toBe(5);
  });

  it('reports 31 February the same way', () => {
    const search = nextOccurrences(schedule('0 0 31 2 *'), {
      mode: 'utc',
      after: Date.parse('2026-01-01T00:00:00Z'),
    });
    expect(search.ok).toBe(false);
  });

  it('still finds 29 February, which is rare but real', () => {
    // The horizon has to be long enough for the leap cycle. Four years plus
    // slack is why it is five.
    expect(nextUtc('0 0 29 2 *', '2029-03-01T00:00:00Z')).toBe('2032-02-29T00:00:00Z');
  });
});

/* ------------------------------------------------------------------ *
 * Lists of occurrences
 * ------------------------------------------------------------------ */

describe('upcoming occurrences', () => {
  it('returns them in order, strictly increasing', () => {
    const search = nextOccurrences(schedule('*/20 * * * *'), {
      mode: 'utc',
      after: Date.parse('2026-03-10T12:05:00Z'),
      count: 5,
    });
    expect(search.ok).toBe(true);
    if (!search.ok) return;

    const times = search.occurrences.map((occurrence) =>
      occurrence.epochMs === null ? null : isoMinute(occurrence.epochMs),
    );
    expect(times).toEqual([
      '2026-03-10T12:20:00Z',
      '2026-03-10T12:40:00Z',
      '2026-03-10T13:00:00Z',
      '2026-03-10T13:20:00Z',
      '2026-03-10T13:40:00Z',
    ]);
  });

  it('never returns more than the documented cap, however many are asked for', () => {
    const search = nextOccurrences(schedule('* * * * *'), {
      mode: 'utc',
      after: Date.parse('2026-03-10T12:00:00Z'),
      count: 10_000,
    });
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    expect(search.occurrences).toHaveLength(10);
  });

  it('returns at least one even when asked for none', () => {
    const search = nextOccurrences(schedule('* * * * *'), {
      mode: 'utc',
      after: Date.parse('2026-03-10T12:00:00Z'),
      count: 0,
    });
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    expect(search.occurrences).toHaveLength(1);
  });

  it('stops at the horizon rather than padding the list', () => {
    // One run a year, asked for ten: the horizon holds about five.
    const search = nextOccurrences(schedule('0 0 1 1 *'), {
      mode: 'utc',
      after: Date.parse('2026-06-01T00:00:00Z'),
      count: 10,
    });
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    expect(search.occurrences.length).toBeGreaterThan(0);
    expect(search.occurrences.length).toBeLessThan(10);
  });
});

/* ------------------------------------------------------------------ *
 * Refusals at the schedule boundary
 * ------------------------------------------------------------------ */

describe('what will not build a schedule', () => {
  it('refuses an analysis with a broken field', () => {
    const analysis = analyzeCron('99 12 * * *', { timezoneMode: 'utc' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    const built = buildSchedule(analysis.value);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe('FIELD_ERROR');
  });

  it('refuses a forged dialect, even though the type says it cannot happen', () => {
    // The value crosses a worker boundary, where a type is a hope. This is the
    // lock restated at the executor.
    const analysis = analyzeCron('0 0 * * *', { timezoneMode: 'utc' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;

    const forged = { ...analysis.value, dialect: 'quartz6' } as unknown as Parameters<
      typeof buildSchedule
    >[0];
    const built = buildSchedule(forged);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe('UNSUPPORTED_DIALECT');
  });

  it('refuses a forged field count', () => {
    const analysis = analyzeCron('0 0 * * *', { timezoneMode: 'utc' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;

    const forged = {
      ...analysis.value,
      fields: [...analysis.value.fields, analysis.value.fields[0]],
    } as unknown as Parameters<typeof buildSchedule>[0];
    const built = buildSchedule(forged);
    expect(built.ok).toBe(false);
  });
});
