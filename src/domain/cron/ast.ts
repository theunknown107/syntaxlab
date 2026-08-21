import type { Explanation } from '../shared/explanation';
import type { DomainError, SourceSpan } from '../shared/result';

/**
 * The cron domain model — 03_DOMAIN_MODEL.md §5, 04_PARSER_ARCHITECTURE.md §4
 *
 * V1.1 supports **exactly one dialect: standard 5-field cron.** That is not a
 * starting point to be widened at parse time; it is the feature. A 6-field
 * expression is genuinely ambiguous — `0 0 12 * * ?` is seconds-first Quartz,
 * while other conventions append a year — and guessing produces a plausible,
 * confidently wrong schedule. A wrong cron reading causes real operational
 * damage (23_RISK_REGISTER.md R-03), so the parser refuses instead.
 */

/**
 * A single-member union on purpose.
 *
 * Keeping the field present in stored records leaves room to widen later
 * without implying support that does not exist today.
 */
export type CronDialect = 'standard5';

export type CronFieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';

/** Field order is positional and fixed; the array index *is* the position. */
export const CRON_FIELD_ORDER = [
  'minute',
  'hour',
  'dayOfMonth',
  'month',
  'dayOfWeek',
] as const satisfies readonly CronFieldName[];

/**
 * The legal range for each field, and the names it accepts.
 *
 * `dayOfWeek` runs 0–7 because **both 0 and 7 mean Sunday** in standard cron
 * (invariant C-I3). That is not a typo and not a range widened for safety: it
 * is the dialect, and the explanation says which convention was applied.
 */
export interface CronFieldSpec {
  readonly name: CronFieldName;
  readonly min: number;
  readonly max: number;
  /** Uppercase alias → value. Empty for fields that take no names. */
  readonly names: Readonly<Record<string, number>>;
  /** How the field is described in prose. */
  readonly label: string;
  /**
   * The plural of `label`. Stored rather than derived: "day of the month"
   * pluralises on its first word, not its last, and a rule that gets that
   * right is longer than the five strings it would replace.
   */
  readonly pluralLabel: string;
}

const MONTH_NAMES: Readonly<Record<string, number>> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const DAY_NAMES: Readonly<Record<string, number>> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export const CRON_FIELD_SPECS: Readonly<Record<CronFieldName, CronFieldSpec>> = {
  minute: { name: 'minute', min: 0, max: 59, names: {}, label: 'minute', pluralLabel: 'minutes' },
  hour: { name: 'hour', min: 0, max: 23, names: {}, label: 'hour', pluralLabel: 'hours' },
  dayOfMonth: {
    name: 'dayOfMonth',
    min: 1,
    max: 31,
    names: {},
    label: 'day of the month',
    pluralLabel: 'days of the month',
  },
  month: {
    name: 'month',
    min: 1,
    max: 12,
    names: MONTH_NAMES,
    label: 'month',
    pluralLabel: 'months',
  },
  dayOfWeek: {
    name: 'dayOfWeek',
    min: 0,
    max: 7,
    names: DAY_NAMES,
    label: 'day of the week',
    pluralLabel: 'days of the week',
  },
};

/* ------------------------------------------------------------------ *
 * Terms
 * ------------------------------------------------------------------ */

/**
 * One term within a field. `field := term ("," term)*`.
 *
 * `step` wraps a base rather than sitting beside it: a step over everything
 * and a step over a range differ only in what is being stepped over. Keeping
 * the base as a term makes that structural instead of a special case.
 *
 * (Written without the literal step syntax on purpose — the star-slash pair
 * closes a block comment, which silently truncated this file the first time.)
 */
export type CronTerm =
  | { readonly kind: 'all'; readonly span: SourceSpan }
  | {
      readonly kind: 'value';
      readonly value: number;
      readonly raw: string;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: 'range';
      readonly from: number;
      readonly to: number;
      readonly rawFrom: string;
      readonly rawTo: string;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: 'step';
      readonly base: CronTerm;
      readonly step: number;
      readonly span: SourceSpan;
    };

