import type { CronTimezoneMode } from '@/domain/cron/ast';
import type { CronOccurrence, CronSchedulePreview, WallClock } from '@/domain/cron/schedule';
import { LIMITS } from '@/domain/shared/limits';
import { refreshCronSchedule } from '@/application/cron/cronWorkspace';
import type { WorkspaceFailure } from '@/application/stores/workspaceStore';
import { Badge, Button } from '@/components/primitives/Button';

import styles from './cron.module.css';

/**
 * When the expression runs next — 04_PARSER_ARCHITECTURE.md §4.4, §4.6
 *
 * A preview, not a scheduler. It shows at most ten occurrences because the
 * question people actually have is "did I write what I meant?", and ten runs
 * answers it; a thousand would just be a slower way to say the same thing.
 *
 * The times are rendered from the wall clock the domain matched, not from
 * `toLocaleString` on the instant, because the two disagree exactly when it
 * matters: in UTC mode the browser would helpfully convert every time back
 * into the reader's own zone, which is the opposite of what the mode is for.
 *
 * **Nothing here refreshes on a timer.** Each set of times says when it was
 * calculated and there is a control to calculate them again — the same rule as
 * the Analyze button, for the same reason: no work the user did not ask for.
 */

interface CronScheduleProps {
  readonly preview: CronSchedulePreview | null;
  readonly status: 'idle' | 'analyzing' | 'ready' | 'error';
  readonly failure: WorkspaceFailure | null;
  /** Whether there is a committed expression at all. */
  readonly hasAnalysis: boolean;
}

export function CronSchedule({
  preview,
  status,
  failure,
  hasAnalysis,
}: CronScheduleProps): React.JSX.Element {
  if (!hasAnalysis) {
    return <p className={styles.empty}>Analyze an expression to see when it runs next.</p>;
  }
  if (status === 'analyzing') {
    return (
      <p className={styles.empty} role="status">
        Calculating the next runs…
      </p>
    );
  }
  if (failure !== null) {
    return (
      <div className={styles.refusal} role="status">
        <Badge tone="warning">Not calculated</Badge>
        <p className={styles.refusalMessage}>{failure.message}</p>
        {failure.hint !== undefined && <p className={styles.refusalHint}>{failure.hint}</p>}
      </div>
    );
  }
  if (preview === null) return <p className={styles.empty}>No times to show.</p>;

  return (
    <div className={styles.schedule}>
      <PreviewBody preview={preview} />
      <ScheduleFooter preview={preview} />
    </div>
  );
}

function PreviewBody({ preview }: { readonly preview: CronSchedulePreview }): React.JSX.Element {
  switch (preview.status) {
    case 'notSchedulable':
      return <NotSchedulable reason={preview.reason} />;
    case 'noOccurrence':
      return (
        <p className={styles.empty} role="status">
          This expression has no run in the next {String(preview.horizonYears)} years. A date like
          30 February never arrives, and neither does a day-of-month and month pair that cannot
          occur together.
        </p>
      );
    case 'occurrences':
      return <Occurrences occurrences={preview.occurrences} mode={preview.mode} />;
  }
}

/**
 * Why there are no times, said plainly.
 *
 * `@reboot` is the interesting one: it is a valid, common, useful expression
 * that simply has no clock time, and saying "invalid" about it would be wrong.
 */
function NotSchedulable({
  reason,
}: {
  readonly reason: 'FIELD_ERROR' | 'NOT_SCHEDULABLE' | 'UNSUPPORTED_DIALECT';
}): React.JSX.Element {
  const message =
    reason === 'NOT_SCHEDULABLE'
      ? '@reboot runs when the machine starts, so it has no clock time to predict.'
      : reason === 'FIELD_ERROR'
        ? 'The expression has an error, so there is nothing to calculate yet. The fields above say which part.'
        : 'This expression is not in the five-field dialect SyntaxLab calculates times for.';

  return (
    <div className={styles.refusal} role="status">
      <Badge tone="warning">No times</Badge>
      <p className={styles.refusalMessage}>{message}</p>
    </div>
  );
}

