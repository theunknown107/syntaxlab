import { describe, expect, it } from 'vitest';
import { analyzeJson } from '@/domain/json/analyze';
import { explanationToText } from '@/domain/shared/explanation';

/**
 * Golden corpus — 04_PARSER_ARCHITECTURE.md §5.4, 13_TEST_PLAN.md
 *
 * Every expectation here has been read by a person. Validity has an oracle
 * (`JSON.parse`, in `differential.test.ts`); *wording* has none, so this file
 * is the only thing standing between a refactor and an explanation that is
 * technically correct and useless.
 *
 * A diff in this file is a product change, not an incidental one.
 *
 * Organised by what is being explained rather than by document size, so the
 * corpus is meaningful coverage rather than a hundred variations of `{"a":1}`.
 */

function summaryOf(source: string): string {
  const result = analyzeJson(source);
  if (!result.ok) throw new Error(`failed: ${result.error.message}`);
  return explanationToText(result.value.explanation.summary);
}

function sectionOf(source: string, id: string): string {
  const result = analyzeJson(source);
  if (!result.ok) throw new Error(`failed: ${result.error.message}`);
  const found = result.value.explanation.details.find((detail) => detail.id === id);
  return found === undefined ? '' : explanationToText(found.body);
}

function firstError(source: string): string {
  const result = analyzeJson(source);
  if (!result.ok) return result.error.message;
  return result.value.errors[0]?.message ?? '';
}

function hintFor(source: string): string {
  const result = analyzeJson(source);
  if (!result.ok) return result.error.hint ?? '';
  return result.value.errors[0]?.hint ?? '';
}

interface GoldenCase {
  readonly source: string;
  readonly summary: string;
}

function runCases(name: string, cases: readonly GoldenCase[]): void {
  describe(name, () => {
    it.each(cases)('$source', ({ source, summary }) => {
      expect(summaryOf(source)).toBe(summary);
    });
  });
}

/* ---------------- valid: primitives ---------------- */

runCases('golden — root primitives', [
  { source: 'null', summary: 'This is the value null.' },
  { source: 'true', summary: 'This is a single boolean: true.' },
  { source: 'false', summary: 'This is a single boolean: false.' },
  { source: '0', summary: 'This is a single number: 0.' },
  { source: '-1.5e-3', summary: 'This is a single number: -1.5e-3.' },
  { source: '"hello"', summary: 'This is a single string: hello.' },
  { source: '""', summary: 'This is a single string: .' },
]);

/* ---------------- valid: containers ---------------- */

runCases('golden — containers', [
  { source: '{}', summary: 'This is an empty object.' },
  { source: '[]', summary: 'This is an empty array.' },
  { source: '{"a":1}', summary: 'This is an object with 1 property.' },
  { source: '{"a":1,"b":2,"c":3}', summary: 'This is an object with 3 properties.' },
  { source: '[1,2,3]', summary: 'This is an array of 3 items, all numbers.' },
  { source: '["a"]', summary: 'This is an array of 1 item, all strings.' },
  { source: '[1,"a",true]', summary: 'This is an array of 3 items, of mixed types.' },
  { source: '[{},{}]', summary: 'This is an array of 2 items, all objects.' },
  {
    source: '{"a":{"b":{"c":1}}}',
    summary: 'This is an object with 1 property, nested 3 levels deep.',
  },
  {
    source: '[[[[1]]]]',
    summary: 'This is an array of 1 item, all arrays, nested 4 levels deep.',
  },
]);

/* ---------------- valid: unicode and escapes ---------------- */

runCases('golden — unicode and escapes', [
  { source: '"caf\\u00e9"', summary: 'This is a single string: café.' },
  { source: '"\\uD83D\\uDE00"', summary: 'This is a single string: \u{1F600}.' },
  { source: '"tab\\there"', summary: 'This is a single string: tab\there.' },
  { source: '"中文"', summary: 'This is a single string: 中文.' },
  { source: '"a\\\\b"', summary: 'This is a single string: a\\b.' },
]);

/* ---------------- the structure line ---------------- */

describe('golden — the structure line', () => {
  it('reports counts, depth, keys and size in one line', () => {
    expect(sectionOf('{"id":1,"name":"Ada","active":true}', 'json-structure')).toBe(
      '4 values · 1 level deep · 3 keys · 35 bytes — 1 object, 1 string, 1 number, 1 boolean',
    );
  });

  it('omits depth for a bare scalar, which has no nesting', () => {
    // "0 levels deep" reads as though something is missing.
    expect(sectionOf('42', 'json-structure')).toBe('1 value · 2 bytes — 1 number');
  });

  it('omits the key count for a document with no objects', () => {
    expect(sectionOf('[1,2]', 'json-structure')).toBe(
      '3 values · 1 level deep · 5 bytes — 1 array, 2 numbers',
    );
  });

  it('counts bytes as UTF-8, not as code units', () => {
    // Four code units, ten bytes: two ASCII quotes plus a four-byte emoji.
    expect(sectionOf('"\u{1F600}"', 'json-structure')).toContain('6 bytes');
  });

  it('does not repeat the summary', () => {
    // The first draft said "The document is an object with 3 properties"
    // directly under a summary saying exactly that.
    const source = '{"a":1,"b":2,"c":3}';
    expect(sectionOf(source, 'json-structure')).not.toContain('object with 3 properties');
  });
});

