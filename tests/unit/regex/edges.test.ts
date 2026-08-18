import { describe, expect, it } from 'vitest';
import { analyzeRegex, flagsToString, parseFlags } from '@/domain/regex/analyze';
import { EMPTY_FLAGS } from '@/domain/regex/ast';
import { explainRegex } from '@/domain/regex/explain';
import { parsePattern } from '@/domain/regex/parser';
import { isValidRegexAnalysis } from '@/domain/regex/validate';
import { explanationToText, joinClauses, text } from '@/domain/shared/explanation';

/**
 * Edge cases reached by real input but not by the main suites.
 *
 * These exist because the branch was untested, not to move a coverage number:
 * each asserts behaviour a user can actually trigger.
 */

describe('flag round-tripping', () => {
  it.each(['', 'g', 'gi', 'dgimsuy', 'v', 'y'])('round-trips "%s"', (input) => {
    const parsed = parseFlags(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Canonical order, so the UI shows flags consistently however they were typed.
    expect(flagsToString(parsed.value).split('').sort().join('')).toBe(
      input.split('').sort().join(''),
    );
  });

  it('normalises flag order', () => {
    const parsed = parseFlags('yigm');
    if (!parsed.ok) return;
    expect(flagsToString(parsed.value)).toBe('gimy');
  });

  it('produces an empty string for no flags', () => {
    expect(flagsToString(EMPTY_FLAGS)).toBe('');
  });
});

describe('unicode escape edge cases', () => {
  it('rejects a code point above the Unicode maximum', () => {
    const analysis = analyzeRegex({ source: '\\u{110000}', flags: 'u' });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.value.errors.some((e) => /above the Unicode maximum/i.test(e.message))).toBe(
      true,
    );
  });

  it('accepts the highest valid code point', () => {
    const analysis = analyzeRegex({ source: '\\u{10FFFF}', flags: 'u' });
    if (!analysis.ok) return;
    expect(analysis.value.errors).toHaveLength(0);
  });

  it('reports an incomplete \\u escape under the u flag', () => {
    const analysis = analyzeRegex({ source: '\\uZZ', flags: 'u' });
    if (!analysis.ok) return;
    expect(analysis.value.errors.some((e) => /incomplete/i.test(e.message))).toBe(true);
  });

  it('treats an incomplete \\u as an identity escape without the u flag', () => {
    // Annex B again: legal without /u, an error with it.
    const analysis = analyzeRegex({ source: '\\uZZ', flags: '' });
    if (!analysis.ok) return;
    expect(analysis.value.errors).toHaveLength(0);
  });
});

describe('explanation composition', () => {
  it('joins two clauses with the conjunction', () => {
    expect(explanationToText(joinClauses([[text('a')], [text('b')]], 'then'))).toBe('a, then b');
  });

  it('joins three clauses with separators and a final conjunction', () => {
    expect(explanationToText(joinClauses([[text('a')], [text('b')], [text('c')]], 'or'))).toBe(
      'a, b, or c',
    );
  });

  it('returns a single clause unchanged', () => {
    expect(explanationToText(joinClauses([[text('only')]]))).toBe('only');
  });

  it('drops empty clauses rather than emitting stray separators', () => {
    expect(explanationToText(joinClauses([[text('a')], [], [text('b')]], 'then'))).toBe(
      'a, then b',
    );
  });

  it('returns nothing for no clauses', () => {
    expect(joinClauses([])).toEqual([]);
  });

  it('describes an empty pattern rather than producing an empty summary', () => {
    const analysis = analyzeRegex({ source: '', flags: '' });
    if (!analysis.ok) return;
    expect(explanationToText(analysis.value.explanation.summary)).toMatch(/empty pattern/i);
  });

  it('flattens a list node', () => {
    const nodes = [{ kind: 'list' as const, items: [[text('one')], [text('two')]] }];
    expect(explanationToText(nodes)).toBe('one; two');
  });
});

