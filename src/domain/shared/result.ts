/**
 * Result — 03_DOMAIN_MODEL.md §2.1
 *
 * The domain never throws for expected failures. A malformed regex is not
 * exceptional; it is the most common input this application receives.
 *
 * Exceptions are reserved for violated invariants (our bugs) and are caught at
 * the worker boundary and converted to an INTERNAL DomainError, so a bug never
 * kills a worker silently.
 */

export type Result<T, E = DomainError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Error codes. Kept small on purpose: each maps to a distinct user-facing
 * recovery path in 08_UI_UX_SPEC.md §14. A code nobody can act on differently
 * does not earn its place.
 */
export type DomainErrorCode =
  /** Input violates the grammar. */
  | 'SYNTAX'
  /** Valid elsewhere, but syntax we deliberately do not support. */
  | 'UNSUPPORTED'
  /** An input or complexity limit was hit. */
  | 'LIMIT_EXCEEDED'
  /** Execution exceeded its wall-clock budget. */
  | 'TIMEOUT'
  /** Our bug. Never shown verbatim to a user. */
  | 'INTERNAL';

export interface SourceSpan {
  /** UTF-16 code-unit offset, inclusive. */
  readonly start: number;
  /** UTF-16 code-unit offset, exclusive. */
  readonly end: number;
  /** 1-based, for error display. */
  readonly line: number;
  /** 1-based, UTF-16 code units. */
  readonly column: number;
}

export interface DomainError {
  readonly code: DomainErrorCode;
  /** User-facing, plain language. Never a stack trace or an internal name. */
  readonly message: string;
  readonly span?: SourceSpan;
  /** What the user can do next. */
  readonly hint?: string;
  /** Development-only detail. Stripped from production builds. */
  readonly detail?: string;
}

/**
 * A hostile input must not become a hostile error message. Anything echoed
 * back into `message` or `hint` is truncated first (03_DOMAIN_MODEL.md §2.2).
 */
export const MAX_ECHOED_INPUT = 80;

export function truncateForMessage(input: string, max: number = MAX_ECHOED_INPUT): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}…`;
}

interface DomainErrorOptions {
  readonly span?: SourceSpan;
  readonly hint?: string;
  readonly detail?: string;
}

export function domainError(
  code: DomainErrorCode,
  message: string,
  options: DomainErrorOptions = {},
): DomainError {
  // Built field-by-field rather than by spreading `options`, so an unexpected
  // key can never reach a DomainError (18_CODING_STANDARDS.md S4).
  const error: {
    code: DomainErrorCode;
    message: string;
    span?: SourceSpan;
    hint?: string;
    detail?: string;
  } = { code, message };

  if (options.span !== undefined) error.span = options.span;
  if (options.hint !== undefined) error.hint = options.hint;
  if (options.detail !== undefined) error.detail = options.detail;

  return error;
}

/**
 * Exhaustiveness guard for discriminated unions. Adding a variant without
 * handling it becomes a compile error rather than a silent fallthrough — the
 * mechanism that stops a new AST node type shipping unexplained
 * (18_CODING_STANDARDS.md §2.2).
 */
export function assertNever(value: never, context = 'value'): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}
