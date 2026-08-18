import type { RegexAnalysis, RegexNode } from './ast';

/**
 * Runtime validation of a RegexAnalysis crossing the worker boundary.
 *
 * Added at M3 with the per-operation result validators. Without it, a
 * successful response carried an unvalidated `unknown` into application state
 * on the strength of a TypeScript cast — trusting the type rather than the
 * value, which is exactly what the rest of the boundary refuses to do.
 *
 * Scope is deliberate. This asserts the invariants a consumer relies on —
 * shape, discriminants, span validity, group numbering — rather than
 * re-verifying every node of a bounded tree. The result is produced by our own
 * code, its size is capped by the input limit, and it is rendered as text
 * rather than executed. Walking every node again would duplicate the parser
 * for no additional safety.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSpan(value: unknown, sourceLength: number): boolean {
  if (!isRecord(value)) return false;
  const { start, end, line, column } = value;
  if (typeof start !== 'number' || typeof end !== 'number') return false;
  if (typeof line !== 'number' || typeof column !== 'number') return false;
  // The documented span invariants (03_DOMAIN_MODEL.md §2.3).
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start <= end &&
    end <= sourceLength &&
    line >= 1 &&
    column >= 1
  );
}

const NODE_TYPES = new Set([
  'Alternation',
  'Sequence',
  'Literal',
  'CharClass',
  'Dot',
  'Anchor',
  'Group',
  'Quantifier',
  'Backreference',
  'CharEscape',
  'UnicodeProperty',
  'Error',
]);

/**
 * Checks the tree's shape to a bounded depth. Full traversal is unnecessary
 * (see above) but the root and its immediate structure must be sound, because
 * a renderer walking a malformed tree is where a crash would surface.
 */
function isNodeShape(value: unknown, sourceLength: number, depth = 0): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.type !== 'string' || !NODE_TYPES.has(value.type)) return false;
  if (!isSpan(value.span, sourceLength)) return false;
  if (depth >= 4) return true; // bounded — see the note above

  if (value.type === 'Alternation') {
    return (
      Array.isArray(value.alternatives) &&
      value.alternatives.every((child) => isNodeShape(child, sourceLength, depth + 1))
    );
  }
  if (value.type === 'Sequence') {
    return (
      Array.isArray(value.elements) &&
      value.elements.every((child) => isNodeShape(child, sourceLength, depth + 1))
    );
  }
  if (value.type === 'Group' || value.type === 'Quantifier') {
    return isNodeShape(value.body, sourceLength, depth + 1);
  }
  return true;
}

function isFlags(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    'global',
    'ignoreCase',
    'multiline',
    'dotAll',
    'unicode',
    'sticky',
    'hasIndices',
    'unicodeSets',
  ].every((key) => typeof value[key] === 'boolean');
}

function isExplanation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.summary) || !Array.isArray(value.details)) return false;
  return (
    value.summary.every((node) => isRecord(node) && typeof node.kind === 'string') &&
    value.details.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        Array.isArray(item.body),
    )
  );
}

export function isValidRegexAnalysis(value: unknown): value is RegexAnalysis {
  if (!isRecord(value)) return false;
  if (value.kind !== 'regex') return false;
  if (typeof value.source !== 'string') return false;

  const sourceLength = value.source.length;

  if (!isFlags(value.flags)) return false;
  if (!isNodeShape(value.ast, sourceLength)) return false;
  // Invariant R-I1: the root is always an Alternation.
  if ((value.ast as RegexNode).type !== 'Alternation') return false;

  if (!Array.isArray(value.tokens)) return false;
  if (
    !value.tokens.every(
      (token) =>
        isRecord(token) &&
        typeof token.type === 'string' &&
        typeof token.raw === 'string' &&
        isSpan(token.span, sourceLength),
    )
  ) {
    return false;
  }

  if (!Array.isArray(value.groups)) return false;
  if (
    !value.groups.every(
      (group) =>
        isRecord(group) &&
        typeof group.number === 'number' &&
        Number.isInteger(group.number) &&
        group.number >= 1 &&
        typeof group.depth === 'number' &&
        isSpan(group.span, sourceLength),
    )
  ) {
    return false;
  }

  // Invariant R-I4: numbers are contiguous from 1 in source order.
  const numbers = value.groups.map((group) => (group as { number: number }).number);
  if (numbers.some((number, index) => number !== index + 1)) return false;

  if (!isExplanation(value.explanation)) return false;

  if (!Array.isArray(value.warnings)) return false;
  if (
    !value.warnings.every(
      (warning) =>
        isRecord(warning) &&
        typeof warning.code === 'string' &&
        typeof warning.message === 'string' &&
        isSpan(warning.span, sourceLength),
    )
  ) {
    return false;
  }

  if (!isRecord(value.compatibility)) return false;
  if (typeof value.compatibility.ecmascript !== 'string') return false;
  if (!Array.isArray(value.compatibility.notes)) return false;

  if (!Array.isArray(value.errors)) return false;
  return value.errors.every(
    (error) =>
      isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string',
  );
}
