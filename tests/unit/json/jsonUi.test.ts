import { describe, expect, it } from 'vitest';
import { analyzeJson } from '@/domain/json/analyze';
import { parseJson } from '@/domain/json/parser';
import { formatJson, minifyJson } from '@/domain/json/format';
import { detectInput, AUTO_SELECT, SUGGEST } from '@/domain/shared/detect';
import {
  allExpandableKeys,
  ancestorKeys,
  buildRows,
  excerptFor,
  keysToDepth,
  previewOf,
  searchTree,
  statusLine,
} from '@/features/json/viewModel';

/**
 * The pure half of the JSON UI: row derivation, search, formatting,
 * detection and the error excerpt.
 *
 * Everything the components render is derived by these functions, so testing
 * them here is testing the interesting part without mounting anything.
 */

function cstOf(source: string) {
  const root = parseJson(source).root;
  if (!root) throw new Error(`no tree for ${source}`);
  return root;
}

function rowsOf(source: string, expanded: Iterable<string> = []) {
  const result = analyzeJson(source);
  if (!result.ok) throw new Error('analysis failed');
  return buildRows(
    result.value.cst,
    new Set(expanded),
    result.value.duplicateKeys,
    result.value.unsafeNumbers,
  );
}

/* ---------------- formatting ---------------- */

describe('formatting operates on the CST', () => {
  it('preserves raw number text, which JSON.stringify would destroy', () => {
    // The single most important property of formatting here.
    const source = '{"a":1e5,"b":1.50,"c":9007199254740993,"d":-0}';
    const formatted = formatJson(cstOf(source), 'two');

    expect(formatted).toContain('1e5');
    expect(formatted).toContain('1.50');
    expect(formatted).toContain('9007199254740993');
    expect(formatted).toContain('-0');

    // What the naive implementation would have produced.
    expect(JSON.stringify(JSON.parse(source))).toContain('100000');
  });

  it('preserves string escapes exactly as written', () => {
    const formatted = formatJson(cstOf('{"a":"\\u0041\\n"}'), 'two');
    expect(formatted).toContain('"\\u0041\\n"');
  });

  it('preserves key order, including integer-like keys', () => {
    const formatted = formatJson(cstOf('{"2":"b","10":"c","1":"a"}'), 'two');
    expect(formatted.indexOf('"2"')).toBeLessThan(formatted.indexOf('"10"'));
    expect(formatted.indexOf('"10"')).toBeLessThan(formatted.indexOf('"1"'));
  });

  it('preserves duplicate keys, which a round trip would collapse', () => {
    const formatted = minifyJson(cstOf('{"a":1,"a":2}'));
    expect(formatted).toBe('{"a":1,"a":2}');
  });

  it('indents with two spaces, four spaces or a tab', () => {
    const cst = cstOf('{"a":[1]}');
    expect(formatJson(cst, 'two')).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(formatJson(cst, 'four')).toBe('{\n    "a": [\n        1\n    ]\n}');
    expect(formatJson(cst, 'tab')).toBe('{\n\t"a": [\n\t\t1\n\t]\n}');
  });

  it('keeps empty containers on one line', () => {
    expect(formatJson(cstOf('{"a":{},"b":[]}'), 'two')).toBe('{\n  "a": {},\n  "b": []\n}');
  });

  it('minifies to the shortest strict JSON', () => {
    expect(minifyJson(cstOf('{\n  "a" : [ 1 , 2 ]\n}'))).toBe('{"a":[1,2]}');
  });

  it('round-trips: formatted output parses to the same value', () => {
    const sources = [
      '{"a":1,"b":[true,null,"x"],"c":{"d":1e5}}',
      '[[[]]]',
      '{"\\u00e9":"caf\\u00e9"}',
      '[]',
      '{}',
      '"just a string"',
      '-1.5e-3',
    ];
    for (const source of sources) {
      for (const style of ['two', 'four', 'tab'] as const) {
        const formatted = formatJson(cstOf(source), style);
        expect(JSON.parse(formatted)).toEqual(JSON.parse(source));
      }
      expect(JSON.parse(minifyJson(cstOf(source)))).toEqual(JSON.parse(source));
    }
  });
});

/* ---------------- rows ---------------- */

