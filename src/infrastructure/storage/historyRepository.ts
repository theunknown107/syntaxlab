import {
  storageError,
  CURRENT_SCHEMA_VERSION,
  type ExportEnvelope,
  type HistoryEntry,
  type HistoryPage,
  type HistoryPatch,
  type HistoryQuery,
  type HistoryRepository,
  type ImportReport,
  type NewHistoryEntry,
  type StorageError,
} from '@/domain/history/entry';
import {
  findDuplicate,
  overCapBy,
  pruneBatchSize,
  queryEntries,
  selectForPruning,
} from '@/domain/history/query';
import { truncateInput } from '@/domain/history/title';
import { buildEnvelope, readEnvelope } from '@/domain/history/transfer';
import { buildSearchText, readEntry } from '@/domain/history/validate';
import { err, ok, type Result } from '@/domain/shared/result';
import {
  clearStore,
  getAll,
  getOne,
  isQuotaError,
  openDatabase,
  put,
  putMany,
  removeMany,
  toStorageError,
  STORE_HISTORY,
  STORE_META,
  type DbListener,
} from './db';

/**
 * The history repository — 06_DATA_STORAGE.md §3, §5, §7
 *
 * One implementation of the *rules*, over two backends. Splitting it the other
 * way — an IndexedDB repository and a memory repository, each with its own
 * dedupe, pruning and validation — would give the fallback path different
 * behaviour from the real one, and the fallback is exactly the path that gets
 * the least manual testing.
 *
 * The entry set is held in memory and written through. That is affordable
 * because the store is capped at 500 entries, and it is what keeps `list` fast
 * enough that the drawer can filter as the user types without a database round
 * trip per keystroke.
 */

export interface HistoryBackend {
  readonly durable: boolean;
  load(): Promise<unknown[]>;
  put(entries: readonly HistoryEntry[]): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
  /** Keeps unreadable records aside so a bug report can explain what happened. */
  quarantine(records: readonly unknown[]): Promise<void>;
}

/** Records kept for diagnosis. Bounded: a corrupt store must not grow forever. */
const MAX_QUARANTINED = 50;