/**
 * A parsed field.
 *
 * `raw` and `terms` are kept alongside `resolved` deliberately. The explanation
 * needs to say what the user *wrote* — including duplicates, which `resolved`
 * collapses — while any future schedule computation needs the expanded set.
 * Losing either one makes the other job harder (brief §29, §33).
 */
export interface CronField {
  readonly name: CronFieldName;
  readonly raw: string;
  readonly span: SourceSpan;
  readonly terms: readonly CronTerm[];
  /** Sorted, deduplicated, fully expanded values. */
  readonly resolved: readonly number[];
  readonly isWildcard: boolean;
  readonly error?: DomainError;
}

/* ------------------------------------------------------------------ *
 * Timezone
 * ------------------------------------------------------------------ */

/**
 * V1.1 supports two modes and no more (04_PARSER_ARCHITECTURE.md §4.5).
 *
 * Named IANA zones are deferred because correct named-zone scheduling needs an
 * inverse wall-clock-to-instant mapping the platform does not provide before
 * `Temporal`, plus a test matrix across zone types. Shipping zones we have not
 * tested to that standard is exactly the confidently-wrong-answer failure this
 * feature is most exposed to.
 */
export type CronTimezoneMode = 'browserLocal' | 'utc';

export interface CronTimezoneContext {
  readonly mode: CronTimezoneMode;
  /** Resolved for display, e.g. "Europe/London" or "UTC". */
  readonly ianaZone: string;
  readonly resolvedFrom: 'browserResolvedOptions' | 'userSelection';
  readonly currentOffsetMinutes: number;
  /**
   * Whether this zone actually has daylight-saving transitions this year.
   *
   * Asked rather than assumed. Saying "this zone observes daylight-saving
   * changes" to someone in `Asia/Kolkata` is a confidently wrong statement of
   * exactly the kind this feature exists to avoid.
   */
  readonly observesDst: boolean;
}

/* ------------------------------------------------------------------ *
 * Warnings
 * ------------------------------------------------------------------ */

export type CronWarningCode =
  /** Both day fields restricted — the OR rule applies and nearly everyone misreads it. */
  | 'DOM_DOW_OR_RULE'
  /** A step on a bare value, e.g. `5/10`. Implementations disagree. */
  | 'NON_STANDARD_STEP_BASE'
  /** Runs very often; worth confirming that was intended. */
  | 'HIGH_FREQUENCY'
  /** `@reboot` has no schedule to compute. */
  | 'NON_SCHEDULABLE_MACRO'
  /** Browser-local mode crosses daylight-saving transitions. */
  | 'DST_LOCAL_MODE';

export interface CronWarning {
  readonly code: CronWarningCode;
  readonly message: string;
  readonly span: SourceSpan;
  readonly hint?: string;
}

/* ------------------------------------------------------------------ *
 * Tokens
 * ------------------------------------------------------------------ */

export type CronTokenType =
  | 'number'
  | 'name'
  | 'star'
  | 'slash'
  | 'dash'
  | 'comma'
  | 'whitespace'
  | 'macro'
  /** A character the dialect does not use. Carried so the parser can name it. */
  | 'unknown';

export interface CronToken {
  readonly type: CronTokenType;
  readonly raw: string;
  readonly span: SourceSpan;
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

export interface CronAnalysis {
  readonly kind: 'cron';
  readonly source: string;
  readonly dialect: CronDialect;
  readonly tokens: readonly CronToken[];
  readonly fields: readonly CronField[];
  readonly explanation: Explanation;
  readonly warnings: readonly CronWarning[];
  readonly timezone: CronTimezoneContext;
  /**
   * The macro this expression expanded from, if any — `@daily` and friends.
   * Kept so the explanation can say "`@daily` means `0 0 * * *`" rather than
   * silently explaining a different string from the one the user typed.
   */
  readonly macro?: string;
  /**
   * Errors found while analysing. Present on a *successful* analysis because
   * one bad field still leaves four explainable ones — the same recovery
   * posture as the regex parser.
   *
   * Analysis fails outright only when nothing useful can be produced: over the
   * length limit, or a field count that is not 5.
   */
  readonly errors: readonly DomainError[];
}
