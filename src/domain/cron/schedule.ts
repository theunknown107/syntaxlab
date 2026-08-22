import { LIMITS } from '../shared/limits';
import { CRON_FIELD_SPECS, type CronAnalysis, type CronTimezoneMode } from './ast';

/**
 * Schedule execution — 04_PARSER_ARCHITECTURE.md §4.4, §4.6
 *
 * The semantic layer over the parsed expression: given a schedule and an
 * instant, when does it next run?
 *
 * **This file never parses anything.** It consumes a validated `CronAnalysis`
 * and reads its `resolved` sets, which the parser has already expanded, sorted,
 * deduplicated and range-checked. There is one grammar in this codebase and it
 * lives in `parser.ts`; a second one here would be two things to keep in
 * agreement, and cron is a dialect minefield precisely because implementations
 * disagree with themselves.
 *
 * **Cron fields are wall-clock fields.** `0 3 * * *` means "when the clock in
 * the selected zone reads 03:00", not "every 24 hours". So the search runs over
 * calendar components in the selected zone and converts to an instant at the
 * end — which is the step where daylight saving becomes visible, because a
 * wall-clock time can fail to exist or exist twice.
 */

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

/**
 * A schedule, reduced to what execution needs.
 *
 * Sets rather than the parser's arrays: the search asks "is this minute in the
 * schedule" far more often than it enumerates, and `resolved` is already
 * sorted so the ordered arrays are kept alongside for advancing.
 *
 * `dayOfMonthRestricted` and `dayOfWeekRestricted` are stored rather than
 * derived from set size, because "restricted" means *selects less than the
 * whole field* — `1-31` in day-of-month restricts nothing, and getting that
 * wrong fires the OR rule on schedules it does not govern.
 */
export interface ScheduleModel {
  readonly dialect: 'standard5';
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  /** 0–6, Sunday first. The parser has already folded 7 into 0. */
  readonly daysOfWeek: readonly number[];
  readonly dayOfMonthRestricted: boolean;
  readonly dayOfWeekRestricted: boolean;
}

/** Why a schedule could not be built. Distinct from "it never runs". */
export type ScheduleRejection =
  /** A field failed to parse, so there is no semantic set to execute. */
  | 'FIELD_ERROR'
  /** `@reboot` — recognised, explained, and not a clock schedule. */
  | 'NOT_SCHEDULABLE'
  /** A dialect this build does not execute. The lock, restated. */
  | 'UNSUPPORTED_DIALECT';

export type ScheduleBuild =
  | { readonly ok: true; readonly schedule: ScheduleModel }
  | { readonly ok: false; readonly reason: ScheduleRejection };

/**
 * Builds the executable model from a validated analysis.
 *
 * Refuses rather than guesses. A schedule assembled from a field that failed to
 * parse would be a confident answer about an expression the user has not
 * finished writing, which is the failure this whole feature is shaped to avoid.
 */
function rejectionFor(analysis: CronAnalysis): ScheduleRejection | null {
  // The dialect lock, asserted again here. `CronDialect` is a one-member union
  // so the compiler thinks this cannot fail; the value arrives across a worker
  // boundary, where types are a hope rather than a guarantee, and a forged
  // payload claiming another dialect must not reach an executor that would
  // happily run it. Widened deliberately so the check survives.
  const dialect: string = analysis.dialect;
  if (dialect !== 'standard5') return 'UNSUPPORTED_DIALECT';
  if (analysis.fields.length === 0) return 'NOT_SCHEDULABLE';
  if (analysis.fields.length !== LIMITS.cron.fields) return 'UNSUPPORTED_DIALECT';
  if (analysis.errors.length > 0) return 'FIELD_ERROR';
  return null;
}

export function buildSchedule(analysis: CronAnalysis): ScheduleBuild {
  const rejection = rejectionFor(analysis);
  if (rejection !== null) return { ok: false, reason: rejection };

  const by = (name: string) => analysis.fields.find((field) => field.name === name);
  const minute = by('minute');
  const hour = by('hour');
  const dayOfMonth = by('dayOfMonth');
  const month = by('month');
  const dayOfWeek = by('dayOfWeek');

  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return { ok: false, reason: 'FIELD_ERROR' };
  }
  if (
    [minute, hour, dayOfMonth, month, dayOfWeek].some(
      (field) => field.error !== undefined || field.resolved.length === 0,
    )
  ) {
    return { ok: false, reason: 'FIELD_ERROR' };
  }

  return {
    ok: true,
    schedule: {
      dialect: 'standard5',
      minutes: [...minute.resolved],
      hours: [...hour.resolved],
      daysOfMonth: [...dayOfMonth.resolved],
      months: [...month.resolved],
      daysOfWeek: [...dayOfWeek.resolved],
      dayOfMonthRestricted: isRestricted(dayOfMonth.resolved, 'dayOfMonth'),
      dayOfWeekRestricted: isRestricted(dayOfWeek.resolved, 'dayOfWeek'),
    },
  };
}