/* ---------------- the shape section ---------------- */

describe('golden — top-level shape', () => {
  it('names each property with its type', () => {
    expect(sectionOf('{"id":1,"tags":[],"meta":null}', 'json-shape')).toBe(
      'The top level holds these properties:id — number; tags — array; meta — null',
    );
  });

  it('caps the list and says how many were left out', () => {
    const source = `{${Array.from({ length: 14 }, (_, index) => `"k${index}":${index}`).join(',')}}`;
    expect(sectionOf(source, 'json-shape')).toContain('…and 4 more.');
  });

  it('breaks down a mixed array', () => {
    expect(sectionOf('[1,"a",true,null]', 'json-shape')).toBe(
      'At the top level:1 number; 1 string; 1 boolean; 1 null',
    );
  });

  it('says nothing for a homogeneous array, which the summary already covers', () => {
    expect(sectionOf('[1,2,3]', 'json-shape')).toBe('');
  });

  it('says nothing for an empty container', () => {
    expect(sectionOf('{}', 'json-shape')).toBe('');
    expect(sectionOf('[]', 'json-shape')).toBe('');
  });
});

/* ---------------- findings ---------------- */

describe('golden — duplicate keys', () => {
  it('says which key, how many times, and where', () => {
    expect(sectionOf('{"a":1,"a":2}', 'json-duplicates')).toBe(
      'Some keys appear more than once. JSON does not forbid this, but nothing agrees on what it means: ' +
        'JavaScript keeps the last one, some parsers keep the first, and some reject the document outright.' +
        'a appears 2 times at the top level',
    );
  });

  it('reads a nested path as a path', () => {
    expect(sectionOf('{"x":{"a":1,"a":2}}', 'json-duplicates')).toContain(
      'a appears 2 times at $.x',
    );
  });

  it('says nothing when there are no duplicates', () => {
    expect(sectionOf('{"a":1,"b":2}', 'json-duplicates')).toBe('');
  });
});

describe('golden — numbers that change when read', () => {
  it('names the value, the position and what it becomes', () => {
    expect(sectionOf('{"id":9007199254740993}', 'json-numbers')).toBe(
      'JavaScript stores every JSON number as a 64-bit float. These do not survive that intact:' +
        '9007199254740993 at $.id — reads back as 9007199254740992. ' +
        'JavaScript stores this as a 64-bit float, which cannot hold every digit. Reading it back gives a different number.' +
        'Where these are identifiers rather than quantities, keep them as strings.',
    );
  });

  it('explains an overflow without the identifier advice, which does not apply', () => {
    const body = sectionOf('{"huge":1e400}', 'json-numbers');
    expect(body).toContain('reads back as Infinity');
    expect(body).not.toContain('keep them as strings');
  });

  it('explains negative zero without the identifier advice', () => {
    const body = sectionOf('{"z":-0}', 'json-numbers');
    expect(body).toContain('the sign is lost');
    expect(body).not.toContain('keep them as strings');
  });

  it('says nothing about numbers that survive intact', () => {
    // The two cases a digit-counting heuristic would wrongly flag.
    expect(sectionOf('{"a":0.1}', 'json-numbers')).toBe('');
    expect(sectionOf('{"a":1e5}', 'json-numbers')).toBe('');
    expect(sectionOf('{"a":9007199254740991}', 'json-numbers')).toBe('');
    expect(sectionOf('{"a":-1.5e-3}', 'json-numbers')).toBe('');
  });
});

describe('golden — keys JavaScript treats specially', () => {
  it('distinguishes a key that is dropped from one that is kept', () => {
    expect(sectionOf('{"__proto__":1}', 'json-keys')).toContain(
      '__proto__ at the top level — kept in the tree, and removed if this document is converted to a JavaScript object.',
    );
    expect(sectionOf('{"constructor":1}', 'json-keys')).toContain(
      'constructor at the top level — kept, but some libraries treat this name specially.',
    );
  });

  it('says what SyntaxLab does without claiming it protects anyone else', () => {
    expect(sectionOf('{"__proto__":1}', 'json-keys')).toContain(
      'ordered list of key/value pairs rather than as JavaScript objects',
    );
  });
});

/* ---------------- invalid documents ---------------- */

