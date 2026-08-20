import { useEffect, useState } from 'react';

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

/**
 * How many rows are put in the document at once — 12_PERFORMANCE.md §11.3
 *
 * A pattern like `[\w.]+@[\w.]+` over a 200 KB subject returns the full
 * 10 000 matches the worker is allowed to send. Rendering all of them built
 * **130 000 DOM nodes** and cost 349 ms of layout, 162 ms of style and 36 MB of
 * heap — a second of work for rows nobody scrolls to.
 *
 * `table-layout: fixed` and `content-visibility: auto` were both measured
 * first and both did nothing: the expense is creating the nodes, not laying
 * them out, and Chromium ignores containment inside a table anyway. So the fix
 * is to not create them.
 *
 * Chosen rather than a virtualiser because match rows are not a fixed height —
 * a matched value runs to 2 000 characters and a capture list is as long as
 * the pattern has groups. The windowing used for the JSON tree assumes a
 * uniform row and does not transfer.
 */
const PAGE_SIZE = 200;

function MatchTable({ result }: { result: RegexExecResult }): React.JSX.Element {
  const notice = truncationNotice(result);
  const [shown, setShown] = useState(PAGE_SIZE);

  // A new result is a new list; showing row 4 000 of the previous one would be
  // both wrong and slow.
  useEffect(() => {
    setShown(PAGE_SIZE);
  }, [result]);

  const visible = result.matches.length <= shown ? result.matches : result.matches.slice(0, shown);
  const remaining = result.matches.length - visible.length;

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
          {visible.map((match) => (
            <MatchRow key={match.ordinal} match={match} hasIndices={result.hasIndices} />
          ))}
        </tbody>
      </table>

      {remaining > 0 && (
        <p className={styles.showMore}>
          <button
            type="button"
            className={styles.showMoreButton}
            onClick={() => {
              setShown((current) => current + PAGE_SIZE);
            }}
          >
            Show {Math.min(PAGE_SIZE, remaining).toLocaleString('en')} more
          </button>{' '}
          <span className={styles.muted} role="status">
            Showing {visible.length.toLocaleString('en')} of{' '}
            {result.matches.length.toLocaleString('en')}.
          </span>
        </p>
      )}
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
