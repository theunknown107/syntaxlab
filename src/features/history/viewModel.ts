import type { HistoryEntry, HistoryPage, StorageError } from '@/domain/history/entry';

/**
 * History presentation — 10_COMPONENT_ARCHITECTURE.md §4
 *
 * Pure functions turning state into what the drawer renders. Kept out of the
 * components so the wording and the grouping can be unit-tested without a DOM,
 * which is where the mistakes in this feature actually are: a plural, a
 * misleading privacy claim, a count that says "0 more".
 */

export interface EntrySummary {
  /** Short, factual line under the title. Never the raw input. */
  readonly detail: string;
  readonly typeLabel: string;
}

export function summarise(entry: HistoryEntry): EntrySummary {
  if (entry.metadata.type === 'regex') {
    const groups = entry.metadata.groupCount;
    const parts = [
      entry.metadata.flags === '' ? 'no flags' : `flags ${entry.metadata.flags}`,
      `${groups} ${groups === 1 ? 'group' : 'groups'}`,
    ];
    if (entry.metadata.hadErrors) parts.push('had errors');
    return { detail: parts.join(' · '), typeLabel: 'Regex' };
  }

  const values = entry.metadata.nodeCount;
  return {
    detail: `${values.toLocaleString('en')} ${values === 1 ? 'value' : 'values'} · depth ${entry.metadata.maxDepth} · ${formatBytes(entry.metadata.byteLength)}`,
    typeLabel: 'JSON',
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * A relative time, coarse on purpose.
 *
 * Minute-accurate timestamps on a list of saved patterns are noise; what the
 * user is scanning for is "today" versus "a while ago".
 */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  return new Date(timestamp).toLocaleDateString('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * What an empty list should say.
 *
 * Three different situations, three different sentences. "No results" when
 * history is paused would leave a user wondering why analysing something
 * changes nothing (08_UI_UX_SPEC.md §8).
 */
export function emptyMessage(filtered: boolean, paused: boolean): string {
  if (filtered) return 'No entries match that search or filter.';
  if (paused) {
    return 'History is paused, so nothing new is being saved. Resume it from the header or below.';
  }
  return 'Analyses you work on are saved here automatically, a couple of seconds after they settle.';
}

/** What the list header says, including whether a filter is hiding anything. */
export function countLabel(page: HistoryPage, filtered: boolean): string {
  const shown = page.entries.length;
  const noun = page.total === 1 ? 'entry' : 'entries';

  if (page.total === 0) return filtered ? 'No matches' : 'Nothing saved yet';
  if (shown < page.total) return `${shown} of ${page.total.toLocaleString('en')} ${noun}`;
  return `${page.total.toLocaleString('en')} ${noun}`;
}

/**
 * Notes about records this build kept but cannot show.
 *
 * Reported rather than hidden. A user whose entries silently vanished after
 * opening an old tab has no way to know what happened, or that the data is
 * still there.
 */
export function integrityNotes(page: HistoryPage): readonly string[] {
  const notes: string[] = [];
  if (page.fromNewerVersion > 0) {
    notes.push(
      `${page.fromNewerVersion} ${page.fromNewerVersion === 1 ? 'entry was' : 'entries were'} saved by a newer version of SyntaxLab. They are kept, but this version cannot show them.`,
    );
  }
  if (page.quarantined > 0) {
    notes.push(
      `${page.quarantined} ${page.quarantined === 1 ? 'entry' : 'entries'} could not be read and ${page.quarantined === 1 ? 'was' : 'were'} set aside rather than deleted.`,
    );
  }
  return notes;
}

/**
 * What the drawer says about where entries live.
 *
 * Carefully bounded. This describes what the application does — it keeps data
 * in this browser and sends none of it anywhere — and stops there. It does not
 * promise that the data *cannot* leave: the browser profile may sync, the
 * device may be shared, and a claim of absolute privacy the architecture
 * cannot enforce would be worse than no claim at all (05_SECURITY.md §11).
 */
export const STORAGE_NOTE =
  'History is stored in this browser and is not sent to any server. Anyone with access to this browser profile can read it. Browsers can clear site storage on their own, so treat exports — not this list — as the backup.';

export const NOT_DURABLE_NOTE =
  'This browser is not allowing SyntaxLab to save history, so entries will be lost when the tab closes. Analysis is unaffected.';

/**
 * How much room history is using.
 *
 * `navigator.storage.estimate()` reports the whole origin, not this feature,
 * and browsers deliberately blur it. The wording says "about" for that reason
 * rather than presenting a rounded number as exact.
 */
export function usageLabel(usage: number | null, quota: number | null): string {
  if (usage === null) return 'This browser does not report how much storage is in use.';
  if (quota === null || quota === 0) return `About ${formatBytes(usage)} in use by this site.`;
  return `About ${formatBytes(usage)} in use by this site, of roughly ${formatBytes(quota)} available.`;
}

/** Turns a storage failure into something a user can act on. */
export function errorNote(error: StorageError): { title: string; hint: string | null } {
  return { title: error.message, hint: error.hint ?? null };
}
