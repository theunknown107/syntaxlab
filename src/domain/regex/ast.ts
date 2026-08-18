import type { DomainError, SourceSpan } from '../shared/result';
import type { Explanation } from '../shared/explanation';

/**
 * Regex AST — 03_DOMAIN_MODEL.md §3.1
 *
 * Target: ECMAScript patterns only (D-03). The node set is shaped for
 * explanation and source linking rather than for matching: every node carries
 * a span so the UI can highlight the exact syntax an explanation refers to.
 *
 * Deliberately not simplified for parsing convenience. A flatter tree would be
 * easier to build and would lose the grouping and precedence information the
 * explanation and future tree view depend on.
 */

export type RegexAnchorKind = 'start' | 'end' | 'wordBoundary' | 'nonWordBoundary';

export type RegexGroupKind =
  | 'capturing'
  | 'nonCapturing'
  | 'named'
  | 'lookahead'
  | 'negativeLookahead'
  | 'lookbehind'
  | 'negativeLookbehind';

/** How an escape was written, which the explanation needs to describe it. */
export type EscapeKind =
  /** \d \D \w \W \s \S — a shorthand character class */
  | 'shorthand'
  /** \n \r \t \f \v \0 — a control character */
  | 'control'
  /** \cA — a control-letter escape */
  | 'controlLetter'
  /** \x41 — a two-digit hex escape */
  | 'hex'
  /** A or \u{1F600} — a Unicode escape */
  | 'unicode'
  /** \$ \. \\ — an escaped metacharacter with no special meaning */
  | 'identity'
  /** \8 \9 or a legacy octal, which behave differently under /u */
  | 'legacyOctal'
  /** Recognised but not valid in this position */
  | 'invalid';

export interface CharClassChar {
  readonly kind: 'char';
  /** The decoded code point this matches. */
  readonly value: string;
  /** Exactly as written, so the explanation can quote it. */
  readonly raw: string;
  readonly span: SourceSpan;
}

export interface CharClassRange {
  readonly kind: 'range';
  readonly from: CharClassChar;
  readonly to: CharClassChar;
  readonly span: SourceSpan;
}

export interface CharClassEscape {
  readonly kind: 'escape';
  readonly escape: EscapeKind;
  readonly raw: string;
  readonly span: SourceSpan;
}

export interface CharClassProperty {
  readonly kind: 'property';
  readonly property: string;
  readonly value?: string;
  readonly negated: boolean;
  readonly raw: string;
  readonly span: SourceSpan;
}

export type CharClassItem = CharClassChar | CharClassRange | CharClassEscape | CharClassProperty;

export type RegexNode =
  /** Root is always this, even for a single branch (invariant R-I1). */
  | {
      readonly type: 'Alternation';
      readonly alternatives: readonly RegexNode[];
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'Sequence';
      readonly elements: readonly RegexNode[];
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'Literal';
      readonly value: string;
      readonly raw: string;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'CharClass';
      readonly negated: boolean;
      readonly items: readonly CharClassItem[];
      readonly span: SourceSpan;
    }
  | { readonly type: 'Dot'; readonly span: SourceSpan }
  | { readonly type: 'Anchor'; readonly anchor: RegexAnchorKind; readonly span: SourceSpan }
  | {
      readonly type: 'Group';
      readonly groupKind: RegexGroupKind;
      /** Present only for capturing and named groups. Assigned in pass two. */
      readonly number?: number;
      readonly name?: string;
      readonly body: RegexNode;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'Quantifier';
      readonly min: number;
      /** null means unbounded (`*`, `+`, `{n,}`). */
      readonly max: number | null;
      readonly lazy: boolean;
      /** Never itself a Quantifier (invariant R-I3). */
      readonly body: RegexNode;
      readonly raw: string;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'Backreference';
      readonly ref: number | string;
      /** False when the reference does not resolve to a real group. */
      readonly resolved: boolean;
      readonly raw: string;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'CharEscape';
      readonly escape: EscapeKind;
      readonly value: string;
      readonly raw: string;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'UnicodeProperty';
      readonly property: string;
      readonly value?: string;
      readonly negated: boolean;
      readonly raw: string;
      readonly span: SourceSpan;
    }
  /** Emitted by error recovery so a single typo still yields a usable tree. */
  | { readonly type: 'Error'; readonly raw: string; readonly span: SourceSpan };

