import type { RegexExecResult, RegexMatch } from '@/domain/regex/execute';
import type { ExecStatus, WorkspaceFailure } from '@/application/stores/workspaceStore';
import { Badge } from '@/components/primitives/Button';
import styles from './regex.module.css';

/**
 * Match results.
 *
 * Everything here is a rendering of what the execution worker reported. The UI
 * does not re-run, re-slice, or infer a match — if a value looks wrong, the
 * bug is in `domain/regex/execute.ts` and belongs there, because the engine's
 * behaviour is the answer the user came for.
 */

interface MatchResultsProps {
  readonly status: ExecStatus;
  readonly result: RegexExecResult | null;
  readonly error: WorkspaceFailure | null;
  readonly hasPattern: boolean;
  readonly hasSubject: boolean;
  readonly patternIsValid: boolean;
}

/**
 * The states that stop a result existing at all, in the order they matter.
 *
 * Split out because the interesting question — "why is there nothing to show?"
 * — has six answers, and threading them through the same function that renders
 * the table made both harder to read.
 */
function blockingState(props: MatchResultsProps): React.JSX.Element | null {
  const { status, error, hasPattern, hasSubject, patternIsValid } = props;

  if (status === 'unavailable') return <UnavailableState />;
  if (!hasPattern) return <p className={styles.muted}>Enter a pattern to test it.</p>;
  if (!patternIsValid) return <InvalidPatternState />;
  if (!hasSubject) return <p className={styles.muted}>Enter a test string to see matches.</p>;
  if (status === 'timeout') return <FailureState title="Timed out" error={error} alert />;
  if (status === 'error') return <FailureState title="Could not run" error={error} alert />;
  return null;
}

export function MatchResults(props: MatchResultsProps): React.JSX.Element {
  const blocked = blockingState(props);
  if (blocked !== null) return blocked;

  const { status, result } = props;
  if (result === null) {
    return (
      <p className={styles.muted}>
        {status === 'running' ? 'Running…' : 'Enter a test string to see matches.'}
      </p>
    );
  }

  if (result.matches.length === 0) {
    // Neutral, not an error: "no matches" is a valid and informative answer
    // (08_UI_UX_SPEC.md §13).
    return (
      <div className={styles.stateBlock} role="status">
        <p>No matches.</p>
        <p className={styles.muted}>The pattern ran successfully and found nothing.</p>
      </div>
    );
  }

  return <MatchTable result={result} />;
}

function UnavailableState(): React.JSX.Element {
  return (
    <div className={styles.stateBlock} role="status">
      <p>
        <Badge tone="warning">Testing unavailable</Badge>
      </p>
      <p>
        This browser could not start a Web Worker, so patterns cannot be run here. Explanations,
        structure and warnings all still work.
      </p>
      <p className={styles.muted}>
        Testing is not moved onto the page&apos;s own thread as a fallback: a pattern that takes a
        long time would freeze the tab, and there is no way to interrupt it once it starts.
      </p>
    </div>
  );
}

function InvalidPatternState(): React.JSX.Element {
  return (
    <div className={styles.stateBlock} role="status">
      <p>
        <Badge tone="error">Pattern is not valid</Badge>
      </p>
      <p>Testing is paused until the pattern parses. The errors above say what to fix.</p>
    </div>
  );
}

function FailureState({
  title,
  error,
  alert,
}: {
  title: string;
  error: WorkspaceFailure | null;
  alert: boolean;
}): React.JSX.Element {
  return (
    <div className={styles.stateBlock} role={alert ? 'alert' : 'status'}>
      <p>
        <Badge tone="error">{title}</Badge>
      </p>
      <p>{error?.message ?? 'Execution failed.'}</p>
      {error?.hint !== undefined && <p className={styles.muted}>{error.hint}</p>}
    </div>
  );
}

function truncationNotice(result: RegexExecResult): string | null {
  switch (result.truncated) {
    case 'matchCount':
      return `Showing the first ${result.matches.length.toLocaleString('en')} matches. There are more — the list is capped so the page stays usable.`;
    case 'outputSize':
      return `Showing the first ${result.matches.length.toLocaleString('en')} matches. The rest were not returned because the results exceeded the size limit.`;
    case 'none':
      return null;
  }
}

function MatchTable({ result }: { result: RegexExecResult }): React.JSX.Element {
  const notice = truncationNotice(result);

  return (
    <div>
      <p className={styles.resultSummary} role="status">
        <Badge tone="accent">
          {result.matches.length.toLocaleString('en')}
          {result.truncated === 'none' ? '' : '+'}{' '}
          {result.matches.length === 1 ? 'match' : 'matches'}
        </Badge>{' '}
        {!result.findsAll && (
          <span className={styles.muted}>
            Only the first match is searched for. Turn on the <code className={styles.code}>g</code>{' '}
            flag to find every match.
          </span>
        )}
      </p>

      {notice !== null && (
        <p className={styles.truncationNotice} role="status">
          {notice}
        </p>
      )}

      <table className={styles.table}>
        <caption className="srOnly">
          Every match, with its position, matched text and capture groups.
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Position</th>
            <th scope="col">Match</th>
            <th scope="col">Groups</th>
          </tr>
        </thead>
        <tbody>
          {result.matches.map((match) => (
            <MatchRow key={match.ordinal} match={match} hasIndices={result.hasIndices} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchRow({
  match,
  hasIndices,
}: {
  match: RegexMatch;
  hasIndices: boolean;
}): React.JSX.Element {
  const empty = match.start === match.end;

  return (
    <tr>
      <td className={styles.numeric}>{match.ordinal + 1}</td>
      <td className={styles.numeric}>
        {match.start}–{match.end}
      </td>
      <td>
        {empty ? (
          // A zero-length match is a real result with nothing to show, so it
          // is labelled rather than rendered as a blank cell.
          <Badge tone="info">empty match</Badge>
        ) : (
          <code className={styles.code}>{match.value}</code>
        )}
        {match.value.length < match.length && (
          <span className={styles.muted}>
            {' '}
            … {match.length.toLocaleString('en')} characters in total
          </span>
        )}
      </td>
      <td>
        <CaptureCells match={match} hasIndices={hasIndices} />
      </td>
    </tr>
  );
}

function CaptureCells({
  match,
  hasIndices,
}: {
  match: RegexMatch;
  hasIndices: boolean;
}): React.JSX.Element {
  if (match.captures.length === 0 && match.named.length === 0) {
    return <span className={styles.muted}>—</span>;
  }

  return (
    <ul className={styles.captureList}>
      {match.captures.map((capture) => (
        <li key={`n${capture.number}`}>
          <span className={styles.captureLabel}>{capture.number}</span>
          {capture.value === null ? (
            // Distinct from an empty string: this group took no part in the
            // match at all, which is a different fact about the pattern.
            <span className={styles.muted}>did not participate</span>
          ) : (
            <code className={styles.code}>{capture.value}</code>
          )}
          {hasIndices && capture.start !== undefined && (
            <span className={styles.muted}>
              {' '}
              at {capture.start}–{capture.end}
            </span>
          )}
        </li>
      ))}

      {match.named.map((named) => (
        <li key={`s${named.name}`}>
          <span className={styles.captureLabel}>{named.name}</span>
          {named.value === null ? (
            <span className={styles.muted}>did not participate</span>
          ) : (
            <code className={styles.code}>{named.value}</code>
          )}
        </li>
      ))}
    </ul>
  );
}
