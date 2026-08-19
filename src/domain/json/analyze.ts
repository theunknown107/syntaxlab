import { err, ok, type DomainError, type Result, type SourceSpan } from '../shared/result';
import type {
  DuplicateKeyReport,
  JsonAnalysis,
  JsonNode,
  JsonPath,
  JsonStats,
  UnsafeNumberReport,
} from './ast';
import { explainJson } from './explain';
import { unsafeNumberReason } from './numbers';
import { parseJson } from './parser';
import { NOTABLE_KEYS, RISKY_KEYS } from './plain';
import { checkInputLength } from './tokenizer';

/**
 * JSON analysis pipeline — 04_PARSER_ARCHITECTURE.md §3.2
 *
 *   text → size check → scan → parse → findings → explanation → JsonAnalysis
 *
 * Framework-free by construction: it runs in the analysis worker and under
 * Node in tests, and imports nothing outside the domain.
 *
 * Returns `err` only when nothing useful can be produced — an input over the
 * size limit, where refusing before parsing is the point. Syntax errors are
 * recovered from and reported *inside* a successful analysis, because a single
 * missing comma should still explain the rest of the document.
 */

/** Keys worth telling the user about. See `plain.ts` for why each matters. */
export interface RiskyKeyReport {
  readonly key: string;
  readonly span: SourceSpan;
  readonly path: JsonPath;
  /** `dropped`: removed from any plain-value conversion. `notable`: kept. */
  readonly severity: 'dropped' | 'notable';
}

export interface JsonFindings {
  readonly stats: JsonStats;
  readonly duplicateKeys: readonly DuplicateKeyReport[];
  readonly unsafeNumbers: readonly UnsafeNumberReport[];
  readonly riskyKeys: readonly RiskyKeyReport[];
}

export function analyzeJson(source: string): Result<JsonAnalysis> {
  const tooLong = checkInputLength(source);
  if (tooLong) return err(tooLong);

  const parsed = parseJson(source);
  const findings = collectFindings(parsed.root, source, parsed.maxDepth);
  const errors = rankErrors(parsed.errors);

  const explanation = explainJson({
    root: parsed.root,
    errors,
    findings,
  });

  return ok({
    kind: 'json',
    source,
    cst: parsed.root,
    valid: errors.length === 0 && parsed.root !== null,
    errors,
    stats: findings.stats,
    duplicateKeys: findings.duplicateKeys,
    unsafeNumbers: findings.unsafeNumbers,
    explanation,
  });
}

/**
 * How specific a message is, when two describe the same position.
 *
 * `UNSUPPORTED` names a construct from another dialect — "Strings must use
 * double quotes" — which is always more useful than the generic syntax
 * complaint the same token also produces.
 */
function specificity(error: DomainError): number {
  if (error.code === 'UNSUPPORTED') return 2;
  if (error.code === 'SYNTAX') return 1;
  return 0;
}

/**
 * One report per position, limit errors first, then source order.
 *
 * The scanner and the parser can both have something to say about the same
 * token: `{a:1}` produced "`a` is not valid JSON" from one and "Object keys
 * must be quoted strings" from the other. Two complaints about one mistake is
 * noise, so the most specific survives — and where the codes tie, the later
 * report wins, because the parser knows what position the token was in and the
 * scanner does not.
 *
 * A `LIMIT_EXCEEDED` explains every syntax error that follows it, so it leads
 * regardless of where it occurred; burying it under the cascade it caused
 * would be actively misleading.
 */
function rankErrors(errors: readonly DomainError[]): DomainError[] {
  const best = new Map<number, DomainError>();
  const unpositioned: DomainError[] = [];

  for (const error of errors) {
    const at = error.span?.start;
    if (at === undefined) {
      unpositioned.push(error);
      continue;
    }
    const existing = best.get(at);
    if (!existing || specificity(error) >= specificity(existing)) best.set(at, error);
  }

  const positioned = [...best.entries()].sort(([a], [b]) => a - b).map(([, error]) => error);

  const all = [...unpositioned, ...positioned];
  const limits = all.filter((error) => error.code === 'LIMIT_EXCEEDED');
  const rest = all.filter((error) => error.code !== 'LIMIT_EXCEEDED');
  return [...limits, ...rest];
}

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

/** Everything one walk accumulates, passed as a single value. */
interface Accumulator {
  readonly duplicateKeys: DuplicateKeyReport[];
  readonly unsafeNumbers: UnsafeNumberReport[];
  readonly riskyKeys: RiskyKeyReport[];
  readonly counters: Counters;
}

