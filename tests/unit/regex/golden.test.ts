import { describe, expect, it } from 'vitest';
import { analyzeRegex } from '@/domain/regex/analyze';
import { explanationToText } from '@/domain/shared/explanation';

/**
 * Golden corpus — 04_PARSER_ARCHITECTURE.md §5.4
 *
 * Every expected summary here has been read by a human. A diff in this file is
 * a product change, not an incidental one: the whole differentiator is that
 * explanations read as if written by someone who understands the syntax, and
 * only a person can judge that (risk R-04).
 *
 * Organised by grammar area rather than by pattern length, so the corpus is
 * meaningful coverage rather than 150 variations of the same thing.
 */

interface GoldenCase {
  readonly pattern: string;
  readonly flags?: string;
  /** The reviewed plain-text summary. */
  readonly summary: string;
}

function summaryOf(pattern: string, flags = ''): string {
  const result = analyzeRegex({ source: pattern, flags });
  if (!result.ok) throw new Error(`failed to analyse ${pattern}: ${result.error.message}`);
  return explanationToText(result.value.explanation.summary);
}

function runCases(name: string, cases: readonly GoldenCase[]): void {
  describe(name, () => {
    it.each(cases)('$pattern', ({ pattern, flags, summary }) => {
      expect(summaryOf(pattern, flags ?? '')).toBe(summary);
    });
  });
}

/* ---------------- literals and escapes ---------------- */

runCases('golden — literals', [
  { pattern: 'a', summary: 'Matches the character a.' },
  { pattern: 'abc', summary: 'Matches the character a, the character b, then the character c.' },
  { pattern: '1', summary: 'Matches the character 1.' },
  { pattern: ' ', summary: 'Matches the character  .' },
  { pattern: '😀', summary: 'Matches the character 😀.' },
]);

runCases('golden — escapes', [
  { pattern: '\\d', summary: 'Matches a digit.' },
  { pattern: '\\D', summary: 'Matches a non-digit.' },
  { pattern: '\\w', summary: 'Matches a word character (letter, digit, or underscore).' },
  { pattern: '\\W', summary: 'Matches a non-word character.' },
  { pattern: '\\s', summary: 'Matches a whitespace character.' },
  { pattern: '\\S', summary: 'Matches a non-whitespace character.' },
  { pattern: '\\n', summary: 'Matches a line feed.' },
  { pattern: '\\t', summary: 'Matches a tab.' },
  { pattern: '\\r', summary: 'Matches a carriage return.' },
  { pattern: '\\0', summary: 'Matches a null character.' },
  { pattern: '\\x41', summary: 'Matches the character \\x41.' },
  { pattern: '\\u0041', summary: 'Matches the character \\u0041.' },
  { pattern: '\\cA', summary: 'Matches the control character \\cA.' },
  { pattern: '\\.', summary: 'Matches a literal ..' },
  { pattern: '\\\\', summary: 'Matches a literal \\.' },
  { pattern: '\\$', summary: 'Matches a literal $.' },
]);

/* ---------------- anchors ---------------- */

runCases('golden — anchors', [
  { pattern: '^', summary: 'Matches the start of the string.' },
  { pattern: '$', summary: 'Matches the end of the string.' },
  { pattern: '^', flags: 'm', summary: 'Matches the start of the string or of any line.' },
  { pattern: '$', flags: 'm', summary: 'Matches the end of the string or of any line.' },
  { pattern: '\\b', summary: 'Matches a word boundary.' },
  { pattern: '\\B', summary: 'Matches a position that is not a word boundary.' },
  {
    pattern: '^a$',
    summary: 'Matches the start of the string, the character a, then the end of the string.',
  },
]);

/* ---------------- dot and flags ---------------- */

runCases('golden — dot', [
  { pattern: '.', summary: 'Matches any character except a line break.' },
  // The `s` flag changes what this means; saying only the first form would be
  // actively wrong for a dotAll pattern.
  { pattern: '.', flags: 's', summary: 'Matches any character, including line breaks.' },
]);

/* ---------------- character classes ---------------- */

