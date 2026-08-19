import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HistoryEntry, HistoryMetadata, NewHistoryEntry } from '@/domain/history/entry';
import { newEntry } from '@/domain/history/title';
import {
  createMemoryBackend,
  HistoryStore,
  type HistoryBackend,
} from '@/infrastructure/storage/historyRepository';

import { createFakeBackend, quotaError, type FakeBackend } from './fakeBackend';

/**
 * Repository behaviour — 06_DATA_STORAGE.md §3, §5
 *
 * Exercised through a controllable backend rather than real IndexedDB, which
 * happy-dom does not provide. What is tested here is the *policy* — dedupe,
 * pruning, pinned protection, quota retry, degradation — and the policy is
 * shared by both backends. The IndexedDB wiring itself is covered end-to-end
 * in a real browser.
 */

const REGEX_META: HistoryMetadata = {
  type: 'regex',
  flags: 'g',
  groupCount: 0,
  hadErrors: false,
  nodeCount: 2,
};

function candidate(input: string, title = `/${input}/g`): NewHistoryEntry {
  return { type: 'regex', title, input, metadata: REGEX_META };
}

async function unwrap<T>(promise: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>) {
  const result = await promise;
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

async function listAll(store: HistoryStore): Promise<readonly HistoryEntry[]> {
  const page = await unwrap(store.list({ sort: 'created', limit: 1_000 }));
  return page.entries;
}

let backend: FakeBackend;
let store: HistoryStore;

beforeEach(() => {
  vi.useRealTimers();
  backend = createFakeBackend();
  store = new HistoryStore(backend);
});

describe('saving', () => {
  it('saves an entry and reads it back', async () => {
    const saved = await unwrap(store.save(candidate('ab+c')));
    expect(saved.input).toBe('ab+c');
    expect(saved.openCount).toBe(1);
    expect(saved.pinned).toBe(false);
    expect(await unwrap(store.get(saved.id))).toEqual(saved);
  });

  it('gives every entry a distinct id', async () => {
    const first = await unwrap(store.save(candidate('a')));
    const second = await unwrap(store.save(candidate('b')));
    expect(first.id).not.toBe(second.id);
  });

  it('updates in place when the same input is saved again within the window', async () => {
    const first = await unwrap(store.save(candidate('ab+c')));
    const second = await unwrap(store.save(candidate('ab+c')));
    expect(second.id).toBe(first.id);
    expect(await listAll(store)).toHaveLength(1);
  });

  it('keeps a user-chosen title when the same input is saved again', async () => {
    const first = await unwrap(store.save(candidate('ab+c')));
    await unwrap(store.update(first.id, { title: 'My email check', isCustomTitle: true }));
    const again = await unwrap(store.save(candidate('ab+c')));
    expect(again.title).toBe('My email check');
    expect(again.searchText).toContain('my email check');
  });

  it('treats different inputs as different entries', async () => {
    await unwrap(store.save(candidate('a')));
    await unwrap(store.save(candidate('b')));
    expect(await listAll(store)).toHaveLength(2);
  });

  it('stores an over-long input truncated and flagged, never silently', async () => {
    const huge = 'x'.repeat(200_000);
    const saved = await unwrap(store.save(candidate(huge, 'huge')));
    expect(saved.inputTruncated).toBe(true);
    expect(saved.input.length).toBeLessThan(huge.length);
  });

  it('derives a title through the domain, including for JSON', async () => {
    const meta: HistoryMetadata = {
      type: 'json',
      valid: true,
      nodeCount: 3,
      maxDepth: 1,
      byteLength: 7,
    };
    const saved = await unwrap(store.save(newEntry('json', '{"a":1}', meta)));
    expect(saved.title).toBe('JSON · 3 values · depth 1');
  });
});

describe('updating', () => {
  it('renames an entry and reindexes it for search', async () => {
    const saved = await unwrap(store.save(candidate('ab+c')));
    const renamed = await unwrap(
      store.update(saved.id, { title: 'Postcode matcher', isCustomTitle: true }),
    );
    expect(renamed.title).toBe('Postcode matcher');

    const page = await unwrap(store.list({ sort: 'created', limit: 10, search: 'postcode' }));
    expect(page.entries.map((entry) => entry.id)).toEqual([saved.id]);
  });

  it('refuses an empty name rather than storing a nameless row', async () => {
    const saved = await unwrap(store.save(candidate('ab+c')));
    const result = await store.update(saved.id, { title: '   ' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('VALIDATION');
  });

  it('reports an update to an entry that is gone', async () => {
    const result = await store.update('missing', { pinned: true });
    expect(!result.ok && result.error.code).toBe('VALIDATION');
  });

  it('pins and unpins', async () => {
    const saved = await unwrap(store.save(candidate('ab+c')));
    expect((await unwrap(store.update(saved.id, { pinned: true }))).pinned).toBe(true);
    expect((await unwrap(store.update(saved.id, { pinned: false }))).pinned).toBe(false);
  });
});

describe('deleting and clearing', () => {
  it('deletes one entry from memory and from the backend', async () => {
    const saved = await unwrap(store.save(candidate('ab+c')));
    await unwrap(store.delete(saved.id));
    expect(await unwrap(store.get(saved.id))).toBeNull();
    expect(backend.records).toHaveLength(0);
  });

  it('clears everything, including pinned entries when asked directly', async () => {
    const saved = await unwrap(store.save(candidate('a')));
    await unwrap(store.update(saved.id, { pinned: true }));
    await unwrap(store.save(candidate('b')));

    await unwrap(store.clear());

    expect(await listAll(store)).toHaveLength(0);
    expect(backend.records).toHaveLength(0);
    expect(await unwrap(store.count())).toBe(0);
  });

  it('keeps the in-memory list intact when the backend refuses a delete', async () => {
    // The list must reflect what storage actually holds, not what was asked.
    const saved = await unwrap(store.save(candidate('ab+c')));
    backend.failNextWith = new Error('disk gone');

    const result = await store.delete(saved.id);
    expect(result.ok).toBe(false);
    expect(await unwrap(store.get(saved.id))).not.toBeNull();
  });
});

describe('capacity and quota', () => {
  it('prunes down to the cap after a save takes it over', async () => {
    const many = Array.from({ length: 505 }, (_, index) => ({
      id: `e${index}`,
      schemaVersion: 1,
      type: 'regex',
      title: `t${index}`,
      isCustomTitle: false,
      input: `p${index}`,
      inputTruncated: false,
      metadata: REGEX_META,
      createdAt: 1_000 + index,
      lastOpenedAt: 1_000 + index,
      openCount: 1,
      pinned: false,
      tags: [],
      searchText: `t${index}`,
    }));
    const seeded = new HistoryStore(createFakeBackend(many));

    await unwrap(seeded.save(candidate('new')));
    expect(await unwrap(seeded.count())).toBe(500);

    // The oldest-touched entries went; the newest and the new save stayed.
    const remaining = await listAll(seeded);
    expect(remaining.some((entry) => entry.input === 'new')).toBe(true);
    expect(remaining.some((entry) => entry.id === 'e0')).toBe(false);
    expect(remaining.some((entry) => entry.id === 'e504')).toBe(true);
  });

  it('frees space and retries once when storage is full', async () => {
    await unwrap(store.save(candidate('first')));
    await unwrap(store.save(candidate('second')));

    backend.failNextWith = quotaError();
    const saved = await unwrap(store.save(candidate('third')));

    expect(saved.input).toBe('third');
    expect(store.durable).toBe(true);
    // One entry was dropped to make room; the save then succeeded.
    expect(await unwrap(store.count())).toBe(2);
  });

  it('never deletes a pinned entry to make room', async () => {
    const first = await unwrap(store.save(candidate('keep-me')));
    await unwrap(store.update(first.id, { pinned: true }));

    backend.failNextWith = quotaError();
    const result = await store.save(candidate('new'));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('QUOTA');
    expect(!result.ok && result.error.message).toContain('pinned');
    expect(await unwrap(store.get(first.id))).not.toBeNull();
  });

  it('reports failure rather than looping when space cannot be freed', async () => {
    await unwrap(store.save(candidate('a')));
    await unwrap(store.save(candidate('b')));

    backend.failAlwaysWith = quotaError();
    const before = backend.writes;
    const result = await store.save(candidate('c'));

    expect(result.ok).toBe(false);
    // Exactly one retry: the first write, the prune, and the retry.
    expect(backend.writes - before).toBeLessThanOrEqual(3);
  });
});

describe('degradation', () => {
  it('is durable while the backend is', () => {
    expect(store.durable).toBe(true);
    expect(new HistoryStore(createMemoryBackend()).durable).toBe(false);
  });

  it('stops claiming durability after an unrecoverable write failure', async () => {
    backend.failNextWith = new Error('connection closed');
    const result = await store.save(candidate('ab+c'));
    expect(result.ok).toBe(false);
    expect(store.durable).toBe(false);
  });

  it('reports a failed load instead of throwing', async () => {
    const failing: HistoryBackend = {
      durable: true,
      load: () => Promise.reject(new Error('corrupt')),
      put: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      quarantine: () => Promise.resolve(),
    };
    const result = await new HistoryStore(failing).list({ sort: 'created', limit: 10 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).not.toContain('corrupt');
  });
});

describe('reading a hostile store', () => {
  it('quarantines unreadable records and keeps the readable ones', async () => {
    const good = {
      id: 'good',
      schemaVersion: 1,
      type: 'regex',
      title: 'fine',
      isCustomTitle: false,
      input: 'a',
      inputTruncated: false,
      metadata: REGEX_META,
      createdAt: 1,
      lastOpenedAt: 1,
      openCount: 1,
      pinned: false,
      tags: [],
      searchText: 'fine',
    };
    const seeded = createFakeBackend([good, { id: 'bad', title: 42 }, null, 'not-a-record']);
    const hostile = new HistoryStore(seeded);

    const page = await unwrap(hostile.list({ sort: 'created', limit: 10 }));
    expect(page.entries.map((entry) => entry.id)).toEqual(['good']);
    expect(page.quarantined).toBe(3);
    expect(seeded.quarantined).toHaveLength(3);
    // The identifiable bad record was moved aside, not left to be re-read on
    // every load. Records with no id at all cannot be addressed individually,
    // and in real IndexedDB cannot exist: `id` is the key path.
    const ids = seeded.records.map((record) =>
      typeof record === 'object' && record !== null ? (record as { id?: unknown }).id : undefined,
    );
    expect(ids).not.toContain('bad');
    expect(ids).toContain('good');
  });

  it('keeps records from a newer build and reports them without showing them', async () => {
    const future = { id: 'future', schemaVersion: 99, type: 'regex', title: 'later' };
    const seeded = createFakeBackend([future]);
    const hostile = new HistoryStore(seeded);

    const page = await unwrap(hostile.list({ sort: 'created', limit: 10 }));
    expect(page.entries).toHaveLength(0);
    expect(page.fromNewerVersion).toBe(1);
    // Untouched on disk: a newer build must find its own data intact.
    expect(seeded.records).toEqual([future]);
  });

  it('survives a store full of nothing but rubbish', async () => {
    const seeded = createFakeBackend([undefined, [], 0, '', { __proto__: { x: 1 } }]);
    const hostile = new HistoryStore(seeded);
    const page = await unwrap(hostile.list({ sort: 'created', limit: 10 }));
    expect(page.entries).toHaveLength(0);
    expect(({} as { x?: number }).x).toBeUndefined();
  });
});

describe('export and import', () => {
  it('round-trips through an envelope', async () => {
    await unwrap(store.save(candidate('a')));
    await unwrap(store.save(candidate('b')));
    const envelope = await unwrap(store.exportAll());

    const empty = new HistoryStore(createFakeBackend());
    const report = await unwrap(empty.importAll(envelope, 'merge'));

    expect(report.imported).toBe(2);
    expect(report.skipped).toBe(0);
    expect((await listAll(empty)).map((entry) => entry.input).sort()).toEqual(['a', 'b']);
  });

  it('refuses a file that is not a SyntaxLab export', async () => {
    for (const value of [{}, { format: 'other' }, [], null, 'text']) {
      const result = await store.importAll(value, 'merge');
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe('VALIDATION');
    }
  });

  it('skips bad records and imports the rest', async () => {
    const envelope = {
      format: 'syntaxlab-export',
      formatVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.1.0',
      entryCount: 2,
      entries: [
        {
          id: 'ok1',
          schemaVersion: 1,
          type: 'regex',
          title: 'fine',
          isCustomTitle: false,
          input: 'a',
          inputTruncated: false,
          metadata: REGEX_META,
          createdAt: 1,
          lastOpenedAt: 1,
          openCount: 1,
          pinned: false,
          tags: [],
          searchText: 'fine',
        },
        { id: 'broken' },
      ],
    };
    const report = await unwrap(store.importAll(envelope, 'merge'));
    expect(report.imported).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.reasons.length).toBeGreaterThan(0);
  });

  it('keeps the more recently used copy when ids collide', async () => {
    const saved = await unwrap(store.save(candidate('current')));
    const stale = {
      ...saved,
      input: 'stale',
      title: 'stale',
      lastOpenedAt: saved.lastOpenedAt - 10_000,
    };
    const envelope = {
      format: 'syntaxlab-export',
      formatVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.1.0',
      entryCount: 1,
      entries: [stale],
    };

    const report = await unwrap(store.importAll(envelope, 'merge'));
    expect(report.updated).toBe(0);
    expect((await unwrap(store.get(saved.id)))?.input).toBe('current');
  });

  it('replaces everything when asked to replace', async () => {
    await unwrap(store.save(candidate('existing')));
    const envelope = await unwrap(new HistoryStore(createFakeBackend()).exportAll());

    await unwrap(store.importAll(envelope, 'replace'));
    expect(await listAll(store)).toHaveLength(0);
  });

  it('refuses an export written by a newer format', async () => {
    const result = await store.importAll(
      { format: 'syntaxlab-export', formatVersion: 99, entries: [] },
      'merge',
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('newer version');
  });
});
