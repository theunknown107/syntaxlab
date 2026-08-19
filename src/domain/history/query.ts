import { LIMITS } from '../shared/limits';
import type { HistoryEntry, HistoryPage, HistoryQuery, HistoryType } from './entry';

/**
 * Querying, sorting and pruning — 06_DATA_STORAGE.md §2.1, §5
 *
 * Pure functions over an array, deliberately. At the 500-entry cap a full scan
 * is sub-millisecond, and the alternative — pushing filters into IndexedDB
 * cursors — would produce two implementations of "what the list shows" that
 * could disagree. One implementation, shared by both repositories, is the one
 * the tests can exercise exhaustively without a database.
 */

/** Pinned first, then by the chosen field, newest first. */
function compare(a: HistoryEntry, b: HistoryEntry, sort: HistoryQuery['sort']): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const field = sort === 'created' ? 'createdAt' : 'lastOpenedAt';
  if (b[field] !== a[field]) return b[field] - a[field];
  // A stable tiebreak, so two entries saved in the same millisecond do not
  // swap places between renders.
  return a.id < b.id ? -1 : 1;
}

function matches(entry: HistoryEntry, query: HistoryQuery): boolean {
  if (query.type !== undefined && entry.type !== query.type) return false;
  if (query.pinnedOnly === true && !entry.pinned) return false;

  const search = query.search?.trim().toLowerCase() ?? '';
  // Substring, not fuzzy. A developer searching `\d+` means those characters,
  // and a fuzzy matcher would rank an unrelated entry above the exact one.
  return search === '' || entry.searchText.includes(search);
}

export function queryEntries(
  entries: readonly HistoryEntry[],
  query: HistoryQuery,
  counts: { readonly fromNewerVersion: number; readonly quarantined: number },
): HistoryPage {
  const matched = entries.filter((entry) => matches(entry, query));
  const sorted = [...matched].sort((a, b) => compare(a, b, query.sort));
  return {
    entries: sorted.slice(0, query.limit),
    total: matched.length,
    fromNewerVersion: counts.fromNewerVersion,
    quarantined: counts.quarantined,
  };
}

/**
 * Finds a recent entry with identical content, so a save can update it instead.
 *
 * Without this, editing one pattern for a minute leaves twenty near-identical
 * rows and buries yesterday's work. The window is deliberately short: the same
 * pattern revisited tomorrow is a genuinely separate session (§4.2).
 */
export function findDuplicate(
  entries: readonly HistoryEntry[],
  type: HistoryType,
  input: string,
  now: number,
): HistoryEntry | null {
  for (const entry of entries) {
    if (entry.type !== type || entry.input !== input) continue;
    if (now - entry.createdAt <= LIMITS.history.dedupeWindowMs) return entry;
  }
  return null;
}

/**
 * Chooses entries to drop when the cap or the quota is reached.
 *
 * **Pinned entries are never candidates**, at any pressure. A user who pinned
 * something said it matters; silently deleting it to make room for an
 * autosave would be the worst thing this feature could do (§5.2). If every
 * entry is pinned, nothing is pruned and the save fails honestly instead.
 *
 * Oldest by `lastOpenedAt`, not `createdAt`: an old entry opened this morning
 * is in use, and a new one never reopened is not.
 */
export function selectForPruning(entries: readonly HistoryEntry[], count: number): HistoryEntry[] {
  if (count <= 0) return [];
  return [...entries]
    .filter((entry) => !entry.pinned)
    .sort((a, b) => a.lastOpenedAt - b.lastOpenedAt)
    .slice(0, count);
}

/** How many entries to drop when a write fails for space. 10% at a time (§5.3). */
export function pruneBatchSize(total: number): number {
  return Math.max(1, Math.ceil(total * 0.1));
}

/** How far over the entry cap the store is, for a routine post-save trim. */
export function overCapBy(total: number): number {
  return Math.max(0, total - LIMITS.history.maxEntries);
}
