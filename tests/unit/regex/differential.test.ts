import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analyzeRegex } from '@/domain/regex/analyze';

/**
 * Differential testing against the platform — 04_PARSER_ARCHITECTURE.md §8
 *
 * The JavaScript engine is the oracle for **syntactic validity**. If our
 * parser and `new RegExp` disagree about whether a pattern is legal, we are
 * wrong, because the tester at M4 runs that same engine.
 *
 * WHAT THIS PROVES, precisely:
 *   ✅ a pattern the engine accepts, we also accept
 *   ✅ a pattern the engine rejects, we also reject
 *
 * WHAT IT DOES NOT PROVE:
 *   ✗ that our *explanation* is correct — no oracle exists for that, which is
 *     why the golden corpus is human-reviewed
 *   ✗ matching semantics — nothing is executed in M3 by design
 *   ✗ agreement on *which* error, or where; the engine's messages are
 *     implementation-defined and differ across browsers
 *
 * Being explicit about this matters: a differential suite that quietly
 * compares the wrong thing gives false confidence.
 */

function engineAccepts(source: string, flags: string): boolean {
  try {
    new RegExp(source, flags);
    return true;
  } catch {
    return false;
  }
}

/** We reject a pattern when analysis fails outright or records a syntax error. */
function weAccept(source: string, flags: string): boolean {
  const result = analyzeRegex({ source, flags });
  if (!result.ok) return false;
  return !result.value.errors.some(
    (error) => error.code === 'SYNTAX' || error.code === 'UNSUPPORTED',
  );
}

/** Patterns chosen to cover the grammar, not to be easy. */
const CORPUS: readonly string[] = [
  // valid — literals and escapes
  'a',
  'abc',
  '',
  'a\\.b',
  '\\d',
  '\\w',
  '\\s',
  '\\D',
  '\\W',
  '\\S',
  '\\n',
  '\\r',
  '\\t',
  '\\f',
  '\\v',
  '\\0',
  '\\x41',
  '\\u0041',
  '\\cA',
  // valid — anchors
  '^',
  '$',
  '^a$',
  '\\b',
  '\\B',
  '\\ba\\b',
  // valid — classes
  '[a]',
  '[abc]',
  '[a-z]',
  '[^a-z]',
  '[a-zA-Z0-9]',
  '[-a]',
  '[a-]',
  '[\\]]',
  '[\\d]',
  '[\\w\\s]',
  '[.]',
  '[*+?]',
  '[[]',
  '[a\\-z]',
  // valid — quantifiers
  'a*',
  'a+',
  'a?',
  'a{2}',
  'a{2,}',
  'a{2,4}',
  'a*?',
  'a+?',
  'a??',
  'a{2,4}?',
  // valid — groups
  '(a)',
  '(?:a)',
  '(?<n>a)',
  '(?=a)',
  '(?!a)',
  '(?<=a)',
  '(?<!a)',
  '((a))',
  '(a)(b)',
  '(a|b)',
  '(?:a|b)+',
  // valid — backreferences
  '(a)\\1',
  '(?<n>a)\\k<n>',
  '\\1(a)',
  // valid — alternation and combinations
  'a|b',
  'a|b|c',
  '^(?:a|b)+$',
  '(?:\\d{3}-){2}\\d{4}',
  '^[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}$',
  '^(?=.*[a-z])(?=.*[A-Z]).{8,}$',
  '(?<=\\$)\\d+(?:\\.\\d{2})?',
  '(a+)+$',
  // invalid — the engine rejects all of these
  '(',
  ')',
  '(a',
  'a)',
  '[',
  '[a',
  'a**',
  '*',
  '+',
  '?',
  'a{4,2}',
  '[z-a]',
  '\\',
  '(?<a>x)(?<a>y)',
  '\\k<missing>',
  '(?<>a)',
];