describe('tree rows', () => {
  it('shows one row for a collapsed document, however large', () => {
    // The cheaper of the two things keeping a big tree responsive.
    const big = `[${Array.from({ length: 20_000 }, (_, i) => i).join(',')}]`;
    expect(rowsOf(big)).toHaveLength(1);
  });

  it('expands only the branches it is told to', () => {
    const rows = rowsOf('{"a":{"b":1},"c":2}', ['$']);
    expect(rows.map((row) => row.label)).toEqual([null, 'a', 'c']);
  });

  it('labels array elements by index and object members by key', () => {
    const rows = rowsOf('{"list":[10,20]}', ['$', '$["list"]']);
    expect(rows.map((row) => row.label)).toEqual([null, 'list', '0', '1']);
  });

  it('reports depth so the row can be indented', () => {
    const rows = rowsOf('{"a":{"b":1}}', ['$', '$["a"]']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2]);
  });

  it('marks each duplicate occurrence, not just the key name', () => {
    const rows = rowsOf('{"a":1,"a":2,"b":3}', ['$']);
    expect(rows.filter((row) => row.duplicate).map((row) => row.label)).toEqual(['a', 'a']);
    expect(rows.find((row) => row.label === 'b')?.duplicate).toBe(false);
  });

  it('keeps both occurrences of a duplicate key in the tree', () => {
    // The UI must not quietly do what JSON.parse does.
    const rows = rowsOf('{"a":1,"a":2}', ['$']);
    expect(rows.filter((row) => row.label === 'a')).toHaveLength(2);
    expect(rows.filter((row) => row.label === 'a').map((row) => row.preview)).toEqual(['1', '2']);
  });

  it('marks a number that changes when read', () => {
    const rows = rowsOf('{"id":9007199254740993,"ok":1}', ['$']);
    expect(rows.find((row) => row.label === 'id')?.unsafeNumber).toBe(true);
    expect(rows.find((row) => row.label === 'ok')?.unsafeNumber).toBe(false);
  });

  it('does not mark a number that round-trips', () => {
    const rows = rowsOf('{"a":0.1,"b":1e5}', ['$']);
    expect(rows.some((row) => row.unsafeNumber)).toBe(false);
  });

  it('renders user keys as ordinary data, including __proto__', () => {
    const rows = rowsOf('{"__proto__":1,"constructor":2}', ['$']);
    expect(rows.map((row) => row.label)).toEqual([null, '__proto__', 'constructor']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('value previews', () => {
  it('quotes strings so "1" cannot be mistaken for 1', () => {
    expect(previewOf(cstOf('"1"'))).toBe('"1"');
    expect(previewOf(cstOf('1'))).toBe('1');
  });

  it('shows numbers as written', () => {
    expect(previewOf(cstOf('1e5'))).toBe('1e5');
  });

  it('summarises containers rather than dumping them', () => {
    expect(previewOf(cstOf('{"a":1}'))).toBe('{…}');
    expect(previewOf(cstOf('[1]'))).toBe('[…]');
    expect(previewOf(cstOf('{}'))).toBe('{}');
    expect(previewOf(cstOf('[]'))).toBe('[]');
  });

  it('truncates a long string rather than putting it all on one row', () => {
    const preview = previewOf(cstOf(JSON.stringify('x'.repeat(500))));
    expect(preview.length).toBeLessThan(80);
    expect(preview).toContain('…');
  });
});

describe('expansion helpers', () => {
  it('collects every expandable key', () => {
    expect(allExpandableKeys(cstOf('{"a":{"b":[1]}}')).size).toBe(3);
    expect(allExpandableKeys(cstOf('{"a":1}')).size).toBe(1);
    expect(allExpandableKeys(cstOf('{}')).size).toBe(0);
  });

  it('expands to a depth for the default view', () => {
    const keys = keysToDepth(cstOf('{"a":{"b":{"c":1}}}'), 2);
    expect(keys.has('$')).toBe(true);
    expect(keys.has('$["a"]')).toBe(true);
    expect(keys.has('$["a"]["b"]')).toBe(false);
  });

  it('lists the ancestors needed to reveal a node', () => {
    expect(
      ancestorKeys([
        { kind: 'key', key: 'a' },
        { kind: 'index', index: 0 },
      ]),
    ).toEqual(['$', '$["a"]']);
  });
});

/* ---------------- search ---------------- */

describe('search reads the tree, not the DOM', () => {
  const doc = '{"name":"Ada","items":[{"name":"first"},{"title":"second"}],"count":42}';

  it('finds matches in keys and in values', () => {
    const matches = searchTree(cstOf(doc), 'name');
    expect(matches.filter((match) => match.where === 'key')).toHaveLength(2);
  });

  it('finds a value match', () => {
    const matches = searchTree(cstOf(doc), 'ada');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.where).toBe('value');
  });

  it('is case-insensitive', () => {
    expect(searchTree(cstOf(doc), 'ADA')).toHaveLength(1);
  });

  it('searches numbers as written', () => {
    expect(searchTree(cstOf('{"a":1e5}'), '1e5')).toHaveLength(1);
  });

  it('returns matches in source order, so stepping moves down the document', () => {
    const matches = searchTree(cstOf(doc), 'name');
    const offsets = matches.map((match) => match.span.start);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it('finds matches inside collapsed branches', () => {
    // The reason search reads the model: a DOM scrape would find nothing here.
    expect(searchTree(cstOf(doc), 'second')).toHaveLength(1);
  });

  it('returns nothing for an empty query', () => {
    expect(searchTree(cstOf(doc), '')).toEqual([]);
    expect(searchTree(cstOf(doc), '   ')).toEqual([]);
  });

  it('caps the result count on a pathological query', () => {
    const many = `[${Array.from({ length: 5000 }, () => '"aaa"').join(',')}]`;
    expect(searchTree(cstOf(many), 'a').length).toBeLessThanOrEqual(500);
  });
});

/* ---------------- errors ---------------- */

describe('error excerpts', () => {
  it('returns the offending line with the caret column', () => {
    expect(excerptFor('{\n  "a": 1,\n}', 3, 1)).toEqual({ line: '}', caretColumn: 1 });
  });

  it('windows a very long line rather than dumping it', () => {
    const long = `{"a":"${'x'.repeat(5000)}"}`;
    const excerpt = excerptFor(long, 1, 4000);
    expect(excerpt).not.toBeNull();
    expect(excerpt?.line.length).toBeLessThan(80);
    expect(excerpt?.line.startsWith('…')).toBe(true);
  });

  it('returns null for a line that does not exist', () => {
    expect(excerptFor('{}', 9, 1)).toBeNull();
  });
});

describe('the status line', () => {
  it('summarises a valid document in one line', () => {
    const result = analyzeJson('{"a":1,"b":[1,2]}');
    if (!result.ok) throw new Error('failed');
    expect(statusLine(result.value)).toEqual({
      valid: true,
      text: 'Valid · 5 values · depth 2 · 2 keys · 17 bytes',
    });
  });

  it('counts problems on an invalid document', () => {
    const result = analyzeJson('{"a":1,}');
    if (!result.ok) throw new Error('failed');
    expect(statusLine(result.value)).toEqual({ valid: false, text: 'Invalid · 1 problem' });
  });

  it('is absent before anything is analysed', () => {
    expect(statusLine(null)).toBeNull();
  });
});

/* ---------------- detection ---------------- */

describe('detection suggests rather than decides', () => {
  it.each([
    ['{"a":1}', 'json'],
    ['{\n  "user": {"name": "Ada"}\n}', 'json'],
    ['[1,2,3]', 'json'],
    ['[{"a":1}]', 'json'],
  ])('reads %j as JSON', (input, type) => {
    const result = detectInput(input);
    expect(result.type).toBe(type);
    expect(result.confidence).toBeGreaterThanOrEqual(AUTO_SELECT);
  });

  it.each([
    ['/^[a-z]+$/gi', 'regex'],
    ['^\\d{4}-\\d{2}$', 'regex'],
    ['\\bword\\b', 'regex'],
  ])('reads %j as a regular expression', (input, type) => {
    expect(detectInput(input).type).toBe(type);
  });

  it('says unknown rather than guessing', () => {
    for (const input of ['', '   ', 'hello world', 'the quick brown fox']) {
      expect(detectInput(input).type).toBe('unknown');
    }
  });

  it('keeps a bare literal below the auto-select line', () => {
    // `true` is valid JSON and equally likely to be a word being made into a
    // pattern, so it may offer but must never switch on its own.
    const result = detectInput('true');
    expect(result.confidence).toBeGreaterThanOrEqual(SUGGEST);
    expect(result.confidence).toBeLessThan(AUTO_SELECT);
  });

  it('samples rather than scanning a huge paste', () => {
    const huge = `{"a":"${'x'.repeat(2_000_000)}"}`;
    const started = Date.now();
    expect(detectInput(huge).type).toBe('json');
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('never suggests cron, which does not exist in V1.0', () => {
    for (const input of ['*/5 * * * *', '0 9 * * 1-5', '@daily']) {
      expect(['json', 'regex', 'unknown']).toContain(detectInput(input).type);
    }
  });
});
