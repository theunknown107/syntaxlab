import type {
  ExportEnvelope,
  HistoryEntry,
  HistoryPage,
  HistoryQuery,
  HistoryRepository,
  HistoryType,
  ImportReport,
  NewHistoryEntry,
  StorageError,
} from '@/domain/history/entry';
import { buildEnvelope } from '@/domain/history/transfer';
import { storageUsage } from '@/infrastructure/browser/capabilities';
import { deleteDatabase } from '@/infrastructure/storage/db';
import { createHistoryRepository } from '@/infrastructure/storage/historyRepository';

import { createStore } from '../stores/createStore';
import {
  reloadSettings,
  settingsStore,
  updateSettings,
  SETTINGS_STORAGE_KEY,
} from '../stores/settingsStore';

/**
 * History state and actions — 11_STATE_MANAGEMENT.md §5, 06_DATA_STORAGE.md §4
 *
 * Everything that touches storage goes through here, so no component ever
 * holds an IndexedDB transaction. Components read a page of entries and call
 * an action; whether that action reached disk, was deduplicated, or was
 * refused for space is decided in one place.
 *
 * **History is an enhancement.** Every failure below leaves Regex and JSON
 * analysis working. That is why `error` is a field to render rather than a
 * thrown exception, and why the repository falls back to memory rather than
 * refusing to exist.
 */

/** How long a deleted entry can be brought back. */
export const UNDO_WINDOW_MS = 5_000;

const EMPTY_PAGE: HistoryPage = {
  entries: [],
  total: 0,
  fromNewerVersion: 0,
  quarantined: 0,
};

export interface HistoryState {
  readonly page: HistoryPage;
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  /** Non-null when something went wrong that the user should see. */
  readonly error: StorageError | null;
  /** False when entries exist only for this session. Shown, never hidden. */
  readonly durable: boolean;
  readonly search: string;
  readonly typeFilter: HistoryType | null;
  readonly pinnedOnly: boolean;
  /** A just-deleted entry, recoverable until the window closes. */
  readonly pendingUndo: HistoryEntry | null;
  /**
   * True after storage refused a write for space even once room had been
   * made. Capture stops until the user acts, because the alternative is
   * retrying a failing write after every analysis for the rest of the session
   * (06_DATA_STORAGE.md §4, Degraded).
   */
  readonly captureSuspended: boolean;
  /** Origin-wide storage estimate, or null where the browser does not report one. */
  readonly usage: number | null;
  readonly quota: number | null;
}

const INITIAL: HistoryState = {
  page: EMPTY_PAGE,
  status: 'idle',
  error: null,
  durable: false,
  search: '',
  typeFilter: null,
  pinnedOnly: false,
  pendingUndo: null,
  captureSuspended: false,
  usage: null,
  quota: null,
};

export const historyStore = createStore<HistoryState>(INITIAL);

/** How many entries the drawer holds at once; the rest are reachable by search. */
const PAGE_LIMIT = 200;

let repository: HistoryRepository | null = null;
let opening: Promise<HistoryRepository> | null = null;
let channel: BroadcastChannel | null = null;
let undoTimer: ReturnType<typeof setTimeout> | null = null;

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/**
 * Opens storage once, no matter how many callers ask at the same time.
 *
 * The first analysis and the first drawer open can race; without the shared
 * promise they would open two connections and each read the store separately.
 */
async function ensureRepository(): Promise<HistoryRepository> {
  if (repository !== null) return repository;
  opening ??= createHistoryRepository().then(({ repository: created, error }) => {
    repository = created;
    if (error !== null) {
      historyStore.setState((previous) => ({ ...previous, error }));
    }
    return created;
  });
  return opening;
}

/**
 * Tells other tabs that history changed.
 *
 * Two tabs of the same app share one database, so a save in one must not leave
 * the other showing a stale list. The message carries no data — the other tab
 * re-reads, which keeps one validation path rather than trusting a payload
 * that arrived over a channel.
 */
function announce(): void {
  channel?.postMessage({ kind: 'history-changed' });
}