/**
 * Whether a field selects less than everything it could.
 *
 * Not "did the user write `*`". `1-31` and `0-6` select every value they can,
 * so they restrict nothing, and the OR rule below must not fire for them —
 * a distinction with its own regression test since M14.
 */
function isRestricted(resolved: readonly number[], name: 'dayOfMonth' | 'dayOfWeek'): boolean {
  const spec = CRON_FIELD_SPECS[name];
  // Day-of-week resolves 7 to 0, so its ceiling is 6 rather than the 7 the
  // grammar accepts.
  const ceiling = name === 'dayOfWeek' ? 6 : spec.max;
  return resolved.length < ceiling - spec.min + 1;
}

/* ------------------------------------------------------------------ *
 * The day rule
 * ------------------------------------------------------------------ */

/**
 * Vixie semantics, and the single most misread rule in cron.
 *
 * When **both** day fields are restricted a day matches if **either** matches —
 * `0 0 1 * MON` is "the 1st, *and also* every Monday", not "the 1st if it is a
 * Monday". When only one is restricted, that one decides. When neither is,
 * every day matches.
 *
 * `03_DOMAIN_MODEL.md` C-I4, `04_PARSER_ARCHITECTURE.md` §4.7.
 */
export function dayMatches(
  schedule: ScheduleModel,
  dayOfMonth: number,
  dayOfWeek: number,
): boolean {
  const domHit = schedule.daysOfMonth.includes(dayOfMonth);
  const dowHit = schedule.daysOfWeek.includes(dayOfWeek);

  if (schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) return domHit || dowHit;
  if (schedule.dayOfMonthRestricted) return domHit;
  if (schedule.dayOfWeekRestricted) return dowHit;
  return true;
}

/* ------------------------------------------------------------------ *
 * Wall clock and instants
 * ------------------------------------------------------------------ */

/** A calendar reading in the selected zone. Months are 1–12, as cron writes them. */
export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/**
 * How a wall-clock time maps onto real instants.
 *
 * Three outcomes, and the two unusual ones are the whole of DST:
 *
 *  - `unique`   — the ordinary case, one instant.
 *  - `skipped`  — the clock jumped forward over this reading. It never occurs.
 *  - `repeated` — the clock fell back across it. It occurs twice.
 */
export type InstantResolution =
  | { readonly kind: 'unique'; readonly epochMs: number; readonly offsetMinutes: number }
  | { readonly kind: 'skipped' }
  | {
      readonly kind: 'repeated';
      readonly instants: readonly { readonly epochMs: number; readonly offsetMinutes: number }[];
    };

/** The wall clock in UTC, which has no transitions and needs no probing. */
/** A day, in milliseconds. Used to probe either side of a possible transition. */
const DAY_MS = 86_400_000;