interface Counters {
  nodeCount: number;
  objectCount: number;
  arrayCount: number;
  stringCount: number;
  numberCount: number;
  booleanCount: number;
  nullCount: number;
  totalKeys: number;
}

/**
 * One walk that gathers everything, rather than four walks over the same tree.
 *
 * Recursive rather than iterative, unlike the parser: depth here is already
 * bounded to `LIMITS.json.maxDepth` by the parser that produced this tree, so
 * the stack cannot be driven by input the way it can during parsing.
 */
export function collectFindings(
  root: JsonNode | null,
  source: string,
  maxDepth: number,
): JsonFindings {
  const counters: Counters = {
    nodeCount: 0,
    objectCount: 0,
    arrayCount: 0,
    stringCount: 0,
    numberCount: 0,
    booleanCount: 0,
    nullCount: 0,
    totalKeys: 0,
  };
  const acc: Accumulator = {
    counters,
    duplicateKeys: [],
    unsafeNumbers: [],
    riskyKeys: [],
  };

  if (root) walk(root, acc);

  return {
    stats: {
      nodeCount: counters.nodeCount,
      maxDepth,
      objectCount: counters.objectCount,
      arrayCount: counters.arrayCount,
      stringCount: counters.stringCount,
      numberCount: counters.numberCount,
      booleanCount: counters.booleanCount,
      nullCount: counters.nullCount,
      totalKeys: counters.totalKeys,
      byteLength: utf8Length(source),
    },
    duplicateKeys: acc.duplicateKeys,
    unsafeNumbers: acc.unsafeNumbers,
    riskyKeys: acc.riskyKeys,
  };
}

function walk(node: JsonNode, acc: Accumulator): void {
  const { counters } = acc;
  counters.nodeCount += 1;

  switch (node.type) {
    case 'object': {
      counters.objectCount += 1;
      counters.totalKeys += node.members.length;
      collectDuplicates(node, acc.duplicateKeys);
      for (const member of node.members) {
        collectRiskyKey(member.key, member.keySpan, node, acc.riskyKeys);
        walk(member.value, acc);
      }
      return;
    }
    case 'array':
      counters.arrayCount += 1;
      for (const element of node.elements) walk(element, acc);
      return;
    case 'string':
      counters.stringCount += 1;
      return;
    case 'number': {
      counters.numberCount += 1;
      const reason = unsafeNumberReason(node.raw, node.value);
      if (reason) {
        acc.unsafeNumbers.push({
          path: node.path,
          raw: node.raw,
          parsed: node.value,
          span: node.span,
          reason,
        });
      }
      return;
    }
    case 'boolean':
      counters.booleanCount += 1;
      return;
    case 'null':
      counters.nullCount += 1;
      return;
    case 'error':
      // Counted as a node so the stats reflect the document's real size, but
      // it contributes no type.
      return;
  }
}

/**
 * Duplicate keys are reported, never collapsed (J-I4).
 *
 * `JSON.parse` keeps the last occurrence and tells nobody. Which one a
 * consumer sees is genuinely ambiguous across languages — some take the first
 * — so the useful answer is "there are two, here is where each one is".
 */
function collectDuplicates(
  node: Extract<JsonNode, { type: 'object' }>,
  out: DuplicateKeyReport[],
): void {
  // A Map keyed by the user's own strings, never an object: a `Map` has no
  // prototype chain to collide with, so `__proto__` is an ordinary key here.
  const seen = new Map<string, SourceSpan[]>();

  for (const member of node.members) {
    const spans = seen.get(member.key);
    if (spans) spans.push(member.keySpan);
    else seen.set(member.key, [member.keySpan]);
  }

  for (const [key, occurrences] of seen) {
    if (occurrences.length > 1) out.push({ path: node.path, key, occurrences });
  }
}

function collectRiskyKey(
  key: string,
  span: SourceSpan,
  parent: Extract<JsonNode, { type: 'object' }>,
  out: RiskyKeyReport[],
): void {
  const severity = RISKY_KEYS.has(key) ? 'dropped' : NOTABLE_KEYS.has(key) ? 'notable' : null;
  if (!severity) return;
  out.push({ key, span, path: parent.path, severity });
}

/**
 * UTF-8 byte length, counted rather than encoded.
 *
 * `new TextEncoder().encode(source).length` allocates a second copy of the
 * whole document — up to 5 MB — to learn one number.
 */
export function utf8Length(source: string): number {
  let bytes = 0;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < source.length) {
      const next = source.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        // A well-formed surrogate pair is one four-byte code point.
        bytes += 4;
        i += 1;
        continue;
      }
      // A lone surrogate is not encodable; UTF-8 encoders emit the three-byte
      // replacement character for it, so count three.
      bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