describe('differential — validity agrees with new RegExp', () => {
  it.each(CORPUS)('%s (no flags)', (source) => {
    expect(weAccept(source, '')).toBe(engineAccepts(source, ''));
  });

  it.each(CORPUS)('%s (u flag)', (source) => {
    expect(weAccept(source, 'u')).toBe(engineAccepts(source, 'u'));
  });
});

describe('differential — Annex B divergence is implemented, not ignored', () => {
  // These are legal without /u and illegal with it. A parser that implements
  // only one mode gets half of them wrong, and the wrong half is invisible
  // until a user pastes a real pattern.
  const annexB = ['a{x}', 'a}', 'a]', '\\q', '{', '}', ']'];

  it.each(annexB)('%s: accepted without u, rejected with u — same as the engine', (source) => {
    expect(weAccept(source, '')).toBe(engineAccepts(source, ''));
    expect(weAccept(source, 'u')).toBe(engineAccepts(source, 'u'));
  });
});

describe('differential — flags agree with the engine', () => {
  it.each(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y', 'gi', 'gimsuy', ''])(
    'accepts the flag set "%s"',
    (flags) => {
      expect(analyzeRegex({ source: 'a', flags }).ok).toBe(engineAccepts('a', flags));
    },
  );

  it.each(['q', 'gg', 'uv', 'x', 'a'])('rejects the flag set "%s"', (flags) => {
    expect(analyzeRegex({ source: 'a', flags }).ok).toBe(engineAccepts('a', flags));
  });
});

describe('differential — generated patterns', () => {
  // A fixed seed keeps CI reproducible; the budget is bounded so the suite
  // stays fast (04_PARSER_ARCHITECTURE.md §8, fuzz budget).
  const runs = 2000;

  it('agrees with the engine on random ASCII noise', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(...'ab()[]{}|*+?.\\^$-,0123'.split('')), maxLength: 12 }),
        (source) => {
          expect(weAccept(source, '')).toBe(engineAccepts(source, ''));
        },
      ),
      { numRuns: runs, seed: 20260818 },
    );
  });

  it('agrees with the engine on random ASCII noise under the u flag', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(...'ab()[]{}|*+?.\\^$-,0123'.split('')), maxLength: 12 }),
        (source) => {
          expect(weAccept(source, 'u')).toBe(engineAccepts(source, 'u'));
        },
      ),
      { numRuns: runs, seed: 20260818 },
    );
  });

  it('agrees with the engine on grammar-shaped patterns', () => {
    // Random noise is mostly invalid, so it exercises only the error paths.
    // Structured generation produces valid-but-unusual input, which is where
    // correctness bugs actually hide.
    const atom = fc.constantFrom('a', 'b', '\\d', '\\w', '.', '[a-z]', '[^0-9]');
    const quantifier = fc.constantFrom('', '*', '+', '?', '{2}', '{1,3}', '*?');
    const piece = fc.tuple(atom, quantifier).map(([a, q]) => `${a}${q}`);
    const grouped = fc
      .tuple(
        fc.constantFrom('(', '(?:', '(?=', '(?!'),
        fc.array(piece, { minLength: 1, maxLength: 3 }),
      )
      .map(([open, parts]) => `${open}${parts.join('')})`);

    fc.assert(
      fc.property(fc.array(fc.oneof(piece, grouped), { minLength: 1, maxLength: 5 }), (parts) => {
        const source = parts.join('');
        expect(weAccept(source, '')).toBe(engineAccepts(source, ''));
      }),
      { numRuns: runs, seed: 20260818 },
    );
  });
});

describe('differential — regression corpus', () => {
  // Every counterexample a fuzz run has produced is pinned here permanently.
  // The fuzzer finds it once; this keeps it found.
  const REGRESSIONS: readonly [string, string][] = [
    ['(?:a)+', ''],
    ['[a-]', ''],
    ['[]a', ''],
    ['a{,2}', ''],
    ['\\8', ''],
    ['(?<a>)', ''],
  ];

  it.each(REGRESSIONS)('%s with flags "%s"', (source, flags) => {
    expect(weAccept(source, flags)).toBe(engineAccepts(source, flags));
  });
});
