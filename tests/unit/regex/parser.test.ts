import { describe, expect, it } from 'vitest';
import { analyzeRegex } from '@/domain/regex/analyze';
import type { RegexAnalysis, RegexNode } from '@/domain/regex/ast';

function analyse(source: string, flags = ''): RegexAnalysis {
  const result = analyzeRegex({ source, flags });
  if (!result.ok) throw new Error(`unexpected failure: ${result.error.message}`);
  return result.value;
}

/** First node of the single alternative — the common shape in these tests. */
function firstElement(ast: RegexNode): RegexNode | undefined {
  if (ast.type !== 'Alternation') return undefined;
  const branch = ast.alternatives[0];
  if (branch?.type !== 'Sequence') return undefined;
  return branch.elements[0];
}

function collect(node: RegexNode, out: RegexNode[] = []): RegexNode[] {
  out.push(node);
  switch (node.type) {
    case 'Alternation':
      node.alternatives.forEach((child) => {
        collect(child, out);
      });
      break;
    case 'Sequence':
      node.elements.forEach((child) => {
        collect(child, out);
      });
      break;
    case 'Group':
    case 'Quantifier':
      collect(node.body, out);
      break;
    default:
      break;
  }
  return out;
}

describe('parser — structure', () => {
  it('always returns an Alternation root (R-I1)', () => {
    // Uniform tree walking beats special-casing in every consumer.
    for (const source of ['', 'a', 'a|b', '(a)', '[a-z]+']) {
      expect(analyse(source).ast.type).toBe('Alternation');
    }
  });

  it('wraps a single branch in one alternative', () => {
    const ast = analyse('abc').ast;
    expect(ast.type === 'Alternation' && ast.alternatives).toHaveLength(1);
  });

  it('splits alternation at the top level', () => {
    const ast = analyse('a|b|c').ast;
    expect(ast.type === 'Alternation' && ast.alternatives).toHaveLength(3);
  });

  it('binds concatenation tighter than alternation', () => {
    // `a|bc` is a|(bc), not (a|b)c — precedence the explanation depends on.
    const ast = analyse('a|bc').ast;
    if (ast.type !== 'Alternation') throw new Error('expected alternation');
    expect(ast.alternatives).toHaveLength(2);
    const second = ast.alternatives[1];
    expect(second?.type === 'Sequence' && second.elements).toHaveLength(2);
  });

  it('parses an empty pattern without error', () => {
    const analysis = analyse('');
    expect(analysis.errors).toHaveLength(0);
  });
});

describe('parser — quantifiers', () => {
  it.each([
    ['a*', 0, null, false],
    ['a+', 1, null, false],
    ['a?', 0, 1, false],
    ['a{3}', 3, 3, false],
    ['a{2,}', 2, null, false],
    ['a{2,4}', 2, 4, false],
    ['a*?', 0, null, true],
    ['a+?', 1, null, true],
    ['a??', 0, 1, true],
    ['a{2,4}?', 2, 4, true],
  ])('parses %s', (source, min, max, lazy) => {
    const node = firstElement(analyse(source).ast);
    expect(node).toMatchObject({ type: 'Quantifier', min, max, lazy });
  });

  it('rejects two quantifiers in a row (R-I3)', () => {
    const analysis = analyse('a**');
    expect(analysis.errors.some((e) => /two quantifiers/i.test(e.message))).toBe(true);
  });

  it('allows a quantified group, which is the legitimate nesting', () => {
    const analysis = analyse('(a*)*');
    expect(analysis.errors).toHaveLength(0);
    const node = firstElement(analysis.ast);
    expect(node?.type).toBe('Quantifier');
  });

  it('never nests a Quantifier directly inside a Quantifier (R-I3)', () => {
    for (const source of ['(a*)*', 'a+', '(?:a{2})+', '[a-z]*']) {
      for (const node of collect(analyse(source).ast)) {
        if (node.type === 'Quantifier') expect(node.body.type).not.toBe('Quantifier');
      }
    }
  });

  it('rejects a quantifier with nothing to repeat', () => {
    expect(analyse('*abc').errors.some((e) => /nothing to repeat/i.test(e.message))).toBe(true);
  });

  it('refuses to quantify an anchor', () => {
    expect(analyse('^*').errors.some((e) => /nothing to repeat/i.test(e.message))).toBe(true);
  });

  it('refuses to quantify a lookahead', () => {
    expect(analyse('(?=a)*').errors.some((e) => /nothing to repeat/i.test(e.message))).toBe(true);
  });
});

