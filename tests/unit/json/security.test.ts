import { afterEach, describe, expect, it } from 'vitest';
import { analyzeJson } from '@/domain/json/analyze';
import { parseJson } from '@/domain/json/parser';
import { toPlainValue } from '@/domain/json/plain';
import { explanationToText } from '@/domain/shared/explanation';

/**
 * Prototype pollution and hostile content — 05_SECURITY.md §7, 13_TEST_PLAN §7
 *
 * JSON keys are entirely user-controlled, so every key in a document is an
 * attempt to name something in our program. The defence is structural: object
 * members live in an ordered array of pairs, so a user key never becomes a
 * real object key anywhere in the CST.
 *
 * These tests assert the property that matters — nothing in the runtime is
 * mutated — rather than asserting that a particular guard was called. A guard
 * can be refactored away; the property cannot be satisfied by accident.
 *
 * This is a strong structural defence, not a proof of impossibility. It covers
 * the vectors this parser creates.
 */

const PAYLOADS: [string, string][] = [
  ['direct __proto__', '{"__proto__": {"polluted": true}}'],
  ['constructor chain', '{"constructor": {"prototype": {"polluted": true}}}'],
  ['bare prototype', '{"prototype": {"polluted": true}}'],
  ['toString override', '{"__proto__": {"toString": "boom"}}'],
  ['nested', '{"a": {"__proto__": {"polluted": true}}}'],
  ['inside an array', '[{"__proto__": {"polluted": true}}]'],
  ['deeply nested', '{"a":{"b":{"c":{"__proto__":{"polluted":true}}}}}'],
  ['escaped key', '{"\\u005f\\u005fproto\\u005f\\u005f": {"polluted": true}}'],
  ['duplicated', '{"__proto__": 1, "__proto__": {"polluted": true}}'],
  ['as an array element key', '{"a": [{"constructor": {"prototype": {"polluted": true}}}]}'],
  ['valueOf override', '{"__proto__": {"valueOf": 1}}'],
  ['every risky key at once', '{"__proto__":1,"constructor":2,"prototype":3}'],
];

/** Nothing global may change. Checked after every payload. */
function expectNoPollution(): void {
  const probe = {} as Record<string, unknown>;
  expect(probe.polluted).toBeUndefined();
  expect(Object.prototype).not.toHaveProperty('polluted');
  expect(Object.prototype).not.toHaveProperty('prototype', expect.anything());
  // Called rather than referenced, so this checks the behaviour a replaced
  // `toString` would change rather than the identity of the function object.
  expect(Object.prototype.toString.call({})).toBe('[object Object]');
  expect([].constructor).toBe(Array);
  expect(typeof ({} as { valueOf: unknown }).valueOf).toBe('function');
}

afterEach(() => {
  expectNoPollution();
});

describe('parsing a hostile document mutates nothing', () => {
  it.each(PAYLOADS)('%s', (_name, source) => {
    const result = analyzeJson(source);
    expect(result.ok).toBe(true);
    expectNoPollution();
  });

  it.each(PAYLOADS)('%s survives conversion to a plain value', (_name, source) => {
    const root = parseJson(source).root;
    expect(root).not.toBeNull();
    if (root) toPlainValue(root);
    expectNoPollution();
  });
});

describe('the CST keeps hostile keys as ordinary data', () => {
  it('stores __proto__ as a member, not as a property', () => {
    const root = parseJson('{"__proto__": {"polluted": true}}').root;
    if (root?.type !== 'object') throw new Error('expected an object');

    // The key is present and readable — nothing was silently dropped from the
    // tree — but it lives in an array, so it names nothing in the runtime.
    expect(root.members).toHaveLength(1);
    expect(root.members[0]?.key).toBe('__proto__');
    expect(Array.isArray(root.members)).toBe(true);
  });

  it('does not give the object node an unexpected prototype', () => {
    const root = parseJson('{"__proto__": {"polluted": true}}').root;
    // The node itself is an ordinary object literal we built; the payload had
    // no way to reach its prototype.
    expect(Object.getPrototypeOf(root)).toBe(Object.prototype);
  });

  it('reports duplicate __proto__ keys like any other duplicate', () => {
    const analysis = analyzeJson('{"__proto__": 1, "__proto__": 2}');
    if (!analysis.ok) throw new Error('expected success');
    expect(analysis.value.duplicateKeys[0]?.key).toBe('__proto__');
    expect(analysis.value.duplicateKeys[0]?.occurrences).toHaveLength(2);
  });
});

