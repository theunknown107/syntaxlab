import { describe, expect, it } from 'vitest';
import { analyzeJson } from '@/domain/json/analyze';
import type { JsonAnalysis } from '@/domain/json/ast';
import { isValidJsonAnalysis } from '@/domain/json/validate';
import { decimalParts, unsafeNumberReason } from '@/domain/json/numbers';
import { formatPath, formatPathBracket, isPlainKey, quoteKey } from '@/domain/json/path';
import { parseWorkerRequest, validateResult } from '@/infrastructure/workers/protocol';

/**
 * The JSON half of the worker boundary, plus the two pure helpers a consumer
 * depends on being exactly right.
 *
 * The rule is the one M3 established: a successful response is checked **by
 * value**, never accepted on a TypeScript cast. This tree is more
 * user-shaped than any other result in the product — every key and every span
 * comes from the document — so the offsets the UI will slice with are checked
 * against the source length here rather than clamped later at each consumer.
 */

function analysis(source: string): JsonAnalysis {
  const result = analyzeJson(source);
  if (!result.ok) throw new Error('fixture failed');
  return result.value;
}

const GOOD = '{"a":[1,"x",{"b":null}],"c":true}';

describe('analysis.json requests', () => {
  it('accepts a well-formed request', () => {
    expect(parseWorkerRequest({ id: 3, op: 'analysis.json', payload: { source: '{}' } })).toEqual({
      id: 3,
      op: 'analysis.json',
      payload: { source: '{}' },
    });
  });

  it('rejects a payload with the wrong shape', () => {
    expect(parseWorkerRequest({ id: 1, op: 'analysis.json', payload: {} })).toBeNull();
    expect(parseWorkerRequest({ id: 1, op: 'analysis.json', payload: { source: 42 } })).toBeNull();
    expect(parseWorkerRequest({ id: 1, op: 'analysis.json', payload: null })).toBeNull();
  });

  it('drops unknown wire keys instead of carrying them into the worker', () => {
    const request = parseWorkerRequest({
      id: 1,
      op: 'analysis.json',
      payload: { source: '{}', evil: true },
    });
    expect(Object.keys(request?.payload ?? {})).toEqual(['source']);
  });
});

describe('analysis.json results', () => {
  it('accepts a result the domain produced', () => {
    expect(validateResult('analysis.json', analysis(GOOD))).not.toBeNull();
    expect(validateResult('analysis.json', analysis('not json'))).not.toBeNull();
    expect(validateResult('analysis.json', analysis(''))).not.toBeNull();
  });

  it('rejects a result belonging to another operation', () => {
    expect(validateResult('analysis.json', { kind: 'regex', source: '', flags: {} })).toBeNull();
    expect(validateResult('analysis.regex', analysis(GOOD))).toBeNull();
  });

  it('rejects primitives and near-misses', () => {
    for (const value of [null, undefined, 0, 'json', [], {}, { kind: 'json' }]) {
      expect(isValidJsonAnalysis(value)).toBe(false);
    }
  });
});

