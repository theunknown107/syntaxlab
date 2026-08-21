import { err, ok } from '../shared/result';
import type { Result, SourceSpan } from '../shared/result';
import type { CronAnalysis, CronTimezoneContext, CronTimezoneMode } from './ast';
import { explainCron } from './explain';
import { parseCron } from './parser';
import { scanWarnings } from './warnings';

/**
 * Cron analysis — 03_DOMAIN_MODEL.md §5
 *
 * Orchestration only: parse, describe the timezone, warn, explain. Every step
 * is a pure function of its input, which is what lets the whole thing run on a
 * worker thread with nothing but a string crossing the boundary.
 *
 * **M14 does not compute run times.** `CronAnalysis` carries no `nextRuns`
 * field yet, deliberately: a schedule executor needs field-advance search, a
 * five-year bound and DST resolution, and inventing a half version of that
 * would produce exactly the confidently-wrong answers this feature exists to
 * prevent. The structured field sets here are what M16 will execute.
 */

/**
 * Describes the timezone the analysis is read in.
 *
 * `browserLocal` asks the platform what zone it is in rather than assuming;
 * `utc` is fixed. There is no third option — named IANA zones are deferred
 * (04_PARSER_ARCHITECTURE.md §4.5), and this function is where that limit is
 * enforced rather than merely documented.
 */
export function resolveTimezone(
  mode: CronTimezoneMode,
  now: Date = new Date(),
): CronTimezoneContext {
  if (mode === 'utc') {
    return { mode: 'utc', ianaZone: 'UTC', resolvedFrom: 'userSelection', currentOffsetMinutes: 0 };
  }

  let ianaZone = 'UTC';
  try {
    // `resolvedOptions()` is what the browser believes it is in. Reported as
    // resolved rather than chosen, so the UI can say where the value came from.
    ianaZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // A locked-down environment without a full ICU build. Falling back to UTC
    // is safe because the label always travels with the times (invariant C-I1).
    ianaZone = 'UTC';
  }

  return {
    mode: 'browserLocal',
    ianaZone,
    resolvedFrom: 'browserResolvedOptions',
    // `getTimezoneOffset` is minutes *behind* UTC, which is the opposite sign
    // to how offsets are written. Negated here so `+60` means UTC+1.
    currentOffsetMinutes: -now.getTimezoneOffset(),
  };
}

export interface AnalyzeCronOptions {
  readonly timezoneMode?: CronTimezoneMode;
  /** Injected so tests are not at the mercy of the clock. */
  readonly now?: Date;
}

export function analyzeCron(
  source: string,
  options: AnalyzeCronOptions = {},
): Result<CronAnalysis> {
  const parsed = parseCron(source);
  if (!parsed.ok) return err(parsed.error);

  const timezone = resolveTimezone(options.timezoneMode ?? 'browserLocal', options.now);
  const wholeSpan: SourceSpan = { start: 0, end: source.length, line: 1, column: 1 };

  const warnings = scanWarnings({
    fields: parsed.value.fields,
    timezone,
    wholeSpan,
    ...(parsed.value.macro === undefined ? {} : { macro: parsed.value.macro }),
    nonSchedulable: parsed.value.nonSchedulable,
  });

  const explanation = explainCron({
    fields: parsed.value.fields,
    timezone,
    ...(parsed.value.macro === undefined ? {} : { macro: parsed.value.macro }),
    nonSchedulable: parsed.value.nonSchedulable,
  });

  return ok({
    kind: 'cron',
    source,
    dialect: 'standard5',
    tokens: parsed.value.tokens,
    fields: parsed.value.fields,
    explanation,
    warnings,
    timezone,
    ...(parsed.value.macro === undefined ? {} : { macro: parsed.value.macro }),
    errors: parsed.value.errors,
  });
}