runCases('golden — character classes', [
  { pattern: '[abc]', summary: 'Matches any of a, b, or c.' },
  { pattern: '[a-z]', summary: 'Matches any of a to z.' },
  { pattern: '[^a-z]', summary: 'Matches any character except a to z.' },
  { pattern: '[a-zA-Z]', summary: 'Matches any of a to z, or A to Z.' },
  { pattern: '[0-9]', summary: 'Matches any of 0 to 9.' },
  { pattern: '[-a]', summary: 'Matches any of -, or a.' },
  { pattern: '[a-]', summary: 'Matches any of a, or -.' },
  { pattern: '[\\d]', summary: 'Matches any of a digit.' },
  { pattern: '[.]', summary: 'Matches any of ..' },
]);

/* ---------------- quantifiers ---------------- */

runCases('golden — quantifiers', [
  { pattern: 'a*', summary: 'Matches zero or more of the character a.' },
  { pattern: 'a+', summary: 'Matches one or more of the character a.' },
  { pattern: 'a?', summary: 'Matches optionally the character a.' },
  { pattern: 'a{3}', summary: 'Matches exactly 3 of the character a.' },
  { pattern: 'a{2,}', summary: 'Matches 2 or more of the character a.' },
  { pattern: 'a{2,4}', summary: 'Matches between 2 and 4 of the character a.' },
  { pattern: 'a*?', summary: 'Matches zero or more (as few as possible) of the character a.' },
  { pattern: 'a+?', summary: 'Matches one or more (as few as possible) of the character a.' },
  { pattern: '\\d+', summary: 'Matches one or more digits.' },
  { pattern: '[a-z]+', summary: 'Matches one or more characters from a to z.' },
  {
    pattern: '\\w{2,4}',
    summary: 'Matches between 2 and 4 word characters (letters, digits, or underscores).',
  },
  { pattern: '\\s*', summary: 'Matches zero or more whitespace characters.' },
  { pattern: '\\W+', summary: 'Matches one or more non-word characters.' },
  // A multi-part body must be bracketed, or the summary would claim the
  // quantifier applies only to the first part.
  {
    pattern: '(?:ab)+',
    summary: 'Matches one or more repetitions of [the character a, then the character b].',
  },
  {
    pattern: '(?:ab)?',
    summary: 'Matches optionally the sequence [the character a, then the character b].',
  },
]);

/* ---------------- alternation ---------------- */

runCases('golden — alternation', [
  { pattern: 'a|b', summary: 'Matches either the character a, or the character b.' },
  {
    pattern: 'a|b|c',
    summary: 'Matches either the character a, the character b, or the character c.',
  },
  {
    pattern: 'ab|cd',
    summary:
      'Matches either the character a, then the character b, or the character c, then the character d.',
  },
]);

/* ---------------- groups ---------------- */

runCases('golden — groups', [
  { pattern: '(a)', summary: 'Matches a captured group (number 1) containing the character a.' },
  { pattern: '(?:a)', summary: 'Matches the character a.' },
  { pattern: '(?<x>a)', summary: 'Matches a captured group named x containing the character a.' },
  {
    pattern: '(a)(b)',
    summary:
      'Matches a captured group (number 1) containing the character a, then a captured group (number 2) containing the character b.',
  },
]);

/* ---------------- lookaround ---------------- */

runCases('golden — lookaround', [
  { pattern: '(?=a)', summary: 'Matches a position followed by the character a.' },
  { pattern: '(?!a)', summary: 'Matches a position not followed by the character a.' },
  { pattern: '(?<=a)', summary: 'Matches a position preceded by the character a.' },
  { pattern: '(?<!a)', summary: 'Matches a position not preceded by the character a.' },
]);

/* ---------------- backreferences ---------------- */

runCases('golden — backreferences', [
  {
    pattern: '(a)\\1',
    summary:
      'Matches a captured group (number 1) containing the character a, then the same text captured by group 1.',
  },
  {
    pattern: '(?<x>a)\\k<x>',
    summary:
      'Matches a captured group named x containing the character a, then the same text captured by the group named x.',
  },
]);

/* ---------------- unicode properties ---------------- */

