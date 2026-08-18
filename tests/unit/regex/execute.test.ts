import { describe, expect, it } from 'vitest';
import { LIMITS } from '@/domain/shared/limits';
import { executeRegex, type RegexExecResult } from '@/domain/regex/execute';

/**
 * Execution semantics.
 *
 * The rule these tests exist to enforce is that SyntaxLab reports what the
 * JavaScript engine actually did — it never simulates, normalises, or
 * "improves" a match. Every expectation below is stated in terms the engine
 * itself would produce, and several are cross-checked against `String.match`
 * and `String.matchAll` so a divergence in our loop is caught rather than
 * pinned as correct.
 */

function run(source: string, flags: string, subject: string): RegexExecResult {
  const result = executeRegex({ source, flags, subject });
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`);
  return result.value;
}

function spans(result: RegexExecResult): [number, number][] {
  return result.matches.map((m) => [m.start, m.end]);
}

describe('executeRegex — basic matching', () => {
  it('reports no matches as a successful empty result, not an error', () => {
    const result = run('zzz', '', 'abc');
    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe('none');
  });

  it('returns a single match without the global flag', () => {
    const result = run('a', '', 'aaa');
    expect(spans(result)).toEqual([[0, 1]]);
    expect(result.findsAll).toBe(false);
  });

  it('returns every match with the global flag', () => {
    const result = run('a', 'g', 'aaa');
    expect(spans(result)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(result.findsAll).toBe(true);
  });

  it('reports offsets and text that agree with each other', () => {
    const subject = 'the year 2026 and 2027';
    const result = run('\\d{4}', 'g', subject);
    for (const match of result.matches) {
      expect(subject.slice(match.start, match.end)).toBe(match.value);
    }
    expect(result.matches.map((m) => m.value)).toEqual(['2026', '2027']);
  });
});

describe('executeRegex — agreement with the engine', () => {
  const cases: [string, string, string][] = [
    ['a', 'g', 'banana'],
    ['an', 'g', 'banana'],
    ['\\w+', 'g', 'one two  three'],
    ['', 'g', 'abc'],
    ['x*', 'g', 'abc'],
    ['(a)(b)?', 'g', 'ab a ab'],
    ['[A-Z]', 'gi', 'aAbB'],
    ['^.', 'gm', 'one\ntwo\nthree'],
    ['.', 'gs', 'a\nb'],
    ['\\b\\w', 'g', 'hello wide world'],
  ];

  it.each(cases)('matches String.matchAll for /%s/%s', (source, flags, subject) => {
    const ours = run(source, flags, subject);
    const theirs = [...subject.matchAll(new RegExp(source, flags))];

    expect(ours.matches.map((m) => m.start)).toEqual(theirs.map((m) => m.index));
    expect(ours.matches.map((m) => m.value)).toEqual(theirs.map((m) => m[0]));
  });
});

describe('executeRegex — zero-length matches', () => {
  it('terminates on an empty pattern and reports a position per gap', () => {
    const result = run('', 'g', 'abc');
    expect(spans(result)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('terminates on a pattern that can match nothing', () => {
    const result = run('x*', 'g', 'axxb');
    expect(spans(result)).toEqual([
      [0, 0],
      [1, 3],
      [3, 3],
      [4, 4],
    ]);
  });

  it('steps over a whole code point under the u flag', () => {
    // Stepping one code unit would report a match inside the surrogate pair,
    // at a position the engine itself never produces.
    const result = run('', 'gu', '\u{1F600}\u{1F600}');
    expect(spans(result)).toEqual([
      [0, 0],
      [2, 2],
      [4, 4],
    ]);
  });

  it('steps one code unit without the u flag, as the engine does', () => {
    const result = run('', 'g', '\u{1F600}');
    expect(spans(result)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('matches an empty subject once', () => {
    expect(spans(run('', 'g', ''))).toEqual([[0, 0]]);
    expect(spans(run('a*', 'g', ''))).toEqual([[0, 0]]);
  });
});

describe('executeRegex — sticky', () => {
  it('scans consecutive matches and stops at the first gap', () => {
    const result = run('a', 'y', 'aab');
    expect(spans(result)).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(result.findsAll).toBe(true);
  });

  it('finds nothing when the subject does not start with a match', () => {
    expect(run('a', 'y', 'ba').matches).toEqual([]);
  });
});

describe('executeRegex — capture groups', () => {
  it('numbers groups in source order and reports non-participation as null', () => {
    const result = run('(a)|(b)', 'g', 'ab');
    expect(result.matches[0]?.captures).toEqual([
      { number: 1, value: 'a', length: 1 },
      { number: 2, value: null, length: 0 },
    ]);
    expect(result.matches[1]?.captures).toEqual([
      { number: 1, value: null, length: 0 },
      { number: 2, value: 'b', length: 1 },
    ]);
  });

  it('distinguishes a non-participating group from one that matched empty', () => {
    const result = run('(a)(x?)', '', 'a');
    expect(result.matches[0]?.captures[1]).toEqual({ number: 2, value: '', length: 0 });
  });

  it('reports named groups separately from numbered ones', () => {
    const result = run('(?<year>\\d{4})-(?<month>\\d{2})', '', '2026-08');
    expect(result.matches[0]?.captures.map((c) => c.value)).toEqual(['2026', '08']);
    expect(result.matches[0]?.named).toEqual([
      { name: 'year', value: '2026', length: 4 },
      { name: 'month', value: '08', length: 2 },
    ]);
  });

  it('reports a named group that did not participate as null', () => {
    const result = run('(?<a>x)|(?<b>y)', '', 'y');
    expect(result.matches[0]?.named).toEqual([
      { name: 'a', value: null, length: 0 },
      { name: 'b', value: 'y', length: 1 },
    ]);
  });

  it('omits capture offsets without the d flag and includes them with it', () => {
    const without = run('(b)(c)', '', 'abc');
    expect(without.hasIndices).toBe(false);
    expect(without.matches[0]?.captures[0]?.start).toBeUndefined();

    const withIndices = run('(b)(c)', 'd', 'abc');
    expect(withIndices.hasIndices).toBe(true);
    expect(withIndices.matches[0]?.captures).toEqual([
      { number: 1, value: 'b', length: 1, start: 1, end: 2 },
      { number: 2, value: 'c', length: 1, start: 2, end: 3 },
    ]);
  });
});

describe('executeRegex — flags change semantics, not appearance', () => {
  it('honours ignoreCase', () => {
    expect(run('abc', '', 'ABC').matches).toEqual([]);
    expect(run('abc', 'i', 'ABC').matches).toHaveLength(1);
  });

  it('honours multiline for anchors', () => {
    expect(run('^b', 'g', 'a\nb').matches).toEqual([]);
    expect(run('^b', 'gm', 'a\nb').matches).toHaveLength(1);
  });

  it('honours dotAll', () => {
    expect(run('a.b', '', 'a\nb').matches).toEqual([]);
    expect(run('a.b', 's', 'a\nb').matches).toHaveLength(1);
  });

  it('honours unicode property escapes', () => {
    const result = run('\\p{Script=Greek}+', 'gu', 'abc αβγ');
    expect(result.matches.map((m) => m.value)).toEqual(['αβγ']);
  });
});

describe('executeRegex — limits and truncation', () => {
  it('rejects a subject over the length limit', () => {
    const result = executeRegex({
      source: 'a',
      flags: '',
      subject: 'a'.repeat(LIMITS.regex.testSubject + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LIMIT_EXCEEDED');
  });

  it('caps the match count and says so', () => {
    const result = run('a', 'g', 'a'.repeat(LIMITS.regex.maxMatches + 500));
    expect(result.matches).toHaveLength(LIMITS.regex.maxMatches);
    expect(result.truncated).toBe('matchCount');
  });

  it('clips a single enormous match but reports its real length', () => {
    const subject = 'x'.repeat(LIMITS.regex.maxMatchTextChars + 1000);
    const match = run('x+', '', subject).matches[0];
    expect(match?.value).toHaveLength(LIMITS.regex.maxMatchTextChars);
    expect(match?.length).toBe(subject.length);
  });

  it('caps total output size and says so', () => {
    // Match count alone does not bound memory: nested groups mean each match
    // carries its text three times, so the ceiling is reached long before the
    // 10 000-match cap.
    const subject = 'z'.repeat(900_000);
    const result = run('(([\\s\\S]{100}))', 'g', subject);
    expect(result.truncated).toBe('outputSize');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.length).toBeLessThan(9000);
  });

  it('never reports truncation when the whole result fits', () => {
    expect(run('a', 'g', 'aaa').truncated).toBe('none');
  });
});

describe('executeRegex — invalid patterns', () => {
  it('reports a pattern the engine refuses to compile', () => {
    const result = executeRegex({ source: '(', flags: '', subject: 'a' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SYNTAX');
  });

  it('reports an invalid flag string', () => {
    const result = executeRegex({ source: 'a', flags: 'gg', subject: 'a' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SYNTAX');
  });

  it('does not leak a stack trace into the message', () => {
    const result = executeRegex({ source: '(', flags: '', subject: 'a' });
    if (result.ok) throw new Error('expected failure');
    expect(result.error.message).not.toMatch(/at |\.ts:|\.js:/);
  });
});

describe('executeRegex — hostile subjects are data, not code', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    // eslint-disable-next-line no-script-url -- a test payload, never navigated to
    'javascript:alert(1)',
    '__proto__',
    '{"__proto__":{"polluted":true}}',
  ];

  it.each(payloads)('returns %s verbatim as match text', (payload) => {
    const result = run('.+', 's', payload);
    expect(result.matches[0]?.value).toBe(payload);
  });

  it('does not pollute Object.prototype via a captured __proto__ group name', () => {
    run('(?<constructor>a)', '', 'a');
    const probe = {} as Record<string, unknown>;
    expect(probe.polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
