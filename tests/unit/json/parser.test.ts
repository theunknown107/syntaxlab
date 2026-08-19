import { describe, expect, it } from 'vitest';
import { LIMITS } from '@/domain/shared/limits';
import type { JsonNode } from '@/domain/json/ast';
import { parseJson } from '@/domain/json/parser';
import { formatPath } from '@/domain/json/path';

/**
 * Parser structure and error behaviour.
 *
 * Validity itself is covered differentially against `JSON.parse`; what is
 * tested here is everything the platform parser cannot tell us — where a node
 * is, what its path is, how many errors we recovered from, and whether the
 * message names the actual rule that was broken.
 */

function parse(source: string) {
  return parseJson(source);
}

function root(source: string): JsonNode {
  const result = parse(source);
  if (!result.root) throw new Error(`no root for ${source}`);
  return result.root;
}

function messages(source: string): string[] {
  return parse(source).errors.map((error) => error.message);
}

describe('scalars at the root', () => {
  it.each([
    ['null', 'null'],
    ['true', 'boolean'],
    ['false', 'boolean'],
    ['0', 'number'],
    ['-1.5e3', 'number'],
    ['"text"', 'string'],
  ])('%s parses as %s', (source, type) => {
    const node = root(source);
    expect(node.type).toBe(type);
    expect(parse(source).errors).toEqual([]);
  });

  it('spans the whole value', () => {
    expect(root('  12.5  ').span).toMatchObject({ start: 2, end: 6 });
  });

  it('gives the root an empty path', () => {
    expect(root('1').path).toEqual([]);
    expect(formatPath(root('1').path)).toBe('$');
  });
});

describe('objects', () => {
  it('parses an empty object', () => {
    const node = root('{}');
    expect(node).toMatchObject({ type: 'object' });
    if (node.type !== 'object') throw new Error('wrong type');
    expect(node.members).toEqual([]);
  });

  it('keeps members in source order, as an array', () => {
    const node = root('{"b":1,"a":2}');
    if (node.type !== 'object') throw new Error('wrong type');
    // Order preserved, and integer-like keys are not reordered the way a
    // JavaScript object would reorder them.
    expect(node.members.map((member) => member.key)).toEqual(['b', 'a']);
  });

  it('does not reorder integer-like keys', () => {
    const node = root('{"2":"two","1":"one"}');
    if (node.type !== 'object') throw new Error('wrong type');
    expect(node.members.map((member) => member.key)).toEqual(['2', '1']);
  });

  it('records the key span separately from the member span', () => {
    const node = root('{"ab":12}');
    if (node.type !== 'object') throw new Error('wrong type');
    const member = node.members[0];
    expect(member?.keySpan).toMatchObject({ start: 1, end: 5 });
    expect(member?.span).toMatchObject({ start: 1, end: 8 });
    expect(member?.keyRaw).toBe('"ab"');
  });

  it('decodes escaped keys but keeps the raw text', () => {
    const node = root('{"a\\u0042c":1}');
    if (node.type !== 'object') throw new Error('wrong type');
    expect(node.members[0]?.key).toBe('aBc');
    expect(node.members[0]?.keyRaw).toBe('"a\\u0042c"');
  });

  it('nests', () => {
    const node = root('{"a":{"b":{"c":1}}}');
    expect(parse('{"a":{"b":{"c":1}}}').maxDepth).toBe(3);
    if (node.type !== 'object') throw new Error('wrong type');
    expect(formatPath(node.members[0]?.value.path ?? [])).toBe('$.a');
  });
});

describe('arrays', () => {
  it('parses an empty array', () => {
    const node = root('[]');
    if (node.type !== 'array') throw new Error('wrong type');
    expect(node.elements).toEqual([]);
  });

  it('indexes elements in order', () => {
    const node = root('[10,20,30]');
    if (node.type !== 'array') throw new Error('wrong type');
    expect(node.elements.map((element) => formatPath(element.path))).toEqual([
      '$[0]',
      '$[1]',
      '$[2]',
    ]);
  });

  it('mixes types', () => {
    const node = root('[1,"a",true,null,[],{}]');
    if (node.type !== 'array') throw new Error('wrong type');
    expect(node.elements.map((element) => element.type)).toEqual([
      'number',
      'string',
      'boolean',
      'null',
      'array',
      'object',
    ]);
  });

  it('does not accept holes the way a JavaScript array literal would', () => {
    // `[1,,2]` is a valid JS array literal with a hole. It is not JSON.
    expect(messages('[1,,2]').length).toBeGreaterThan(0);
  });
});

describe('paths', () => {
  it('builds the accessor chain through both containers', () => {
    const node = root('{"user":{"items":[{"name":"x"}]}}');
    if (node.type !== 'object') throw new Error('wrong');
    const items = node.members[0]?.value;
    if (items?.type !== 'object') throw new Error('wrong');
    const array = items.members[0]?.value;
    if (array?.type !== 'array') throw new Error('wrong');
    const first = array.elements[0];
    if (first?.type !== 'object') throw new Error('wrong');

    expect(formatPath(first.members[0]?.value.path ?? [])).toBe('$.user.items[0].name');
  });

  it('falls back to bracket notation for keys dot notation cannot express', () => {
    const node = root('{"a.b":1,"has space":2,"2":3}');
    if (node.type !== 'object') throw new Error('wrong');
    expect(node.members.map((member) => formatPath(member.value.path))).toEqual([
      '$["a.b"]',
      '$["has space"]',
      '$["2"]',
    ]);
  });
});

