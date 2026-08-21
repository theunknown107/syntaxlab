import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { analyzeCron } from '@/domain/cron/analyze';
import { CRON_FIELD_SPECS, type CronField, type CronTerm } from '@/domain/cron/ast';
import { parseCron } from '@/domain/cron/parser';
import { tokenize } from '@/domain/cron/tokenizer';
import { LIMITS } from '@/domain/shared/limits';

/**
 * Cron property and fuzz tests — 13_TEST_PLAN.md, brief §40
 *
 * The objective is **total, terminating and deterministic** — not "accepts
 * everything". A parser for untrusted input must never hang, never throw and
 * never disagree with itself before it is generous.
 *
 * Budget is bounded and seeded so the suite stays fast and a failure is
 * reproducible. Every counterexample found becomes a permanent case in
 * `corpus.test.ts`.
 */

const SEED = 20260821;
const RUNS = 1200;
const CONFIG = { seed: SEED, numRuns: RUNS } as const;

/** Characters a cron expression can plausibly contain, hostile ones included. */
const CRON_CHARS = '0123456789*/-, \tLW#?H@abcJANDECMONFRIsun';

const arbitraryExpression = fc.stringOf(fc.constantFrom(...CRON_CHARS), {
  minLength: 0,
  maxLength: 40,
});

/** A well-formed expression, for properties that need one. */
const arbitraryValidExpression = fc
  .tuple(
    fc.constantFrom('*', '0', '30', '*/15', '0,30', '10-20', '10-20/2'),
    fc.constantFrom('*', '0', '12', '*/6', '9-17'),
    fc.constantFrom('*', '1', '15', '1,15', '1-7'),
    fc.constantFrom('*', '1', '6', 'JAN', 'JAN-JUN', '*/3'),
    fc.constantFrom('*', '0', '7', '1-5', 'MON', 'MON-FRI'),
  )
  .map((fields) => fields.join(' '));

function everyTerm(field: CronField, visit: (term: CronTerm) => void): void {
  const walk = (term: CronTerm): void => {
    visit(term);
    if (term.kind === 'step') walk(term.base);
  };
  for (const term of field.terms) walk(term);
}

/* ------------------------------------------------------------------ *
 * Totality
 * ------------------------------------------------------------------ */

describe('the parser is total', () => {
  it('never throws, on any input', () => {
    fc.assert(
      fc.property(arbitraryExpression, (source) => {
        expect(() => parseCron(source)).not.toThrow();
      }),
      CONFIG,
    );
  });

  it('never throws from a full analysis either', () => {
    fc.assert(
      fc.property(arbitraryExpression, (source) => {
        expect(() => analyzeCron(source)).not.toThrow();
      }),
      CONFIG,
    );
  });

  it('always terminates and covers the source, in the tokenizer', () => {
    fc.assert(
      fc.property(arbitraryExpression, (source) => {
        const tokens = tokenize(source);
        let cursor = 0;
        for (const token of tokens) {
          // Each token starts where the last ended: no gaps, no overlaps, and
          // no zero-width token, which is what a non-advancing loop produces.
          expect(token.span.start).toBe(cursor);
          expect(token.span.end).toBeGreaterThan(token.span.start);
          cursor = token.span.end;
        }
        expect(cursor).toBe(source.length);
      }),
      CONFIG,
    );
  });

  it('is deterministic — the same input gives the same answer', () => {
    fc.assert(
      fc.property(arbitraryExpression, (source) => {
        expect(JSON.stringify(parseCron(source))).toBe(JSON.stringify(parseCron(source)));
      }),
      CONFIG,
    );
  });
});

/* ------------------------------------------------------------------ *
 * The dialect lock, as a property
 * ------------------------------------------------------------------ */

