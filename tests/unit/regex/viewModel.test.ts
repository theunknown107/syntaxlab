import { describe, expect, it } from 'vitest';
import { analyzeRegex } from '@/domain/regex/analyze';
import { executeRegex } from '@/domain/regex/execute';
import type { RegexAnalysis } from '@/domain/regex/ast';
import {
  astToTree,
  describeNode,
  expandableKeys,
  FLAGS,
  linkedRange,
  matchRanges,
  tokenRanges,
  warningKind,
  warningTone,
} from '@/features/regex/viewModel';

/**
 * View-model tests.
 *
 * These are the pure half of the UI: everything the panels render is derived
 * here, so the derivations can be checked without mounting a component or
 * starting a worker. Real analyses are used as input rather than hand-built
 * fixtures, because a fixture that drifts from the parser tests the fixture.
 */

function analyse(source: string, flags = ''): RegexAnalysis {
  const result = analyzeRegex({ source, flags });
  if (!result.ok) throw new Error(`analysis failed: ${result.error.message}`);
  return result.value;
}

describe('tokenRanges', () => {
  it('colours structure but leaves ordinary literals alone', () => {
    const ranges = tokenRanges(analyse('ab(c)').tokens);
    const classes = ranges.map((range) => range.className);

    expect(classes).toContain('tok-group');
    // `a`, `b` and `c` are plain characters and take the default colour.
    expect(ranges).toHaveLength(2);
  });

  it('gives each construct its documented class', () => {
    const byClass = new Map(
      tokenRanges(analyse('^[a-z]+\\d.$|x').tokens).map((range) => [range.className, range]),
    );

    expect([...byClass.keys()].sort()).toEqual([
      'tok-anchor',
      'tok-class',
      'tok-escape',
      'tok-meta',
      'tok-quantifier',
    ]);
  });

  it('produces ranges that lie inside the pattern', () => {
    const source = '(?<name>\\w+)@[a-z]{2,}';
    for (const range of tokenRanges(analyse(source).tokens)) {
      expect(range.from).toBeGreaterThanOrEqual(0);
      expect(range.to).toBeLessThanOrEqual(source.length);
      expect(range.from).toBeLessThan(range.to);
    }
  });

  it('marks unreadable syntax as invalid', () => {
    const classes = tokenRanges(analyse('(?P<n>a)').tokens).map((range) => range.className);
    expect(classes).toContain('tok-invalid');
  });
});

describe('matchRanges', () => {
  function ranges(source: string, flags: string, subject: string) {
    const result = executeRegex({ source, flags, subject });
    if (!result.ok) throw new Error('exec failed');
    return matchRanges(result.value.matches);
  }

  it('alternates tints so adjacent matches stay distinguishable', () => {
    expect(ranges('a', 'g', 'aaa').map((range) => range.className)).toEqual([
      'match-even',
      'match-odd',
      'match-even',
    ]);
  });

  it('skips zero-length matches rather than inventing a width for them', () => {
    // A mark decoration needs a non-empty range, and highlighting one
    // character would claim the match covered something it did not. These are
    // reported in the match table instead.
    expect(ranges('x*', 'g', 'ab')).toEqual([]);
  });

  it('keeps the offsets the engine reported', () => {
    expect(ranges('\\d+', 'g', 'a12b345')).toEqual([
      { from: 1, to: 3, className: 'match-even' },
      { from: 4, to: 7, className: 'match-odd' },
    ]);
  });
});

describe('linkedRange', () => {
  it('is empty when nothing is hovered', () => {
    expect(linkedRange(null)).toEqual([]);
  });

  it('is empty for a zero-width span', () => {
    expect(linkedRange({ start: 3, end: 3, line: 1, column: 4 })).toEqual([]);
  });

  it('marks the hovered span', () => {
    expect(linkedRange({ start: 1, end: 4, line: 1, column: 2 })).toEqual([
      { from: 1, to: 4, className: 'tok-linked' },
    ]);
  });
});

