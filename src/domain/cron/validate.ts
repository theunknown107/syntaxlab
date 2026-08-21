import { CRON_FIELD_ORDER, CRON_FIELD_SPECS, type CronFieldName } from './ast';

/**
 * Runtime validation of a `CronAnalysis` crossing the worker boundary.
 *
 * Same rule as the regex and JSON operations: a successful response is checked
 * **by value**, never accepted on the strength of a TypeScript cast. A cast
 * describes what we hope arrived; this describes what did.
 *
 * A cron analysis is small and completely bounded — five fields, at most a few
 * hundred terms — so unlike the JSON tree it is checked *exhaustively* rather
 * than to a budget. There is no reason to trust any part of it.
 *
 * What this is defending against is not a hostile cron expression, which the
 * parser already handles, but a malformed *result*: a worker that has been
 * replaced, a protocol drift between two deploys, or our own bug producing a
 * shape the UI will then index into.
 */

const WARNING_CODES = new Set([
  'DOM_DOW_OR_RULE',
  'NON_STANDARD_STEP_BASE',
  'HIGH_FREQUENCY',
  'NON_SCHEDULABLE_MACRO',
  'DST_LOCAL_MODE',
]);

const TOKEN_TYPES = new Set([
  'number',
  'name',
  'star',
  'slash',
  'dash',
  'comma',
  'whitespace',
  'macro',
  'unknown',
]);

const TIMEZONE_MODES = new Set(['browserLocal', 'utc']);
const RESOLVED_FROM = new Set(['browserResolvedOptions', 'userSelection']);
const EXPLANATION_KINDS = new Set(['text', 'code', 'emphasis', 'ref', 'list']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Offsets that actually index into the source, in the right order. */
function isSpanRange(start: number, end: number, sourceLength: number): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  return start >= 0 && start <= end && end <= sourceLength;
}

/** One-based line and column, as every consumer of a span assumes. */
function isSpanPosition(line: unknown, column: unknown): boolean {
  if (typeof line !== 'number' || typeof column !== 'number') return false;
  return line >= 1 && column >= 1;
}

function isSpan(value: unknown, sourceLength: number): boolean {
  if (!isRecord(value)) return false;
  const { start, end } = value;
  if (typeof start !== 'number' || typeof end !== 'number') return false;
  if (!isSpanRange(start, end, sourceLength)) return false;
  return isSpanPosition(value.line, value.column);
}

function isValueTerm(value: Record<string, unknown>): boolean {
  return Number.isInteger(value.value) && typeof value.raw === 'string';
}

function isRangeTerm(value: Record<string, unknown>): boolean {
  if (!Number.isInteger(value.from) || !Number.isInteger(value.to)) return false;
  if (typeof value.rawFrom !== 'string' || typeof value.rawTo !== 'string') return false;
  return (value.from as number) <= (value.to as number);
}

/** Terms nest only through `step`, so the depth is small and bounded. */
function isTerm(value: unknown, sourceLength: number, depth = 0): boolean {
  if (depth > 8) return false;
  if (!isRecord(value)) return false;
  if (!isSpan(value.span, sourceLength)) return false;

  if (value.kind === 'all') return true;
  if (value.kind === 'value') return isValueTerm(value);
  if (value.kind === 'range') return isRangeTerm(value);
  if (value.kind === 'step') return isStepTerm(value, sourceLength, depth);
  return false;
}

function isStepTerm(value: Record<string, unknown>, sourceLength: number, depth: number): boolean {
  if (!Number.isInteger(value.step) || (value.step as number) <= 0) return false;
  return isTerm(value.base, sourceLength, depth + 1);
}

function areTermsValid(terms: unknown, sourceLength: number): boolean {
  if (!Array.isArray(terms)) return false;
  return (terms as unknown[]).every((term) => isTerm(term, sourceLength));
}

/**
 * A field, checked against the spec for its own name.
 *
 * The range check is the one that matters: the UI will render these values as
 * times and days, and a minute of 61 is a wrong answer rather than a crash.
 */
function isField(value: unknown, name: CronFieldName, sourceLength: number): boolean {
  if (!isRecord(value)) return false;
  if (value.name !== name) return false;
  if (typeof value.raw !== 'string') return false;
  if (!isSpan(value.span, sourceLength)) return false;
  if (typeof value.isWildcard !== 'boolean') return false;
  if (!areTermsValid(value.terms, sourceLength)) return false;
  if (!isResolvedSet(value.resolved, name)) return false;
  if (value.error !== undefined && !isRecord(value.error)) return false;
  return true;
}

