import type { CaptureGroupInfo, RegexNode, RegexToken, RegexWarningCode } from '@/domain/regex/ast';
import type { RegexMatch } from '@/domain/regex/execute';
import type { SourceSpan } from '@/domain/shared/result';
import type { EditorRange } from '@/components/editor/CodeEditor';

/**
 * Presentation view models — pure functions from domain data to what the
 * panels render.
 *
 * They live apart from the components so the interesting logic — token
 * colouring, match highlighting, the shape of the AST rows — is unit-testable
 * without mounting anything. Nothing here recomputes an analysis or a match;
 * it only re-describes what the workers already produced.
 */

/* ------------------------------------------------------------------ *
 * Editor decorations
 * ------------------------------------------------------------------ */

const TOKEN_CLASS: Readonly<Record<RegexToken['type'], string | null>> = {
  Char: null, // ordinary literal text keeps the default colour
  Dot: 'tok-meta',
  Alternate: 'tok-meta',
  Anchor: 'tok-anchor',
  GroupOpen: 'tok-group',
  GroupClose: 'tok-group',
  ClassOpen: 'tok-class',
  ClassClose: 'tok-class',
  Quantifier: 'tok-quantifier',
  Escape: 'tok-escape',
  UnicodeProperty: 'tok-escape',
  Backreference: 'tok-escape',
  Invalid: 'tok-invalid',
};

/**
 * Colouring for the pattern editor.
 *
 * Derived from the same token list the explanation is built from, so a span
 * the explanation points at and the span the editor colours are the same span
 * by construction rather than by two grammars agreeing.
 */
export function tokenRanges(tokens: readonly RegexToken[]): EditorRange[] {
  const ranges: EditorRange[] = [];
  for (const token of tokens) {
    const className = TOKEN_CLASS[token.type];
    if (className === null) continue;
    ranges.push({ from: token.span.start, to: token.span.end, className });
  }
  return ranges;
}

/**
 * Match highlighting for the test-string editor.
 *
 * Alternating tints so two adjacent matches stay distinguishable, each paired
 * with an underline in the theme so colour is never the only signal.
 *
 * Zero-length matches are skipped here and shown in the match table instead: a
 * mark decoration needs a non-empty range, and inventing a one-character
 * highlight would claim the match covered a character it did not.
 */
export function matchRanges(matches: readonly RegexMatch[]): EditorRange[] {
  const ranges: EditorRange[] = [];
  for (const match of matches) {
    if (match.start === match.end) continue;
    ranges.push({
      from: match.start,
      to: match.end,
      className: match.ordinal % 2 === 0 ? 'match-even' : 'match-odd',
    });
  }
  return ranges;
}

/** The span the user is pointing at, drawn over the token colouring. */
export function linkedRange(span: SourceSpan | null): EditorRange[] {
  if (!span || span.start >= span.end) return [];
  return [{ from: span.start, to: span.end, className: 'tok-linked' }];
}

/* ------------------------------------------------------------------ *
 * Flags
 * ------------------------------------------------------------------ */

export interface FlagInfo {
  readonly letter: string;
  readonly name: string;
  readonly description: string;
}

/** The eight ECMAScript flags, in the order `flagsToString` emits them. */
export const FLAGS: readonly FlagInfo[] = [
  { letter: 'd', name: 'Indices', description: 'Report the start and end of every capture group.' },
  { letter: 'g', name: 'Global', description: 'Find every match, not only the first.' },
  { letter: 'i', name: 'Ignore case', description: 'Match without regard to upper or lower case.' },
  { letter: 'm', name: 'Multiline', description: '^ and $ match at every line break.' },
  { letter: 's', name: 'Dot all', description: '. also matches line breaks.' },
  { letter: 'u', name: 'Unicode', description: 'Treat the pattern as a sequence of code points.' },
  { letter: 'v', name: 'Unicode sets', description: 'Extended Unicode mode; a superset of u.' },
  { letter: 'y', name: 'Sticky', description: 'Match only at the position the last match ended.' },
];

/* ------------------------------------------------------------------ *
 * AST rows
 * ------------------------------------------------------------------ */

export interface AstRow {
  readonly label: string;
  readonly detail?: string;
  readonly span: SourceSpan;
  /** Present when this node contributes a warning, for the row badge. */
  readonly warning?: string;
}

const ANCHOR_LABELS: Readonly<Record<string, string>> = {
  start: 'Start of input',
  end: 'End of input',
  wordBoundary: 'Word boundary',
  nonWordBoundary: 'Not a word boundary',
};

function quantifierDetail(min: number, max: number | null, lazy: boolean): string {
  const range =
    max === null ? `${min} or more` : min === max ? `exactly ${min}` : `${min} to ${max}`;
  return lazy ? `${range}, as few as possible` : range;
}

