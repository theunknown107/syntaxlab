import styles from './StatusBar.module.css';

/**
 * Status bar — 08_UI_UX_SPEC.md §4
 *
 * The live region is established at M1 so every later feature inherits a
 * working announcement channel rather than bolting one on at M10.
 *
 * `aria-live="polite"` and not `assertive`: analysis results should be
 * announced when the screen reader reaches a natural pause, never by
 * interrupting the user mid-sentence (§12.2).
 */
interface StatusBarProps {
  /** Announced to assistive technology and shown as the status text. */
  readonly status?: string;
}

export function StatusBar({ status }: StatusBarProps): React.JSX.Element {
  return (
    <footer className={styles.statusBar}>
      <div className={styles.inner}>
        <p className={styles.status} role="status" aria-live="polite">
          {status ?? 'Ready'}
        </p>
        <p className={styles.privacy}>Runs locally in your browser</p>
      </div>
    </footer>
  );
}