describe('errors name the rule that was broken', () => {
  it.each([
    ['{"a":1,}', /Trailing comma before `}`/],
    ['[1,]', /Trailing comma before `\]`/],
    ["{'a':1}", /double quotes/],
    ['{a:1}', /Object keys must be quoted strings/],
    ['// c\n1', /Comments are not valid JSON/],
    ['/* c */1', /Comments are not valid JSON/],
    ['{"a":undefined}', /`undefined` is not a JSON value/],
    ['{"a":NaN}', /`NaN` is not a JSON value/],
    ['{"a":Infinity}', /`Infinity` is not a JSON value/],
    ['{"a":None}', /Python/],
    ['{"a" 1}', /Expected `:` after an object key/],
    ['{"a":1 "b":2}', /Expected a comma or `}`/],
    ['[1 2]', /Expected a comma or `\]`/],
    ['{"a":1', /never closed/],
    ['[1', /never closed/],
    ['"unterminated', /never closed/],
    ['01', /leading zeros/],
    ['1.', /decimal point must be followed/],
    ['.5', /Unexpected character/],
    ['1e', /exponent must be followed/],
    ['1e+', /exponent must be followed/],
    ['+1', /leading `\+`/],
    ['"\\x41"', /not a valid JSON escape/],
    ['"\\u12"', /exactly four hexadecimal digits/],
    ['', /The document is empty/],
    ['{} {}', /more content after the end/],
    ['TRUE', /lower case/],
  ])('%s', (source, expected) => {
    const found = messages(source);
    expect(found.length).toBeGreaterThan(0);
    expect(found.join(' | ')).toMatch(expected);
  });

  it('reports a raw control character inside a string', () => {
    expect(messages('"a\tb"').join(' ')).toMatch(/raw control character/);
  });

  it('carries a span and a line for every error', () => {
    for (const error of parse('{"a" 1, "b": }').errors) {
      expect(error.span?.line).toBeGreaterThanOrEqual(1);
      expect(error.span?.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('reports the line a multi-line document failed on', () => {
    const error = parse('{\n  "a": 1,\n  "b": ?\n}').errors[0];
    expect(error?.span?.line).toBe(3);
  });

  it('does not echo a huge hostile token into the message', () => {
    const error = parse(`{${'x'.repeat(5000)}:1}`).errors[0];
    expect(error?.message.length).toBeLessThan(200);
  });

  it('never includes a stack trace', () => {
    for (const source of ['{', '[', '"', '{"a"', 'nope']) {
      for (const error of parse(source).errors) {
        expect(error.message).not.toMatch(/\bat \w+|\.ts:\d|\.js:\d/);
      }
    }
  });
});

describe('error recovery', () => {
  it('keeps parsing after a bad member', () => {
    const result = parse('{"a": ?, "b": 2}');
    expect(result.errors.length).toBeGreaterThan(0);
    const node = result.root;
    if (node?.type !== 'object') throw new Error('expected an object');
    // The point of recovery: `b` is still there to explain.
    expect(node.members.map((member) => member.key)).toContain('b');
  });

  it('keeps parsing after a bad array element', () => {
    const result = parse('[1, ?, 3]');
    const node = result.root;
    if (node?.type !== 'array') throw new Error('expected an array');
    expect(node.elements.length).toBeGreaterThanOrEqual(2);
  });

  it('caps a cascade rather than reporting one error per token', () => {
    const result = parse(`[${'?,'.repeat(500)}]`);
    expect(result.errors.length).toBeLessThanOrEqual(24);
  });
});

describe('limits', () => {
  it('reports depth rather than overflowing the stack', () => {
    const depth = LIMITS.json.maxDepth + 50;
    const result = parse('['.repeat(depth) + ']'.repeat(depth));
    expect(result.errors.some((error) => error.code === 'LIMIT_EXCEEDED')).toBe(true);
    expect(result.maxDepth).toBeLessThanOrEqual(LIMITS.json.maxDepth);
  });

  it('reports depth for objects too', () => {
    const depth = LIMITS.json.maxDepth + 50;
    const result = parse('{"a":'.repeat(depth) + '1' + '}'.repeat(depth));
    expect(result.errors.some((error) => error.code === 'LIMIT_EXCEEDED')).toBe(true);
  });

  it('survives nesting far past the limit without a RangeError', () => {
    // A recursive parser dies here. This is the whole reason the parser keeps
    // an explicit stack.
    const result = parse('['.repeat(200_000));
    expect(result.errors.some((error) => error.code === 'LIMIT_EXCEEDED')).toBe(true);
  });

  it('accepts nesting exactly at the limit', () => {
    const depth = LIMITS.json.maxDepth;
    const result = parse('['.repeat(depth) + ']'.repeat(depth));
    expect(result.errors).toEqual([]);
    expect(result.maxDepth).toBe(depth);
  });
});
