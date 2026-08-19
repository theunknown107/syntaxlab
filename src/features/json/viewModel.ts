import type {
  DuplicateKeyReport,
  JsonAnalysis,
  JsonNode,
  JsonNodeType,
  JsonPath,
  UnsafeNumberReport,
} from '@/domain/json/ast';
import { formatPath, pathKey } from '@/domain/json/path';
import type { SourceSpan } from '@/domain/shared/result';

/**
 * JSON presentation view models.
 *
 * Everything the tree renders is derived here, once, outside React. The
 * components then map over rows. That is not tidiness: a component that walked
 * the CST during render would re-walk half a million nodes on every keystroke,
 * and the tree is the largest thing on the page.
 *
 * The rows are **flat**, with an explicit depth. Flattening is what lets the
 * list be virtualised by slicing an array, and what makes keyboard movement a
 * matter of moving one index.
 */

export interface JsonRow {
  /** Stable across re-analysis of an unchanged document. */
  readonly key: string;
  readonly depth: number;
  /** The property name or array index, absent at the root. */
  readonly label: string | null;
  readonly type: JsonNodeType;
  /** A short rendering of the value, already truncated. */
  readonly preview: string;
  readonly path: JsonPath;
  readonly span: SourceSpan;
  /** Null for a leaf; a count for a container. */
  readonly childCount: number | null;
  readonly expandable: boolean;
  /** This key appears more than once in its parent object. */
  readonly duplicate: boolean;
  /** This number does not survive the round trip through a double. */
  readonly unsafeNumber: boolean;
}

/** How much of a string value is shown on a row. */
const PREVIEW_LIMIT = 60;

function truncate(value: string, max = PREVIEW_LIMIT): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * A one-line rendering of a value.
 *
 * Strings are shown with their quotes so a string `"1"` cannot be mistaken for
 * the number `1` — the distinction the tree exists to make visible. Numbers
 * are shown as **written**, not as reparsed, so `1e5` stays `1e5`.
 */
export function previewOf(node: JsonNode): string {
  switch (node.type) {
    case 'object':
      return node.members.length === 0 ? '{}' : `{…}`;
    case 'array':
      return node.elements.length === 0 ? '[]' : `[…]`;
    case 'string':
      return `"${truncate(node.value)}"`;
    case 'number':
      return node.raw;
    case 'boolean':
      return String(node.value);
    case 'null':
      return 'null';
    case 'error':
      return truncate(node.raw, 24);
  }
}

function childCountOf(node: JsonNode): number | null {
  if (node.type === 'object') return node.members.length;
  if (node.type === 'array') return node.elements.length;
  return null;
}

/** A node's children, with the label and key span each one is reached by. */
interface Child {
  readonly node: JsonNode;
  readonly label: string;
  readonly keySpan?: SourceSpan;
}

/**
 * The children of a container, in source order.
 *
 * Extracted because three walkers need it and each had written its own
 * version, which is three places for the same off-by-one.
 */
function childrenOf(node: JsonNode): Child[] {
  if (node.type === 'array') {
    return node.elements.map((element, index) => ({ node: element, label: String(index) }));
  }
  if (node.type === 'object') {
    return node.members.map((member) => ({
      node: member.value,
      label: member.key,
      keySpan: member.keySpan,
    }));
  }
  return [];
}

interface BuildContext {
  readonly expanded: ReadonlySet<string>;
  readonly duplicateSpans: ReadonlySet<number>;
  readonly unsafeSpans: ReadonlySet<number>;
  readonly rows: JsonRow[];
}

/**
 * Flattens the visible part of the tree.
 *
 * Only expanded branches are walked, so a collapsed 500 000-node document
 * costs one row. That is the first and cheapest of the two things keeping a
 * large tree responsive; virtualisation is the second.
 *
 * Iterative rather than recursive so it cannot be the thing that overflows,
 * and so the row order matches the order a reader sees.
 */
export function buildRows(
  root: JsonNode | null,
  expanded: ReadonlySet<string>,
  duplicates: readonly DuplicateKeyReport[],
  unsafeNumbers: readonly UnsafeNumberReport[],
): JsonRow[] {
  if (!root) return [];

  const context: BuildContext = {
    expanded,
    duplicateSpans: new Set(
      duplicates.flatMap((report) => report.occurrences.map((span) => span.start)),
    ),
    unsafeSpans: new Set(unsafeNumbers.map((report) => report.span.start)),
    rows: [],
  };

  interface Frame {
    readonly node: JsonNode;
    readonly depth: number;
    readonly label: string | null;
    readonly keySpan?: SourceSpan;
  }
  const stack: Frame[] = [{ node: root, depth: 0, label: null }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;

    const row = toRow(frame, context);
    context.rows.push(row);

    if (!row.expandable || !expanded.has(row.key)) continue;

    // Reversed, so the stack pops them back in source order.
    const children = childrenOf(frame.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (!child) continue;
      stack.push(
        child.keySpan === undefined
          ? { node: child.node, depth: frame.depth + 1, label: child.label }
          : {
              node: child.node,
              depth: frame.depth + 1,
              label: child.label,
              keySpan: child.keySpan,
            },
      );
    }
  }

  return context.rows;
}

function toRow(
  frame: { node: JsonNode; depth: number; label: string | null; keySpan?: SourceSpan },
  context: BuildContext,
): JsonRow {
  const { node, depth, label, keySpan } = frame;
  const childCount = childCountOf(node);
  return {
    key: pathKey(node.path),
    depth,
    label,
    type: node.type,
    preview: previewOf(node),
    path: node.path,
    span: node.span,
    childCount,
    expandable: childCount !== null && childCount > 0,
    // Matched by key-span offset rather than by name: two members can share a
    // name, and only the specific occurrences are duplicates.
    duplicate: keySpan !== undefined && context.duplicateSpans.has(keySpan.start),
    unsafeNumber: context.unsafeSpans.has(node.span.start),
  };
}

