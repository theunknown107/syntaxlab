import { describe, expect, it } from 'vitest';

import type { HistoryEntry, HistoryQuery } from '@/domain/history/entry';
import {
  findDuplicate,
  overCapBy,
  pruneBatchSize,
  queryEntries,
  selectForPruning,
} from '@/domain/history/query';
import { buildSearchText } from '@/domain/history/validate';
import { LIMITS } from '@/domain/shared/limits';

function entry(overrides: Partial<HistoryEntry> & { id: string }): HistoryEntry {
  const title = overrides.title ?? `entry ${overrides.id}`;
  const input = overrides.input ?? `input ${overrides.id}`;
  return {
    schemaVersion: 1,
    type: 'regex',
    isCustomTitle: false,
    inputTruncated: false,
    metadata: { type: 'regex', flags: '', groupCount: 0, hadErrors: false, nodeCount: 1 },
    createdAt: 1_000,
    lastOpenedAt: 1_000,
    openCount: 1,
    pinned: false,
    tags: [],
    ...overrides,
    title,
    input,
    searchText: buildSearchText(title, input),
  };
}

const base: HistoryQuery = { sort: 'created', limit: 100 };
const noCounts = { fromNewerVersion: 0, quarantined: 0 };

describe('queryEntries — ordering', () => {
  it('puts pinned entries first regardless of age', () => {
    const page = queryEntries(
      [
        entry({ id: 'new', createdAt: 5_000 }),
        entry({ id: 'old-pinned', createdAt: 1_000, pinned: true }),
      ],
      base,
      noCounts,
    );
    expect(page.entries.map((item) => item.id)).toEqual(['old-pinned', 'new']);
  });

  it('sorts newest first within each group', () => {
    const page = queryEntries(
      [
        entry({ id: 'b', createdAt: 2_000 }),
        entry({ id: 'c', createdAt: 3_000 }),
        entry({ id: 'a', createdAt: 1_000 }),
      ],
      base,
      noCounts,
    );
    expect(page.entries.map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by last opened when asked, not by creation', () => {
    const page = queryEntries(
      [
        entry({ id: 'created-later', createdAt: 5_000, lastOpenedAt: 5_000 }),
        entry({ id: 'opened-recently', createdAt: 1_000, lastOpenedAt: 9_000 }),
      ],
      { ...base, sort: 'opened' },
      noCounts,
    );
    expect(page.entries[0]?.id).toBe('opened-recently');
  });

  it('breaks ties stably, so rows do not swap between renders', () => {
    const entries = [entry({ id: 'b', createdAt: 1 }), entry({ id: 'a', createdAt: 1 })];
    const first = queryEntries(entries, base, noCounts).entries.map((item) => item.id);
    const second = queryEntries([...entries].reverse(), base, noCounts).entries.map(
      (item) => item.id,
    );
    expect(first).toEqual(second);
  });

  it('does not mutate the array it is given', () => {
    const entries = [entry({ id: 'b', createdAt: 2 }), entry({ id: 'a', createdAt: 1 })];
    queryEntries(entries, base, noCounts);
    expect(entries.map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('queryEntries — filtering', () => {
  const mixed = [
    entry({ id: 'r1', type: 'regex', title: 'Email pattern' }),
    entry({ id: 'j1', type: 'json', title: 'Config payload' }),
    entry({ id: 'r2', type: 'regex', title: 'Phone pattern', pinned: true }),
  ];

  it('filters by type', () => {
    const page = queryEntries(mixed, { ...base, type: 'json' }, noCounts);
    expect(page.entries.map((item) => item.id)).toEqual(['j1']);
  });

  it('filters to pinned only', () => {
    const page = queryEntries(mixed, { ...base, pinnedOnly: true }, noCounts);
    expect(page.entries.map((item) => item.id)).toEqual(['r2']);
  });

  it('searches case-insensitively across title and input', () => {
    expect(queryEntries(mixed, { ...base, search: 'PATTERN' }, noCounts).total).toBe(2);
    expect(queryEntries(mixed, { ...base, search: 'input j1' }, noCounts).total).toBe(1);
  });

  it('treats regex metacharacters in a search as literal text', () => {
    // A developer searching `\d+` means those characters. Interpreting the
    // query as a pattern would match nothing and look broken.
    const entries = [entry({ id: 'x', title: 'match \\d+ digits' }), entry({ id: 'y' })];
    expect(queryEntries(entries, { ...base, search: '\\d+' }, noCounts).total).toBe(1);
    expect(queryEntries(entries, { ...base, search: '.*' }, noCounts).total).toBe(0);
  });

  it('ignores surrounding whitespace in a search', () => {
    expect(queryEntries(mixed, { ...base, search: '  email  ' }, noCounts).total).toBe(1);
  });

  it('reports the total separately from the page', () => {
    const entries = Array.from({ length: 20 }, (_, index) => entry({ id: `e${index}` }));
    const page = queryEntries(entries, { ...base, limit: 5 }, noCounts);
    expect(page.entries).toHaveLength(5);
    expect(page.total).toBe(20);
  });

  it('passes through the counts of hidden and quarantined records', () => {
    const page = queryEntries([], base, { fromNewerVersion: 2, quarantined: 3 });
    expect(page.fromNewerVersion).toBe(2);
    expect(page.quarantined).toBe(3);
  });
});

describe('findDuplicate', () => {
  const now = 1_000_000;

  it('finds an identical entry saved within the window', () => {
    const entries = [entry({ id: 'a', type: 'regex', input: 'ab+c', createdAt: now - 5_000 })];
    expect(findDuplicate(entries, 'regex', 'ab+c', now)?.id).toBe('a');
  });

  it('ignores an identical entry saved before the window', () => {
    const stale = now - LIMITS.history.dedupeWindowMs - 1;
    const entries = [entry({ id: 'a', input: 'ab+c', createdAt: stale })];
    expect(findDuplicate(entries, 'regex', 'ab+c', now)).toBeNull();
  });

  it('does not match across types', () => {
    const entries = [entry({ id: 'a', type: 'json', input: '{}', createdAt: now })];
    expect(findDuplicate(entries, 'regex', '{}', now)).toBeNull();
  });

  it('requires the input to be identical, not merely similar', () => {
    const entries = [entry({ id: 'a', input: 'ab+c', createdAt: now })];
    expect(findDuplicate(entries, 'regex', 'ab+cd', now)).toBeNull();
  });
});

describe('selectForPruning', () => {
  it('never selects a pinned entry, at any pressure', () => {
    const entries = [
      entry({ id: 'pinned-oldest', pinned: true, lastOpenedAt: 1 }),
      entry({ id: 'unpinned', lastOpenedAt: 9_000 }),
    ];
    expect(selectForPruning(entries, 2).map((item) => item.id)).toEqual(['unpinned']);
  });

  it('returns nothing when every entry is pinned', () => {
    const entries = [entry({ id: 'a', pinned: true }), entry({ id: 'b', pinned: true })];
    expect(selectForPruning(entries, 5)).toEqual([]);
  });

  it('drops least recently opened first, not oldest created', () => {
    const entries = [
      entry({ id: 'old-but-used', createdAt: 1, lastOpenedAt: 9_000 }),
      entry({ id: 'new-but-untouched', createdAt: 8_000, lastOpenedAt: 8_000 }),
    ];
    expect(selectForPruning(entries, 1).map((item) => item.id)).toEqual(['new-but-untouched']);
  });

  it('selects nothing for a non-positive count', () => {
    expect(selectForPruning([entry({ id: 'a' })], 0)).toEqual([]);
    expect(selectForPruning([entry({ id: 'a' })], -1)).toEqual([]);
  });
});

describe('pruneBatchSize and overCapBy', () => {
  it('frees about a tenth at a time, and never nothing', () => {
    expect(pruneBatchSize(500)).toBe(50);
    expect(pruneBatchSize(1)).toBe(1);
    expect(pruneBatchSize(0)).toBe(1);
  });

  it('reports only genuine overflow', () => {
    expect(overCapBy(LIMITS.history.maxEntries)).toBe(0);
    expect(overCapBy(LIMITS.history.maxEntries + 3)).toBe(3);
    expect(overCapBy(0)).toBe(0);
  });
});