export function connectTabs(): () => void {
  // AppSettings live in localStorage, which already broadcasts its own changes
  // across tabs. Re-reading on that event costs nothing and keeps the pause
  // switch consistent everywhere without a second message type.
  const onStorage = (event: StorageEvent): void => {
    if (event.key === SETTINGS_STORAGE_KEY || event.key === null) reloadSettings();
  };
  window.addEventListener('storage', onStorage);

  if (typeof BroadcastChannel === 'undefined') {
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }

  channel = new BroadcastChannel('syntaxlab');
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (typeof message !== 'object' || message === null) return;
    if ((message as { kind?: unknown }).kind === 'history-changed') {
      // Another tab wrote. Drop the cached repository so the next read comes
      // from disk rather than from this tab's stale in-memory copy.
      repository = null;
      opening = null;
      void refresh();
    }
  };

  return () => {
    window.removeEventListener('storage', onStorage);
    channel?.close();
    channel = null;
  };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

function currentQuery(): HistoryQuery {
  const { search, typeFilter, pinnedOnly } = historyStore.getState();
  const query: HistoryQuery = {
    sort: settingsStore.getState().historySort,
    limit: PAGE_LIMIT,
    search,
    pinnedOnly,
  };
  return typeFilter === null ? query : { ...query, type: typeFilter };
}

export async function refresh(): Promise<void> {
  historyStore.setState((previous) => ({
    ...previous,
    status: previous.status === 'ready' ? 'ready' : 'loading',
  }));

  const repo = await ensureRepository();
  const result = await repo.list(currentQuery());

  historyStore.setState((previous) =>
    result.ok
      ? { ...previous, page: result.value, status: 'ready', durable: repo.durable, error: null }
      : { ...previous, status: 'failed', durable: repo.durable, error: result.error },
  );
}

export function setSearch(search: string): void {
  historyStore.setState((previous) => ({ ...previous, search }));
  void refresh();
}

export function setTypeFilter(typeFilter: HistoryType | null): void {
  historyStore.setState((previous) => ({ ...previous, typeFilter }));
  void refresh();
}

export function setPinnedOnly(pinnedOnly: boolean): void {
  historyStore.setState((previous) => ({ ...previous, pinnedOnly }));
  void refresh();
}

