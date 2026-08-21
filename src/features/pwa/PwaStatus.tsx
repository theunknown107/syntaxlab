import { useEffect } from 'react';

import {
  acknowledgeOfflineReady,
  applyUpdate,
  dismissUpdate,
  pwaStore,
  startPwa,
} from '@/application/pwa/pwaStore';
import { workspaceStore } from '@/application/stores/workspaceStore';
import { useStore } from '@/components/hooks/useStore';

import styles from './pwa.module.css';

/**
 * Offline and update indication — 07_PWA_OFFLINE.md §5
 *
 * The whole offline UI, and it is deliberately almost nothing: a calm chip
 * when offline, one banner when a new version is waiting. No interstitial, no
 * red, no nagging. The application works offline, so telling the user it is
 * broken would be a lie.
 */

/** Registers the service worker and watches the network. Mounted once. */
export function PwaProvider(): null {
  useEffect(() => startPwa(), []);
  return null;
}

/**
 * The offline chip, for the header.
 *
 * `role="status"` with `aria-live="polite"`: a connection change is worth
 * announcing once, quietly, and must never move focus or interrupt what is
 * being read (13_ACCESSIBILITY.md).
 */
export function OfflineChip(): React.JSX.Element | null {
  const online = useStore(pwaStore, (state) => state.online);
  const unavailable = useStore(pwaStore, (state) => state.offlineUnavailable);

  if (online) return null;

  return (
    <span className={styles.chip} role="status">
      <span aria-hidden="true" className={styles.dot} />
      {unavailable ? 'Offline — not cached' : 'Offline'}
    </span>
  );
}

/**
 * The update banner.
 *
 * Dismissible, and re-offered on the next load rather than nagging in this
 * one. Nothing here reloads the page on its own: the button is the only path
 * to a reload, which is the single rule this whole feature exists to keep.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const available = useStore(pwaStore, (state) => state.updateAvailable);
  const dismissed = useStore(pwaStore, (state) => state.updateDismissed);
  const offlineReady = useStore(pwaStore, (state) => state.offlineReady);

  // One toast, once, the first time the app becomes usable offline.
  useEffect(() => {
    if (!offlineReady) return undefined;
    const timer = setTimeout(acknowledgeOfflineReady, 6000);
    return () => {
      clearTimeout(timer);
    };
  }, [offlineReady]);

  if (offlineReady && !available) {
    return (
      <aside className={styles.toast} role="status">
        <span>Ready to work offline.</span>
        <button
          type="button"
          className={styles.action}
          aria-label="Dismiss the offline notice"
          onClick={acknowledgeOfflineReady}
        >
          Dismiss
        </button>
      </aside>
    );
  }

  if (!available || dismissed) return null;

  return (
    <aside className={styles.banner} role="status" aria-label="Application update">
      <span className={styles.text}>
        A new version of SyntaxLab is ready. Reloading takes a moment and keeps what you are working
        on.
      </span>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            // The editor buffers travel across the reload, so accepting an
            // update never costs the user their work (§4.1 rule 5).
            const state = workspaceStore.getState();
            applyUpdate(
              JSON.stringify({
                mode: state.mode,
                pattern: state.pattern,
                flags: state.flags,
                testSubject: state.testSubject,
                jsonInput: state.jsonInput,
              }),
            );
          }}
        >
          Reload
        </button>
        <button type="button" className={styles.action} onClick={dismissUpdate}>
          Later
        </button>
      </div>
    </aside>
  );
}
