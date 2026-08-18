import type { SourceSpan } from './result';

/**
 * Explanation model — 03_DOMAIN_MODEL.md §2.4, ADR-011
 *
 * The natural design is `explain(): string` returning markdown. Because
 * explanations quote the user's own tokens, that string would contain user
 * input, and rendering it as HTML would create an injection opportunity on
 * every single analysis — the highest-frequency one in the product.
 *
 * Returning a tree of typed segments instead means user content reaches the
 * DOM as a text node rather than as markup, and the analysis-output path has
 * no HTML sink at all. No sanitiser is needed because there is nothing to
 * sanitise.
 *
 * Consequence for authors: never build a sentence by concatenating user text
 * into a `text` node. Put the user's text in a `code` or `ref` node, which the
 * renderer escapes and styles as quoted syntax.
 */

export type ExplanationNode =
  /** Prose written by us. Never contains user input. */
  | { readonly kind: 'text'; readonly value: string }
  /** A fragment of the user's own syntax, rendered in a code style. */
  | { readonly kind: 'code'; readonly value: string }
  /** Prose we want to stress. Never contains user input. */
  | { readonly kind: 'emphasis'; readonly value: string }
  /** User syntax that also points back at its position in the source. */
  | { readonly kind: 'ref'; readonly value: string; readonly span: SourceSpan }
  | { readonly kind: 'list'; readonly items: readonly ExplanationNode[][] };

export type ExplanationSeverity = 'info' | 'warning' | 'error';

export interface ExplanationSection {
  readonly id: string;
  readonly title: string;
  readonly span?: SourceSpan;
  readonly body: readonly ExplanationNode[];
  readonly severity?: ExplanationSeverity;
}

export interface Explanation {
  /** One-paragraph plain-English reading of the whole input. */
  readonly summary: readonly ExplanationNode[];
  readonly details: readonly ExplanationSection[];
}

/* ------------------------------------------------------------------ *
 * Builders
 *
 * Short names because explanation code is dense with them; using the
 * builders rather than object literals keeps the discipline visible —
 * `code(userText)` reads as "this is user content".
 * ------------------------------------------------------------------ */

export function text(value: string): ExplanationNode {
  return { kind: 'text', value };
}

export function code(value: string): ExplanationNode {
  return { kind: 'code', value };
}

export function emphasis(value: string): ExplanationNode {
  return { kind: 'emphasis', value };
}

export function ref(value: string, span: SourceSpan): ExplanationNode {
  return { kind: 'ref', value, span };
}

export function list(items: readonly ExplanationNode[][]): ExplanationNode {
  return { kind: 'list', items };
}

export function section(
  id: string,
  title: string,
  body: readonly ExplanationNode[],
  extra: { span?: SourceSpan; severity?: ExplanationSeverity } = {},
): ExplanationSection {
  // Built field-by-field rather than by spreading `extra`, so an unexpected
  // key can never reach a section (18_CODING_STANDARDS.md S4).
  const result: {
    id: string;
    title: string;
    body: readonly ExplanationNode[];
    span?: SourceSpan;
    severity?: ExplanationSeverity;
  } = { id, title, body };
  if (extra.span !== undefined) result.span = extra.span;
  if (extra.severity !== undefined) result.severity = extra.severity;
  return result;
}

/**
 * Joins clauses into a sentence with proper conjunctions.
 *
 * Without this, summaries read as a comma-separated token dump — the failure
 * mode R-04 describes, and the difference between a tool that teaches and one
 * that merely lists.
 */
export function joinClauses(
  clauses: readonly (readonly ExplanationNode[])[],
  conjunction = 'then',
): ExplanationNode[] {
  const present = clauses.filter((clause) => clause.length > 0);
  if (present.length === 0) return [];
  if (present.length === 1) return [...(present[0] ?? [])];

  const out: ExplanationNode[] = [];
  present.forEach((clause, index) => {
    if (index > 0) {
      out.push(text(index === present.length - 1 ? `, ${conjunction} ` : ', '));
    }
    out.push(...clause);
  });
  return out;
}

/** Flattens an explanation to plain text. Used by tests and copy-to-clipboard. */
export function explanationToText(nodes: readonly ExplanationNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
        case 'emphasis':
          return node.value;
        case 'code':
        case 'ref':
          return node.value;
        case 'list':
          return node.items.map((item) => explanationToText(item)).join('; ');
      }
    })
    .join('');
}