export function setSort(historySort: 'created' | 'opened'): void {
  updateSettings({ historySort });
  void refresh();
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** Applies a mutation, refreshing the list and telling other tabs. */
async function mutate(
  action: (repo: HistoryRepository) => Promise<{ ok: boolean; error?: StorageError }>,
): Promise<boolean> {
  const repo = await ensureRepository();
  const result = await action(repo);

  if (!result.ok) {
    historyStore.setState((previous) => ({
      ...previous,
      error: result.error ?? previous.error,
      durable: repo.durable,
    }));
    return false;
  }

  historyStore.setState((previous) => ({ ...previous, error: null }));
  await refresh();
  announce();
  return true;
}

/** Records one analysis. Called only by the capture policy. */
export async function saveEntry(candidate: NewHistoryEntry): Promise<boolean> {
  const saved = await mutate((repo) => repo.save(candidate));
  if (!saved && historyStore.getState().error?.code === 'QUOTA') {
    historyStore.setState((previous) => ({ ...previous, captureSuspended: true }));
  }
  return saved;
}

/**
 * Resumes automatic saving after the user has made room.
 *
 * Explicit rather than automatic: storage was full a moment ago, and silently
 * trying again would put the same failure back in front of them.
 */
export function resumeCapture(): void {
  historyStore.setState((previous) => ({ ...previous, captureSuspended: false, error: null }));
}

/**
 * Marks an entry as opened, for the "recently used" sort.
 *
 * A failure here is deliberately not surfaced: the user asked to open an
 * entry, and they got it. A warning that the *access time* could not be
 * recorded would be noise about something they never asked for.
 */
export async function touchEntry(entry: HistoryEntry): Promise<void> {
  const repo = await ensureRepository();
  const updated = await repo.update(entry.id, {
    lastOpenedAt: Date.now(),
    openCount: entry.openCount + 1,
  });
  if (updated.ok) {
    await refresh();
    announce();
  }
}

export async function rename(id: string, title: string): Promise<boolean> {
  return mutate((repo) => repo.update(id, { title: title.trim(), isCustomTitle: true }));
}

export async function setPinned(id: string, pinned: boolean): Promise<boolean> {
  return mutate((repo) => repo.update(id, { pinned }));
}

/**
 * Deletes an entry, keeping it recoverable for a few seconds.
 *
 * The delete is real and immediate rather than deferred: a tab closed during
 * the undo window must not resurrect something the user deleted. Undo re-adds
 * the entry through the same validated import path.
 */
export async function remove(id: string): Promise<boolean> {
  const repo = await ensureRepository();
  const existing = await repo.get(id);
  const entry = existing.ok ? existing.value : null;

  const removed = await mutate((target) => target.delete(id));
  if (!removed || entry === null) return removed;

  if (undoTimer !== null) clearTimeout(undoTimer);
  historyStore.setState((previous) => ({ ...previous, pendingUndo: entry }));
  undoTimer = setTimeout(() => {
    dismissUndo();
  }, UNDO_WINDOW_MS);

  return true;
}

export async function undoRemove(): Promise<boolean> {
  const entry = historyStore.getState().pendingUndo;
  if (entry === null) return false;

  dismissUndo();
  // Through import rather than a bespoke path, so a restored entry passes the
  // same validation as one that arrives from a file.
  return mutate((repo) => repo.importAll(buildEnvelope([entry], __APP_VERSION__), 'merge'));
}

export function dismissUndo(): void {
  if (undoTimer !== null) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
  historyStore.setState((previous) =>
    previous.pendingUndo === null ? previous : { ...previous, pendingUndo: null },
  );
}

/** Deletes everything, including pinned entries. Only ever called after a confirm. */
export async function clearAll(): Promise<boolean> {
  dismissUndo();
  return mutate((repo) => repo.clear());
}

/* ------------------------------------------------------------------ *
 * Transfer
 * ------------------------------------------------------------------ */

/**
 * Removes a database that cannot be opened, and starts again.
 *
 * Offered only when the database is genuinely unreadable, and only on an
 * explicit action — see `deleteDatabase`. This is the one operation in the
 * feature that destroys data without being able to show the user what it is
 * destroying, which is exactly why it is not automatic.
 */
export async function resetDatabase(): Promise<boolean> {
  const result = await deleteDatabase();
  if (!result.ok) {
    historyStore.setState((previous) => ({ ...previous, error: result.error }));
    return false;
  }

  repository = null;
  opening = null;
  historyStore.setState((previous) => ({
    ...previous,
    page: EMPTY_PAGE,
    error: null,
    captureSuspended: false,
  }));
  await refresh();
  announce();
  return true;
}

/** Re-reads the browser's storage estimate. Cheap, and only when asked. */
export async function refreshUsage(): Promise<void> {
  const { usage, quota } = await storageUsage();
  historyStore.setState((previous) => ({ ...previous, usage, quota }));
}

export async function exportAll(): Promise<ExportEnvelope | null> {
  const repo = await ensureRepository();
  const result = await repo.exportAll();
  if (result.ok) return result.value;
  historyStore.setState((previous) => ({ ...previous, error: result.error }));
  return null;
}

export async function importAll(
  envelope: unknown,
  mode: 'merge' | 'replace',
): Promise<ImportReport | null> {
  const repo = await ensureRepository();
  const result = await repo.importAll(envelope, mode);

  if (!result.ok) {
    historyStore.setState((previous) => ({ ...previous, error: result.error }));
    return null;
  }

  historyStore.setState((previous) => ({ ...previous, error: null }));
  await refresh();
  announce();
  return result.value;
}

/** Test seam. Production code opens its own repository. */
export function __setRepositoryForTests(next: HistoryRepository | null): void {
  repository = next;
  opening = null;
  historyStore.reset();
  dismissUndo();
}
