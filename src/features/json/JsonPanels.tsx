import type { JsonAnalysis } from '@/domain/json/ast';
import { formatPath } from '@/domain/json/path';
import { INDENT_LABELS, type IndentStyle } from '@/domain/json/format';
import type { DomainError } from '@/domain/shared/result';
import { Badge, Button } from '@/components/primitives/Button';
import type { JsonMatch, JsonRow } from './viewModel';
import { excerptFor, formatBytes, TYPE_LABELS } from './viewModel';
import styles from './json.module.css';

/**
 * The JSON side panels: errors, findings, the selected node, the toolbar.
 *
 * Grouped in one file for the same reason as the regex tables — they are
 * small renderings of one slice of `JsonAnalysis` each, and four files would
 * spread one idea across four places.
 *
 * Everything here renders user content as a React text child. There is no
 * HTML string anywhere in the path, which is what makes a key called
 * `<img src=x onerror=…>` a piece of text rather than an element.
 */

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

interface JsonErrorsProps {
  readonly errors: readonly DomainError[];
  readonly source: string;
  readonly onGoTo: (offset: number) => void;
}

export function JsonErrors({ errors, source, onGoTo }: JsonErrorsProps): React.JSX.Element {
  return (
    <ul className={styles.errorList}>
      {errors.map((error, index) => (
        <li key={index} className={styles.error}>
          <div className={styles.errorHead}>
            <Badge tone="error">{errorLabel(error)}</Badge>
            <span className={styles.errorMessage}>{error.message}</span>
          </div>

          {error.span !== undefined && (
            <>
              <button
                type="button"
                className={styles.errorLocation}
                onClick={() => {
                  onGoTo(error.span?.start ?? 0);
                }}
              >
                Line {error.span.line}, column {error.span.column}
              </button>
              <ErrorExcerpt source={source} line={error.span.line} column={error.span.column} />
            </>
          )}

          {error.hint !== undefined && <p className={styles.errorHint}>{error.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

/** A short category, so severity is never carried by colour alone. */
function errorLabel(error: DomainError): string {
  switch (error.code) {
    case 'UNSUPPORTED':
      return 'Not JSON';
    case 'LIMIT_EXCEEDED':
      return 'Too large';
    case 'INTERNAL':
      return 'Error';
    default:
      return 'Syntax';
  }
}

function ErrorExcerpt({
  source,
  line,
  column,
}: {
  source: string;
  line: number;
  column: number;
}): React.JSX.Element | null {
  const excerpt = excerptFor(source, line, column);
  if (!excerpt) return null;

  return (
    <pre className={styles.excerpt} aria-hidden="true">
      <code>{excerpt.line}</code>
      {'\n'}
      <code className={styles.caret}>{`${' '.repeat(Math.max(0, excerpt.caretColumn - 1))}^`}</code>
    </pre>
  );
}

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

interface FindingsProps {
  readonly analysis: JsonAnalysis;
  readonly onGoTo: (offset: number) => void;
}

/**
 * Duplicate keys and numbers that change when read.
 *
 * Duplicates are shown as *every* occurrence, because the domain keeps every
 * occurrence. The wording says which one a JavaScript consumer sees without
 * pretending the parser threw the others away.
 */
export function JsonFindings({ analysis, onGoTo }: FindingsProps): React.JSX.Element | null {
  const { duplicateKeys, unsafeNumbers } = analysis;
  if (duplicateKeys.length === 0 && unsafeNumbers.length === 0) return null;

  return (
    <div className={styles.findings}>
      {duplicateKeys.length > 0 && (
        <section aria-label="Duplicate keys">
          <p className={styles.findingLead}>
            <Badge tone="warning">Duplicate keys</Badge> Every occurrence is kept in the tree below.
            JavaScript reads the <strong>last</strong> one; other languages differ.
          </p>
          <ul className={styles.findingList}>
            {duplicateKeys.map((report) => (
              <li key={`${formatPath(report.path)}/${report.key}`}>
                <code className={styles.code}>{report.key}</code>
                <span className={styles.muted}>
                  {' '}
                  in {report.path.length === 0 ? 'the top level' : formatPath(report.path)} —{' '}
                </span>
                {report.occurrences.map((span, index) => (
                  <button
                    key={span.start}
                    type="button"
                    className={styles.jump}
                    onClick={() => {
                      onGoTo(span.start);
                    }}
                  >
                    line {span.line}
                    {index < report.occurrences.length - 1 ? ', ' : ''}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {unsafeNumbers.length > 0 && (
        <section aria-label="Numbers that change when read">
          <p className={styles.findingLead}>
            <Badge tone="warning">Numbers</Badge> JavaScript stores every JSON number as a 64-bit
            float. These do not survive that intact.
          </p>
          <ul className={styles.findingList}>
            {unsafeNumbers.map((report) => (
              <li key={report.span.start}>
                <code className={styles.code}>{report.raw}</code>
                <span className={styles.muted}> reads back as </span>
                <code className={styles.code}>{String(report.parsed)}</code>
                <span className={styles.muted}> — {reasonLabel(report.reason)}. </span>
                <button
                  type="button"
                  className={styles.jump}
                  onClick={() => {
                    onGoTo(report.span.start);
                  }}
                >
                  line {report.span.line}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function reasonLabel(reason: 'PRECISION_LOSS' | 'OVERFLOW' | 'NEGATIVE_ZERO'): string {
  switch (reason) {
    case 'PRECISION_LOSS':
      return 'a double cannot hold every digit';
    case 'OVERFLOW':
      return 'larger than a double can represent';
    case 'NEGATIVE_ZERO':
      return 'the sign is lost';
  }
}

/* ------------------------------------------------------------------ *
 * Selected node
 * ------------------------------------------------------------------ */

interface SelectedProps {
  readonly row: JsonRow | null;
  readonly onCopy: (text: string) => void;
}

export function JsonSelected({ row, onCopy }: SelectedProps): React.JSX.Element {
  if (!row) return <p className={styles.muted}>Select a node to see its path.</p>;

  const path = formatPath(row.path);
  return (
    <div className={styles.selected}>
      <code className={styles.path}>{path}</code>
      <span className={styles.muted}>{TYPE_LABELS[row.type]}</span>
      <Button
        onClick={() => {
          onCopy(path);
        }}
        variant="ghost"
      >
        Copy path
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Toolbar
 * ------------------------------------------------------------------ */

interface ToolbarProps {
  readonly indent: IndentStyle;
  readonly onIndent: (indent: IndentStyle) => void;
  readonly onPrettify: () => void;
  readonly onMinify: () => void;
  readonly canFormat: boolean;
  readonly reason: string;
}

/**
 * Format controls.
 *
 * Disabled on an invalid document rather than hidden: a control that vanishes
 * leaves the user wondering where it went, and the reason is given next to it.
 * Formatting invalid JSON would mean inventing the missing pieces.
 */
export function JsonToolbar({
  indent,
  onIndent,
  onPrettify,
  onMinify,
  canFormat,
  reason,
}: ToolbarProps): React.JSX.Element {
  return (
    <div className={styles.toolbar}>
      <label className={styles.indentPicker}>
        <span className={styles.muted}>Indent</span>
        <select
          className={styles.select}
          value={indent}
          onChange={(event) => {
            onIndent(event.target.value as IndentStyle);
          }}
        >
          {(Object.keys(INDENT_LABELS) as IndentStyle[]).map((style) => (
            <option key={style} value={style}>
              {INDENT_LABELS[style]}
            </option>
          ))}
        </select>
      </label>

      <Button onClick={onPrettify} disabled={!canFormat} variant="secondary">
        Format
      </Button>
      <Button onClick={onMinify} disabled={!canFormat} variant="secondary">
        Minify
      </Button>

      {!canFormat && <span className={styles.muted}>{reason}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

interface SearchProps {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly matches: readonly JsonMatch[];
  readonly index: number;
  readonly onStep: (delta: number) => void;
}

export function JsonSearch({
  query,
  onQuery,
  matches,
  index,
  onStep,
}: SearchProps): React.JSX.Element {
  const count = matches.length;
  return (
    <div className={styles.search}>
      <label className={styles.searchField}>
        <span className="srOnly">Search keys and values</span>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search keys and values"
          value={query}
          onChange={(event) => {
            onQuery(event.target.value);
          }}
        />
      </label>

      <span className={styles.searchCount} role="status">
        {query.trim() === ''
          ? ''
          : count === 0
            ? 'No matches'
            : `${index + 1} of ${count.toLocaleString('en')}`}
      </span>

      <Button
        onClick={() => {
          onStep(-1);
        }}
        disabled={count === 0}
        variant="ghost"
        ariaLabel="Previous match"
      >
        ↑
      </Button>
      <Button
        onClick={() => {
          onStep(1);
        }}
        disabled={count === 0}
        variant="ghost"
        ariaLabel="Next match"
      >
        ↓
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Large-document state
 * ------------------------------------------------------------------ */

interface ManualProps {
  readonly size: number;
  readonly stale: boolean;
  readonly onAnalyze: () => void;
}

/**
 * The manual-analysis prompt for a large document.
 *
 * Above `manualAnalyzeBytes` nothing is parsed on a debounce, because
 * re-parsing megabytes on every keystroke is exactly the expensive work
 * nobody asked for (08_UI_UX_SPEC.md §3).
 */
export function JsonManualPrompt({ size, stale, onAnalyze }: ManualProps): React.JSX.Element {
  return (
    <div className={styles.manual} role="status">
      <p>
        This document is {formatBytes(size)}. It is analysed when you ask, rather than as you type.
        {stale ? ' The tree below is from the previous analysis.' : ''}
      </p>
      <Button onClick={onAnalyze} variant="primary">
        Analyze JSON
      </Button>
    </div>
  );
}
