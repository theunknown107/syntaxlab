import { describe, expect, it } from 'vitest';
import { analyzeJson } from '@/domain/json/analyze';
import { parseJson } from '@/domain/json/parser';
import { toPlainValue } from '@/domain/json/plain';

/**
 * Differential testing against `JSON.parse`.
 *
 * **What this proves:** that our *validity verdict* matches the platform's on
 * every input in the corpus, and that for valid input our *values* match too —
 * strings after unescaping, numbers after conversion, arrays and objects
 * element by element.
 *
 * **What it deliberately does not prove**, because the oracle cannot speak to
 * it (J-I1, §4 of the M5 brief):
 *
 *   - *Positions.* `JSON.parse` reports no spans, and its error messages are
 *     engine-specific and unstable, so nothing about line, column or offset
 *     can be checked here. Those are covered in `parser.test.ts`.
 *   - *Duplicate keys.* `JSON.parse` silently keeps the last occurrence. We
 *     keep every occurrence deliberately, so the trees differ by design and
 *     only the last-wins plain value is compared.
 *   - *Diagnostic quality.* We report more, and more specifically, than the
 *     platform. Reporting three errors where `JSON.parse` throws one is the
 *     intended behaviour, not a disagreement.
 *
 * If the verdicts disagree, we are wrong. That is the rule.
 */

function platformAccepts(source: string): boolean {
  try {
    JSON.parse(source);
    return true;
  } catch {
    return false;
  }
}

function weAccept(source: string): boolean {
  const result = analyzeJson(source);
  return result.ok && result.value.valid;
}

/** The plain value our CST denotes, for comparison with `JSON.parse`. */
function ourValue(source: string): unknown {
  const root = parseJson(source).root;
  if (!root) throw new Error('no root');
  return toPlainValue(root).value;
}

const VALID: string[] = [
  // Scalars at the root — RFC 8259 allows any value, not only object/array.
  'null',
  'true',
  'false',
  '0',
  '-0',
  '1',
  '-1',
  '12345',
  '1.5',
  '-1.5',
  '1e5',
  '1E5',
  '1e+5',
  '1e-5',
  '-1.5e-3',
  '0.0',
  '1.0e0',
  '"a"',
  '""',
  // Whitespace is permitted around and between tokens.
  ' \t\r\n1 \t\r\n',
  '{}',
  '[]',
  '{ }',
  '[ ]',
  // Containers.
  '{"a":1}',
  '{"a":1,"b":2}',
  '[1,2,3]',
  '[[[]]]',
  '{"a":{"b":{"c":[1,2,{"d":null}]}}}',
  '[{"a":1},{"b":2}]',
  '{"a":[],"b":{},"c":null,"d":true,"e":1,"f":"s"}',
  // Strings and escapes.
  '"\\""',
  '"\\\\"',
  '"\\/"',
  '"\\b\\f\\n\\r\\t"',
  '"\\u0041"',
  '"\\u00e9"',
  '"\\uD83D\\uDE00"',
  '"\\u007F"',
  '"caf\u00e9"',
  '"\u4e2d\u6587"',
  '"\u{1F600}"',
  '"line1\\nline2"',
  '"quote:\\u0022"',
  // Keys.
  '{"":1}',
  '{"a b":1}',
  '{"a.b":1}',
  '{"\\u0041":1}',
  '{"\u{1F600}":1}',
  // Numbers at the edges.
  '9007199254740991',
  '-9007199254740991',
  '1e308',
  '1e-308',
  '0.1',
  '123456789012345678901234567890',
];

const INVALID: string[] = [
  '',
  ' ',
  '{',
  '}',
  '[',
  ']',
  '[,]',
  '{,}',
  '{"a"}',
  '{"a":}',
  '{:1}',
  '{"a" 1}',
  '{"a":1,}',
  '[1,]',
  '[1,,2]',
  '[1 2]',
  '{"a":1 "b":2}',
  "{'a':1}",
  '{a:1}',
  '{"a":undefined}',
  '{"a":NaN}',
  '{"a":Infinity}',
  '{"a":-Infinity}',
  '{"a":None}',
  '{"a":01}',
  '01',
  '+1',
  '.5',
  '1.',
  '1e',
  '1e+',
  '1.2.3',
  '0x10',
  "'a'",
  '"a',
  'a"',
  '"\\x41"',
  '"\\u12"',
  '"\\u12g4"',
  '"\\q"',
  'tru',
  'TRUE',
  'nulll',
  '// comment',
  '/* comment */',
  '{} {}',
  '1 2',
  '[1][2]',
  '{"a":1}extra',
  '\u{FEFF}{}',
];

