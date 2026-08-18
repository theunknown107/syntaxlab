import type {
  CaptureGroupInfo,
  EngineCompatibility,
  RegexToken,
  RegexWarning,
} from '@/domain/regex/ast';
import type { DomainError, SourceSpan } from '@/domain/shared/result';
import { Badge } from '@/components/primitives/Button';
import { groupLabelFor, warningKind, warningTone } from './viewModel';
import type { SpanLinkHandlers } from './ExplanationView';
import styles from './regex.module.css';

/**
 * The read-only analysis tables.
 *
 * Grouped in one file because they are the same thing four times — a small
 * table over a slice of `RegexAnalysis`, each row linked back to its source
 * span. Splitting them into four files would spread one idea across four
 * places without making any of them easier to change.
 */

/* ------------------------------------------------------------------ *
 * Tokens
 * ------------------------------------------------------------------ */

interface TokenTableProps {
  readonly tokens: readonly RegexToken[];
  readonly links: SpanLinkHandlers;
}

/**
 * Token · meaning · position, with the hover link to the editor.
 *
 * The link is bidirectional and is the thing that makes the tool feel like it
 * understands the pattern rather than merely listing it (08_UI_UX_SPEC.md
 * §7.1). Each row is a button so it works from the keyboard too.
 */
export function TokenTable({ tokens, links }: TokenTableProps): React.JSX.Element {
  return (
    <table className={styles.table}>
      <caption className="srOnly">
        Every token in the pattern, with its kind and position. Selecting a row moves the cursor to
        that token.
      </caption>
      <thead>
        <tr>
          <th scope="col">Token</th>
          <th scope="col">Kind</th>
          <th scope="col">Position</th>
        </tr>
      </thead>
      <tbody>
        {tokens.map((token, index) => (
          <tr key={`${token.span.start}-${index}`}>
            <td>
              <button
                type="button"
                className={styles.rowButton}
                onMouseEnter={() => {
                  links.onHover(token.span);
                }}
                onMouseLeave={() => {
                  links.onHover(null);
                }}
                onFocus={() => {
                  links.onHover(token.span);
                }}
                onBlur={() => {
                  links.onHover(null);
                }}
                onClick={() => {
                  links.onSelect(token.span);
                }}
              >
                <code className={styles.code}>{token.raw}</code>
              </button>
            </td>
            <td>{token.type}</td>
            <td className={styles.numeric}>
              {token.span.start}–{token.span.end}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ *
 * Capture groups
 * ------------------------------------------------------------------ */

interface GroupTableProps {
  readonly groups: readonly CaptureGroupInfo[];
  readonly links: SpanLinkHandlers;
}

export function GroupTable({ groups, links }: GroupTableProps): React.JSX.Element {
  if (groups.length === 0) {
    return <p className={styles.muted}>This pattern has no capture groups.</p>;
  }

  return (
    <table className={styles.table}>
      <caption className="srOnly">
        Capture groups, with their number, name, depth and position.
      </caption>
      <thead>
        <tr>
          <th scope="col">Group</th>
          <th scope="col">Depth</th>
          <th scope="col">Position</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.number}>
            <td>
              <button
                type="button"
                className={styles.rowButton}
                onMouseEnter={() => {
                  links.onHover(group.span);
                }}
                onMouseLeave={() => {
                  links.onHover(null);
                }}
                onClick={() => {
                  links.onSelect(group.span);
                }}
              >
                {groupLabelFor(group)}
              </button>
            </td>
            <td className={styles.numeric}>{group.depth}</td>
            <td className={styles.numeric}>
              {group.span.start}–{group.span.end}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ *
 * Warnings and errors
 * ------------------------------------------------------------------ */

interface WarningListProps {
  readonly warnings: readonly RegexWarning[];
  readonly errors: readonly DomainError[];
  readonly links: SpanLinkHandlers;
}

/**
 * Errors first, then warnings.
 *
 * The two are visually distinct and carry a text label as well as a colour: a
 * portability note and a pattern that may take exponential time are different
 * claims, and rendering both in red teaches users to ignore both.
 */
export function WarningList({ warnings, errors, links }: WarningListProps): React.JSX.Element {
  return (
    <ul className={styles.warningList}>
      {errors.map((error, index) => (
        <li key={`e${index}`} className={styles.warningError}>
          <Badge tone="error">Error</Badge>
          <span>
            {error.message}
            {error.hint !== undefined && <span className={styles.warningHint}> {error.hint}</span>}
          </span>
          {error.span !== undefined && <JumpButton span={error.span} links={links} />}
        </li>
      ))}

      {warnings.map((warning, index) => (
        <li
          key={`w${index}`}
          className={
            warningTone(warning.code) === 'warning' ? styles.warningWarn : styles.warningInfo
          }
        >
          <Badge tone={warningTone(warning.code) === 'warning' ? 'warning' : 'info'}>
            {warningKind(warning.code)}
          </Badge>
          <span>
            {warning.message}
            {warning.hint !== undefined && (
              <span className={styles.warningHint}> {warning.hint}</span>
            )}
          </span>
          <JumpButton span={warning.span} links={links} />
        </li>
      ))}
    </ul>
  );
}

function JumpButton({
  span,
  links,
}: {
  span: SourceSpan;
  links: SpanLinkHandlers;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.jump}
      onClick={() => {
        links.onSelect(span);
      }}
    >
      Show at {span.start}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Compatibility
 * ------------------------------------------------------------------ */

const LEVEL_LABELS: Readonly<Record<string, string>> = {
  es5: 'ES5',
  es2018: 'ES2018',
  es2022: 'ES2022',
  es2024: 'ES2024',
  es2025: 'ES2025',
};

export function CompatibilityView({
  compatibility,
}: {
  compatibility: EngineCompatibility;
}): React.JSX.Element {
  return (
    <div className={styles.compat}>
      <p>
        Needs <Badge tone="accent">{LEVEL_LABELS[compatibility.ecmascript] ?? 'ES5'}</Badge> or
        later.
      </p>
      {compatibility.notes.length > 0 && (
        <ul className={styles.compatNotes}>
          {compatibility.notes.map((note, index) => (
            <li key={index}>
              <strong>{note.feature}</strong> — {note.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
