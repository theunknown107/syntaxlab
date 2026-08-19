import {
  registerServiceWorker,
  type PwaEvent,
  type ServiceWorkerHandle,
} from '@/infrastructure/pwa/registerServiceWorker';

import { createStore } from '../stores/createStore';

/**
 * Offline and update state — 07_PWA_OFFLINE.md §5
 *
 * The entire offline UI budget is one chip, one toast and one dismissible
 * banner. This store holds exactly enough to render those and nothing more.
 *
 * **Being offline is not an error state.** Every analysis SyntaxLab performs
 * is local computation, so with the application cached there is nothing the
 * network was providing. The chip exists to answer "will this still work?",
 * not to apologise.
 */

export interface PwaState {
  /** From `navigator.onLine` — see the caveat on `startNetworkWatch`. */
  readonly online: boolean;
  /** A new version is installed and waiting for the user to accept it. */
  readonly updateAvailable: boolean;
  /** The update banner was dismissed this session. Re-offered on next load. */
  readonly updateDismissed: boolean;
  /** Shown once, the first time the app becomes offline-capable. */
  readonly offlineReady: boolean;
  /**
   * Set when the service worker could not be registered. The application
   * works; it will not work offline. Only surfaced if the user goes offline,
   * because until then it changes nothing they can see.
   */
  readonly offlineUnavailable: boolean;
}

const INITIAL: PwaState = {
  // Assume online when the browser will not say. A wrong "offline" chip on a
  // working connection is more confusing than no chip.
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  updateAvailable: false,
  updateDismissed: false,
  offlineReady: false,
  offlineUnavailable: false,
};

export const pwaStore = createStore<PwaState>(INITIAL);

let handle: ServiceWorkerHandle | null = null;

function onEvent(event: PwaEvent): void {
  pwaStore.setState((previous) => {
    switch (event.kind) {
      case 'update-available':
        return { ...previous, updateAvailable: true, updateDismissed: false };
      case 'offline-ready':
        return { ...previous, offlineReady: true };
      case 'unavailable':
        return { ...previous, offlineUnavailable: true };
    }
  });
}

/**
 * Starts registration and network watching. Called once, from the shell.
 *
 * **`navigator.onLine` is a heuristic**, and a well-known one: it reports
 * whether a network interface exists, not whether anything is reachable. That
 * is adequate here precisely because the application makes no requests — we
 * never need to know if a server is reachable, only whether to show a chip.
 * We deliberately do not probe an endpoint to find out: that would breach
 * `connect-src 'none'` and the privacy promise, for a cosmetic indicator.
 */
export function startPwa(): () => void {
  handle = registerServiceWorker(onEvent);

  const setOnline = (online: boolean): void => {
    pwaStore.setState((previous) =>
      previous.online === online ? previous : { ...previous, online },
    );
  };
  const goOnline = (): void => {
    setOnline(true);
  };
  const goOffline = (): void => {
    setOnline(false);
  };

  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);

  return () => {
    window.removeEventListener('online', goOnline);
    window.removeEventListener('offline', goOffline);
    handle?.dispose();
    handle = null;
  };
}

/**
 * Applies a waiting update.
 *
 * Only ever from an explicit user action. The editor contents are written to
 * `sessionStorage` first so the reload does not cost the user their work
 * (§4.1 rule 5); the shell restores them on the way back up.
 */
export function applyUpdate(snapshot: string | null): void {
  if (snapshot !== null) {
    try {
      sessionStorage.setItem(PENDING_KEY, snapshot);
    } catch {
      // Storage refused. The update is still worth applying; losing an
      // unsaved editor buffer is bad, but silently refusing to update is
      // worse, and the user asked for this explicitly.
    }
  }
  handle?.applyUpdate();
}

export function dismissUpdate(): void {
  pwaStore.setState((previous) => ({ ...previous, updateDismissed: true }));
}

export function acknowledgeOfflineReady(): void {
  pwaStore.setState((previous) => ({ ...previous, offlineReady: false }));
}

export const PENDING_KEY = 'syntaxlab.pendingInput';

/** Reads and clears whatever was preserved across an update reload. */
export function takePendingInput(): string | null {
  try {
    const value = sessionStorage.getItem(PENDING_KEY);
    if (value !== null) sessionStorage.removeItem(PENDING_KEY);
    return value;
  } catch {
    return null;
  }
}

/** Test seam. Production code registers through `startPwa`. */
export function __setHandleForTests(next: ServiceWorkerHandle | null): void {
  handle = next;
  pwaStore.reset();
}
