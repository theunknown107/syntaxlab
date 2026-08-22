import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { analyzeCron } from '@/domain/cron/analyze';
import {
  buildSchedule,
  nextOccurrence,
  nextOccurrences,
  type ScheduleModel,
} from '@/domain/cron/schedule';
import { LIMITS } from '@/domain/shared/limits';

/**
 * Schedule properties — 13_TEST_PLAN.md, brief §37
 *
 * The golden corpus says the engine is right about the cases someone thought
 * of. These say it is right about the ones nobody did — and, just as
 * importantly, that it always *stops*.
 *
 * The strongest test here is differential: `naiveNext` walks forward a minute
 * at a time and asks "does this one match?", which is the definition of a cron
 * schedule rather than an implementation of one. It is far too slow to ship and
 * exactly right, so it is the reference the fast field-advancing search is
 * checked against. Its day rule is written out separately on purpose: if both
 * copies read the OR rule from the same helper, agreeing would prove nothing.
 */

const SEED = 20260822;
const CONFIG = { seed: SEED, numRuns: 300 } as const;

/* ------------------------------------------------------------------ *
 * Generators — real expressions, parsed by the real parser
 * ------------------------------------------------------------------ */

const minuteTerm = fc.oneof(
  fc.constant('*'),
  fc.integer({ min: 0, max: 59 }).map(String),
  fc.constantFrom('*/5', '*/15', '0,30', '5-10', '0-59/20', '7/13'),
);
const hourTerm = fc.oneof(
  fc.constant('*'),
  fc.integer({ min: 0, max: 23 }).map(String),
  fc.constantFrom('*/6', '9-17', '0,12', '1-23/4'),
);
const domTerm = fc.oneof(
  fc.constant('*'),
  fc.integer({ min: 1, max: 31 }).map(String),
  fc.constantFrom('1-15', '*/10', '1,15,31', '29'),
);
const monthTerm = fc.oneof(
  fc.constant('*'),
  fc.integer({ min: 1, max: 12 }).map(String),
  fc.constantFrom('1-6', '*/3', 'JAN,JUL', '2'),
);
const dowTerm = fc.oneof(
  fc.constant('*'),
  fc.integer({ min: 0, max: 7 }).map(String),
  fc.constantFrom('1-5', 'MON', '0,6', '*/2'),
);

const expression = fc
  .tuple(minuteTerm, hourTerm, domTerm, monthTerm, dowTerm)
  .map(([minute, hour, dom, month, dow]) => `${minute} ${hour} ${dom} ${month} ${dow}`);

/** Instants inside the range the app deals with, on a whole minute. */
const startInstant = fc
  .integer({ min: Date.UTC(2024, 0, 1) / 60_000, max: Date.UTC(2030, 0, 1) / 60_000 })
  .map((minutes) => minutes * 60_000);

function scheduleOf(source: string): ScheduleModel | null {
  const analysis = analyzeCron(source, { timezoneMode: 'utc' });
  if (!analysis.ok) return null;
  const built = buildSchedule(analysis.value);
  return built.ok ? built.schedule : null;
}

/* ------------------------------------------------------------------ *
 * The independent reference
 * ------------------------------------------------------------------ */

/**
 * Does this UTC instant match? Written from the specification, not from the
 * engine — including its own copy of the day rule (04_PARSER_ARCHITECTURE §4.7):
 * when both day fields are restricted the schedule runs on *either*, and a
 * field that selects its whole range restricts nothing.
 */
function matchesNaively(schedule: ScheduleModel, epochMs: number): boolean {
  const at = new Date(epochMs);
  if (!schedule.minutes.includes(at.getUTCMinutes())) return false;
  if (!schedule.hours.includes(at.getUTCHours())) return false;
  if (!schedule.months.includes(at.getUTCMonth() + 1)) return false;

  const domRestricted = schedule.daysOfMonth.length < 31;
  const dowRestricted = schedule.daysOfWeek.length < 7;
  const domHit = schedule.daysOfMonth.includes(at.getUTCDate());
  const dowHit = schedule.daysOfWeek.includes(at.getUTCDay());

  if (domRestricted && dowRestricted) return domHit || dowHit;
  if (domRestricted) return domHit;
  if (dowRestricted) return dowHit;
  return true;
}