/** Every expandable key, for "expand all". */
export function allExpandableKeys(root: JsonNode | null): Set<string> {
  const keys = new Set<string>();
  if (!root) return keys;

  const stack: JsonNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    const children = childrenOf(node);
    if (children.length === 0) continue;
    keys.add(pathKey(node.path));
    for (const child of children) stack.push(child.node);
  }
  return keys;
}

/** Keys of every container down to a given depth, for the default view. */
export function keysToDepth(root: JsonNode | null, maxDepth: number): Set<string> {
  const keys = new Set<string>();
  if (!root) return keys;

  const stack: { node: JsonNode; depth: number }[] = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry || entry.depth >= maxDepth) continue;

    const children = childrenOf(entry.node);
    if (children.length === 0) continue;
    keys.add(pathKey(entry.node.path));
    for (const child of children) stack.push({ node: child.node, depth: entry.depth + 1 });
  }
  return keys;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export interface JsonMatch {
  /** Path key of the node holding the match. */
  readonly key: string;
  readonly path: JsonPath;
  readonly span: SourceSpan;
  readonly where: 'key' | 'value';
  /** The text that matched, for the result list. */
  readonly text: string;
}

/**
 * Searches the **tree**, never the rendered DOM.
 *
 * Scraping the DOM would find only what is currently expanded and currently
 * on screen, which for a virtualised list is a few dozen rows — so the answer
 * would depend on the scroll position. Searching the model finds everything.
 */
export function searchTree(root: JsonNode | null, query: string, limit = 500): JsonMatch[] {
  const needle = query.trim().toLowerCase();
  if (!root || needle === '') return [];

  const matches: JsonMatch[] = [];
  const stack: JsonNode[] = [root];

  while (stack.length > 0 && matches.length < limit) {
    const node = stack.pop();
    if (!node) break;

    const valueMatch = matchValue(node, needle);
    if (valueMatch) matches.push(valueMatch);

    for (const child of childrenOf(node)) {
      const keyMatch = matchKey(child, needle);
      if (keyMatch) matches.push(keyMatch);
      stack.push(child.node);
    }
  }

  // Source order, so stepping through results moves down the document rather
  // than jumping around it.
  return matches.sort((a, b) => a.span.start - b.span.start).slice(0, limit);
}

function matchValue(node: JsonNode, needle: string): JsonMatch | null {
  const value = matchableValue(node);
  if (!value?.toLowerCase().includes(needle)) return null;
  return {
    key: pathKey(node.path),
    path: node.path,
    span: node.span,
    where: 'value',
    text: truncate(value, 40),
  };
}

function matchKey(child: Child, needle: string): JsonMatch | null {
  const keySpan = child.keySpan;
  if (keySpan === undefined || !child.label.toLowerCase().includes(needle)) return null;
  return {
    key: pathKey(child.node.path),
    path: child.node.path,
    span: keySpan,
    where: 'key',
    text: truncate(child.label, 40),
  };
}

function matchableValue(node: JsonNode): string | null {
  switch (node.type) {
    case 'string':
      return node.value;
    case 'number':
      return node.raw;
    case 'boolean':
      return String(node.value);
    case 'null':
      return 'null';
    default:
      return null;
  }
}

/** Every ancestor path key of a node, so a match can be revealed. */
export function ancestorKeys(path: JsonPath): string[] {
  const keys: string[] = [];
  for (let end = 0; end < path.length; end += 1) keys.push(pathKey(path.slice(0, end)));
  return keys;
}

/* ------------------------------------------------------------------ *
 * Error presentation
 * ------------------------------------------------------------------ */

/** How many lines of context are shown around the caret. */
const EXCERPT_WIDTH = 56;

interface Excerpt {
  readonly line: string;
  readonly caretColumn: number;
}

/**
 * The offending line, windowed around the error so a 4 000-character minified
 * document does not become a 4 000-character error message.
 */
export function excerptFor(source: string, line: number, column: number): Excerpt | null {
  const lines = source.split('\n');
  const text = lines[line - 1];
  if (text === undefined) return null;

  if (text.length <= EXCERPT_WIDTH) return { line: text, caretColumn: column };

  const half = Math.floor(EXCERPT_WIDTH / 2);
  const start = Math.max(0, column - half);
  const windowed = text.slice(start, start + EXCERPT_WIDTH);
  return {
    line: (start > 0 ? '…' : '') + windowed,
    caretColumn: column - start + (start > 0 ? 1 : 0),
  };
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

export interface JsonStatusLine {
  readonly valid: boolean;
  readonly text: string;
}

/** The one-line summary for the status bar. Compact, not a grid of cards. */
export function statusLine(analysis: JsonAnalysis | null): JsonStatusLine | null {
  if (!analysis) return null;
  if (!analysis.valid) {
    const count = analysis.errors.length;
    return { valid: false, text: `Invalid · ${count} ${count === 1 ? 'problem' : 'problems'}` };
  }

  const { stats } = analysis;
  const parts = [`${stats.nodeCount.toLocaleString('en')} values`, `depth ${stats.maxDepth}`];
  if (stats.totalKeys > 0) parts.push(`${stats.totalKeys.toLocaleString('en')} keys`);
  parts.push(formatBytes(stats.byteLength));
  return { valid: true, text: `Valid · ${parts.join(' · ')}` };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const TYPE_LABELS: Readonly<Record<JsonNodeType, string>> = {
  object: 'object',
  array: 'array',
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  null: 'null',
  error: 'unreadable',
};

export { formatPath };
