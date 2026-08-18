import { describe, expect, it } from 'vitest';
import {
  assertNever,
  domainError,
  err,
  MAX_ECHOED_INPUT,
  ok,
  truncateForMessage,
} from '@/domain/shared/result';

describe('Result', () => {
  it('narrows to the value on ok', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('narrows to the error on err', () => {
    const result = err(domainError('SYNTAX', 'bad input'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SYNTAX');
  });
});

describe('domainError', () => {
  it('includes only the options that were supplied', () => {
    const error = domainError('LIMIT_EXCEEDED', 'too big');
    // Built field-by-field rather than by spreading, so absent options must
    // not appear as undefined keys (18_CODING_STANDARDS.md S4).
    expect(Object.hasOwn(error, 'hint')).toBe(false);
    expect(Object.hasOwn(error, 'span')).toBe(false);
  });

  it('carries a hint and a span when supplied', () => {
    const span = { start: 0, end: 3, line: 1, column: 1 };
    const error = domainError('SYNTAX', 'unmatched (', { hint: 'Close the group.', span });
    expect(error.hint).toBe('Close the group.');
    expect(error.span).toEqual(span);
  });
});

describe('truncateForMessage', () => {
  it('leaves short input untouched', () => {
    expect(truncateForMessage('abc')).toBe('abc');
  });

  it('truncates at the boundary without an ellipsis', () => {
    const exact = 'x'.repeat(MAX_ECHOED_INPUT);
    expect(truncateForMessage(exact)).toBe(exact);
  });

  it('truncates hostile input so it cannot become a hostile message', () => {
    const hostile = 'A'.repeat(5000);
    const result = truncateForMessage(hostile);
    expect(result).toHaveLength(MAX_ECHOED_INPUT + 1); // + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('assertNever', () => {
  it('throws when an unhandled variant reaches it at runtime', () => {
    // Compile-time exhaustiveness is the point; this guards the runtime path
    // for values arriving from outside the type system (worker messages,
    // storage records).
    expect(() => assertNever('unexpected' as never, 'mode')).toThrow(/Unhandled mode/);
  });
});
