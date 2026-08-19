import { createStore } from './createStore';

/**
 * Settings — 06_DATA_STORAGE.md §6, 11_STATE_MANAGEMENT.md §5
 *
 * localStorage rather than IndexedDB, deliberately. Settings are a handful of
 * booleans that must be readable *synchronously during the first render* — the
 * app has to know whether history is paused before it saves anything, and an
 * async read would mean a window in which capture had already happened.
 *
 * The same rule as history applies: what comes back is untrusted. A user can
 * type anything into localStorage from a console, and a missing or corrupt
 * value must produce defaults rather than a broken app.
 */

const STORAGE_KEY = 'syntaxlab.settings.v1';

export interface Settings {
  /** Whether new analyses are captured. Off means nothing new is written. */
  readonly historyEnabled: boolean;
  /** Whether the first-run explanation has been shown and acknowledged. */
  readonly hasSeenHistoryNotice: boolean;
  readonly historySort: 'created' | 'opened';
}

export const DEFAULT_SETTINGS: Settings = {
  // On by default. History is the feature; a user who does not want it can
  // turn it off from the header or the first-run notice, both one click away.
  historyEnabled: true,
  hasSeenHistoryNotice: false,
  historySort: 'created',
};

function readStored(): Settings {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode and some enterprise policies throw on access rather than
    // returning null. Defaults are a working app; a throw here is a blank one.
    return DEFAULT_SETTINGS;
  }
  if (raw === null) return DEFAULT_SETTINGS;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;
    const record = parsed as Record<string, unknown>;
    // Field by field, with defaults for anything unrecognised, so a setting
    // added in a later version cannot make an older build unusable.
    return {
      historyEnabled: record.historyEnabled !== false,
      hasSeenHistoryNotice: record.hasSeenHistoryNotice === true,
      historySort: record.historySort === 'opened' ? 'opened' : 'created',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsStore = createStore<Settings>(readStored());

/**
 * Writes settings, tolerating a storage that refuses.
 *
 * A failure here is not reported to the user: settings still apply for the
 * session, and an error toast about a preference not persisting would be more
 * noise than the problem is worth. It is not silent about anything the user
 * would otherwise be misled by — history durability is reported separately.
 */
function persist(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignored on purpose. See above.
  }
}

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.setState((previous) => {
    const next: Settings = {
      historyEnabled: patch.historyEnabled ?? previous.historyEnabled,
      hasSeenHistoryNotice: patch.hasSeenHistoryNotice ?? previous.hasSeenHistoryNotice,
      historySort: patch.historySort ?? previous.historySort,
    };
    persist(next);
    return next;
  });
}

/** Re-reads from storage. Used when another tab changes a setting. */
export function reloadSettings(): void {
  settingsStore.setState(readStored());
}

export { STORAGE_KEY as SETTINGS_STORAGE_KEY };