describe('golden — invalid documents explain the actual rule', () => {
  it.each([
    [
      '{"a":1,}',
      'Trailing comma before `}`.',
      'JSON forbids trailing commas. JavaScript and JSON5 allow them.',
    ],
    [
      '[1,]',
      'Trailing comma before `]`.',
      'JSON forbids trailing commas. JavaScript and JSON5 allow them.',
    ],
    [
      "{'a':1}",
      'Strings must use double quotes.',
      'JSON does not allow single quotes. JavaScript and JSON5 do — replace `\'` with `"`.',
    ],
    ['{a:1}', 'Object keys must be quoted strings.', 'Write `"a"` rather than `a`.'],
    [
      '{"a":1}// tail',
      'Comments are not valid JSON.',
      'Strict JSON has no comments. JSONC and JSON5 allow them — remove this one, or use a tool that supports those.',
    ],
    [
      '{"a":undefined}',
      '`undefined` is not a JSON value.',
      'Use `null`, or leave the property out entirely.',
    ],
    ['{"a":NaN}', '`NaN` is not a JSON value.', 'Use `null`, or a string such as `"NaN"`.'],
    [
      '{"a":01}',
      'Numbers may not have leading zeros.',
      'Write `0` on its own, or remove the leading zero.',
    ],
    [
      '1.',
      'A decimal point must be followed by at least one digit.',
      'Write `1.0` rather than `1.`.',
    ],
    ['1e', 'An exponent must be followed by at least one digit.', 'Write `1e10` rather than `1e`.'],
    ['+1', 'A leading `+` is not allowed on a JSON number.', 'Write `1` rather than `+1`.'],
    [
      '"\\x41"',
      '`\\x` is not a valid JSON escape.',
      'JSON allows `\\" \\\\ \\/ \\b \\f \\n \\r \\t` and `\\uXXXX`.',
    ],
    [
      '"\\u12"',
      'A `\\u` escape needs exactly four hexadecimal digits.',
      'For example `\\u00e9`. Pad shorter values with zeros.',
    ],
    [
      '"abc',
      'The string starting on line 1 is never closed.',
      'Check for a missing `"`, or a `"` inside the value that needs escaping.',
    ],
    ['{"a":1', 'The object opened on line 1 is never closed.', 'Add the matching `}`.'],
    ['[1', 'The array opened on line 1 is never closed.', 'Add the matching `]`.'],
    [
      '',
      'The document is empty.',
      'JSON needs a value — an object, an array, a string, a number, `true`, `false` or `null`.',
    ],
    [
      '{} {}',
      'There is more content after the end of the JSON value.',
      'A JSON document holds exactly one value. Wrap several values in an array.',
    ],
    [
      '{"a" 1}',
      'Expected `:` after an object key.',
      'Each key is followed by a colon and then its value.',
    ],
    [
      '[1 2]',
      'Expected a comma or `]` between array items.',
      'Array items are separated by commas.',
    ],
    [
      '"a\tb"',
      'A raw control character (U+0009) is not allowed inside a string.',
      'Escape it — a tab is `\\t` and a newline is `\\n`.',
    ],
    [
      '\u{FEFF}{}',
      'The document starts with a byte-order mark.',
      'JSON has no BOM. Save the file as UTF-8 without one.',
    ],
  ])('%j', (source, message, hint) => {
    expect(firstError(source)).toBe(message);
    expect(hintFor(source)).toBe(hint);
  });
});

describe('golden — invalid document summaries', () => {
  it('names the problem and what survived', () => {
    expect(summaryOf('{"a":1,}')).toBe(
      'This is not valid JSON. One problem was found: Trailing comma before `}`. ' +
        'The rest of the document was read as an object with 1 property.',
    );
  });

  it('counts multiple problems and leads with the one that comes first in the source', () => {
    // The object opens at offset 0 and the array at offset 5, so the object's
    // failure leads — errors are reported in source order, not in the order
    // the parser happened to discover them.
    expect(summaryOf('{"a":[1,2')).toBe(
      'This is not valid JSON. 2 problems were found, starting with: The object opened on line 1 is never closed. ' +
        'The rest of the document was read as an object with 1 property.',
    );
  });

  it('claims no recovery when nothing substantive survived', () => {
    // The first draft read "…was read as a part that could not be read".
    expect(summaryOf('// hi\n{"a":1}')).toBe(
      'This is not valid JSON. 2 problems were found, starting with: Comments are not valid JSON.',
    );
    // One report, not two: the scanner and the parser both had something to
    // say about this token, and the more specific message survived.
    expect(summaryOf("{'a':1}")).toBe(
      'This is not valid JSON. One problem was found: Strings must use double quotes.',
    );
  });
});

/* ---------------- limits ---------------- */

describe('golden — limits', () => {
  it('refuses an oversized document with the actual size', () => {
    const oversized = `"${'a'.repeat(5_000_001)}"`;
    expect(firstError(oversized)).toBe('Input is 4.8 MB; the limit is 4.8 MB.');
  });

  it('names the nesting limit rather than crashing', () => {
    expect(firstError('['.repeat(600))).toBe('Nesting is deeper than 500 levels.');
    expect(hintFor('['.repeat(600))).toBe(
      'Real documents are rarely more than about twenty deep. This is usually generated or malformed data.',
    );
  });
});
