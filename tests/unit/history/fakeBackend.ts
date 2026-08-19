import type { HistoryEntry } from '@/domain/history/entry';
import type { HistoryBackend } from '@/infrastructure/storage/historyRepository';

/**
 * A backend that can be told to fail.
 *
 * The interesting behaviour of the repository is what it does when storage
 * refuses — quota, corruption, a dead connection — and none of that is
 * reachable through a backend that always works. Real IndexedDB is exercised
 * end-to-end in a real browser instead; happy-dom does not provide it.
 */
export interface FakeBackend extends HistoryBackend {
  /** Raw records, so a test can plant something no valid write would produce. */
  records: unknown[];
  quarantined: unknown[];
  /** Thrown by the next write, then cleared. */
  failNextWith: Error | null;
  /** Thrown by every write until set back to null. */
  failAlwaysWith: Error | null;
  writes: number;
}

export function quotaError(): DOMException {
  return new DOMException('quota', 'QuotaExceededError');
}

function idOf(record: unknown): string | undefined {
  // Records here are deliberately hostile — a test plants nulls and strings —
  // so this must not assume it was handed an object.
  if (typeof record !== 'object' || record === null) return undefined;
  const id = (record as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

export function createFakeBackend(initial: unknown[] = [], durable = true): FakeBackend {
  const fake: FakeBackend = {
    durable,
    records: [...initial],
    quarantined: [],
    failNextWith: null,
    failAlwaysWith: null,
    writes: 0,

    load: () => Promise.resolve([...fake.records]),

    put(entries) {
      guard();
      const ids = new Set(entries.map((entry) => entry.id));
      const kept = fake.records.filter((record) => {
        const id = idOf(record);
        return id === undefined || !ids.has(id);
      });
      fake.records = [...kept, ...entries.map((entry): HistoryEntry => ({ ...entry }))];
      return Promise.resolve();
    },

    remove(ids) {
      guard();
      fake.records = fake.records.filter((record) => {
        const id = idOf(record);
        return id === undefined || !ids.includes(id);
      });
      return Promise.resolve();
    },

    clear() {
      guard();
      fake.records = [];
      return Promise.resolve();
    },

    quarantine(records) {
      fake.quarantined.push(...records);
      return Promise.resolve();
    },
  };

  function guard(): void {
    fake.writes += 1;
    if (fake.failAlwaysWith !== null) throw fake.failAlwaysWith;
    if (fake.failNextWith !== null) {
      const error = fake.failNextWith;
      fake.failNextWith = null;
      throw error;
    }
  }

  return fake;
}
