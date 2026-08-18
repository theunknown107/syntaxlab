import { describe, expect, it } from 'vitest';
import { tokenize } from '@/domain/regex/tokenizer';

const lex = (source: string, unicode = false) => tokenize(source, { unicode });

describe('tokenizer — literals and spans', () => {
  it('assigns a span to every token', () => {
    const { tokens } = lex('abc');
    expect(tokens.map((t) => [t.span.start, t.span.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('measures astral characters in UTF-16 code units', () => {
    // 😀 is one code point but two code units. Every downstream span depends
    // on this being counted the way String.slice and RegExp indices do.
    const { tokens } = lex('a😀b');
    expect('a😀b'.length).toBe(4);
    expect(tokens).toHaveLength(3);
    expect(tokens[1]?.raw).toBe('😀');
    expect(tokens[1]?.span).toMatchObject({ start: 1, end: 3 });
    expect(tokens[2]?.span).toMatchObject({ start: 3, end: 4 });
  });

  it('keeps spans within the source for astral input', () => {
    const source = '😀+😀';
    const { tokens } = lex(source);
    for (const token of tokens) {
      expect(token.span.start).toBeGreaterThanOrEqual(0);
      expect(token.span.end).toBeLessThanOrEqual(source.length);
      expect(token.span.start).toBeLessThanOrEqual(token.span.end);
    }
  });

  it('tracks line and column across newlines', () => {
    const { tokens } = lex('a\nb');
    expect(tokens[2]?.span.line).toBe(2);
    expect(tokens[2]?.span.column).toBe(1);
  });
});

describe('tokenizer — character class context', () => {
  it('treats metacharacters as literals inside a class', () => {
    const { tokens } = lex('[.*+]');
    const inner = tokens.filter((t) => t.kind === 'char');
    expect(inner.map((t) => t.raw)).toEqual(['.', '*', '+']);
  });

  it('treats the same characters as operators outside a class', () => {
    const { tokens } = lex('a*');
    expect(tokens[1]?.kind).toBe('quantifier');
  });

  it('reads a leading caret as negation', () => {
    const { tokens } = lex('[^a]');
    expect(tokens[1]?.kind).toBe('classNegate');
  });

  it('treats a caret elsewhere in a class as a literal', () => {
    const { tokens } = lex('[a^]');
    expect(tokens.filter((t) => t.kind === 'classNegate')).toHaveLength(0);
  });

  it('distinguishes a range hyphen from a literal hyphen', () => {
    expect(lex('[a-z]').tokens.some((t) => t.kind === 'classRange')).toBe(true);
    // Leading and trailing hyphens are literals, which the explanation
    // depends on getting right.
    expect(lex('[-az]').tokens.some((t) => t.kind === 'classRange')).toBe(false);
    expect(lex('[az-]').tokens.some((t) => t.kind === 'classRange')).toBe(false);
  });

  it('reports an unterminated class', () => {
    const { errors } = lex('[abc');
    expect(errors[0]?.message).toMatch(/unterminated/i);
  });
});

describe('tokenizer — quantifiers', () => {
  it.each([
    ['a*', 0, null, false],
    ['a+', 1, null, false],
    ['a?', 0, 1, false],
    ['a*?', 0, null, true],
    ['a{3}', 3, 3, false],
    ['a{2,}', 2, null, false],
    ['a{2,4}', 2, 4, false],
    ['a{2,4}?', 2, 4, true],
  ])('reads %s', (source, min, max, lazy) => {
    const token = lex(source).tokens.find((t) => t.kind === 'quantifier');
    expect(token).toMatchObject({ min, max, lazy });
  });

  it('rejects a backwards range, matching the JS engine', () => {
    const { errors } = lex('a{4,2}');
    expect(errors[0]?.message).toMatch(/backwards/i);
  });

  it('treats a non-quantifier brace as a literal without the u flag', () => {
    const { tokens, errors } = lex('a{x}');
    expect(errors).toHaveLength(0);
    expect(tokens.some((t) => t.kind === 'char' && t.raw === '{')).toBe(true);
  });

  it('rejects a lone brace with the u flag', () => {
    // Annex B and strict-unicode disagree here, and we implement both.
    const { errors } = lex('a{x}', true);
    expect(errors[0]?.message).toMatch(/`u` flag/);
  });
});

describe('tokenizer — groups', () => {
  it.each([
    ['(a)', 'capturing'],
    ['(?:a)', 'nonCapturing'],
    ['(?<name>a)', 'named'],
    ['(?=a)', 'lookahead'],
    ['(?!a)', 'negativeLookahead'],
    ['(?<=a)', 'lookbehind'],
    ['(?<!a)', 'negativeLookbehind'],
  ])('reads %s as %s', (source, groupKind) => {
    const token = lex(source).tokens.find((t) => t.kind === 'groupOpen');
    expect(token?.groupKind).toBe(groupKind);
  });

  it('captures the group name', () => {
    const token = lex('(?<year>\\d{4})').tokens.find((t) => t.kind === 'groupOpen');
    expect(token?.groupName).toBe('year');
  });

  it('rejects unrecognised group syntax without stalling', () => {
    const { errors, tokens } = lex('(?%a)');
    expect(errors[0]?.message).toMatch(/unrecognised group/i);
    expect(tokens.length).toBeGreaterThan(0);
  });
});

describe('tokenizer — escapes', () => {
  it.each([
    ['\\d', 'shorthand'],
    ['\\w', 'shorthand'],
    ['\\s', 'shorthand'],
    ['\\n', 'control'],
    ['\\t', 'control'],
    ['\\x41', 'hex'],
    ['\\u0041', 'unicode'],
    ['\\cA', 'controlLetter'],
    ['\\.', 'identity'],
  ])('categorises %s as %s', (source, escape) => {
    const token = lex(source).tokens.find((t) => t.kind === 'escape');
    expect(token?.escape).toBe(escape);
  });

  it('decodes hex and unicode escapes', () => {
    expect(lex('\\x41').tokens[0]?.value).toBe('A');
    expect(lex('\\u0041').tokens[0]?.value).toBe('A');
    expect(lex('\\u{1F600}', true).tokens[0]?.value).toBe('😀');
  });

  it('requires the u flag for brace unicode escapes', () => {
    const { errors } = lex('\\u{1F600}');
    expect(errors[0]?.message).toMatch(/requires the `u` flag/);
  });

  it('reads word-boundary anchors outside a class', () => {
    expect(lex('\\b').tokens[0]?.kind).toBe('anchor');
  });

  it('reads \\b inside a class as a backspace, not a boundary', () => {
    // A genuine ECMAScript subtlety; getting it wrong produces a confidently
    // wrong explanation.
    const token = lex('[\\b]').tokens.find((t) => t.kind === 'escape');
    expect(token?.escape).toBe('control');
    expect(token?.value).toBe('\b');
  });

  it('reports a trailing backslash', () => {
    const { errors } = lex('a\\');
    expect(errors[0]?.message).toMatch(/lone backslash/i);
  });

  it('rejects a non-syntax identity escape under the u flag', () => {
    expect(lex('\\q', true).errors).toHaveLength(1);
    expect(lex('\\q', false).errors).toHaveLength(0);
  });
});

describe('tokenizer — backreferences and properties', () => {
  it('reads a numeric backreference', () => {
    const token = lex('(a)\\1').tokens.find((t) => t.kind === 'backreference');
    expect(token?.ref).toBe(1);
  });

  it('reads a named backreference', () => {
    const token = lex('(?<a>x)\\k<a>').tokens.find((t) => t.kind === 'backreference');
    expect(token?.ref).toBe('a');
  });

  it('reads a unicode property with the u flag', () => {
    const token = lex('\\p{Letter}', true).tokens.find((t) => t.kind === 'unicodeProperty');
    expect(token).toMatchObject({ property: 'Letter', negated: false });
  });

  it('reads a negated property and a property value', () => {
    expect(lex('\\P{L}', true).tokens[0]).toMatchObject({ negated: true });
    expect(lex('\\p{Script=Greek}', true).tokens[0]).toMatchObject({
      property: 'Script',
      propertyValue: 'Greek',
    });
  });

  it('treats \\p as an identity escape without the u flag', () => {
    // This is what JavaScript actually does, and it is a common real bug.
    const token = lex('\\p{L}').tokens[0];
    expect(token?.kind).toBe('escape');
    expect(token?.escape).toBe('identity');
  });
});

describe('tokenizer — foreign dialect recognition', () => {
  it.each([
    ['(?P<name>x)', 'Python'],
    ['(?P=name)', 'Python'],
    ['(?>abc)', 'PCRE and Java'],
    ['(?#comment)', 'PCRE'],
    ['(?R)', 'PCRE'],
    ['(?1)', 'PCRE'],
    ['a*+', 'PCRE and Java'],
    ['\\A', 'PCRE and Python'],
    ['\\Z', 'PCRE and Python'],
    ['\\h', 'PCRE'],
    ['\\R', 'PCRE'],
    ['\\K', 'PCRE'],
  ])('recognises %s as %s syntax', (source, origin) => {
    const { errors, tokens } = lex(source);
    expect(errors[0]?.code).toBe('UNSUPPORTED');
    const token = tokens.find((t) => t.foreignDialect !== undefined);
    expect(token?.foreignDialect?.origin).toBe(origin);
  });

  it('teaches the JavaScript equivalent rather than only rejecting', () => {
    const { errors } = lex('(?P<year>\\d+)');
    expect(errors[0]?.hint).toMatch(/\(\?<name>/);
  });

  it('does not rewrite the pattern', () => {
    // We explain; we never silently change what the user wrote.
    const { tokens } = lex('(?P<a>x)');
    expect(tokens[0]?.raw).toBe('(?P<a>');
  });
});

describe('tokenizer — termination', () => {
  it.each(['', '\\', '[', '(', '((((', '*', '{', '}', ']', '\\u', '\\p{', '(?'])(
    'terminates on %s',
    (source) => {
      expect(() => lex(source)).not.toThrow();
    },
  );

  it('terminates on deeply nested input', () => {
    expect(() => lex('('.repeat(5000))).not.toThrow();
  });
});