describe('a malformed success payload never reaches application state', () => {
  function corrupt(mutate: (value: Record<string, unknown>) => void): unknown {
    const value = structuredClone(analysis(GOOD)) as unknown as Record<string, unknown>;
    mutate(value);
    return value;
  }

  it('rejects a span that points outside the source', () => {
    // The UI slices the document with these offsets. An out-of-range value is
    // refused at the boundary rather than clamped at each of the several
    // places that consume one.
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          value.source = '{}';
        }),
      ),
    ).toBe(false);
  });

  it('rejects a reversed span', () => {
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          (value.cst as { span: { start: number; end: number } }).span = {
            start: 10,
            end: 2,
            line: 1,
            column: 1,
          } as never;
        }),
      ),
    ).toBe(false);
  });

  it('rejects a line or column below one', () => {
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          (value.cst as { span: { line: number } }).span.line = 0;
        }),
      ),
    ).toBe(false);
  });

  it('rejects an unknown node type', () => {
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          (value.cst as { type: string }).type = 'wormhole';
        }),
      ),
    ).toBe(false);
  });

  it('rejects object members arriving as a record rather than an array', () => {
    // If this ever passed, the primary prototype-pollution defence would have
    // been lost upstream — so the shape check is a security check.
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          (value.cst as { members: unknown }).members = { a: 1 };
        }),
      ),
    ).toBe(false);
  });

  it('rejects a member with no key', () => {
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          delete (value.cst as { members: Record<string, unknown>[] }).members[0]?.key;
        }),
      ),
    ).toBe(false);
  });

  it('rejects a malformed path segment', () => {
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          (value.cst as { path: unknown }).path = [{ kind: 'wat' }];
        }),
      ),
    ).toBe(false);
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          (value.cst as { path: unknown }).path = [{ kind: 'index', index: -1 }];
        }),
      ),
    ).toBe(false);
  });

  it('rejects negative or fractional stats', () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(
        isValidJsonAnalysis(
          corrupt((value) => {
            (value.stats as Record<string, number>).nodeCount = bad;
          }),
        ),
      ).toBe(false);
    }
  });

  it('rejects a missing stats field', () => {
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          delete (value.stats as Record<string, unknown>).byteLength;
        }),
      ),
    ).toBe(false);
  });

  it('rejects a duplicate report with no occurrences', () => {
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          value.duplicateKeys = [{ path: [], key: 'a', occurrences: [] }];
        }),
      ),
    ).toBe(false);
  });

  it('rejects an unknown unsafe-number reason', () => {
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          value.unsafeNumbers = [
            {
              path: [],
              raw: '1',
              parsed: 1,
              span: { start: 0, end: 1, line: 1, column: 1 },
              reason: 'VIBES',
            },
          ];
        }),
      ),
    ).toBe(false);
  });

  it('rejects an explanation node of an unknown kind', () => {
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          (value.explanation as { summary: unknown }).summary = [{ kind: 'html', value: '<b>' }];
        }),
      ),
    ).toBe(false);
  });

  it('rejects a document claiming to be valid while carrying errors', () => {
    // The two would contradict each other in the UI.
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          value.errors = [{ code: 'SYNTAX', message: 'x' }];
        }),
      ),
    ).toBe(false);
  });

  it('rejects an error that is not an error', () => {
    expect(
      isValidJsonAnalysis(
        corrupt((value) => {
          value.valid = false;
          value.errors = [{ message: 'no code' }];
        }),
      ),
    ).toBe(false);
  });

  it('does not accept a prototype-polluting payload', () => {
    const payload: unknown = JSON.parse(
      // `String.replace` with a string pattern already replaces only the
      // first occurrence, which is the one that matters here.
      JSON.stringify(analysis('{}')).replace('{', '{"__proto__":{"polluted":true},'),
    );
    isValidJsonAnalysis(payload);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('validates a large document without walking every node', () => {
    // The budget exists so validation cannot cost more than the parse did.
    const big = `[${Array.from({ length: 20_000 }, (_, i) => i).join(',')}]`;
    const started = Date.now();
    expect(isValidJsonAnalysis(analysis(big))).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('path formatting', () => {
  it('uses dot notation where a key allows it', () => {
    expect(
      formatPath([
        { kind: 'key', key: 'user' },
        { kind: 'index', index: 2 },
      ]),
    ).toBe('$.user[2]');
  });

  it('always uses brackets in the bracket form', () => {
    expect(formatPathBracket([{ kind: 'key', key: 'user' }])).toBe('$["user"]');
  });

  it('falls back to brackets for keys dot notation cannot express', () => {
    const cases: [string, string][] = [
      ['a.b', '$["a.b"]'],
      ['a b', '$["a b"]'],
      ['2', '$["2"]'],
      ['', '$[""]'],
      ['a-b', '$["a-b"]'],
      ['a[0]', '$["a[0]"]'],
      ['quote"key', '$["quote\\"key"]'],
      ['back\\slash', '$["back\\\\slash"]'],
      ['new\nline', '$["new\\nline"]'],
      ['tab\there', '$["tab\\there"]'],
    ];
    for (const [key, expected] of cases) {
      expect(formatPath([{ kind: 'key', key }])).toBe(expected);
    }
  });

  it('accepts identifier-like keys as plain', () => {
    for (const key of ['a', '_a', '$a', 'aB9', '__proto__']) expect(isPlainKey(key)).toBe(true);
    for (const key of ['', '9a', 'a b', 'a-b', 'é']) expect(isPlainKey(key)).toBe(false);
  });

  it('escapes control characters and lone surrogates rather than emitting them', () => {
    expect(quoteKey('')).toBe('"\\u0001"');
    expect(quoteKey('\uD800')).toBe('"\\ud800"');
    expect(quoteKey('\b\f')).toBe('"\\b\\f"');
  });

  it('leaves ordinary non-ASCII text readable', () => {
    expect(quoteKey('café')).toBe('"café"');
    expect(quoteKey('中文')).toBe('"中文"');
  });
});

describe('number faithfulness', () => {
  it('normalises formatting differences away', () => {
    expect(decimalParts('1e5')).toEqual(decimalParts('100000'));
    expect(decimalParts('1.50')).toEqual(decimalParts('1.5'));
    expect(decimalParts('0.0')).toEqual(decimalParts('0'));
    expect(decimalParts('-0')).toEqual(decimalParts('0'));
  });

  it('rejects text that is not a decimal literal', () => {
    for (const text of ['', 'abc', '0x10', '1e', '.', '--1']) {
      expect(decimalParts(text)).toBeNull();
    }
  });

  it('flags only numbers that genuinely change', () => {
    // Converted from text rather than written as a literal: the literal would
    // lose the digit at compile time, which is the very effect under test.
    const unsafeInteger = '9007199254740993';
    expect(unsafeNumberReason(unsafeInteger, Number(unsafeInteger))).toBe('PRECISION_LOSS');
    expect(unsafeNumberReason('1e400', Number('1e400'))).toBe('OVERFLOW');
    expect(unsafeNumberReason('-0', -0)).toBe('NEGATIVE_ZERO');
  });

  it('does not flag numbers that round-trip', () => {
    // The two cases a digit-counting heuristic gets wrong.
    for (const raw of [
      '0.1',
      '1e5',
      '0',
      '-1.5e-3',
      '9007199254740991',
      '1.7976931348623157e308',
    ]) {
      expect(unsafeNumberReason(raw, Number(raw))).toBeNull();
    }
  });
});