describe('explanation detail sections', () => {
  it('describes greedy and lazy quantifiers differently', () => {
    const greedy = analyzeRegex({ source: 'a+', flags: '' });
    const lazy = analyzeRegex({ source: 'a+?', flags: '' });
    if (!greedy.ok || !lazy.ok) return;

    const greedyText = greedy.value.explanation.details
      .map((d) => explanationToText(d.body))
      .join(' ');
    const lazyText = lazy.value.explanation.details.map((d) => explanationToText(d.body)).join(' ');

    expect(greedyText).toMatch(/greedy/i);
    expect(lazyText).toMatch(/lazy/i);
  });

  it('explains a capture group in terms the user will use in code', () => {
    const analysis = analyzeRegex({ source: '(a)', flags: '' });
    if (!analysis.ok) return;
    const body = analysis.value.explanation.details.map((d) => explanationToText(d.body)).join(' ');
    expect(body).toContain('$1');
    expect(body).toContain('match[1]');
  });

  it('explains a named group by its accessor', () => {
    const analysis = analyzeRegex({ source: '(?<year>a)', flags: '' });
    if (!analysis.ok) return;
    const body = analysis.value.explanation.details.map((d) => explanationToText(d.body)).join(' ');
    expect(body).toContain('groups.year');
  });

  it('marks an unresolved backreference as a warning severity', () => {
    const analysis = analyzeRegex({ source: '\\1', flags: '' });
    if (!analysis.ok) return;
    const section = analysis.value.explanation.details.find((d) => d.id.startsWith('backref'));
    expect(section?.severity).toBe('warning');
  });

  it('marks an unreadable region as an error severity', () => {
    const analysis = analyzeRegex({ source: '(?>x)', flags: '' });
    if (!analysis.ok) return;
    const section = analysis.value.explanation.details.find((d) => d.id.startsWith('error'));
    expect(section?.severity).toBe('error');
  });

  it('describes alternation ordering, which decides which branch wins', () => {
    const analysis = analyzeRegex({ source: 'a|b', flags: '' });
    if (!analysis.ok) return;
    const section = analysis.value.explanation.details.find((d) => d.id === 'alternation');
    expect(explanationToText(section?.body ?? [])).toMatch(/left to right/i);
  });
});

describe('explainRegex used directly on a parse tree', () => {
  it('works without going through analyzeRegex', () => {
    // The engine is pure and framework-free; this is the contract that lets
    // it be tested and reused independently of the pipeline.
    const parsed = parsePattern('a|b', EMPTY_FLAGS);
    const explanation = explainRegex(parsed.ast, EMPTY_FLAGS);
    expect(explanationToText(explanation.summary)).toContain('either');
  });
});

describe('validator rejects structurally invalid analyses', () => {
  it('rejects a non-object', () => {
    expect(isValidRegexAnalysis(null)).toBe(false);
    expect(isValidRegexAnalysis('regex')).toBe(false);
    expect(isValidRegexAnalysis([])).toBe(false);
  });

  it('rejects tokens that are not an array', () => {
    const analysis = analyzeRegex({ source: 'a', flags: '' });
    if (!analysis.ok) return;
    const broken = { ...analysis.value, tokens: 'no' };
    expect(isValidRegexAnalysis(broken)).toBe(false);
  });

  it('rejects a group numbered from zero', () => {
    const analysis = analyzeRegex({ source: '(a)', flags: '' });
    if (!analysis.ok) return;
    const broken = {
      ...analysis.value,
      groups: [{ number: 0, depth: 0, span: analysis.value.groups[0]?.span }],
    };
    expect(isValidRegexAnalysis(broken)).toBe(false);
  });

  it('rejects a span whose start is after its end', () => {
    const analysis = analyzeRegex({ source: 'ab', flags: '' });
    if (!analysis.ok) return;
    const broken = {
      ...analysis.value,
      tokens: [{ type: 'Char', raw: 'a', span: { start: 2, end: 1, line: 1, column: 1 } }],
    };
    expect(isValidRegexAnalysis(broken)).toBe(false);
  });

  it('rejects a zero line number', () => {
    const analysis = analyzeRegex({ source: 'a', flags: '' });
    if (!analysis.ok) return;
    const broken = {
      ...analysis.value,
      tokens: [{ type: 'Char', raw: 'a', span: { start: 0, end: 1, line: 0, column: 1 } }],
    };
    expect(isValidRegexAnalysis(broken)).toBe(false);
  });

  it('rejects malformed flags', () => {
    const analysis = analyzeRegex({ source: 'a', flags: '' });
    if (!analysis.ok) return;
    expect(isValidRegexAnalysis({ ...analysis.value, flags: { global: 'yes' } })).toBe(false);
  });

  it('rejects a malformed explanation', () => {
    const analysis = analyzeRegex({ source: 'a', flags: '' });
    if (!analysis.ok) return;
    expect(isValidRegexAnalysis({ ...analysis.value, explanation: { summary: 'text' } })).toBe(
      false,
    );
  });

  it('rejects malformed compatibility information', () => {
    const analysis = analyzeRegex({ source: 'a', flags: '' });
    if (!analysis.ok) return;
    expect(isValidRegexAnalysis({ ...analysis.value, compatibility: { ecmascript: 5 } })).toBe(
      false,
    );
  });

  it('rejects malformed errors', () => {
    const analysis = analyzeRegex({ source: 'a', flags: '' });
    if (!analysis.ok) return;
    expect(isValidRegexAnalysis({ ...analysis.value, errors: [{ code: 1 }] })).toBe(false);
  });

  it('accepts a genuine analysis for every corpus shape', () => {
    for (const source of ['', 'a', '(a)(b)', '[a-z]+', 'a|b|c', '(?<n>x)\\k<n>', '(?=a)b']) {
      const analysis = analyzeRegex({ source, flags: '' });
      if (!analysis.ok) continue;
      expect(isValidRegexAnalysis(analysis.value)).toBe(true);
    }
  });
});

