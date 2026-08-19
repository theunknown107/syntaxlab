/**
 * Runtime validation of a `JsonAnalysis` crossing the worker boundary.
 *
 * Same rule as the regex operations: a successful response is checked **by
 * value**, never accepted on the strength of a TypeScript cast. What makes
 * this one stricter is that the tree is entirely user-shaped — every key, and
 * every span the UI will use to slice the source and place a decoration, comes
 * from the document. A wrong offset here is not a cosmetic problem.
 *
 * Scope is deliberate. The tree is walked to a bounded depth and node count
 * rather than exhaustively: it is produced by our own parser, its size is
 * capped by the input limit, and it is rendered as text rather than executed.
 * Re-verifying half a million nodes would duplicate the parser for no
 * additional safety, and would cost more than the parse did.
 */

const NODE_TYPES = new Set(['object', 'array', 'string', 'number', 'boolean', 'null', 'error']);
const UNSAFE_REASONS = new Set(['PRECISION_LOSS', 'OVERFLOW', 'NEGATIVE_ZERO']);

/** How much of the tree is re-checked. Beyond this the shape is trusted. */
const WALK_NODE_BUDGET = 5000;
const WALK_DEPTH_BUDGET = 600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSpan(value: unknown, sourceLength: number): boolean {
  if (!isRecord(value)) return false;
  const { start, end, line, column } = value;
  if (typeof start !== 'number' || typeof end !== 'number') return false;
  if (typeof line !== 'number' || typeof column !== 'number') return false;
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

function isPath(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((segment) => {
    if (!isRecord(segment)) return false;
    if (segment.kind === 'key') return typeof segment.key === 'string';
    if (segment.kind === 'index') {
      return (
        typeof segment.index === 'number' && Number.isInteger(segment.index) && segment.index >= 0
      );
    }
    return false;
  });
}

interface WalkBudget {
  nodes: number;
}

function isNode(value: unknown, sourceLength: number, budget: WalkBudget, depth: number): boolean {
  if (depth > WALK_DEPTH_BUDGET) return false;
  if (budget.nodes <= 0) return true; // budget spent; the rest is trusted
  budget.nodes -= 1;

  if (!isRecord(value)) return false;
  if (typeof value.type !== 'string' || !NODE_TYPES.has(value.type)) return false;
  if (!isSpan(value.span, sourceLength)) return false;
  if (!isPath(value.path)) return false;

  switch (value.type) {
    case 'object':
      return isMembers(value.members, sourceLength, budget, depth);
    case 'array':
      return (
        Array.isArray(value.elements) &&
        value.elements.every((element) => isNode(element, sourceLength, budget, depth + 1))
      );
    case 'string':
      return typeof value.value === 'string' && typeof value.raw === 'string';
    case 'number':
      return typeof value.value === 'number' && typeof value.raw === 'string';
    case 'boolean':
      return typeof value.value === 'boolean';
    case 'null':
      return true;
    default:
      return typeof value.raw === 'string';
  }
}

function isMembers(
  value: unknown,
  sourceLength: number,
  budget: WalkBudget,
  depth: number,
): boolean {
  // An array, not a record. If this ever arrived as an object the primary
  // prototype-pollution defence would have been lost somewhere upstream, so
  // the shape check is a security check as much as a correctness one.
  if (!Array.isArray(value)) return false;

  return value.every((member) => {
    if (!isRecord(member)) return false;
    if (typeof member.key !== 'string' || typeof member.keyRaw !== 'string') return false;
    if (!isSpan(member.keySpan, sourceLength)) return false;
    if (!isSpan(member.span, sourceLength)) return false;
    return isNode(member.value, sourceLength, budget, depth + 1);
  });
}

function isStats(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const fields = [
    'nodeCount',
    'maxDepth',
    'objectCount',
    'arrayCount',
    'stringCount',
    'numberCount',
    'booleanCount',
    'nullCount',
    'totalKeys',
    'byteLength',
  ];
  return fields.every((field) => {
    const count = value[field];
    return typeof count === 'number' && Number.isInteger(count) && count >= 0;
  });
}

function isDomainError(value: unknown): boolean {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

function isDuplicateReport(value: unknown, sourceLength: number): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.key !== 'string' || !isPath(value.path)) return false;
  return (
    Array.isArray(value.occurrences) &&
    value.occurrences.length > 0 &&
    value.occurrences.every((span) => isSpan(span, sourceLength))
  );
}

function isUnsafeNumberReport(value: unknown, sourceLength: number): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.raw !== 'string' || typeof value.parsed !== 'number') return false;
  if (typeof value.reason !== 'string' || !UNSAFE_REASONS.has(value.reason)) return false;
  return isPath(value.path) && isSpan(value.span, sourceLength);
}

function isExplanationNodes(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (!Array.isArray(value)) return false;

  return value.every((node) => {
    if (!isRecord(node)) return false;
    switch (node.kind) {
      case 'text':
      case 'code':
      case 'emphasis':
        return typeof node.value === 'string';
      case 'ref':
        return typeof node.value === 'string' && isRecord(node.span);
      case 'list':
        return (
          Array.isArray(node.items) &&
          node.items.every((item) => isExplanationNodes(item, depth + 1))
        );
      default:
        return false;
    }
  });
}

function isExplanation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isExplanationNodes(value.summary)) return false;
  if (!Array.isArray(value.details)) return false;

  return value.details.every((detail) => {
    if (!isRecord(detail)) return false;
    if (typeof detail.id !== 'string' || typeof detail.title !== 'string') return false;
    return isExplanationNodes(detail.body);
  });
}

/** The one export: does this value hold together as a `JsonAnalysis`? */
export function isValidJsonAnalysis(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind !== 'json') return false;
  if (typeof value.source !== 'string') return false;
  if (typeof value.valid !== 'boolean') return false;

  const sourceLength = value.source.length;
  const budget: WalkBudget = { nodes: WALK_NODE_BUDGET };

  if (value.cst !== null && !isNode(value.cst, sourceLength, budget, 0)) return false;
  if (!Array.isArray(value.errors) || !value.errors.every(isDomainError)) return false;
  if (!isStats(value.stats)) return false;

  if (
    !Array.isArray(value.duplicateKeys) ||
    !value.duplicateKeys.every((report) => isDuplicateReport(report, sourceLength))
  ) {
    return false;
  }

  if (
    !Array.isArray(value.unsafeNumbers) ||
    !value.unsafeNumbers.every((report) => isUnsafeNumberReport(report, sourceLength))
  ) {
    return false;
  }

  // A document reported as valid may not also carry errors; the two would
  // contradict each other in the UI.
  if (value.valid && value.errors.length > 0) return false;

  return isExplanation(value.explanation);
}
