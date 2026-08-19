import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION, type HistoryEntry } from '@/domain/history/entry';
import { buildSearchText, readEntry } from '@/domain/history/validate';
import { LIMITS } from '@/domain/shared/limits';

/**
 * Validate-on-read — 06_DATA_STORAGE.md §7
 *
 * These tests are the guarantee that persisted data cannot become application
 * state without being checked. Anything a devtools console can write into the
 * database is a valid input here.
 */

function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    type: 'regex',
    title: '/ab+c/gi',
    isCustomTitle: false,
    input: 'ab+c',
    inputTruncated: false,
    metadata: { type: 'regex', flags: 'gi', groupCount: 0, hadErrors: false, nodeCount: 3 },
    createdAt: 1_700_000_000_000,
    lastOpenedAt: 1_700_000_000_000,
    openCount: 1,
    pinned: false,
    tags: [],
    searchText: '/ab+c/gi\nab+c',
    ...overrides,
  };
}

function expectOk(value: unknown): HistoryEntry {
  const outcome = readEntry(value);
  expect(outcome.kind).toBe('ok');
  if (outcome.kind !== 'ok') throw new Error('unreachable');
  return outcome.entry;
}

describe('readEntry — valid records', () => {
  it('accepts a well-formed record', () => {
    const entry = expectOk(validRecord());
    expect(entry.id).toBe('a1');
    expect(entry.type).toBe('regex');
    expect(entry.metadata).toEqual({
      type: 'regex',
      flags: 'gi',
      groupCount: 0,
      hadErrors: false,
      nodeCount: 3,
    });
  });

  it('accepts a json record', () => {
    const entry = expectOk(
      validRecord({
        type: 'json',
        title: 'JSON · 3 values · depth 1',
        input: '{"a":1}',
        metadata: { type: 'json', valid: true, nodeCount: 3, maxDepth: 1, byteLength: 7 },
      }),
    );
    expect(entry.metadata.type).toBe('json');
  });

  it('drops keys the schema does not define', () => {
    // A spread would carry these through into application state.
    const entry = expectOk(validRecord({ evil: 'payload', __proto__: { polluted: true } }));
    expect(Object.keys(entry).sort()).toEqual(
      [
        'createdAt',
        'id',
        'input',
        'inputTruncated',
        'isCustomTitle',
        'lastOpenedAt',
        'metadata',
        'openCount',
        'pinned',
        'schemaVersion',
        'searchText',
        'tags',
        'title',
        'type',
      ].sort(),
    );
    expect((entry as unknown as { evil?: string }).evil).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('drops keys the metadata schema does not define', () => {
    const entry = expectOk(
      validRecord({
        metadata: {
          type: 'regex',
          flags: 'g',
          groupCount: 1,
          hadErrors: false,
          nodeCount: 2,
          smuggled: true,
        },
      }),
    );
    expect((entry.metadata as unknown as { smuggled?: boolean }).smuggled).toBeUndefined();
  });

  it('recomputes searchText rather than trusting the stored value', () => {
    // A stored searchText that disagrees with the content would make search
    // silently wrong — an entry that exists but can never be found.
    const entry = expectOk(validRecord({ searchText: 'completely unrelated' }));
    expect(entry.searchText).toBe(buildSearchText('/ab+c/gi', 'ab+c'));
    expect(entry.searchText).toContain('ab+c');
  });

  it('filters non-strings out of tags and bounds their number', () => {
    const entry = expectOk(
      validRecord({ tags: ['keep', 42, null, {}, ...Array.from({ length: 30 }, () => 'x')] }),
    );
    expect(entry.tags[0]).toBe('keep');
    expect(entry.tags).toHaveLength(20);
    expect(entry.tags.every((tag) => typeof tag === 'string')).toBe(true);
  });

  it('coerces missing booleans to false rather than rejecting', () => {
    const entry = expectOk(validRecord({ pinned: 'yes', isCustomTitle: 1, inputTruncated: null }));
    expect(entry.pinned).toBe(false);
    expect(entry.isCustomTitle).toBe(false);
    expect(entry.inputTruncated).toBe(false);
  });
});

describe('readEntry — future records', () => {
  it('keeps a record from a newer schema version', () => {
    // Kept and hidden, not quarantined: old code destroying newer data is how
    // a user loses everything by opening a stale tab (§7.3).
    const outcome = readEntry(validRecord({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }));
    expect(outcome).toEqual({ kind: 'future', id: 'a1' });
  });

  it('keeps a record whose type this build does not know', () => {
    const outcome = readEntry(validRecord({ type: 'cron' }));
    expect(outcome).toEqual({ kind: 'future', id: 'a1' });
  });
});

describe('readEntry — invalid records', () => {
  const cases: readonly (readonly [string, Record<string, unknown>])[] = [
    ['no id', { id: undefined }],
    ['empty id', { id: '' }],
    ['numeric id', { id: 7 }],
    ['no schemaVersion', { schemaVersion: undefined }],
    ['zero schemaVersion', { schemaVersion: 0 }],
    ['fractional schemaVersion', { schemaVersion: 1.5 }],
    ['empty title', { title: '' }],
    ['non-string title', { title: 42 }],
    ['non-string input', { input: null }],
    ['NaN timestamp', { createdAt: Number.NaN }],
    ['Infinite timestamp', { lastOpenedAt: Number.POSITIVE_INFINITY }],
    ['negative timestamp', { createdAt: -1 }],
    ['absurd future timestamp', { lastOpenedAt: 9_999_999_999_999 }],
    ['created after opened', { createdAt: 2_000, lastOpenedAt: 1_000 }],
    ['negative openCount', { openCount: -3 }],
    ['missing metadata', { metadata: undefined }],
    ['metadata of the wrong type', { metadata: { type: 'json', valid: true } }],
    [
      'metadata with a bad count',
      { metadata: { type: 'regex', flags: '', groupCount: -1, hadErrors: false, nodeCount: 0 } },
    ],
  ];

  for (const [name, patch] of cases) {
    it(`rejects a record with ${name}`, () => {
      expect(readEntry(validRecord(patch)).kind).toBe('invalid');
    });
  }

  it('rejects non-objects', () => {
    for (const value of [null, undefined, 42, 'string', [], true]) {
      expect(readEntry(value).kind).toBe('invalid');
    }
  });

  it('rejects an input longer than the stored limit', () => {
    const outcome = readEntry(validRecord({ input: 'x'.repeat(LIMITS.history.maxInputChars + 1) }));
    expect(outcome.kind).toBe('invalid');
  });

  it('reports the id of an invalid record so it can be named', () => {
    const outcome = readEntry(validRecord({ title: '' }));
    expect(outcome.kind === 'invalid' && outcome.id).toBe('a1');
  });

  it('never throws, whatever it is handed', () => {
    const hostile: unknown[] = [
      Object.create(null),
      new Proxy({}, { get: () => undefined }),
      { id: { toString: () => 'x' } },
      { ...validRecord(), metadata: [] },
      { ...validRecord(), tags: 'not-an-array' },
    ];
    for (const value of hostile) {
      expect(() => readEntry(value)).not.toThrow();
    }
  });
});

describe('buildSearchText', () => {
  it('lowercases so search is case-insensitive', () => {
    expect(buildSearchText('Title', 'INPUT')).toBe('title\ninput');
  });

  it('bounds how much of the input is indexed', () => {
    const text = buildSearchText('t', 'x'.repeat(10_000));
    expect(text.length).toBeLessThan(3_000);
  });
});
