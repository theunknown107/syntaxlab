import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@/domain/shared/limits';
import type { JsonNode } from '@/domain/json/ast';
import { analyzeJson } from '@/domain/json/analyze';
import { parseJson } from '@/domain/json/parser';
import { toPlainValue } from '@/domain/json/plain';
import { formatPath, formatPathBracket } from '@/domain/json/path';

/**
 * Property and fuzz testing.
 *
 * The corpus tests assert what specific documents do. These assert what
 * *every* document does — the invariants a consumer relies on and a refactor
 * can silently break. Seeded, so a failure is reproducible, and bounded, so
 * the suite stays a gate rather than a coffee break.
 */

const SEED = 20_260_819;
const RUNS = 400;

/**
 * The characters a JSON scanner has to get right.
 *
 * Listed rather than spread from a string literal: spreading a string yields
 * code points, which would decompose the emoji — a different case, and one the
 * surrogate arbitrary below covers deliberately.
 */
const JSON_ALPHABET = [
  '{',
  '}',
  '[',
  ']',
  '"',
  ',',
  ':',
  '\\',
  ' ',
  '\n',
  '\t',
  '0',
  '1',
  '.',
  'e',
  'E',
  '-',
  '+',
  't',
  'r',
  'u',
  'f',
  'a',
  'l',
  's',
  'n',
  'é',
  '\u{1F600}',
];

/** Arbitrary text, including the characters that break naive scanners. */
const hostileText = fc.oneof(
  fc.string(),
  fc.string({ unit: fc.constantFrom(...JSON_ALPHABET) }),
  fc.string({ unit: 'binary' }),
  // Unpaired surrogates: valid UTF-16, not valid UTF-8, and a classic source
  // of parser corruption.
  fc.string({ unit: fc.constantFrom('\uD800', '\uDC00', 'a', '"', '\\') }),
);

function walk(node: JsonNode, visit: (node: JsonNode, parent: JsonNode | null) => void): void {
  const stack: [JsonNode, JsonNode | null][] = [[node, null]];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    const [current, parent] = entry;
    visit(current, parent);
    if (current.type === 'array') {
      for (const element of current.elements) stack.push([element, current]);
    } else if (current.type === 'object') {
      for (const member of current.members) stack.push([member.value, current]);
    }
  }
}