export type RegexNodeType = RegexNode['type'];

/* ------------------------------------------------------------------ *
 * Analysis result
 * ------------------------------------------------------------------ */

export interface RegexFlags {
  readonly global: boolean;
  readonly ignoreCase: boolean;
  readonly multiline: boolean;
  readonly dotAll: boolean;
  readonly unicode: boolean;
  readonly sticky: boolean;
  readonly hasIndices: boolean;
  readonly unicodeSets: boolean;
}

export const EMPTY_FLAGS: RegexFlags = {
  global: false,
  ignoreCase: false,
  multiline: false,
  dotAll: false,
  unicode: false,
  sticky: false,
  hasIndices: false,
  unicodeSets: false,
};

export interface CaptureGroupInfo {
  readonly number: number;
  readonly name?: string;
  readonly span: SourceSpan;
  /** Nesting depth, for the group table and the tree view. */
  readonly depth: number;
}

export type RegexWarningCode =
  | 'NESTED_QUANTIFIER'
  | 'UNESCAPED_DOT_IN_CLASS'
  | 'REDUNDANT_ESCAPE'
  | 'EMPTY_ALTERNATIVE'
  | 'UNICODE_FLAG_ADVISED'
  | 'LARGE_BOUNDED_REPEAT'
  | 'ANCHOR_IN_MIDDLE'
  | 'LOOKBEHIND_COMPATIBILITY'
  | 'UNRESOLVED_BACKREFERENCE'
  | 'DUPLICATE_GROUP_NAME';

export interface RegexWarning {
  readonly code: RegexWarningCode;
  readonly message: string;
  readonly span: SourceSpan;
  readonly hint?: string;
}

/** The ECMAScript level a pattern requires. */
export type EcmaScriptLevel = 'es5' | 'es2018' | 'es2022' | 'es2024' | 'es2025';

export interface CompatibilityNote {
  readonly feature: string;
  readonly level: EcmaScriptLevel;
  readonly detail: string;
  readonly span: SourceSpan;
}

export interface EngineCompatibility {
  /** The highest level any construct in the pattern requires. */
  readonly ecmascript: EcmaScriptLevel;
  readonly notes: readonly CompatibilityNote[];
}

export type RegexTokenType =
  | 'Char'
  | 'Dot'
  | 'Anchor'
  | 'GroupOpen'
  | 'GroupClose'
  | 'Alternate'
  | 'ClassOpen'
  | 'ClassClose'
  | 'Quantifier'
  | 'Escape'
  | 'UnicodeProperty'
  | 'Backreference'
  | 'Invalid';

/** Flat, ordered token list backing the token-breakdown table in the UI. */
export interface RegexToken {
  readonly type: RegexTokenType;
  readonly raw: string;
  readonly span: SourceSpan;
}

export interface RegexAnalysis {
  readonly kind: 'regex';
  readonly source: string;
  readonly flags: RegexFlags;
  readonly ast: RegexNode;
  readonly tokens: readonly RegexToken[];
  readonly groups: readonly CaptureGroupInfo[];
  readonly explanation: Explanation;
  readonly warnings: readonly RegexWarning[];
  readonly compatibility: EngineCompatibility;
  /**
   * Syntax errors found while parsing. Present on a *successful* analysis
   * because the parser recovers: one typo in a long pattern still yields an
   * explanation for the rest, and the UI shows both.
   *
   * An analysis fails outright (Result.err) only when nothing useful can be
   * produced at all — over the length limit, or unusable flags.
   */
  readonly errors: readonly DomainError[];
}
