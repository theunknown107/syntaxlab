import { describe, expect, it } from 'vitest';
import { executeRegex } from '@/domain/regex/execute';
import { isValidRegexExecResult } from '@/domain/regex/validate';
import { parseWorkerRequest, validateResult } from '@/infrastructure/workers/protocol';

/**
 * The execution half of the worker boundary.
 *
 * The rule this enforces is the one M3 established and M4 extends to a second
 * operation: a successful response is checked **by value**, not accepted on
 * the strength of a TypeScript cast. Offsets in an execution result are used
 * to slice the subject and to place editor decorations, so an out-of-range
 * number here would not be a cosmetic problem.
 */

function goodResult() {
  const result = executeRegex({ source: '(a)(b)?', flags: 'gd', subject: 'ab a' });
  if (!result.ok) throw new Error('fixture failed');
  return result.value;
}

describe('exec.regex requests', () => {
  it('accepts a well-formed request', () => {
    const request = parseWorkerRequest({
      id: 1,
      op: 'exec.regex',
      payload: { source: 'a', flags: 'g', subject: 'aaa' },
    });
    expect(request).toEqual({
      id: 1,
      op: 'exec.regex',
      payload: { source: 'a', flags: 'g', subject: 'aaa' },
    });
  });

  it('rejects a payload with a missing or mistyped field', () => {
    expect(parseWorkerRequest({ id: 1, op: 'exec.regex', payload: { source: 'a' } })).toBeNull();
    expect(
      parseWorkerRequest({
        id: 1,
        op: 'exec.regex',
        payload: { source: 'a', flags: 'g', subject: 7 },
      }),
    ).toBeNull();
  });

  it('drops unknown wire keys instead of carrying them into the worker', () => {
    const request = parseWorkerRequest({
      id: 1,
      op: 'exec.regex',
      payload: { source: 'a', flags: '', subject: 'a', extra: 'ignored' },
      rogue: true,
    });
    expect(request).not.toBeNull();
    expect(Object.keys(request?.payload ?? {})).toEqual(['source', 'flags', 'subject']);
    expect(Object.keys(request ?? {})).toEqual(['id', 'op', 'payload']);
  });
});

describe('exec.regex results', () => {
  it('accepts a result the domain produced', () => {
    expect(validateResult('exec.regex', goodResult())).not.toBeNull();
  });

  it('rebuilds the result field by field, dropping unknown keys', () => {
    const contaminated = {
      ...goodResult(),
      injected: 'should not survive',
      matches: [{ ...goodResult().matches[0], injected: 'nor should this' }],
    };

    const validated = validateResult('exec.regex', contaminated);
    expect(validated).not.toBeNull();
    expect(validated).not.toHaveProperty('injected');
    expect(validated?.matches[0]).not.toHaveProperty('injected');
  });

  it('preserves the fields that matter', () => {
    const original = goodResult();
    const validated = validateResult('exec.regex', original);

    expect(validated?.matches.map((m) => [m.start, m.end])).toEqual(
      original.matches.map((m) => [m.start, m.end]),
    );
    expect(validated?.matches[0]?.captures).toEqual(original.matches[0]?.captures);
    expect(validated?.hasIndices).toBe(true);
  });

  it('rejects an offset outside the subject', () => {
    // The UI slices the subject and places decorations with these numbers, so
    // an out-of-range value is rejected here rather than clamped at each of
    // the several places that consume one.
    const bad = { ...goodResult(), subjectLength: 2 };
    expect(validateResult('exec.regex', bad)).toBeNull();
  });

  it('rejects a match whose end precedes its start', () => {
    const result = goodResult();
    const bad = {
      ...result,
      matches: [{ ...result.matches[0], start: 3, end: 1 }],
    };
    expect(isValidRegexExecResult(bad)).toBe(false);
  });

  it('rejects a clipped value longer than the length it claims', () => {
    const result = goodResult();
    const bad = {
      ...result,
      matches: [{ ...result.matches[0], value: 'abcdef', length: 2 }],
    };
    expect(isValidRegexExecResult(bad)).toBe(false);
  });

  it('rejects an unknown truncation reason', () => {
    expect(isValidRegexExecResult({ ...goodResult(), truncated: 'whatever' })).toBe(false);
  });

  it('rejects a result belonging to another operation', () => {
    expect(validateResult('exec.regex', { pong: true, sentAt: 1, receivedAt: 2 })).toBeNull();
    expect(validateResult('exec.spin', goodResult())).toBeNull();
  });

  it('rejects primitives and hostile shapes', () => {
    for (const value of [null, undefined, 42, 'ok', [], { kind: 'regexExec' }]) {
      expect(isValidRegexExecResult(value)).toBe(false);
    }
  });

  it('does not accept a prototype-polluting payload', () => {
    const payload = JSON.parse(
      '{"kind":"regexExec","matches":[],"truncated":"none","findsAll":true,"hasIndices":false,"subjectLength":0,"elapsedMs":0,"__proto__":{"polluted":true}}',
    ) as unknown;

    const validated = validateResult('exec.regex', payload);
    expect(validated).not.toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