describe('the parser always terminates and never throws', () => {
  it('on arbitrary text', () => {
    fc.assert(
      fc.property(hostileText, (source) => {
        // No try/catch: throwing *is* the failure. The domain returns errors.
        const result = analyzeJson(source);
        expect(result.ok).toBe(true);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('on text built from JSON punctuation alone', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('{', '}', '[', ']', ':', ',', '"', '\\', '1', 'e'), {
          maxLength: 200,
        }),
        (parts) => {
          expect(analyzeJson(parts.join('')).ok).toBe(true);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('on truncations of a valid document', () => {
    // Every prefix of a valid document is a realistic mid-typing state.
    const full = '{"a":[1,2,{"b":"c\\u00e9","d":[true,null]}],"e":{"f":1.5e-3}}';
    for (let end = 0; end <= full.length; end += 1) {
      const result = analyzeJson(full.slice(0, end));
      expect(result.ok).toBe(true);
    }
  });

  it('on adversarial shapes that a recursive parser cannot survive', () => {
    const cases = [
      '['.repeat(100_000),
      '{'.repeat(100_000),
      '{"a":'.repeat(50_000),
      `${'['.repeat(50_000)}]`.repeat(1),
      '"'.repeat(10_000),
      '\\'.repeat(10_000),
      `"${'\\'.repeat(10_000)}`,
      ','.repeat(50_000),
      '1'.repeat(100_000),
      `${'-'.repeat(50_000)}1`,
    ];
    for (const source of cases) {
      const result = analyzeJson(source);
      expect(result.ok).toBe(true);
    }
  });
});

describe('spans stay inside the source and nest correctly', () => {
  it('every span is a valid range within the document', () => {
    fc.assert(
      fc.property(hostileText, (source) => {
        const root = parseJson(source).root;
        if (!root) return;

        walk(root, (node) => {
          expect(node.span.start).toBeGreaterThanOrEqual(0);
          expect(node.span.end).toBeLessThanOrEqual(source.length);
          expect(node.span.start).toBeLessThanOrEqual(node.span.end);
          expect(node.span.line).toBeGreaterThanOrEqual(1);
          expect(node.span.column).toBeGreaterThanOrEqual(1);
        });
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('a parent span contains every child span', () => {
    fc.assert(
      fc.property(fc.json(), (source) => {
        const root = parseJson(source).root;
        if (!root) return;

        walk(root, (node, parent) => {
          if (!parent) return;
          expect(node.span.start).toBeGreaterThanOrEqual(parent.span.start);
          expect(node.span.end).toBeLessThanOrEqual(parent.span.end);
        });
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('a key span lies inside its member span', () => {
    fc.assert(
      fc.property(fc.json(), (source) => {
        const root = parseJson(source).root;
        if (!root) return;

        walk(root, (node) => {
          if (node.type !== 'object') return;
          for (const member of node.members) {
            expect(member.keySpan.start).toBeGreaterThanOrEqual(member.span.start);
            expect(member.keySpan.end).toBeLessThanOrEqual(member.span.end);
          }
        });
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('the reported line matches the newlines before the offset', () => {
    fc.assert(
      fc.property(fc.json(), (source) => {
        const root = parseJson(source).root;
        if (!root) return;

        walk(root, (node) => {
          const before = source.slice(0, node.span.start);
          const expected = before.split('\n').length;
          expect(node.span.line).toBe(expected);
        });
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe('structural consistency', () => {
  it('a path is the accessor chain to the node that carries it', () => {
    fc.assert(
      fc.property(fc.json(), (source) => {
        const root = parseJson(source).root;
        if (!root) return;

        walk(root, (node, parent) => {
          if (!parent) {
            expect(node.path).toEqual([]);
            return;
          }
          expect(node.path.length).toBe(parent.path.length + 1);
          // The prefix is the parent's own path, unchanged.
          expect(node.path.slice(0, parent.path.length)).toEqual(parent.path);
        });
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('a formatted path is always non-empty and rooted at $', () => {
    fc.assert(
      fc.property(fc.json(), (source) => {
        const root = parseJson(source).root;
        if (!root) return;
        walk(root, (node) => {
          expect(formatPath(node.path).startsWith('$')).toBe(true);
          expect(formatPathBracket(node.path).startsWith('$')).toBe(true);
        });
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('a valid document produces no errors and an invalid one produces at least one', () => {
    fc.assert(
      fc.property(hostileText, (source) => {
        const result = analyzeJson(source);
        if (!result.ok) return;

        let platformValid = true;
        try {
          JSON.parse(source);
        } catch {
          platformValid = false;
        }

        expect(result.value.valid).toBe(platformValid);
        expect(result.value.errors.length === 0).toBe(platformValid);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('stats agree with the tree they describe', () => {
    fc.assert(
      fc.property(fc.json(), (source) => {
        const result = analyzeJson(source);
        if (!result.ok || !result.value.cst) return;

        let counted = 0;
        walk(result.value.cst, () => {
          counted += 1;
        });
        expect(result.value.stats.nodeCount).toBe(counted);
        expect(result.value.stats.maxDepth).toBeLessThanOrEqual(LIMITS.json.maxDepth);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('round-trips every valid document to the same value the platform reads', () => {
    fc.assert(
      fc.property(fc.json(), (source) => {
        const root = parseJson(source).root;
        if (!root) return;
        expect(toPlainValue(root).value).toEqual(JSON.parse(source));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe('limits hold under fuzzing', () => {
  it('never reports depth beyond the limit', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2000 }), (depth) => {
        const result = parseJson('['.repeat(depth) + ']'.repeat(depth));
        expect(result.maxDepth).toBeLessThanOrEqual(LIMITS.json.maxDepth);
      }),
      { seed: SEED, numRuns: 120 },
    );
  });

  it('refuses an over-sized document before parsing it', () => {
    const oversized = `"${'a'.repeat(LIMITS.json.input)}"`;
    const result = analyzeJson(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LIMIT_EXCEEDED');
  });

  it('bounds the error list however bad the input is', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('?', ',', '@', '#'), { maxLength: 2000 }), (parts) => {
        const result = analyzeJson(`[${parts.join('')}]`);
        if (!result.ok) return;
        expect(result.value.errors.length).toBeLessThanOrEqual(24);
      }),
      { seed: SEED, numRuns: 120 },
    );
  });
});

describe('nothing in the runtime is mutated, whatever the keys are', () => {
  it('holds for arbitrary object keys', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constantFrom('__proto__', 'constructor', 'prototype', 'toString', 'valueOf'),
            fc.string(),
          ),
          { maxLength: 12 },
        ),
        (keys) => {
          const source = `{${keys.map((key, index) => `${JSON.stringify(key)}:${index}`).join(',')}}`;
          const root = parseJson(source).root;
          if (root) toPlainValue(root);

          const probe = {} as Record<string, unknown>;
          expect(probe.polluted).toBeUndefined();
          expect(Object.getPrototypeOf({})).toBe(Object.prototype);
          expect(Object.prototype.toString.call({})).toBe('[object Object]');
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