function Occurrences({
  occurrences,
  mode,
}: {
  readonly occurrences: readonly CronOccurrence[];
  readonly mode: CronTimezoneMode;
}): React.JSX.Element {
  const [next, ...rest] = occurrences;
  if (next === undefined) return <p className={styles.empty}>No times to show.</p>;

  return (
    <>
      <div className={styles.nextRun}>
        <span className={styles.nextRunLabel}>Next run</span>
        <p className={styles.nextRunTime}>{formatWall(next.wall)}</p>
        <p className={styles.nextRunZone}>{zoneLabel(next, mode)}</p>
        <AnomalyNote occurrence={next} />
      </div>

      {rest.length > 0 && (
        <>
          <h3 className={styles.upcomingHeading}>Then</h3>
          <ol className={styles.upcoming} aria-label="Upcoming runs">
            {rest.map((occurrence) => (
              <li key={keyOf(occurrence)} className={styles.upcomingItem}>
                <span className={styles.upcomingTime}>{formatWall(occurrence.wall)}</span>
                <span className={styles.upcomingZone}>{zoneLabel(occurrence, mode)}</span>
                <AnomalyNote occurrence={occurrence} />
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/**
 * What daylight saving did to this run.
 *
 * Both notes describe rather than decide. Schedulers genuinely differ here —
 * most skip a run the clock jumped over, some fire it an hour later; some run
 * a repeated one twice, others once — and picking one behaviour and presenting
 * it as the answer would be the confidently wrong output this panel exists to
 * avoid (`04_PARSER_ARCHITECTURE.md` §4.6).
 */
function AnomalyNote({
  occurrence,
}: {
  readonly occurrence: CronOccurrence;
}): React.JSX.Element | null {
  if (occurrence.anomaly === 'skipped') {
    return (
      <p className={styles.anomaly}>
        <Badge tone="warning">Clock skipped</Badge>
        <span>
          This time does not exist on this date: the clocks go forward through it. Most schedulers
          skip the run; some run it once the clocks have changed. Check yours before relying on it.
        </span>
      </p>
    );
  }

  if (occurrence.anomaly === 'repeated' && occurrence.repeatedInstants !== undefined) {
    const [first, second] = occurrence.repeatedInstants;
    return (
      <p className={styles.anomaly}>
        <Badge tone="warning">Happens twice</Badge>
        <span>
          The clocks go back through this time, so it occurs twice —{' '}
          {first !== undefined && <code>{offsetLabel(first.offsetMinutes)}</code>}
          {' and '}
          {second !== undefined && <code>{offsetLabel(second.offsetMinutes)}</code>}. Schedulers
          differ on whether the run happens once or twice.
        </span>
      </p>
    );
  }

  return null;
}

/** When these times were worked out, and how to work them out again. */
function ScheduleFooter({ preview }: { readonly preview: CronSchedulePreview }): React.JSX.Element {
  return (
    <div className={styles.scheduleFooter}>
      <span className={styles.computedAt}>
        Calculated at {formatClock(preview.computedAt)}
        {preview.status === 'occurrences' &&
          ` · showing up to ${String(LIMITS.cron.maxOccurrences)} runs`}
      </span>
      <Button onClick={refreshCronSchedule} variant="ghost">
        Recalculate
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Formatting
 *
 * Written out rather than delegated to `Intl`, because every one of these
 * values is a wall clock the domain already resolved, and handing it back to a
 * formatter that would re-interpret it in the browser's zone is exactly the
 * bug this panel must not have. `Intl` is still the right tool for a date the
 * *browser* owns — see `formatClock`.
 * ------------------------------------------------------------------ */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatWall(wall: WallClock): string {
  // The weekday comes from the calendar date, computed in UTC so the browser's
  // own zone cannot shift it. It is a property of the date, not of a zone.
  const weekday =
    WEEKDAYS[new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()] ?? '';
  const month = MONTHS[wall.month - 1] ?? '';
  return `${weekday} ${String(wall.day)} ${month} ${String(wall.year)}, ${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** `UTC+05:30`, the way people write an offset. */
function offsetLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'UTC';
  const sign = offsetMinutes < 0 ? '-' : '+';
  const total = Math.abs(offsetMinutes);
  return `UTC${sign}${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function zoneLabel(occurrence: CronOccurrence, mode: CronTimezoneMode): string {
  if (mode === 'utc') return 'UTC';
  if (occurrence.offsetMinutes === null) return 'This browser';
  return `This browser · ${offsetLabel(occurrence.offsetMinutes)}`;
}

/**
 * The instant these times were calculated at, in the reader's own zone.
 *
 * `Intl` is right here and wrong above: this is a real instant on the reader's
 * clock rather than a wall-clock reading in a chosen mode.
 */
function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Stable across re-renders, and distinct even for the two skipped-time cases. */
function keyOf(occurrence: CronOccurrence): string {
  const { wall } = occurrence;
  return `${String(wall.year)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}
