import { ModeSelector } from './ModeSelector';
import styles from './Header.module.css';

/**
 * Application header — 08_UI_UX_SPEC.md §6
 *
 * M1 ships the wordmark and the mode selector. The history, theme, and help
 * controls arrive with the features they open (M7, M8, M10). Rendering them
 * now as inert buttons would be exactly the "disabled affordance" the UX spec
 * rules out (§2.1): a control that does nothing reads as broken, not pending.
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
      </div>
    </header>
  );
}