describe('compatibility reporting', () => {
  it('raises the required level for lookbehind', () => {
    const analysis = analyzeRegex({ source: '(?<=a)b', flags: '' });
    if (!analysis.ok) return;
    expect(analysis.value.compatibility.ecmascript).toBe('es2018');
    expect(analysis.value.compatibility.notes.some((n) => n.feature.includes('Lookbehind'))).toBe(
      true,
    );
  });

  it('raises the level for unicode property escapes', () => {
    const analysis = analyzeRegex({ source: '\\p{L}', flags: 'u' });
    if (!analysis.ok) return;
    expect(analysis.value.compatibility.ecmascript).toBe('es2018');
  });

  it('raises the level for the d flag', () => {
    const analysis = analyzeRegex({ source: 'a', flags: 'd' });
    if (!analysis.ok) return;
    expect(analysis.value.compatibility.ecmascript).toBe('es2022');
  });

  it('raises the level for the v flag', () => {
    const analysis = analyzeRegex({ source: 'a', flags: 'v' });
    if (!analysis.ok) return;
    expect(analysis.value.compatibility.ecmascript).toBe('es2024');
  });

  it('reports es5 for a plain pattern', () => {
    const analysis = analyzeRegex({ source: '^abc$', flags: '' });
    if (!analysis.ok) return;
    expect(analysis.value.compatibility.ecmascript).toBe('es5');
  });
});

describe('warning edge cases', () => {
  it('warns about an empty alternative', () => {
    const analysis = analyzeRegex({ source: 'a|', flags: '' });
    if (!analysis.ok) return;
    expect(analysis.value.warnings.some((w) => w.code === 'EMPTY_ALTERNATIVE')).toBe(true);
  });

  it('does not warn about a mid-pattern caret when the m flag is set', () => {
    // With `m`, `^` legitimately matches at line starts, so the warning would
    // be wrong.
    const withoutM = analyzeRegex({ source: 'a^b', flags: '' });
    const withM = analyzeRegex({ source: 'a^b', flags: 'm' });
    if (!withoutM.ok || !withM.ok) return;
    expect(withoutM.value.warnings.some((w) => w.code === 'ANCHOR_IN_MIDDLE')).toBe(true);
    expect(withM.value.warnings.some((w) => w.code === 'ANCHOR_IN_MIDDLE')).toBe(false);
  });

  it('warns about a literal dot inside a class', () => {
    const analysis = analyzeRegex({ source: '[.]', flags: '' });
    if (!analysis.ok) return;
    expect(analysis.value.warnings.some((w) => w.code === 'UNESCAPED_DOT_IN_CLASS')).toBe(true);
  });

  it('does not warn about a nested quantifier when there is none', () => {
    const analysis = analyzeRegex({ source: 'a+b+', flags: '' });
    if (!analysis.ok) return;
    expect(analysis.value.warnings.some((w) => w.code === 'NESTED_QUANTIFIER')).toBe(false);
  });

  it('detects a nested quantifier through an alternation', () => {
    const analysis = analyzeRegex({ source: '(a*|b)+', flags: '' });
    if (!analysis.ok) return;
    expect(analysis.value.warnings.some((w) => w.code === 'NESTED_QUANTIFIER')).toBe(true);
  });
});
