import { HistoryControls } from '@/features/history/HistoryControls';
import { OfflineChip } from '@/features/pwa/PwaStatus';
import { ThemeControls } from '@/features/theme/ThemeControls';

import { ModeSelector } from './ModeSelector';
import styles from './Header.module.css';

/**
 * Application header — 08_UI_UX_SPEC.md §6
 *
 * M1 shipped the wordmark and the mode selector; M7 added the history
 * controls and M8 the appearance control. The help control arrives with the
 * feature it opens (M10).
 * Rendering them now as inert buttons would be exactly the "disabled
 * affordance" the UX spec rules out (§2.1): a control that does nothing reads
 * as broken, not pending.
 */
export function Header(): React.JSX.Element {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>
            Syntax<span className={styles.wordmarkAccent}>Lab</span>
          </span>
          <span className={styles.tagline}>Understand developer syntax instantly.</span>
        </div>

        <nav className={styles.nav} aria-label="Analysis mode">
          <ModeSelector />
        </nav>

        <OfflineChip />
        <HistoryControls />
        <ThemeControls />
      </div>
    </header>
  );
}