runCases('golden — unicode properties', [
  {
    pattern: '\\p{L}',
    flags: 'u',
    summary: 'Matches any character with the Unicode property L.',
  },
  {
    pattern: '\\P{L}',
    flags: 'u',
    summary: 'Matches any character without the Unicode property L.',
  },
  {
    pattern: '\\p{Script=Greek}',
    flags: 'u',
    summary: 'Matches any character with the Unicode property Script=Greek.',
  },
]);

/* ---------------- realistic patterns ---------------- */

runCases('golden — realistic patterns', [
  {
    pattern: '^[A-Z][a-z]+$',
    summary:
      'Matches the start of the string, any of A to Z, one or more characters from a to z, then the end of the string.',
  },
  {
    pattern: '^\\d{3}-\\d{2}-\\d{4}$',
    summary:
      'Matches the start of the string, exactly 3 digits, the character -, exactly 2 digits, the character -, exactly 4 digits, then the end of the string.',
  },
  {
    pattern: '(?<year>\\d{4})-(?<month>\\d{2})',
    summary:
      'Matches a captured group named year containing exactly 4 digits, the character -, then a captured group named month containing exactly 2 digits.',
  },
]);

/* ---------------- nesting and structure ---------------- */

runCases('golden — nesting', [
  {
    pattern: '((a))',
    summary:
      'Matches a captured group (number 1) containing a captured group (number 2) containing the character a.',
  },
  {
    pattern: '(a(b))',
    summary:
      'Matches a captured group (number 1) containing the character a, then a captured group (number 2) containing the character b.',
  },
  {
    pattern: '(?:(a)|(b))',
    summary:
      'Matches either a captured group (number 1) containing the character a, or a captured group (number 2) containing the character b.',
  },
  {
    pattern: '(a)|(b)|(c)',
    summary:
      'Matches either a captured group (number 1) containing the character a, a captured group (number 2) containing the character b, or a captured group (number 3) containing the character c.',
  },
  {
    // Non-capturing groups add no wording of their own, so deep nesting of
    // them must read as a plain sequence rather than as three nested clauses.
    pattern: '(?:a(?:b(?:c)))',
    summary: 'Matches the character a, then the character b, then the character c.',
  },
]);

/* ---------------- quantified groups ---------------- */

runCases('golden — quantified groups', [
  {
    pattern: '(ab)*',
    summary:
      'Matches zero or more repetitions of [a captured group (number 1) containing the character a, then the character b].',
  },
  {
    pattern: '(a|b){2}',
    summary:
      'Matches exactly 2 repetitions of [a captured group (number 1) containing either the character a, or the character b].',
  },
  {
    pattern: '(\\d+)?',
    summary: 'Matches optionally a captured group (number 1) containing one or more digits.',
  },
  { pattern: '[a-z]{1,3}', summary: 'Matches between 1 and 3 characters from a to z.' },
  { pattern: 'a{0,1}', summary: 'Matches optionally the character a.' },
  { pattern: '[A-Z]{2,}', summary: 'Matches 2 or more characters from A to Z.' },
]);

/* ---------------- lookaround in context ---------------- */

runCases('golden — lookaround in context', [
  {
    pattern: '(?=\\d)a',
    summary: 'Matches a position followed by a digit, then the character a.',
  },
  {
    pattern: 'a(?!\\d)',
    summary: 'Matches the character a, then a position not followed by a digit.',
  },
  {
    pattern: '(?<=x)y',
    summary: 'Matches a position preceded by the character x, then the character y.',
  },
  {
    pattern: '(?<!x)y',
    summary: 'Matches a position not preceded by the character x, then the character y.',
  },
  {
    // A multi-part assertion body is bracketed, or where the assertion ends
    // would be ambiguous.
    pattern: '(?=.*a)(?=.*b)',
    summary:
      'Matches a position followed by [zero or more characters other than line breaks, then the character a], then a position followed by [zero or more characters other than line breaks, then the character b].',
  },
]);

/* ---------------- more character classes ---------------- */

