import type { DomainError, SourceSpan } from '../shared/result';
import type { Explanation } from '../shared/explanation';

/**
 * JSON CST — 03_DOMAIN_MODEL.md §4.1
 *
 * A **concrete** syntax tree, not an abstract one. It keeps positions and raw
 * source text, because the tree view, path copying, error carets and
 * precision-loss detection all need the text exactly as the user wrote it. An
 * abstract tree would be smaller and would silently discard the difference
 * between `1e5` and `100000`.
 *
 * Members are an ordered **array**, never a `Record<string, JsonNode>`. See
 * `members` below: that is the primary prototype-pollution defence and it is
 * structural rather than a check that can be forgotten.
 */

export type JsonPathSegment =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'index'; readonly index: number };

/** The accessor chain from the root. Empty at the root itself. */
export type JsonPath = readonly JsonPathSegment[];

export interface JsonMember {
  /** The decoded key. */
  readonly key: string;
  /** Exactly as written, including quotes and escapes. */
  readonly keyRaw: string;
  readonly keySpan: SourceSpan;
  readonly value: JsonNode;
  /** Key through value, so the whole pair can be highlighted. */
  readonly span: SourceSpan;
}

export type JsonNode =
  /**
   * Members are an ordered array of pairs.
   *
   * If this were `Record<string, JsonNode>`, input containing
   * `{"__proto__": {...}}` would put an attacker-controlled key onto a real
   * object, and every later merge, spread or lookup would become a pollution
   * or confusion vector. An array removes the vector at the data-structure
   * level — attacker keys never become real object keys — and preserves key
   * order and duplicates for free (03_DOMAIN_MODEL.md §4.2).
   */
  | {
      readonly type: 'object';
      readonly members: readonly JsonMember[];
      readonly span: SourceSpan;
      readonly path: JsonPath;
    }
  | {
      readonly type: 'array';
      readonly elements: readonly JsonNode[];
      readonly span: SourceSpan;
      readonly path: JsonPath;
    }
  | {
      readonly type: 'string';
      /** Unescaped. Lone surrogates are preserved, not replaced (J-I5). */
      readonly value: string;
      /** Exact source text including the quotes. */
      readonly raw: string;
      readonly span: SourceSpan;
      readonly path: JsonPath;
    }
  | {
      readonly type: 'number';
      /** The IEEE-754 double, which is what JavaScript can represent. */
      readonly value: number;
      /** The exact digits the user wrote. `1e5` stays `1e5`, not `100000`. */
      readonly raw: string;
      readonly span: SourceSpan;
      readonly path: JsonPath;
    }
  | {
      readonly type: 'boolean';
      readonly value: boolean;
      readonly span: SourceSpan;
      readonly path: JsonPath;
    }
  | { readonly type: 'null'; readonly span: SourceSpan; readonly path: JsonPath }
  /** Emitted by panic-mode recovery so one typo still yields a usable tree. */
  | {
      readonly type: 'error';
      readonly raw: string;
      readonly span: SourceSpan;
      readonly path: JsonPath;
    };

export type JsonNodeType = JsonNode['type'];

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export interface JsonStats {
  readonly nodeCount: number;
  readonly maxDepth: number;
  readonly objectCount: number;
  readonly arrayCount: number;
  readonly stringCount: number;
  readonly numberCount: number;
  readonly booleanCount: number;
  readonly nullCount: number;
  readonly totalKeys: number;
  readonly byteLength: number;
}

export interface DuplicateKeyReport {
  readonly path: JsonPath;
  readonly key: string;
  /** Every occurrence, in source order. Never collapsed (J-I4). */
  readonly occurrences: readonly SourceSpan[];
}

/**
 * Why a number cannot be represented faithfully.
 *
 * `PRECISION_LOSS` earns its place on its own: `{"id": 9007199254740993}`
 * round-trips through any JavaScript JSON parser as `9007199254740992`.
 * Silently corrupted identifiers are a real production bug, and the raw text
 * is the only place the evidence survives.
 */
export type UnsafeNumberReason = 'PRECISION_LOSS' | 'OVERFLOW' | 'NEGATIVE_ZERO';

export interface UnsafeNumberReport {
  readonly path: JsonPath;
  readonly raw: string;
  readonly parsed: number;
  readonly span: SourceSpan;
  readonly reason: UnsafeNumberReason;
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

export interface JsonAnalysis {
  readonly kind: 'json';
  readonly source: string;
  /** Null only when nothing at all could be parsed at the root. */
  readonly cst: JsonNode | null;
  readonly valid: boolean;
  /** Multiple, via error recovery. Ranked; the UI shows the first few. */
  readonly errors: readonly DomainError[];
  readonly stats: JsonStats;
  readonly duplicateKeys: readonly DuplicateKeyReport[];
  readonly unsafeNumbers: readonly UnsafeNumberReport[];
  readonly explanation: Explanation;
}