describe('parser — groups and numbering', () => {
  it('numbers a single group from 1', () => {
    expect(analyse('(a)').groups.map((g) => g.number)).toEqual([1]);
  });

  it('numbers sibling groups in source order', () => {
    expect(analyse('(a)(b)').groups.map((g) => g.number)).toEqual([1, 2]);
  });

  it('numbers by opening parenthesis, not by nesting (R-I4)', () => {
    // ((a)(b)) → outer is 1, then 2 and 3 in source order.
    expect(analyse('((a)(b))').groups.map((g) => g.number)).toEqual([1, 2, 3]);
  });

  it('keeps numbering contiguous across alternation', () => {
    expect(analyse('(a)|(b)').groups.map((g) => g.number)).toEqual([1, 2]);
  });

  it('does not number non-capturing groups', () => {
    expect(analyse('(?:a)(b)').groups.map((g) => g.number)).toEqual([1]);
  });

  it('does not number lookarounds', () => {
    expect(analyse('(?=a)(?!b)(?<=c)(?<!d)(e)').groups.map((g) => g.number)).toEqual([1]);
  });

  it('numbers named groups alongside numeric ones', () => {
    const groups = analyse('(a)(?<mid>b)(c)').groups;
    expect(groups.map((g) => g.number)).toEqual([1, 2, 3]);
    expect(groups[1]?.name).toBe('mid');
  });

  it('records nesting depth', () => {
    const groups = analyse('((a))').groups;
    expect(groups[0]?.depth).toBe(0);
    expect(groups[1]?.depth).toBe(1);
  });

  it('rejects a duplicate group name', () => {
    expect(
      analyse('(?<a>x)(?<a>y)').errors.some((e) => /duplicate group name/i.test(e.message)),
    ).toBe(true);
  });

  it('reports an unmatched opening parenthesis', () => {
    expect(analyse('(abc').errors.some((e) => /unmatched `\(`/i.test(e.message))).toBe(true);
  });

  it('reports an unmatched closing parenthesis', () => {
    expect(analyse('abc)').errors.some((e) => /unmatched `\)`/i.test(e.message))).toBe(true);
  });
});

describe('parser — backreferences', () => {
  it('resolves a numeric backreference to an existing group', () => {
    const node = collect(analyse('(a)\\1').ast).find((n) => n.type === 'Backreference');
    expect(node).toMatchObject({ ref: 1, resolved: true });
  });

  it('resolves a forward reference, which is legal', () => {
    // \1(a) is valid ECMAScript; a single-pass parser cannot resolve it,
    // which is why numbering is a second pass.
    const node = collect(analyse('\\1(a)').ast).find((n) => n.type === 'Backreference');
    expect(node).toMatchObject({ resolved: true });
  });

  it('does not treat \\1 as a backreference when no group exists (R-I6)', () => {
    // The common shortcut is "\1 always means group 1". ECMAScript says
    // otherwise: without /u this is a legacy octal escape.
    const analysis = analyse('\\1');
    const node = collect(analysis.ast).find((n) => n.type === 'Backreference');
    expect(node).toMatchObject({ resolved: false });
    expect(analysis.errors).toHaveLength(0);
    expect(analysis.warnings.some((w) => w.code === 'UNRESOLVED_BACKREFERENCE')).toBe(true);
  });

  it('rejects an out-of-range numeric reference under the u flag (R-I6)', () => {
    const analysis = analyse('\\1', 'u');
    expect(analysis.errors.some((e) => /does not exist/i.test(e.message))).toBe(true);
  });

  it('resolves a named backreference', () => {
    const node = collect(analyse('(?<x>a)\\k<x>').ast).find((n) => n.type === 'Backreference');
    expect(node).toMatchObject({ ref: 'x', resolved: true });
  });

  it('accepts a k-escape as an identity escape when there are no named groups', () => {
    // Annex B: with no group names anywhere, `\k` is not a named
    // backreference at all and the engine accepts the pattern. Asserting an
    // error here would contradict `new RegExp`, which the differential suite
    // proved.
    expect(analyse('\\k<nope>').errors).toHaveLength(0);
  });

  it('reports an unknown named reference once named groups exist', () => {
    const analysis = analyse(String.raw`(?<real>a)\k<nope>`);
    expect(analysis.errors.some((e) => /no group named/i.test(e.message))).toBe(true);
  });

  it('reports an unknown named reference under the u flag', () => {
    const analysis = analyse('\\k<nope>', 'u');
    expect(analysis.errors.some((e) => /no group named/i.test(e.message))).toBe(true);
  });
});