runCases('golden — character class detail', [
  {
    pattern: '[\\w-]',
    summary: 'Matches any of a word character (letter, digit, or underscore), or -.',
  },
  { pattern: '[^\\s]', summary: 'Matches any character except a whitespace character.' },
  { pattern: '[a-z0-9_]', summary: 'Matches any of a to z, 0 to 9, or _.' },
  // Inside a class these are identity escapes for the literal character, not
  // class shorthands — naming them "the escape" told the user nothing.
  { pattern: '[\\]]', summary: 'Matches any of a literal ].' },
  { pattern: '[\\^]', summary: 'Matches any of a literal ^.' },
  { pattern: '[0-9a-fA-F]', summary: 'Matches any of 0 to 9, a to f, or A to F.' },
]);

/* ---------------- more escapes ---------------- */

runCases('golden — escape detail', [
  { pattern: '\\/', summary: 'Matches a literal /.' },
  { pattern: '\\*', summary: 'Matches a literal *.' },
  { pattern: '\\(', summary: 'Matches a literal (.' },
  { pattern: '\\[', summary: 'Matches a literal [.' },
  { pattern: '\\v', summary: 'Matches a vertical tab.' },
  { pattern: '\\f', summary: 'Matches a form feed.' },
]);

/* ---------------- flags change meaning ---------------- */

runCases('golden — flags', [
  {
    pattern: 'abc',
    flags: 'i',
    summary: 'Matches the character a, the character b, then the character c.',
  },
  {
    // The `s` flag changes what `.` means; stating only the default would be
    // actively wrong here.
    pattern: 'a.b',
    flags: 's',
    summary: 'Matches the character a, any character, including line breaks, then the character b.',
  },
  {
    pattern: '^a',
    flags: 'gm',
    summary: 'Matches the start of the string or of any line, then the character a.',
  },
  { pattern: 'a', flags: 'y', summary: 'Matches the character a.' },
  { pattern: 'a', flags: 'd', summary: 'Matches the character a.' },
]);

/* ---------------- more realistic patterns ---------------- */

runCases('golden — realistic patterns II', [
  {
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    summary:
      'Matches the start of the string, exactly 4 digits, the character -, exactly 2 digits, the character -, exactly 2 digits, then the end of the string.',
  },
  {
    pattern: '#[0-9a-f]{6}',
    flags: 'i',
    summary: 'Matches the character #, then exactly 6 characters from 0 to 9, or a to f.',
  },
  {
    pattern: '\\bword\\b',
    summary:
      'Matches a word boundary, the character w, the character o, the character r, the character d, then a word boundary.',
  },
  {
    pattern: '^\\s+|\\s+$',
    summary:
      'Matches either the start of the string, then one or more whitespace characters, or one or more whitespace characters, then the end of the string.',
  },
  {
    pattern: '(\\w)\\1',
    summary:
      'Matches a captured group (number 1) containing a word character (letter, digit, or underscore), then the same text captured by group 1.',
  },
  {
    pattern: '^.{0,10}$',
    summary:
      'Matches the start of the string, between 0 and 10 characters other than line breaks, then the end of the string.',
  },
]);

/* ---------------- astral characters ----------------
 * A code-unit/code-point mixup would surface here first.
 * ------------------------------------------------- */

runCases('golden — astral characters', [
  { pattern: '\u{1F600}+', summary: 'Matches one or more of the character \u{1F600}.' },
  {
    pattern: '[\u{1F600}-\u{1F61C}]',
    flags: 'u',
    summary: 'Matches any of \u{1F600} to \u{1F61C}.',
  },
]);

/* ---------------- structural assertions ----------------
 * Beyond exact wording, these assert properties the summary must have for
 * any input — the things a reviewer would check but that are cheap to
 * automate across the whole corpus.
 * ------------------------------------------------------ */

const STRUCTURAL_PATTERNS = [
  '^[A-Z][a-z]+$',
  '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$',
  '\\b(?:https?|ftp)://[^\\s/$.?#].[^\\s]*\\b',
  '(?<=\\$)\\d+(?:\\.\\d{2})?',
  '^[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}$',
  '(a+)+$',
  '^(\\d{1,3}\\.){3}\\d{1,3}$',
  '^#?([a-f0-9]{6}|[a-f0-9]{3})$',
  '^v?(\\d+)\\.(\\d+)\\.(\\d+)$',
  '[\\u4e00-\\u9fa5]+',
  '(?:a|b)*c',
  '\\s+$',
  '^\\s*$',
  '[^\\x00-\\x7F]',
  '(\\w)\\1',
];

