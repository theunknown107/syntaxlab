import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analyzeRegex } from '@/domain/regex/analyze';
import type { RegexAnalysis, RegexNode } from '@/domain/regex/ast';
import { LIMITS } from '@/domain/shared/limits';

/**
 * Property and fuzz tests — 04_PARSER_ARCHITECTURE.md §1.1, 13_TEST_PLAN.md §4
 *
 * The objective is **zero crashes, zero infinite loops, deterministic
 * failure** — not "the parser accepts everything". A parser for hostile input
 * must be total and terminating before it is generous.
 *
 * Budget is bounded and seeded so CI stays fast and reproducible. A failing
 * seed is printed by fast-check, and every counterexample found becomes a
 * permanent case in `differential.test.ts`.
 */

const SEED = 20260818;
const RUNS = 1500;

/** Characters that actually exercise the grammar, not arbitrary noise. */
const REGEX_CHARS = 'ab01()[]{}|*+?.^$-,\\/<>=!:kpPdwsWSuxcn'.split('');

const arbitraryPattern = fc.string({ unit: fc.constantFrom(...REGEX_CHARS), maxLength: 40 });

function analyseOrNull(source: string, flags: string): RegexAnalysis | null {
  const result = analyzeRegex({ source, flags });
  return result.ok ? result.value : null;
}

function everyNode(node: RegexNode, visit: (node: RegexNode) => void): void {
  visit(node);
  switch (node.type) {
    case 'Alternation':
      node.alternatives.forEach((child) => {
        everyNode(child, visit);
      });
      break;
    case 'Sequence':
      node.elements.forEach((child) => {
        everyNode(child, visit);
      });
      break;
    case 'Group':
    case 'Quantifier':
      everyNode(node.body, visit);
      break;
    default:
      break;
  }
}

function childrenOf(node: RegexNode): readonly RegexNode[] {
  switch (node.type) {
    case 'Alternation':
      return node.alternatives;
    case 'Sequence':
      return node.elements;
    case 'Group':
    case 'Quantifier':
      return [node.body];
    default:
      return [];
  }
}

describe('property — totality and termination', () => {
  it('never throws, for any input', () => {
    fc.assert(
      fc.property(arbitraryPattern, fc.constantFrom('', 'u', 'gimsy', 'v'), (source, flags) => {
        expect(() => analyzeRegex({ source, flags })).not.toThrow();
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('never throws on arbitrary unicode text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (source) => {
        expect(() => analyzeRegex({ source, flags: '' })).not.toThrow();
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('terminates within a bounded time for any input', () => {
    // A stalled parser is indistinguishable from a hung tab, so this asserts
    // wall-clock termination rather than trusting the cursor guard alone.
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const started = Date.now();
        analyzeRegex({ source, flags: '' });
        expect(Date.now() - started).toBeLessThan(1000);
      }),
      { numRuns: 400, seed: SEED },
    );
  });

  it('always returns a Result rather than throwing or hanging on adversarial shapes', () => {
    const adversarial = [
      '('.repeat(2000),
      '['.repeat(2000),
      '\\'.repeat(2000),
      'a{'.repeat(1000),
      '(?:'.repeat(1000),
      '(a|'.repeat(500),
      '[a-'.repeat(500),
      '*'.repeat(1000),
      '(?<'.repeat(500),
      '\\u{'.repeat(500),
    ];
    for (const source of adversarial) {
      const started = Date.now();
      expect(() => analyzeRegex({ source, flags: '' })).not.toThrow();
      expect(Date.now() - started).toBeLessThan(2000);
    }
  });
});

describe('property — limits are enforced by the domain, not by the UI', () => {
  it('rejects any pattern over the length limit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: LIMITS.regex.pattern + 1, max: LIMITS.regex.pattern + 500 }),
        (length) => {
          const result = analyzeRegex({ source: 'a'.repeat(length), flags: '' });
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.code).toBe('LIMIT_EXCEEDED');
        },
      ),
      { numRuns: 30, seed: SEED },
    );
  });

  it('caps nesting depth instead of overflowing the stack', () => {
    fc.assert(
      fc.property(fc.integer({ min: LIMITS.regex.maxDepth + 1, max: 500 }), (depth) => {
        const analysis = analyseOrNull('('.repeat(depth) + 'a' + ')'.repeat(depth), '');
        expect(analysis).not.toBeNull();
        expect(analysis?.errors.some((error) => error.code === 'LIMIT_EXCEEDED')).toBe(true);
      }),
      { numRuns: 25, seed: SEED },
    );
  });
});