function newId(): string {
  // `randomUUID` needs a secure context; a page served over plain HTTP still
  // needs working history, so there is a fallback.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function idOf(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) return null;
  const id = (record as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

export class HistoryStore implements HistoryRepository {
  private readonly entries = new Map<string, HistoryEntry>();
  private fromNewerVersion = 0;
  private quarantined = 0;
  private degraded = false;
  private loaded = false;

  constructor(private readonly backend: HistoryBackend) {}

  /** True only while writes are actually reaching durable storage. */
  get durable(): boolean {
    return this.backend.durable && !this.degraded;
  }

  /**
   * Reads everything once, validating each record.
   *
   * Lazy rather than done in the constructor, so a failure here is a `Result`
   * a caller can render rather than an exception thrown inside a component
   * tree during its first render.
   */
  private async ensureLoaded(): Promise<Result<void, StorageError>> {
    if (this.loaded) return ok(undefined);

    let records: unknown[];
    try {
      records = await this.backend.load();
    } catch (error) {
      return err(toStorageError(error));
    }

    const bad: unknown[] = [];
    for (const record of records) {
      const outcome = readEntry(record);
      if (outcome.kind === 'ok') {
        this.entries.set(outcome.entry.id, outcome.entry);
      } else if (outcome.kind === 'future') {
        // Left on disk untouched. A newer build must find its own data intact.
        this.fromNewerVersion += 1;
      } else {
        bad.push(record);
      }
    }

    if (bad.length > 0) {
      this.quarantined = bad.length;
      // Moved aside, never deleted: a record that failed validation may still
      // be the only copy of something the user wrote (§7.4).
      await this.safely(async () => {
        await this.backend.quarantine(bad.slice(0, MAX_QUARANTINED));
        const ids = bad.map(idOf).filter((id): id is string => id !== null);
        if (ids.length > 0) await this.backend.remove(ids);
      });
    }

    this.loaded = true;
    return ok(undefined);
  }

  /** Runs a write, turning a throw into a degraded state rather than a crash. */
  private async safely(write: () => Promise<void>): Promise<StorageError | null> {
    try {
      await write();
      return null;
    } catch (error) {
      if (!isQuotaError(error)) this.degraded = true;
      return toStorageError(error);
    }
  }

  private snapshot(): HistoryEntry[] {
    return [...this.entries.values()];
  }

  async list(query: HistoryQuery): Promise<Result<HistoryPage, StorageError>> {
    const loaded = await this.ensureLoaded();
    if (!loaded.ok) return loaded;
    return ok(
      queryEntries(this.snapshot(), query, {
        fromNewerVersion: this.fromNewerVersion,
        quarantined: this.quarantined,
      }),
    );
  }

  async get(id: string): Promise<Result<HistoryEntry | null, StorageError>> {
    const loaded = await this.ensureLoaded();
    if (!loaded.ok) return loaded;
    return ok(this.entries.get(id) ?? null);
  }

  async save(candidate: NewHistoryEntry): Promise<Result<HistoryEntry, StorageError>> {
    const loaded = await this.ensureLoaded();
    if (!loaded.ok) return loaded;

    const now = Date.now();
    const { input, truncated } = truncateInput(candidate.input);
    const existing = findDuplicate(this.snapshot(), candidate.type, input, now);

    // A repeat within the dedupe window refreshes the existing entry rather
    // than adding a near-identical row — but a title the user typed themselves
    // is never overwritten by a derived one.
    const title = existing?.isCustomTitle === true ? existing.title : candidate.title;

    const entry: HistoryEntry = existing
      ? {
          ...existing,
          title,
          metadata: candidate.metadata,
          lastOpenedAt: now,
          searchText: buildSearchText(title, input),
        }
      : {
          id: newId(),
          schemaVersion: CURRENT_SCHEMA_VERSION,
          type: candidate.type,
          title,
          isCustomTitle: false,
          input,
          inputTruncated: truncated,
          metadata: candidate.metadata,
          createdAt: now,
          lastOpenedAt: now,
          openCount: 1,
          pinned: false,
          tags: [],
          searchText: buildSearchText(title, input),
        };

    const failure = await this.write(entry);
    if (failure !== null) return err(failure);

    this.entries.set(entry.id, entry);
    await this.trimToCap();
    return ok(entry);
  }

  /**
   * Writes one entry, making room and retrying once if storage is full.
   *
   * The retry is not a blind repeat: the first attempt failed for space, and
   * the second happens only after space was actually freed. If pruning can
   * free nothing — every entry pinned — the failure is reported rather than
   * escalated into deleting something the user protected (§5.2).
   */
  private async write(entry: HistoryEntry): Promise<StorageError | null> {
    const failure = await this.safely(() => this.backend.put([entry]));
    if (failure?.code !== 'QUOTA') return failure;

    const victims = selectForPruning(this.snapshot(), pruneBatchSize(this.entries.size));
    if (victims.length === 0) {
      return storageError(
        'QUOTA',
        'History storage is full and every saved entry is pinned.',
        'Unpin or delete some entries, or export them, to make room.',
      );
    }

    await this.prune(victims);

    const retry = await this.safely(() => this.backend.put([entry]));
    if (retry !== null) this.degraded = true;
    return retry;
  }

  private async prune(victims: readonly HistoryEntry[]): Promise<void> {
    const failure = await this.safely(() =>
      this.backend.remove(victims.map((victim) => victim.id)),
    );
    // The in-memory set follows the backend, not the intent: if the delete did
    // not happen, the entries are still there and must still be listed.
    if (failure !== null) return;
    for (const victim of victims) this.entries.delete(victim.id);
  }

  /** Keeps the store at its entry cap after a successful save. */
  private async trimToCap(): Promise<void> {
    const excess = overCapBy(this.entries.size);
    if (excess === 0) return;
    const victims = selectForPruning(this.snapshot(), excess);
    if (victims.length > 0) await this.prune(victims);
  }

  async update(id: string, patch: HistoryPatch): Promise<Result<HistoryEntry, StorageError>> {
    const loaded = await this.ensureLoaded();
    if (!loaded.ok) return loaded;

    const existing = this.entries.get(id);
    if (!existing) {
      return err(storageError('VALIDATION', 'That history entry no longer exists.'));
    }

    const title = patch.title ?? existing.title;
    if (title.trim() === '') {
      return err(storageError('VALIDATION', 'A history entry needs a name.'));
    }

    const updated: HistoryEntry = {
      ...existing,
      title,
      isCustomTitle: patch.isCustomTitle ?? existing.isCustomTitle,
      pinned: patch.pinned ?? existing.pinned,
      lastOpenedAt: patch.lastOpenedAt ?? existing.lastOpenedAt,
      openCount: patch.openCount ?? existing.openCount,
      searchText: buildSearchText(title, existing.input),
    };

    const failure = await this.write(updated);
    if (failure !== null) return err(failure);

    this.entries.set(id, updated);
    return ok(updated);
  }

  async delete(id: string): Promise<Result<void, StorageError>> {
    const loaded = await this.ensureLoaded();
    if (!loaded.ok) return loaded;

    const failure = await this.safely(() => this.backend.remove([id]));
    if (failure !== null) return err(failure);
    this.entries.delete(id);
    return ok(undefined);
  }

  async clear(): Promise<Result<void, StorageError>> {
    const loaded = await this.ensureLoaded();
    if (!loaded.ok) return loaded;

    const failure = await this.safely(() => this.backend.clear());
    if (failure !== null) return err(failure);

    this.entries.clear();
    // Cleared means cleared: the counts of hidden and quarantined records go
    // with it, or the UI would keep reporting data that is no longer there.
    this.fromNewerVersion = 0;
    this.quarantined = 0;
    return ok(undefined);
  }

  async count(): Promise<Result<number, StorageError>> {
    const loaded = await this.ensureLoaded();
    if (!loaded.ok) return loaded;
    return ok(this.entries.size);
  }

  async exportAll(): Promise<Result<ExportEnvelope, StorageError>> {
    const loaded = await this.ensureLoaded();
    if (!loaded.ok) return loaded;
    const all = this.snapshot().sort((a, b) => a.createdAt - b.createdAt);
    return ok(buildEnvelope(all, __APP_VERSION__));
  }

  async importAll(
    envelope: unknown,
    mode: 'merge' | 'replace',
  ): Promise<Result<ImportReport, StorageError>> {
    const loaded = await this.ensureLoaded();
    if (!loaded.ok) return loaded;

    const parsed = readEnvelope(envelope);
    if (typeof parsed === 'string') return err(storageError('VALIDATION', parsed));

    if (mode === 'replace') {
      const cleared = await this.clear();
      if (!cleared.ok) return cleared;
    }

    const { incoming, imported, updated } = this.reconcile(parsed.entries);

    if (incoming.length > 0) {
      const failure = await this.safely(() => this.backend.put(incoming));
      if (failure !== null) return err(failure);
      for (const entry of incoming) this.entries.set(entry.id, entry);
      await this.trimToCap();
    }

    return ok({ imported, updated, skipped: parsed.skipped, reasons: parsed.reasons });
  }

  /**
   * Decides which imported entries to keep.
   *
   * A shared id means the same entry seen twice, so the more recently used
   * copy wins and importing an old backup cannot undo today's work.
   */
  private reconcile(candidates: readonly HistoryEntry[]): {
    incoming: HistoryEntry[];
    imported: number;
    updated: number;
  } {
    const incoming: HistoryEntry[] = [];
    let imported = 0;
    let updated = 0;

    for (const entry of candidates) {
      const existing = this.entries.get(entry.id);
      if (existing === undefined) {
        imported += 1;
      } else if (existing.lastOpenedAt >= entry.lastOpenedAt) {
        continue;
      } else {
        updated += 1;
      }
      incoming.push(entry);
    }

    return { incoming, imported, updated };
  }
}

/* ------------------------------------------------------------------ *
 * Backends
 * ------------------------------------------------------------------ */

/**
 * In-memory storage, used when IndexedDB is unavailable.
 *
 * History is an enhancement, so a browser that refuses storage still gets a
 * working list for the session — it simply reports that nothing is being
 * saved, rather than pretending otherwise.
 */
export function createMemoryBackend(): HistoryBackend {
  let records: HistoryEntry[] = [];
  return {
    durable: false,
    load: () => Promise.resolve([...records]),
    put: (entries) => {
      const ids = new Set(entries.map((entry) => entry.id));
      records = [...records.filter((record) => !ids.has(record.id)), ...entries];
      return Promise.resolve();
    },
    remove: (ids) => {
      records = records.filter((record) => !ids.includes(record.id));
      return Promise.resolve();
    },
    clear: () => {
      records = [];
      return Promise.resolve();
    },
    quarantine: () => Promise.resolve(),
  };
}

const QUARANTINE_KEY = 'quarantine';

/**
 * IndexedDB stores structured clones, which reject anything exotic. Entries are
 * plain data by construction, but `tags` is rebuilt as a real array so a frozen
 * or proxied value can never reach the clone algorithm.
 */
function cloneable(entries: readonly HistoryEntry[]): HistoryEntry[] {
  return entries.map((entry) => ({ ...entry, tags: [...entry.tags] }));
}

export function createIdbBackend(db: IDBDatabase): HistoryBackend {
  return {
    durable: true,
    load: () => getAll(db, STORE_HISTORY),
    put: (entries) => putMany(db, STORE_HISTORY, cloneable(entries)),
    remove: (ids) => removeMany(db, STORE_HISTORY, [...ids]),
    clear: () => clearStore(db, STORE_HISTORY),
    quarantine: async (records) => {
      // `{ key, value }`, the shape the `meta` store is specified to hold
      // (06_DATA_STORAGE.md §2.2), rather than a shape unique to this caller.
      const stored = (await getOne(db, STORE_META, QUARANTINE_KEY)) as
        { value?: { records?: unknown } } | undefined;
      const previous = stored?.value?.records;
      const kept: unknown[] = Array.isArray(previous) ? (previous as unknown[]) : [];
      await put(db, STORE_META, {
        key: QUARANTINE_KEY,
        value: { records: [...kept, ...records].slice(-MAX_QUARANTINED), at: Date.now() },
      });
    },
  };
}

/**
 * Builds the repository the application uses, falling back rather than failing.
 *
 * The reason for any degradation is returned alongside, so the UI can say *why*
 * history is not being saved instead of silently dropping it.
 */
export async function createHistoryRepository(
  listener?: DbListener,
): Promise<{ repository: HistoryStore; error: StorageError | null }> {
  const opened = await openDatabase(listener);
  if (!opened.ok) {
    return { repository: new HistoryStore(createMemoryBackend()), error: opened.error };
  }
  return { repository: new HistoryStore(createIdbBackend(opened.value)), error: null };
}