/**
 * The expanded values: integers, in range, sorted and unique.
 *
 * The range check is the one that matters. These are rendered as times and
 * days, so a minute of 61 is a wrong answer rather than a crash.
 */
function isResolvedSet(resolved: unknown, name: CronFieldName): boolean {
  if (!Array.isArray(resolved)) return false;
  const spec = CRON_FIELD_SPECS[name];
  // Day-of-week normalises 7 to 0, so its resolved ceiling is 6 rather than
  // the 7 the input grammar accepts.
  const ceiling = name === 'dayOfWeek' ? 6 : spec.max;

  let previous = -Infinity;
  for (const entry of resolved as unknown[]) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) return false;
    if (entry < spec.min || entry > ceiling) return false;
    // Sorted and unique, which the UI relies on when it renders them.
    if (entry <= previous) return false;
    previous = entry;
  }
  return true;
}

function isExplanationNodes(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((node) => {
    if (!isRecord(node)) return false;
    if (typeof node.kind !== 'string' || !EXPLANATION_KINDS.has(node.kind)) return false;
    if (node.kind === 'list') return Array.isArray(node.items);
    return typeof node.value === 'string';
  });
}

function isExplanation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isExplanationNodes(value.summary)) return false;
  if (!Array.isArray(value.details)) return false;
  return value.details.every((section: unknown) => {
    if (!isRecord(section)) return false;
    return (
      typeof section.id === 'string' &&
      typeof section.title === 'string' &&
      isExplanationNodes(section.body)
    );
  });
}

function areTokensValid(tokens: unknown, sourceLength: number): boolean {
  if (!Array.isArray(tokens)) return false;
  return (tokens as unknown[]).every((token) => {
    if (!isRecord(token)) return false;
    if (typeof token.type !== 'string' || !TOKEN_TYPES.has(token.type)) return false;
    if (typeof token.raw !== 'string') return false;
    return isSpan(token.span, sourceLength);
  });
}

/**
 * Either five fields in the fixed order, or none.
 *
 * None is the reboot-macro case, which has no schedule to describe. Any other
 * count is not something this build produces, and accepting one would let the
 * dialect lock leak at the boundary instead of holding at the parser.
 */
function areFieldsValid(fields: unknown, sourceLength: number): boolean {
  if (!Array.isArray(fields)) return false;
  const list = fields as unknown[];
  if (list.length === 0) return true;
  if (list.length !== CRON_FIELD_ORDER.length) return false;
  return CRON_FIELD_ORDER.every((name, index) => isField(list[index], name, sourceLength));
}

function areWarningsValid(warnings: unknown, sourceLength: number): boolean {
  if (!Array.isArray(warnings)) return false;
  return (warnings as unknown[]).every((warning) => {
    if (!isRecord(warning)) return false;
    if (typeof warning.code !== 'string' || !WARNING_CODES.has(warning.code)) return false;
    if (typeof warning.message !== 'string') return false;
    return isSpan(warning.span, sourceLength);
  });
}

/**
 * Real offsets run from -12:00 to +14:00. Anything outside that is not a
 * timezone, and would be rendered as one.
 */
function isRealOffset(value: unknown): boolean {
  if (typeof value !== 'number') return false;
  return value >= -720 && value <= 840;
}

function isTimezone(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.mode !== 'string' || !TIMEZONE_MODES.has(value.mode)) return false;
  if (typeof value.ianaZone !== 'string' || value.ianaZone === '') return false;
  if (typeof value.resolvedFrom !== 'string' || !RESOLVED_FROM.has(value.resolvedFrom)) {
    return false;
  }
  if (typeof value.observesDst !== 'boolean') return false;
  return isRealOffset(value.currentOffsetMinutes);
}

/**
 * Kind, source and dialect.
 *
 * The dialect check is the lock enforced again on arrival: if a result claims
 * a dialect this build does not implement, it did not come from this build.
 */
function isEnvelopeValid(value: Record<string, unknown>): boolean {
  return value.kind === 'cron' && typeof value.source === 'string' && value.dialect === 'standard5';
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

export function isValidCronAnalysis(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isEnvelopeValid(value)) return false;

  const sourceLength = (value.source as string).length;
  if (!areTokensValid(value.tokens, sourceLength)) return false;
  if (!areFieldsValid(value.fields, sourceLength)) return false;
  if (!isExplanation(value.explanation)) return false;
  if (!areWarningsValid(value.warnings, sourceLength)) return false;
  if (!isTimezone(value.timezone)) return false;
  if (!isOptionalString(value.macro)) return false;
  if (!Array.isArray(value.errors)) return false;
  return (value.errors as unknown[]).every((error) => isRecord(error));
}