describe('golden — structural properties', () => {
  it.each(STRUCTURAL_PATTERNS)('%s produces a non-empty, well-formed summary', (pattern) => {
    const result = analyzeRegex({ source: pattern, flags: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const summary = explanationToText(result.value.explanation.summary);
    expect(summary.length).toBeGreaterThan(10);
    expect(summary.startsWith('Matches ')).toBe(true);
    expect(summary.endsWith('.')).toBe(true);
    // A summary that still contains a placeholder or an object stringification
    // is a bug the exact-match cases would not catch on their own.
    expect(summary).not.toContain('undefined');
    expect(summary).not.toContain('[object');
    expect(summary).not.toContain('NaN');
  });

  it.each(STRUCTURAL_PATTERNS)('%s produces detail sections with valid spans', (pattern) => {
    const result = analyzeRegex({ source: pattern, flags: '' });
    if (!result.ok) return;

    for (const detail of result.value.explanation.details) {
      expect(detail.id.length).toBeGreaterThan(0);
      expect(detail.title.length).toBeGreaterThan(0);
      if (detail.span) {
        expect(detail.span.start).toBeGreaterThanOrEqual(0);
        expect(detail.span.end).toBeLessThanOrEqual(pattern.length);
      }
    }
  });
});

/* ---------------- malformed and foreign ---------------- */

describe('golden — malformed patterns report clearly', () => {
  it.each([
    ['(abc', /unmatched `\(`/i],
    ['abc)', /unmatched `\)`/i],
    ['a**', /two quantifiers/i],
    ['*abc', /nothing to repeat/i],
    ['[abc', /unterminated/i],
    ['a{4,2}', /backwards/i],
    ['[z-a]', /backwards/i],
    ['a\\', /lone backslash/i],
    ['(?<a>x)(?<a>y)', /duplicate group name/i],
    ['(?<real>a)\\k<nope>', /no group named/i],
  ])('%s', (pattern, expected) => {
    const result = analyzeRegex({ source: pattern, flags: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.errors.some((error) => expected.test(error.message))).toBe(true);
  });
});

describe('golden — foreign dialects are named, not merely rejected', () => {
  it.each([
    ['(?P<name>x)', /Python/],
    ['(?P=name)', /Python/],
    ['(?>x)', /not supported in JavaScript/],
    ['a*+', /Possessive/],
    ['\\A', /not supported in JavaScript/],
    ['\\K', /not supported in JavaScript/],
    ['(?#note)', /Inline comments/],
    ['(?R)', /Recursion/],
  ])('%s', (pattern, expected) => {
    const result = analyzeRegex({ source: pattern, flags: '' });
    if (!result.ok) return;
    const unsupported = result.value.errors.filter((error) => error.code === 'UNSUPPORTED');
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported.some((error) => expected.test(error.message))).toBe(true);
  });
});

describe('golden — warnings fire where expected', () => {
  it.each([
    ['(a+)+', 'NESTED_QUANTIFIER'],
    ['\\p{L}', 'UNICODE_FLAG_ADVISED'],
    ['a\\q', 'REDUNDANT_ESCAPE'],
    ['a{1,5000}', 'LARGE_BOUNDED_REPEAT'],
    ['(?<=a)b', 'LOOKBEHIND_COMPATIBILITY'],
    ['\\1', 'UNRESOLVED_BACKREFERENCE'],
    ['a^b', 'ANCHOR_IN_MIDDLE'],
  ])('%s raises %s', (pattern, code) => {
    const result = analyzeRegex({ source: pattern, flags: '' });
    if (!result.ok) return;
    expect(result.value.warnings.map((warning) => warning.code)).toContain(code);
  });

  it('describes the ReDoS warning as a heuristic, not a guarantee', () => {
    // Absence of this warning must never read as a safety guarantee — that
    // comes from worker termination, not static analysis.
    const result = analyzeRegex({ source: '(a+)+', flags: '' });
    if (!result.ok) return;
    const warning = result.value.warnings.find((w) => w.code === 'NESTED_QUANTIFIER');
    expect(warning?.hint).toMatch(/cannot find every case/i);
  });
});