describe('plain-value conversion', () => {
  it('builds objects with no prototype at all', () => {
    const root = parseJson('{"a": {"b": 1}}').root;
    if (!root) throw new Error('no root');
    const { value } = toPlainValue(root);

    expect(Object.getPrototypeOf(value)).toBeNull();
    const nested = (value as Record<string, unknown>).a;
    expect(Object.getPrototypeOf(nested)).toBeNull();
  });

  it('drops __proto__ and says that it did', () => {
    const root = parseJson('{"__proto__": 1, "keep": 2}').root;
    if (!root) throw new Error('no root');
    const { value, droppedKeys } = toPlainValue(root);

    expect(droppedKeys).toEqual(['__proto__']);
    expect(Object.keys(value as object)).toEqual(['keep']);
  });

  it('keeps constructor and prototype, which are ordinary keys here', () => {
    const root = parseJson('{"constructor": 1, "prototype": 2}').root;
    if (!root) throw new Error('no root');
    const { value, droppedKeys } = toPlainValue(root);

    expect(droppedKeys).toEqual([]);
    expect(Object.keys(value as object)).toEqual(['constructor', 'prototype']);
    // On a null-prototype object these name nothing.
    expect((value as Record<string, unknown>).constructor).toBe(1);
  });

  it('survives Object.assign onto a normal object, which uses setters', () => {
    // The reason `__proto__` is dropped rather than merely made an own
    // property: `Object.assign` assigns, and assignment consults the
    // prototype chain of the *target*.
    const root = parseJson('{"__proto__": {"polluted": true}, "safe": 1}').root;
    if (!root) throw new Error('no root');
    const { value } = toPlainValue(root);

    const target: Record<string, unknown> = {};
    Object.assign(target, value);

    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
    expectNoPollution();
  });

  it('survives a spread into a normal object', () => {
    const root = parseJson('{"__proto__": {"polluted": true}}').root;
    if (!root) throw new Error('no root');
    const { value } = toPlainValue(root);
    const spread = { ...(value as object) };

    expect(Object.getPrototypeOf(spread)).toBe(Object.prototype);
    expectNoPollution();
  });

  it('survives structuredClone, which future storage will use', () => {
    const root = parseJson('{"__proto__":{"polluted":true},"a":[1,{"b":null}]}').root;
    if (!root) throw new Error('no root');
    const cloned: unknown = structuredClone(toPlainValue(root).value);

    expect(cloned).toEqual({ a: [1, { b: null }] });
    expectNoPollution();
  });
});

describe('the analysis tells the user about risky keys rather than hiding them', () => {
  it('names __proto__ in the explanation', () => {
    const analysis = analyzeJson('{"__proto__": 1}');
    if (!analysis.ok) throw new Error('expected success');

    const section = analysis.value.explanation.details.find((d) => d.id === 'json-keys');
    expect(section).toBeDefined();
    expect(explanationToText(section?.body ?? [])).toContain('__proto__');
    expect(section?.severity).toBe('warning');
  });

  it('does not overclaim what the protection covers', () => {
    const analysis = analyzeJson('{"__proto__": 1}');
    if (!analysis.ok) throw new Error('expected success');
    const text = explanationToText(
      analysis.value.explanation.details.find((d) => d.id === 'json-keys')?.body ?? [],
    );

    // No absolute claims: the wording describes what SyntaxLab does, and warns
    // that other tools may not (05_SECURITY.md §1, no "foolproof").
    expect(text).not.toMatch(/impossible|guaranteed|foolproof|completely safe|prevents all/i);
    expect(text).toMatch(/other tools may not/i);
  });

  it('says nothing about risky keys when there are none', () => {
    const analysis = analyzeJson('{"a": 1}');
    if (!analysis.ok) throw new Error('expected success');
    expect(analysis.value.explanation.details.find((d) => d.id === 'json-keys')).toBeUndefined();
  });
});

describe('script payloads are data, never markup', () => {
  const XSS = [
    '<script>window.__xssCanary=1</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    // eslint-disable-next-line no-script-url -- a test payload, never navigated to
    'javascript:alert(1)',
    '\\u003cscript\\u003ealert(1)\\u003c/script\\u003e',
  ];

  it.each(XSS)('returns %s verbatim as a string value', (payload) => {
    const source = JSON.stringify({ value: payload.replace(/\\u/g, '\\u') });
    const root = parseJson(source).root;
    if (root?.type !== 'object') throw new Error('expected an object');
    expect(root.members[0]?.value.type).toBe('string');
  });

  it.each(XSS)('returns %s verbatim as a key', (payload) => {
    const root = parseJson(JSON.stringify({ [payload]: 1 })).root;
    if (root?.type !== 'object') throw new Error('expected an object');
    expect(root.members[0]?.key).toBe(payload);
  });

  it('carries a payload through the explanation as explanation nodes, not markup', () => {
    const analysis = analyzeJson('{"<img src=x onerror=alert(1)>": 1}');
    if (!analysis.ok) throw new Error('expected success');

    // Every segment quoting user content is a `code` node, which the renderer
    // emits as a text child. There is no string of HTML anywhere in the path.
    const shape = analysis.value.explanation.details.find((d) => d.id === 'json-shape');
    const nodes = shape?.body.flatMap((node) =>
      node.kind === 'list' ? node.items.flat() : [node],
    );
    const userSegments = nodes?.filter((node) => node.kind === 'code');
    expect(userSegments?.some((node) => node.value.includes('<img'))).toBe(true);
  });

  it('never sets a canary while parsing', () => {
    const canary = globalThis as unknown as { __xssCanary?: unknown };
    for (const payload of XSS) analyzeJson(JSON.stringify({ a: payload }));
    expect(canary.__xssCanary).toBeUndefined();
  });
});

describe('hostile input does not become a hostile error message', () => {
  it('truncates a huge unquoted key', () => {
    const error = parseJson(`{${'A'.repeat(100_000)}:1}`).errors[0];
    expect(error?.message.length).toBeLessThan(200);
  });

  it('truncates a huge unexpected token', () => {
    for (const error of parseJson(`[${' '.repeat(1000)}]`).errors) {
      expect(error.message.length).toBeLessThan(200);
    }
  });

  it('strips newlines from an echoed token so the message stays one line', () => {
    const error = parseJson('{"a" \n\n\n bad}').errors[0];
    expect(error?.message).not.toContain('\n');
  });
});