describe('validity agrees with JSON.parse', () => {
  it.each(VALID)('accepts %j', (source) => {
    // Guard the corpus itself: a "valid" case the platform rejects would make
    // the assertion below meaningless.
    expect(platformAccepts(source)).toBe(true);
    expect(weAccept(source)).toBe(true);
  });

  it.each(INVALID)('rejects %j', (source) => {
    expect(platformAccepts(source)).toBe(false);
    expect(weAccept(source)).toBe(false);
  });
});

describe('values agree with JSON.parse', () => {
  it.each(VALID)('parses %j to the same value', (source) => {
    // `toEqual` compares structurally, so a null-prototype object and a plain
    // one with the same entries match — which is exactly the comparison we
    // want, since the prototype difference is the point of our representation.
    expect(ourValue(source)).toEqual(JSON.parse(source));
  });

  it('agrees on strings after unescaping', () => {
    const cases = ['"\\u0041\\u0042"', '"\\uD83D\\uDE00"', '"tab\\there"', '"\\u00e9t\u00e9"'];
    for (const source of cases) {
      expect(ourValue(source)).toBe(JSON.parse(source));
    }
  });

  it('agrees on numbers after conversion', () => {
    const cases = [
      '1e5',
      '0.1',
      '-0',
      '1e308',
      '9007199254740993',
      '123456789012345678901234567890',
    ];
    for (const source of cases) {
      expect(Object.is(ourValue(source), JSON.parse(source))).toBe(true);
    }
  });

  it('agrees on the last-wins value for duplicate keys, while still reporting both', () => {
    // The one place the trees differ by design: `JSON.parse` keeps the last
    // occurrence and says nothing. We keep both and report them, and our
    // plain-value conversion then applies the same last-wins rule.
    const source = '{"a":1,"a":2}';
    expect(ourValue(source)).toEqual(JSON.parse(source));

    const analysis = analyzeJson(source);
    if (!analysis.ok) throw new Error('expected success');
    expect(analysis.value.duplicateKeys).toHaveLength(1);
    expect(analysis.value.duplicateKeys[0]?.occurrences).toHaveLength(2);
  });
});

describe('key order, which JSON.parse does not preserve', () => {
  it('keeps integer-like keys in source order', () => {
    // V8 reorders integer-like keys on a real object, so this is a property
    // our CST has and the platform's result does not.
    const root = parseJson('{"2":"two","10":"ten","1":"one"}').root;
    if (root?.type !== 'object') throw new Error('expected an object');
    expect(root.members.map((member) => member.key)).toEqual(['2', '10', '1']);
    expect(Object.keys(JSON.parse('{"2":"two","10":"ten","1":"one"}') as object)).toEqual([
      '1',
      '2',
      '10',
    ]);
  });
});

describe('generated documents', () => {
  /** A deterministic pseudo-random generator, so a failure is reproducible. */
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
  }

  function generate(random: () => number, depth: number): unknown {
    const roll = random();
    if (depth <= 0 || roll < 0.35) {
      if (roll < 0.08) return null;
      if (roll < 0.14) return random() < 0.5;
      if (roll < 0.24) return Math.round((random() - 0.5) * 1e6) / 100;
      return String.fromCodePoint(
        ...Array.from({ length: Math.floor(random() * 6) }, () =>
          Math.floor(random() * 0x2ff + 0x20),
        ),
      );
    }
    if (roll < 0.68) {
      return Array.from({ length: Math.floor(random() * 5) }, () => generate(random, depth - 1));
    }
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < Math.floor(random() * 5); i += 1) {
      entries[`k${Math.floor(random() * 1000)}`] = generate(random, depth - 1);
    }
    return entries;
  }

  it('round-trips 2000 generated documents through both parsers', () => {
    const random = makeRandom(20_260_819);
    for (let i = 0; i < 2000; i += 1) {
      const source = JSON.stringify(generate(random, 4));
      expect(weAccept(source)).toBe(true);
      expect(ourValue(source)).toEqual(JSON.parse(source));
    }
  });

  it('agrees on 2000 mutated documents', () => {
    // Mutation produces mostly-invalid input, which is where a parser's
    // verdict is easiest to get wrong.
    const random = makeRandom(72_531);
    const alphabet = '{}[],:"\\0189eE.+-truefalsnl \t\n\u00e9';

    for (let i = 0; i < 2000; i += 1) {
      const base = JSON.stringify(generate(random, 3));
      const at = Math.floor(random() * base.length);
      const replacement = alphabet[Math.floor(random() * alphabet.length)] ?? '';
      const mutated = base.slice(0, at) + replacement + base.slice(at + 1);

      expect(weAccept(mutated)).toBe(platformAccepts(mutated));
    }
  });
});