function groupLabel(node: Extract<RegexNode, { type: 'Group' }>): string {
  switch (node.groupKind) {
    case 'capturing':
      return `Capture group ${node.number ?? '?'}`;
    case 'named':
      return `Named group ${node.name ?? '?'} (${node.number ?? '?'})`;
    case 'nonCapturing':
      return 'Non-capturing group';
    case 'lookahead':
      return 'Lookahead';
    case 'negativeLookahead':
      return 'Negative lookahead';
    case 'lookbehind':
      return 'Lookbehind';
    case 'negativeLookbehind':
      return 'Negative lookbehind';
  }
}

/** One row's label and detail. Exhaustive over the node union by design. */
export function describeNode(node: RegexNode): { label: string; detail?: string } {
  switch (node.type) {
    case 'Alternation':
      return { label: 'Alternation', detail: `${node.alternatives.length} alternatives` };
    case 'Sequence':
      return { label: 'Sequence', detail: `${node.elements.length} parts` };
    case 'Literal':
      return { label: 'Literal', detail: node.raw };
    case 'CharClass':
      return {
        label: node.negated ? 'Negated character class' : 'Character class',
        detail: `${node.items.length} entries`,
      };
    case 'Dot':
      return { label: 'Any character' };
    case 'Anchor':
      return { label: ANCHOR_LABELS[node.anchor] ?? 'Anchor' };
    case 'Group':
      return { label: groupLabel(node) };
    case 'Quantifier':
      return { label: 'Repeat', detail: quantifierDetail(node.min, node.max, node.lazy) };
    case 'Backreference':
      return {
        label: 'Backreference',
        detail: node.resolved ? `to group ${node.ref}` : `unresolved: ${node.raw}`,
      };
    case 'CharEscape':
      return { label: 'Escape', detail: node.raw };
    case 'UnicodeProperty':
      return { label: 'Unicode property', detail: node.raw };
    case 'Error':
      return { label: 'Could not be read', detail: node.raw };
  }
}

function childrenOf(node: RegexNode): readonly RegexNode[] {
  switch (node.type) {
    case 'Alternation':
      return node.alternatives;
    case 'Sequence':
      return node.elements;
    case 'Group':
    case 'Quantifier':
      return [node.body];
    default:
      return [];
  }
}

export interface AstTreeNode {
  readonly key: string;
  readonly value: AstRow;
  readonly children: readonly AstTreeNode[];
}

/**
 * Converts the AST to tree rows.
 *
 * Keys are structural paths (`0.1.0`) rather than array indices at each level,
 * so an expansion survives a re-analysis that leaves the shape unchanged.
 */
export function astToTree(node: RegexNode, path = '0'): AstTreeNode {
  const described = describeNode(node);
  const row: { label: string; detail?: string; span: SourceSpan } = {
    label: described.label,
    span: node.span,
  };
  if (described.detail !== undefined) row.detail = described.detail;

  return {
    key: path,
    value: row,
    children: childrenOf(node).map((child, index) => astToTree(child, `${path}.${index}`)),
  };
}

/** Keys of every node that has children — used by "expand all". */
export function expandableKeys(node: AstTreeNode, out = new Set<string>()): Set<string> {
  if (node.children.length > 0) out.add(node.key);
  for (const child of node.children) expandableKeys(child, out);
  return out;
}

/* ------------------------------------------------------------------ *
 * Warnings and groups
 * ------------------------------------------------------------------ */

/**
 * Warning severity.
 *
 * Not everything is red. A portability note and a pattern that may take
 * exponential time are different things, and colouring them identically
 * teaches users to ignore both (§13 of the M4 brief).
 */
export type WarningTone = 'warning' | 'info';

const EXPENSIVE: ReadonlySet<RegexWarningCode> = new Set([
  'NESTED_QUANTIFIER',
  'LARGE_BOUNDED_REPEAT',
]);

export function warningTone(code: RegexWarningCode): WarningTone {
  return EXPENSIVE.has(code) ? 'warning' : 'info';
}

/** Short human label for the warning kind, so severity is never colour alone. */
export function warningKind(code: RegexWarningCode): string {
  switch (code) {
    case 'NESTED_QUANTIFIER':
    case 'LARGE_BOUNDED_REPEAT':
      return 'May be slow';
    case 'LOOKBEHIND_COMPATIBILITY':
    case 'UNICODE_FLAG_ADVISED':
      return 'Compatibility';
    case 'UNRESOLVED_BACKREFERENCE':
    case 'DUPLICATE_GROUP_NAME':
    case 'EMPTY_ALTERNATIVE':
      return 'Likely mistake';
    default:
      return 'Note';
  }
}

export function groupLabelFor(group: CaptureGroupInfo): string {
  return group.name === undefined ? `Group ${group.number}` : `${group.name} (${group.number})`;
}