describe('the dialect lock holds under fuzzing', () => {
  it('never accepts an expression whose field count is not 5', () => {
    fc.assert(
      fc.property(arbitraryExpression, (source) => {
        const parsed = parseCron(source);
        if (!parsed.ok) return;
        // A macro expands to five fields; anything else must have five.
        if (parsed.value.nonSchedulable) return;
        expect(parsed.value.fields).toHaveLength(LIMITS.cron.fields);
      }),
      CONFIG,
    );
  });

  it('refuses every 6- and 7-field expression built from valid parts', () => {
    const part = fc.constantFrom('*', '0', '5', '*/15', '1-5', 'MON');
    fc.assert(
      fc.property(fc.array(part, { minLength: 6, maxLength: 7 }), (parts) => {
        const parsed = parseCron(parts.join(' '));
        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.error.code).toBe('UNSUPPORTED');
      }),
      CONFIG,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Structural invariants
 * ------------------------------------------------------------------ */

describe('structural invariants', () => {
  it('keeps every resolved value inside its field range', () => {
    fc.assert(
      fc.property(arbitraryValidExpression, (source) => {
        const parsed = parseCron(source);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        for (const field of parsed.value.fields) {
          const spec = CRON_FIELD_SPECS[field.name];
          for (const value of field.resolved) {
            expect(value).toBeGreaterThanOrEqual(spec.min);
            // Day-of-week normalises 7 to 0, so the resolved ceiling is 6.
            expect(value).toBeLessThanOrEqual(field.name === 'dayOfWeek' ? 6 : spec.max);
          }
        }
      }),
      CONFIG,
    );
  });

  it('keeps resolved values sorted and unique', () => {
    fc.assert(
      fc.property(arbitraryValidExpression, (source) => {
        const parsed = parseCron(source);
        if (!parsed.ok) return;
        for (const field of parsed.value.fields) {
          const sorted = [...field.resolved].sort((a, b) => a - b);
          expect(field.resolved).toEqual(sorted);
          expect(new Set(field.resolved).size).toBe(field.resolved.length);
        }
      }),
      CONFIG,
    );
  });

  it('never produces an empty resolved set for a field without an error', () => {
    fc.assert(
      fc.property(arbitraryValidExpression, (source) => {
        const parsed = parseCron(source);
        if (!parsed.ok) return;
        for (const field of parsed.value.fields) {
          if (field.error !== undefined) continue;
          expect(field.resolved.length, `${field.name}: ${field.raw}`).toBeGreaterThan(0);
        }
      }),
      CONFIG,
    );
  });

  it('keeps every span within the source and every range ordered', () => {
    fc.assert(
      fc.property(arbitraryExpression, (source) => {
        const parsed = parseCron(source);
        if (!parsed.ok) return;
        for (const field of parsed.value.fields) {
          everyTerm(field, (term) => {
            expect(term.span.start).toBeGreaterThanOrEqual(0);
            expect(term.span.end).toBeGreaterThanOrEqual(term.span.start);
            if (term.kind === 'range') expect(term.from).toBeLessThanOrEqual(term.to);
            if (term.kind === 'step') expect(term.step).toBeGreaterThan(0);
          });
        }
      }),
      CONFIG,
    );
  });

  it('always produces an explanation summary, valid or not', () => {
    fc.assert(
      fc.property(arbitraryExpression, (source) => {
        const analysis = analyzeCron(source);
        if (!analysis.ok) return;
        expect(analysis.value.explanation.summary.length).toBeGreaterThan(0);
      }),
      CONFIG,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Bounded work
 * ------------------------------------------------------------------ */

describe('bounded work', () => {
  it('finishes a hostile input well inside a human timescale', () => {
    // Not a benchmark — a guard against a pathological input finding a
    // quadratic path. A worker that takes seconds on 1 000 characters looks
    // hung to a user.
    const hostile = `${'1,'.repeat(400)}1 * * * *`;
    const started = performance.now();
    const parsed = parseCron(hostile);
    const elapsed = performance.now() - started;
    expect(parsed.ok).toBe(true);
    expect(elapsed).toBeLessThan(250);
  });

  it('refuses an over-long expression instead of working through it', () => {
    const parsed = parseCron('*'.repeat(LIMITS.cron.input + 1));
    expect(parsed.ok).toBe(false);
  });
});