describe('property — span invariants (R-I7)', () => {
  it('keeps every span inside the source and well ordered', () => {
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const analysis = analyseOrNull(source, '');
        if (!analysis) return;

        everyNode(analysis.ast, (node) => {
          expect(node.span.start).toBeGreaterThanOrEqual(0);
          expect(node.span.end).toBeLessThanOrEqual(source.length);
          expect(node.span.start).toBeLessThanOrEqual(node.span.end);
          expect(node.span.line).toBeGreaterThanOrEqual(1);
          expect(node.span.column).toBeGreaterThanOrEqual(1);
        });
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it("covers every child's span with its parent's", () => {
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const analysis = analyseOrNull(source, '');
        if (!analysis) return;

        everyNode(analysis.ast, (node) => {
          for (const child of childrenOf(node)) {
            expect(node.span.start).toBeLessThanOrEqual(child.span.start);
            expect(node.span.end).toBeGreaterThanOrEqual(child.span.end);
          }
        });
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('does not overlap sibling spans', () => {
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const analysis = analyseOrNull(source, '');
        if (!analysis) return;

        everyNode(analysis.ast, (node) => {
          if (node.type !== 'Sequence') return;
          const elements = node.elements;
          for (let index = 1; index < elements.length; index++) {
            const previous = elements[index - 1];
            const current = elements[index];
            if (previous && current) {
              expect(current.span.start).toBeGreaterThanOrEqual(previous.span.end);
            }
          }
        });
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('keeps token spans inside the source, including astral input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40, unit: 'binary' }), (source) => {
        const analysis = analyseOrNull(source, '');
        if (!analysis) return;
        for (const token of analysis.tokens) {
          expect(token.span.start).toBeGreaterThanOrEqual(0);
          expect(token.span.end).toBeLessThanOrEqual(source.length);
          expect(token.span.start).toBeLessThan(token.span.end + 1);
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});

describe('property — structural invariants', () => {
  it('always produces an Alternation root (R-I1)', () => {
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const analysis = analyseOrNull(source, '');
        if (analysis) expect(analysis.ast.type).toBe('Alternation');
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('never nests a Quantifier directly inside a Quantifier (R-I3)', () => {
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const analysis = analyseOrNull(source, '');
        if (!analysis) return;
        everyNode(analysis.ast, (node) => {
          if (node.type === 'Quantifier') expect(node.body.type).not.toBe('Quantifier');
        });
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('keeps quantifier bounds ordered (R-I2)', () => {
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const analysis = analyseOrNull(source, '');
        if (!analysis) return;
        everyNode(analysis.ast, (node) => {
          if (node.type !== 'Quantifier') return;
          expect(node.min).toBeGreaterThanOrEqual(0);
          if (node.max !== null) expect(node.min).toBeLessThanOrEqual(node.max);
        });
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('numbers capture groups contiguously from 1 (R-I4)', () => {
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const analysis = analyseOrNull(source, '');
        if (!analysis) return;
        const numbers = analysis.groups.map((group) => group.number);
        expect(numbers).toEqual(numbers.map((_, index) => index + 1));
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('produces a group entry for every Group node that carries a number', () => {
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const analysis = analyseOrNull(source, '');
        if (!analysis) return;
        const numbered: number[] = [];
        everyNode(analysis.ast, (node) => {
          if (node.type === 'Group' && node.number !== undefined) numbered.push(node.number);
        });
        expect(numbered.sort((a, b) => a - b)).toEqual(analysis.groups.map((g) => g.number));
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});

describe('property — output safety', () => {
  it('produces an explanation for every analysable pattern', () => {
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const analysis = analyseOrNull(source, '');
        if (!analysis) return;
        expect(analysis.explanation.summary.length).toBeGreaterThan(0);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('never echoes an oversized string into an error message', () => {
    // A hostile input must not become a hostile error message
    // (03_DOMAIN_MODEL.md §2.2).
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 2000 }), (length) => {
        const analysis = analyseOrNull('('.repeat(length), '');
        if (!analysis) return;
        for (const error of analysis.errors) {
          expect(error.message.length).toBeLessThan(300);
        }
      }),
      { numRuns: 40, seed: SEED },
    );
  });

  it('emits only explanation node kinds the renderer understands', () => {
    const allowed = new Set(['text', 'code', 'emphasis', 'ref', 'list']);
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const analysis = analyseOrNull(source, '');
        if (!analysis) return;
        for (const node of analysis.explanation.summary) {
          expect(allowed.has(node.kind)).toBe(true);
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});

describe('property — determinism', () => {
  it('produces identical output for identical input', () => {
    // Required for golden tests to mean anything, and for the UI not to
    // flicker between renders.
    fc.assert(
      fc.property(arbitraryPattern, (source) => {
        const first = analyzeRegex({ source, flags: '' });
        const second = analyzeRegex({ source, flags: '' });
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      }),
      { numRuns: 500, seed: SEED },
    );
  });
});