describe('describeNode', () => {
  it('names a capture group by its number', () => {
    const tree = astToTree(analyse('(a)').ast);
    const labels = JSON.stringify(tree);
    expect(labels).toContain('Capture group 1');
  });

  it('names a named group by both name and number', () => {
    expect(JSON.stringify(astToTree(analyse('(?<year>a)').ast))).toContain('Named group year (1)');
  });

  it('distinguishes the four lookaround kinds', () => {
    const kinds = ['(?=a)', '(?!a)', '(?<=a)', '(?<!a)'].map((source) =>
      JSON.stringify(astToTree(analyse(source).ast)),
    );
    expect(kinds[0]).toContain('Lookahead');
    expect(kinds[1]).toContain('Negative lookahead');
    expect(kinds[2]).toContain('Lookbehind');
    expect(kinds[3]).toContain('Negative lookbehind');
  });

  it('reads a quantifier as a range rather than as syntax', () => {
    const cases: [string, string][] = [
      ['a*', '0 or more'],
      ['a+', '1 or more'],
      ['a{3}', 'exactly 3'],
      ['a{2,4}', '2 to 4'],
      ['a+?', 'as few as possible'],
    ];
    for (const [source, expected] of cases) {
      expect(JSON.stringify(astToTree(analyse(source).ast))).toContain(expected);
    }
  });

  it('says when a backreference does not resolve', () => {
    expect(JSON.stringify(astToTree(analyse('\\9').ast))).toContain('unresolved');
  });

  it('describes every node type the parser can produce', () => {
    // Exhaustiveness is what stops a new node type rendering as a blank row.
    const sources = ['a|b', 'ab', 'a', '[a]', '.', '^', '(a)', 'a*', '(a)\\1', '\\n', '\\p{L}'];
    for (const source of sources) {
      const analysis = analyse(source, source.includes('\\p') ? 'u' : '');
      expect(describeNode(analysis.ast).label.length).toBeGreaterThan(0);
    }
  });
});

describe('astToTree', () => {
  it('keys nodes by structural path so expansion survives a re-analysis', () => {
    const first = astToTree(analyse('(a)(b)').ast);
    const second = astToTree(analyse('(a)(b)').ast);
    expect(first.children.map((child) => child.key)).toEqual(
      second.children.map((child) => child.key),
    );
    expect(first.key).toBe('0');
  });

  it('nests a group body under the group', () => {
    const tree = astToTree(analyse('(ab)').ast);
    expect(tree.children.length).toBeGreaterThan(0);
  });

  it('carries each node span for the source link', () => {
    const source = '(abc)';
    const tree = astToTree(analyse(source).ast);
    expect(tree.value.span.start).toBe(0);
    expect(tree.value.span.end).toBeLessThanOrEqual(source.length);
  });

  it('collects every expandable key for expand-all', () => {
    const keys = expandableKeys(astToTree(analyse('((a)(b))').ast));
    expect(keys.size).toBeGreaterThan(1);
    expect(keys.has('0')).toBe(true);
  });
});

describe('warning presentation', () => {
  it('does not colour every warning as a problem', () => {
    expect(warningTone('NESTED_QUANTIFIER')).toBe('warning');
    expect(warningTone('LOOKBEHIND_COMPATIBILITY')).toBe('info');
    expect(warningTone('REDUNDANT_ESCAPE')).toBe('info');
  });

  it('gives every warning a text label, so severity is never colour alone', () => {
    const codes = [
      'NESTED_QUANTIFIER',
      'UNESCAPED_DOT_IN_CLASS',
      'REDUNDANT_ESCAPE',
      'EMPTY_ALTERNATIVE',
      'UNICODE_FLAG_ADVISED',
      'LARGE_BOUNDED_REPEAT',
      'ANCHOR_IN_MIDDLE',
      'LOOKBEHIND_COMPATIBILITY',
      'UNRESOLVED_BACKREFERENCE',
      'DUPLICATE_GROUP_NAME',
    ] as const;

    for (const code of codes) {
      expect(warningKind(code).length).toBeGreaterThan(0);
    }
  });
});

describe('flag metadata', () => {
  it('covers all eight ECMAScript flags exactly once', () => {
    const letters = FLAGS.map((flag) => flag.letter);
    expect(letters).toEqual(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);
    expect(new Set(letters).size).toBe(8);
  });

  it('explains what each flag does, not merely what it is called', () => {
    for (const flag of FLAGS) {
      expect(flag.description.length).toBeGreaterThan(20);
      expect(flag.name.length).toBeGreaterThan(0);
    }
  });
});