/** The next match, found the slow honest way. `null` if none within the window. */
function naiveNext(schedule: ScheduleModel, after: number, windowMinutes: number): number | null {
  let candidate = Math.floor(after / 60_000) * 60_000 + 60_000;
  for (let step = 0; step < windowMinutes; step += 1) {
    if (matchesNaively(schedule, candidate)) return candidate;
    candidate += 60_000;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Properties
 * ------------------------------------------------------------------ */

describe('the fast search agrees with a minute-by-minute scan', () => {
  it('finds the same next occurrence, and skips nothing on the way to it', () => {
    // 45 days of minutes: wide enough to cross month ends, leap days and the
    // sparse `29`/`2` schedules. The scan stops at the engine's answer rather
    // than running the full window every time, which is both far cheaper and a
    // stronger check — reaching that answer without a match proves no run was
    // skipped in between, not merely that the answer itself matches.
    const window = 45 * 24 * 60;

    fc.assert(
      fc.property(expression, startInstant, (source, after) => {
        const schedule = scheduleOf(source);
        if (schedule === null) return; // rejected by the parser, not our business

        const claimed = nextOccurrence(schedule, { mode: 'utc', after })?.epochMs ?? null;
        const distance = claimed === null ? window : Math.ceil((claimed - after) / 60_000);
        const reference = naiveNext(schedule, after, Math.min(distance, window));

        if (claimed !== null && distance <= window) {
          // The scan walked every minute up to the claim and found this first.
          expect(reference, `${source} after ${new Date(after).toISOString()}`).toBe(claimed);
          return;
        }
        // Either the engine found nothing, or its answer is beyond the window.
        // Either way nothing inside the window may match.
        expect(reference, source).toBeNull();
      }),
      CONFIG,
    );
  });
});

describe('every occurrence returned', () => {
  it('is strictly after the instant asked about', () => {
    fc.assert(
      fc.property(expression, startInstant, (source, after) => {
        const schedule = scheduleOf(source);
        if (schedule === null) return;
        const occurrence = nextOccurrence(schedule, { mode: 'utc', after });
        if (occurrence?.epochMs == null) return;
        // Strictly: a schedule due exactly now is already due, not next.
        expect(occurrence.epochMs, source).toBeGreaterThan(after);
      }),
      CONFIG,
    );
  });

  it('satisfies every field of the schedule that produced it', () => {
    fc.assert(
      fc.property(expression, startInstant, (source, after) => {
        const schedule = scheduleOf(source);
        if (schedule === null) return;
        const search = nextOccurrences(schedule, { mode: 'utc', after, count: 5 });
        if (!search.ok) return;
        for (const occurrence of search.occurrences) {
          if (occurrence.epochMs === null) continue;
          expect(matchesNaively(schedule, occurrence.epochMs), source).toBe(true);
        }
      }),
      CONFIG,
    );
  });

  it('comes in strictly increasing order, with no repeats', () => {
    fc.assert(
      fc.property(expression, startInstant, (source, after) => {
        const schedule = scheduleOf(source);
        if (schedule === null) return;
        const search = nextOccurrences(schedule, { mode: 'utc', after, count: 6 });
        if (!search.ok) return;
        const times = search.occurrences.map((occurrence) => occurrence.epochMs);
        for (let index = 1; index < times.length; index += 1) {
          const previous = times[index - 1];
          const current = times[index];
          if (previous == null || current == null) continue;
          expect(current, source).toBeGreaterThan(previous);
        }
      }),
      CONFIG,
    );
  });

  it('never exceeds the requested count or the hard cap', () => {
    fc.assert(
      fc.property(
        expression,
        startInstant,
        fc.integer({ min: 1, max: 50 }),
        (source, after, count) => {
          const schedule = scheduleOf(source);
          if (schedule === null) return;
          const search = nextOccurrences(schedule, { mode: 'utc', after, count });
          if (!search.ok) return;
          expect(search.occurrences.length, source).toBeLessThanOrEqual(
            Math.min(count, LIMITS.cron.maxOccurrences),
          );
        },
      ),
      CONFIG,
    );
  });
});

describe('the search always stops', () => {
  it('stays far under the step tripwire, so the tripwire never fires', () => {
    fc.assert(
      fc.property(expression, startInstant, (source, after) => {
        const schedule = scheduleOf(source);
        if (schedule === null) return;
        const search = nextOccurrences(schedule, { mode: 'utc', after, count: 10 });
        // The bound is a tripwire for a bug, not a budget the search spends.
        // Measuring the margin is the only way to know it is still a tripwire.
        expect(search.steps, source).toBeLessThan(LIMITS.cron.maxSearchSteps);
        expect(search.steps, source).toBeGreaterThan(0);
      }),
      CONFIG,
    );
  });

  it('returns an answer for any schedule the parser accepts, including impossible ones', () => {
    fc.assert(
      fc.property(expression, startInstant, (source, after) => {
        const schedule = scheduleOf(source);
        if (schedule === null) return;
        const started = performance.now();
        const search = nextOccurrences(schedule, { mode: 'utc', after, count: 10 });
        const elapsed = performance.now() - started;
        // Either occurrences or an honest "none within the horizon" — never a
        // hang, and never a throw.
        expect(typeof search.ok, source).toBe('boolean');
        expect(elapsed, source).toBeLessThan(250);
      }),
      CONFIG,
    );
  });

  it('reports the horizon rather than searching forever for a date that never comes', () => {
    // 30 February. No amount of searching finds one, so the bound is the only
    // thing that ends this.
    const schedule = scheduleOf('0 0 30 2 *');
    expect(schedule).not.toBeNull();
    if (schedule === null) return;

    const started = performance.now();
    const search = nextOccurrences(schedule, {
      mode: 'utc',
      after: Date.parse('2026-01-01T00:00:00Z'),
      count: 10,
    });
    const elapsed = performance.now() - started;

    expect(search.ok).toBe(false);
    if (search.ok) return;
    expect(search.reason).toBe('NO_OCCURRENCE_IN_HORIZON');
    expect(search.horizonYears).toBe(LIMITS.cron.searchYears);
    expect(elapsed).toBeLessThan(250);
  });
});

describe('UTC mode', () => {
  it('never reports a daylight-saving anomaly, because UTC has none', () => {
    fc.assert(
      fc.property(expression, startInstant, (source, after) => {
        const schedule = scheduleOf(source);
        if (schedule === null) return;
        const search = nextOccurrences(schedule, { mode: 'utc', after, count: 5 });
        if (!search.ok) return;
        for (const occurrence of search.occurrences) {
          expect(occurrence.anomaly, source).toBeUndefined();
          expect(occurrence.offsetMinutes, source).toBe(0);
        }
      }),
      CONFIG,
    );
  });
});
