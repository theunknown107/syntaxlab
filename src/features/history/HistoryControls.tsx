import { useEffect, useState } from 'react';

import { setHistoryEnabled } from '@/application/history/capture';
import { connectTabs, historyStore, refresh } from '@/application/history/historyStore';
import { settingsStore, updateSettings } from '@/application/stores/settingsStore';
import { useStore } from '@/components/hooks/useStore';

import { HistoryDrawer } from './HistoryDrawer';
import styles from './history.module.css';

/**
 * Header controls and the first-run notice — 08_UI_UX_SPEC.md §19.1
 *
 * Two controls, both always visible: open history, and pause it. Pause is in
 * the header rather than buried in settings because it is the control a user
 * reaches for when they are about to paste something they would rather not
 * have recorded, and at that moment it needs to be one click away.
 */

export function HistoryControls(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const enabled = useStore(settingsStore, (value) => value.historyEnabled);
  const total = useStore(historyStore, (value) => value.page.total);

  useEffect(() => {
    const disconnect = connectTabs();
    // One read at startup, so the count in the header is real before the
    // drawer has ever been opened.
    void refresh();
    return disconnect;
  }, []);

  return (
    <>
      <div className={styles.controlsGroup}>
        <button
          type="button"
          className={styles.headerButton}
          onClick={() => {
            setOpen(true);
          }}
        >
          History
          {total > 0 ? <span className={styles.countPill}>{total}</span> : null}
        </button>

        <button
          type="button"
          className={styles.headerButton}
          aria-pressed={!enabled}
          // The label states the current state, not only the action, because
          // a toggle that reads "Pause" gives no clue whether it is already on.
          aria-label={enabled ? 'History is on. Pause history.' : 'History is paused. Resume it.'}
          onClick={() => {
            setHistoryEnabled(!enabled);
          }}
        >
          {enabled ? 'Pause' : 'Paused'}
        </button>
      </div>

      <HistoryDrawer
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/**
 * A one-time explanation of what history does.
 *
 * A banner rather than a modal: this is information, and blocking the app to
 * deliver it would interrupt someone who came here to read a regex. It offers
 * the opt-out directly, so a user who does not want history never has to go
 * looking for the setting.
 */
export function HistoryNotice(): React.JSX.Element | null {
  const seen = useStore(settingsStore, (value) => value.hasSeenHistoryNotice);
  if (seen) return null;

  const acknowledge = (): void => {
    updateSettings({ hasSeenHistoryNotice: true });
  };

  return (
    <aside className={styles.notice} aria-label="About history">
      <p className={styles.noticeText}>
        SyntaxLab now saves what you analyse, in this browser, so you can come back to it. It is
        not sent to a server. You can pause it at any time from the header.
      </p>
      <div className={styles.noticeActions}>
        <button type="button" className={styles.noticeButton} onClick={acknowledge}>
          Got it
        </button>
        <button
          type="button"
          className={styles.noticeButton}
          onClick={() => {
            setHistoryEnabled(false);
            acknowledge();
          }}
        >
          Turn history off
        </button>
      </div>
    </aside>
  );
}