function utcWallClock(epochMs: number): WallClock {
  const date = new Date(epochMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

/** The wall clock in the browser's own zone, which is what `Date` reads natively. */
function localWallClock(epochMs: number): WallClock {
  const date = new Date(epochMs);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

export function wallClockOf(epochMs: number, mode: CronTimezoneMode): WallClock {
  return mode === 'utc' ? utcWallClock(epochMs) : localWallClock(epochMs);
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

/**
 * Turns a wall-clock reading into the instant or instants it names.
 *
 * **This is where daylight saving is detected, and it is detected rather than
 * assumed.** The technique is the standard offset-probe, and it needs nothing
 * but `Date`:
 *
 *   1. Treat the reading as if it were UTC, giving a fixed point of reference.
 *   2. Take the zone's offset a day *before* and a day *after* that point.
 *      Any transition near the reading lies between the two, so where the two
 *      differ we get two candidate instants instead of one.
 *   3. Keep only the candidates that actually read back as the wall clock we
 *      asked for.
 *
 * Probing a day out on both sides is what makes the fall-back case work. An
 * earlier version probed forward only — offset at the guess, then offset at the
 * instant that guess corrected to — and that walk never steps back over a
 * transition it has already passed: for London's 01:30 on 25 October both
 * probes land after the change, agree on GMT, and report a single instant while
 * the earlier BST one goes unmentioned. A day is wider than any transition and
 * narrower than the gap between two, so the pair straddles the change.
 *
 * Zero survivors means the reading does not exist: the clock jumped over it.
 * Two means it exists twice: the clock fell back through it. Neither case is
 * inferred from `observesDst`, which answers a different, coarser question —
 * whether the zone transitions *at all this year* — and cannot say whether a
 * particular February morning is affected.
 *
 * The probe is exact for whole-minute schedules in every real zone, including
 * the half-hour and 45-minute offsets and Lord Howe's 30-minute saving step,
 * because it never assumes the size of the shift.
 */
export function resolveInstant(wall: WallClock, mode: CronTimezoneMode): InstantResolution {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);

  if (mode === 'utc') {
    return { kind: 'unique', epochMs: asUtc, offsetMinutes: 0 };
  }

  // `getTimezoneOffset` is minutes *behind* UTC, so adding it moves from a
  // wall-clock reading to the instant that shows it.
  const before = new Date(asUtc - DAY_MS).getTimezoneOffset();
  const after = new Date(asUtc + DAY_MS).getTimezoneOffset();
  const candidates = [asUtc + before * 60_000, asUtc + after * 60_000];

  const valid = [...new Set(candidates)]
    .filter((epochMs) => sameWallClock(localWallClock(epochMs), wall))
    .sort((a, b) => a - b);

  if (valid.length === 0) return { kind: 'skipped' };
  if (valid.length === 1) {
    const epochMs = valid[0] ?? asUtc;
    return { kind: 'unique', epochMs, offsetMinutes: offsetAt(epochMs) };
  }
  return {
    kind: 'repeated',
    instants: valid.map((epochMs) => ({ epochMs, offsetMinutes: offsetAt(epochMs) })),
  };
}

/**
 * The zone's offset at an instant, in minutes *ahead* of UTC — the sign people
 * write, so +05:30 is 330.
 *
 * Negating `getTimezoneOffset` turns UTC itself into `-0`, which formats as
 * "-0" and compares unequal to `0` under `Object.is`. Normalised here rather
 * than at each place that displays or compares it.
 */
function offsetAt(epochMs: number): number {
  const offset = -new Date(epochMs).getTimezoneOffset();
  return offset === 0 ? 0 : offset;
}

/* ------------------------------------------------------------------ *
 * Occurrences
 * ------------------------------------------------------------------ */

/** How a wall-clock match relates to real time. Structured; the UI writes the prose. */
export type OccurrenceAnomaly = 'skipped' | 'repeated';

export interface CronOccurrence {
  /** The wall clock the schedule matched, in the selected mode. */
  readonly wall: WallClock;
  /**
   * The instant it names, as an epoch millisecond value.
   *
   * `null` only for a `skipped` occurrence: the clock jumped over that
   * reading, so there is no instant, and inventing one would be the
   * confidently-wrong answer this feature exists to prevent.
   */
  readonly epochMs: number | null;
  /** Minutes ahead of UTC, so `+60` is UTC+1. `null` alongside a null instant. */
  readonly offsetMinutes: number | null;
  readonly anomaly?: OccurrenceAnomaly;
  /**
   * Both instants, for a `repeated` reading. The clock fell back through this
   * time, so it happens twice, and schedulers differ on which they use —
   * showing one and calling it *the* answer would be a guess.
   */
  readonly repeatedInstants?: readonly {
    readonly epochMs: number;
    readonly offsetMinutes: number;
  }[];
}

/**
 * The result of a search, and what it cost.
 *
 * `steps` is the number of field-advance iterations taken. It stays inside the
 * domain — `previewSchedule` drops it, so it never crosses the worker boundary
 * — and exists so the bound can be *measured* rather than asserted: the tests
 * check it against the tripwire, and `scripts/measure-cron.ts` reports it.
 * A bound nobody measures is a bound nobody knows the margin on.
 */
export type ScheduleSearch =
  | {
      readonly ok: true;
      readonly occurrences: readonly CronOccurrence[];
      readonly steps: number;
    }
  | {
      readonly ok: false;
      /** Searched the whole horizon and found nothing. `0 0 30 2 *`. */
      readonly reason: 'NO_OCCURRENCE_IN_HORIZON';
      readonly horizonYears: number;
      readonly steps: number;
    };

export interface OccurrenceOptions {
  readonly mode: CronTimezoneMode;
  /** Search strictly after this instant. Defaults to now. */
  readonly after?: number;
  /** How many to return. Clamped to the documented cap. */
  readonly count?: number;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 30;
}

/** The weekday of a wall-clock date, 0 = Sunday. Computed in UTC so no zone can skew it. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The next value in a sorted set at or after `from`, or null if there is none. */
function atOrAfter(values: readonly number[], from: number): number | null {
  for (const value of values) if (value >= from) return value;
  return null;
}

/**
 * One step of the advance.
 *
 * Each field is checked in descending significance, and the first mismatch
 * jumps to the next plausible boundary and resets everything below it. Split
 * out of the loop so the loop is a bound and this is the logic.
 */
function advanceOnce(
  schedule: ScheduleModel,
  cursor: WallClock,
): { readonly done: boolean; readonly wall: WallClock } {
  const { year, month, day, hour, minute } = cursor;
  const keep = (wall: WallClock) => ({ done: false, wall });

  // Month
  const nextMonth = atOrAfter(schedule.months, month);
  if (nextMonth === null) {
    return keep({ year: year + 1, month: 1, day: 1, hour: 0, minute: 0 });
  }
  if (nextMonth !== month) {
    return keep({ year, month: nextMonth, day: 1, hour: 0, minute: 0 });
  }

  // Day. Rolls the month over rather than searching inside an impossible one —
  // 31 April is not a date, and neither is 30 February, which is how
  // `0 0 30 2 *` reaches the horizon and reports that it never runs.
  if (day > daysInMonth(year, month)) {
    return keep(
      month === 12
        ? { year: year + 1, month: 1, day: 1, hour: 0, minute: 0 }
        : { year, month: month + 1, day: 1, hour: 0, minute: 0 },
    );
  }
  if (!dayMatches(schedule, day, weekdayOf(year, month, day))) {
    return keep({ year, month, day: day + 1, hour: 0, minute: 0 });
  }

  // Hour
  const nextHour = atOrAfter(schedule.hours, hour);
  if (nextHour === null) return keep({ year, month, day: day + 1, hour: 0, minute: 0 });
  if (nextHour !== hour) return keep({ year, month, day, hour: nextHour, minute: 0 });

  // Minute
  const nextMinute = atOrAfter(schedule.minutes, minute);
  if (nextMinute === null) {
    return keep(
      hour === 23
        ? { year, month, day: day + 1, hour: 0, minute: 0 }
        : { year, month, day, hour: hour + 1, minute: 0 },
    );
  }

  return { done: true, wall: { year, month, day, hour, minute: nextMinute } };
}

/**
 * The next wall-clock reading the schedule matches, at or after `start`.
 *
 * Field-by-field advance, never minute-by-minute: iterating a five-year window
 * a minute at a time is 2.6 million steps per answer and is exactly what makes
 * a worker look hung. Each mismatch jumps to the next plausible boundary and
 * resets everything below it, so an answer is found in tens of steps.
 *
 * Bounded twice over — by a calendar horizon and by a step count — because a
 * loop that is only *probably* finite is a frozen tab waiting for the input
 * that proves otherwise.
 */
function nextWallClock(
  schedule: ScheduleModel,
  start: WallClock,
  horizonYear: number,
): { readonly wall: WallClock | null; readonly steps: number } {
  let cursor: WallClock = start;
  let steps = 0;

  while (steps < LIMITS.cron.maxSearchSteps) {
    steps += 1;
    if (cursor.year > horizonYear) return { wall: null, steps };

    const advanced = advanceOnce(schedule, cursor);
    if (advanced.done) return { wall: advanced.wall, steps };
    cursor = advanced.wall;
  }

  // The tripwire, not a budget. Tens of steps is the expected cost; reaching
  // six figures means the advance logic above has stopped advancing.
  return { wall: null, steps };
}

/** One minute later, in wall-clock terms. Used to step past a match. */
function plusOneMinute(wall: WallClock): WallClock {
  let { year, month, day, hour, minute } = wall;
  minute += 1;
  if (minute > 59) {
    minute = 0;
    hour += 1;
  }
  if (hour > 23) {
    hour = 0;
    day += 1;
  }
  if (day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
  }
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return { year, month, day, hour, minute };
}

function occurrenceFor(wall: WallClock, mode: CronTimezoneMode): CronOccurrence {
  const resolved = resolveInstant(wall, mode);

  if (resolved.kind === 'skipped') {
    return { wall, epochMs: null, offsetMinutes: null, anomaly: 'skipped' };
  }
  if (resolved.kind === 'repeated') {
    const first = resolved.instants[0];
    return {
      wall,
      // The earlier of the two, which is the instant a scheduler that fires
      // once would use — with both carried alongside so the UI can say the
      // reading happens twice rather than picking silently.
      epochMs: first?.epochMs ?? null,
      offsetMinutes: first?.offsetMinutes ?? null,
      anomaly: 'repeated',
      repeatedInstants: resolved.instants,
    };
  }
  return { wall, epochMs: resolved.epochMs, offsetMinutes: resolved.offsetMinutes };
}

/**
 * The next occurrences of a schedule.
 *
 * Searches wall-clock readings, because that is what cron fields describe, and
 * converts each match to an instant afterwards. A reading the clock skipped is
 * returned with a null instant and a `skipped` anomaly rather than dropped:
 * "this run does not happen this year" is the answer, and schedulers differ on
 * whether they fire at 03:00 instead, so we report and do not pick
 * (`04_PARSER_ARCHITECTURE.md` §4.6).
 */
export function nextOccurrences(
  schedule: ScheduleModel,
  options: OccurrenceOptions,
): ScheduleSearch {
  const mode = options.mode;
  const after = options.after ?? Date.now();
  const wanted = Math.max(1, Math.min(options.count ?? 1, LIMITS.cron.maxOccurrences));

  // Strictly after: a schedule due exactly now has already been due.
  let cursor = plusOneMinute(wallClockOf(after, mode));
  const horizonYear = wallClockOf(after, mode).year + LIMITS.cron.searchYears;

  const occurrences: CronOccurrence[] = [];
  let steps = 0;
  while (occurrences.length < wanted) {
    const match = nextWallClock(schedule, cursor, horizonYear);
    steps += match.steps;
    if (match.wall === null) break;
    occurrences.push(occurrenceFor(match.wall, mode));
    cursor = plusOneMinute(match.wall);
  }

  if (occurrences.length === 0) {
    return {
      ok: false,
      reason: 'NO_OCCURRENCE_IN_HORIZON',
      horizonYears: LIMITS.cron.searchYears,
      steps,
    };
  }
  return { ok: true, occurrences, steps };
}

/** Convenience for the common question. Returns null when nothing is due. */
export function nextOccurrence(
  schedule: ScheduleModel,
  options: OccurrenceOptions,
): CronOccurrence | null {
  const search = nextOccurrences(schedule, { ...options, count: 1 });
  return search.ok ? (search.occurrences[0] ?? null) : null;
}

/* ------------------------------------------------------------------ *
 * The preview — what crosses the worker boundary
 * ------------------------------------------------------------------ */

/**
 * A schedule preview: the answer to "when does this run next?", in the shape
 * the UI renders and the worker returns.
 *
 * Discriminated rather than a list plus a flag, because "no occurrence within
 * five years" and "no occurrences yet" are different answers and a caller that
 * reads `occurrences.length === 0` for both will eventually render the wrong
 * one. `notSchedulable` is separate again: `@reboot` has no times at all,
 * which is not the same as having none in the horizon.
 */
export type CronSchedulePreview =
  | {
      readonly status: 'occurrences';
      readonly mode: CronTimezoneMode;
      readonly computedAt: number;
      readonly occurrences: readonly CronOccurrence[];
    }
  | {
      readonly status: 'noOccurrence';
      readonly mode: CronTimezoneMode;
      readonly computedAt: number;
      readonly horizonYears: number;
    }
  | {
      readonly status: 'notSchedulable';
      readonly mode: CronTimezoneMode;
      readonly computedAt: number;
      readonly reason: ScheduleRejection;
    };

export interface PreviewOptions {
  readonly mode: CronTimezoneMode;
  /** The instant to search from. Defaults to now. */
  readonly after?: number;
  readonly count?: number;
}

/**
 * Builds a schedule from an analysis and answers with its next occurrences.
 *
 * The single entry point the worker calls. It takes a *parsed analysis*, never
 * text: the parser is the sole syntax authority, and a second reader of cron
 * syntax is a second set of rules to disagree with the first
 * (`04_PARSER_ARCHITECTURE.md` §6).
 */
export function previewSchedule(
  analysis: CronAnalysis,
  options: PreviewOptions,
): CronSchedulePreview {
  const computedAt = options.after ?? Date.now();
  const built = buildSchedule(analysis);
  if (!built.ok) {
    return { status: 'notSchedulable', mode: options.mode, computedAt, reason: built.reason };
  }

  const search = nextOccurrences(built.schedule, {
    mode: options.mode,
    after: computedAt,
    ...(options.count === undefined ? {} : { count: options.count }),
  });

  return search.ok
    ? { status: 'occurrences', mode: options.mode, computedAt, occurrences: search.occurrences }
    : {
        status: 'noOccurrence',
        mode: options.mode,
        computedAt,
        horizonYears: search.horizonYears,
      };
}