describe('parser — character classes', () => {
  it('parses ranges', () => {
    const node = firstElement(analyse('[a-z]').ast);
    expect(node?.type).toBe('CharClass');
    if (node?.type === 'CharClass') {
      expect(node.items[0]).toMatchObject({ kind: 'range' });
    }
  });

  it('parses negation', () => {
    const node = firstElement(analyse('[^a-z]').ast);
    expect(node).toMatchObject({ type: 'CharClass', negated: true });
  });

  it('treats a leading hyphen as a literal', () => {
    const node = firstElement(analyse('[-a]').ast);
    if (node?.type !== 'CharClass') throw new Error('expected class');
    expect(node.items[0]).toMatchObject({ kind: 'char', raw: '-' });
  });

  it('mixes escapes and ranges', () => {
    const node = firstElement(analyse('[\\d a-f]').ast);
    if (node?.type !== 'CharClass') throw new Error('expected class');
    expect(node.items.map((i) => i.kind)).toContain('escape');
    expect(node.items.map((i) => i.kind)).toContain('range');
  });

  it('rejects a backwards range', () => {
    expect(analyse('[z-a]').errors.some((e) => /backwards/i.test(e.message))).toBe(true);
  });
});

describe('parser — limits', () => {
  it('rejects a pattern over the documented length limit', () => {
    const result = analyzeRegex({ source: 'a'.repeat(10_001), flags: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LIMIT_EXCEEDED');
  });

  it('accepts a pattern at exactly the limit', () => {
    expect(analyzeRegex({ source: 'a'.repeat(10_000), flags: '' }).ok).toBe(true);
  });

  it('caps nesting depth rather than overflowing the stack', () => {
    // '(((((...' is 1 byte per level. A recursive parser without a cap dies
    // with an unattributable RangeError inside the worker.
    const analysis = analyse('('.repeat(300) + 'a' + ')'.repeat(300));
    expect(analysis.errors.some((e) => e.code === 'LIMIT_EXCEEDED')).toBe(true);
  });

  it('does not crash on extreme nesting', () => {
    expect(() => analyzeRegex({ source: '('.repeat(5000), flags: '' })).not.toThrow();
  });
});

describe('parser — flags', () => {
  it.each(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'])('accepts the %s flag', (flag) => {
    expect(analyzeRegex({ source: 'a', flags: flag }).ok).toBe(true);
  });

  it('rejects an unknown flag', () => {
    const result = analyzeRegex({ source: 'a', flags: 'q' });
    expect(result.ok).toBe(false);
  });

  it('rejects a repeated flag', () => {
    expect(analyzeRegex({ source: 'a', flags: 'gg' }).ok).toBe(false);
  });

  it('rejects u and v together, as the engine does', () => {
    expect(analyzeRegex({ source: 'a', flags: 'uv' }).ok).toBe(false);
  });
});

describe('parser — error recovery', () => {
  it('still explains the rest of a pattern containing one error', () => {
    // The point of recovery: one typo in a long pattern must not blank the
    // whole explanation.
    const analysis = analyse('(abc');
    expect(analysis.errors.length).toBeGreaterThan(0);
    expect(analysis.explanation.summary.length).toBeGreaterThan(0);
    expect(analysis.groups).toHaveLength(1);
  });

  it('produces a usable tree despite an unsupported construct', () => {
    const analysis = analyse('a(?P<x>b)c');
    expect(analysis.errors.some((e) => e.code === 'UNSUPPORTED')).toBe(true);
    expect(analysis.tokens.length).toBeGreaterThan(3);
  });
});
