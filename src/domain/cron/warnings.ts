import type { SourceSpan } from '../shared/result';
import type { CronField, CronTerm, CronTimezoneContext, CronWarning } from './ast';

/**
 * Cron warnings — 04_PARSER_ARCHITECTURE.md §4.7, 03_DOMAIN_MODEL.md §5.2
 *
 * Warnings are not syntax errors. A schedule that runs every minute is valid
 * and sometimes intended; the job here is to surface the things people
 * reliably get wrong, not to editorialise about frequency.
 *
 * The one that earns the feature is `DOM_DOW_OR_RULE`.
 */

/** How often the schedule fires, used only to decide whether to warn. */
function runsPerHour(fields: readonly CronField[]): number {
  const minute = fields.find((field) => field.name === 'minute');
  const hour = fields.find((field) => field.name === 'hour');
  if (!minute || !hour) return 0;
  // Per hour, so a restricted hour field does not hide a per-minute schedule.
  return minute.resolved.length * (hour.resolved.length > 0 ? 1 : 0);
}

/** True when a term is a step, at any depth. Used for the `5/10` check. */
function stepsOnBareValue(term: CronTerm): boolean {
  return term.kind === 'step' && term.base.kind === 'value';
}

export interface WarningScanInput {
  readonly fields: readonly CronField[];
  readonly timezone: CronTimezoneContext;
  readonly wholeSpan: SourceSpan;
  readonly macro?: string;
  readonly nonSchedulable: boolean;
}

/**
 * The OR rule. This is the single most valuable output of the feature.
 *
 * Standard Vixie semantics: when *both* day fields are restricted, a day
 * matches if *either* matches. `0 0 1 * MON` is "the 1st of the month AND ALSO
 * every Monday", not "the 1st, if it is a Monday". Approximately every
 * developer reads it the second way, so this warning is unconditional whenever
 * both are restricted — never suppressed, never rate-limited.
 */
function orRuleWarning(fields: readonly CronField[]): CronWarning[] {
  const dayOfMonth = fields.find((field) => field.name === 'dayOfMonth');
  const dayOfWeek = fields.find((field) => field.name === 'dayOfWeek');
  if (dayOfMonth === undefined || dayOfWeek === undefined) return [];
  if (dayOfMonth.isWildcard || dayOfWeek.isWildcard) return [];
  if (dayOfMonth.error !== undefined || dayOfWeek.error !== undefined) return [];

  return [
    {
      code: 'DOM_DOW_OR_RULE',
      message:
        'Both the day-of-month and day-of-week fields are restricted, so this runs on days matching EITHER of them — not only on days matching both.',
      span: { ...dayOfMonth.span, end: dayOfWeek.span.end },
      hint: 'This is standard cron behaviour and it surprises almost everyone. To require both, restrict one field and check the other inside the job.',
    },
  ];
}

/** `5/10` and friends: valid here, but not portable. */
function stepBaseWarnings(fields: readonly CronField[]): CronWarning[] {
  const warnings: CronWarning[] = [];
  for (const field of fields) {
    for (const term of field.terms) {
      if (!stepsOnBareValue(term)) continue;
      warnings.push({
        code: 'NON_STANDARD_STEP_BASE',
        message:
          'A step on a single value behaves differently between schedulers. This reading is "from that value to the end of the field, every nth", which is what Vixie cron and cronie do.',
        span: term.span,
        hint: 'Other schedulers reject it outright. Writing the range explicitly, as `a-b/n`, means the same thing everywhere.',
      });
    }
  }
  return warnings;
}

/** Frequent is not wrong. This confirms rather than scolds. */
function frequencyWarning(fields: readonly CronField[]): CronWarning[] {
  const minute = fields.find((field) => field.name === 'minute');
  if (minute === undefined || minute.error !== undefined) return [];
  const perHour = runsPerHour(fields);
  if (perHour < 12) return [];

  return [
    {
      code: 'HIGH_FREQUENCY',
      message:
        perHour === 60 ? 'This runs every minute.' : `This runs ${String(perHour)} times an hour.`,
      span: minute.span,
      hint: 'Valid, and sometimes exactly right — worth confirming it is what you meant.',
    },
  ];
}

export function scanWarnings(input: WarningScanInput): readonly CronWarning[] {
  const warnings: CronWarning[] = [];
  const { fields, timezone, wholeSpan } = input;

  if (input.nonSchedulable) {
    warnings.push({
      code: 'NON_SCHEDULABLE_MACRO',
      message: '`@reboot` runs once when the scheduler starts, not on a clock.',
      span: wholeSpan,
      hint: 'There is no next run time to compute — it depends entirely on when the machine or service restarts.',
    });
    return warnings;
  }

  warnings.push(...orRuleWarning(fields));
  warnings.push(...stepBaseWarnings(fields));
  warnings.push(...frequencyWarning(fields));

  // Only when the zone actually transitions. Warning a reader in a zone with
  // no daylight saving that their zone observes daylight saving is a false
  // statement dressed as a caution, and it teaches them to skip the warnings
  // that are true.
  if (timezone.mode === 'browserLocal' && timezone.observesDst) {
    warnings.push({
      code: 'DST_LOCAL_MODE',
      message: `Times are shown in your browser's timezone (${timezone.ianaZone}), which observes daylight-saving changes.`,
      span: wholeSpan,
      hint: 'Schedulers differ on what happens to a time that is skipped or repeated by a transition. Switch to UTC to compare against a scheduler that runs in UTC.',
    });
  }

  return warnings;
}
