import { ErrorBoundary } from '@/components/ErrorBoundary';
import styles from './JsonPlaceholder.module.css';

/**
 * JSON mode's empty state — 08_UI_UX_SPEC.md §13
 *
 * JSON is a real selectable mode from M1; its feature is built at M6. Until
 * then the pane says so plainly rather than showing a control that does
 * nothing. The copy teaches what will be there, which is the role empty states
 * play in this product — there is no separate onboarding.
 */
export function JsonPlaceholder(): React.JSX.Element {
  return (
    <div className={styles.placeholder}>
      <ErrorBoundary scope="input">
        <section className={styles.pane} aria-labelledby="json-input-heading">
          <div className={styles.paneHeader}>
            <h2 id="json-input-heading" className={styles.paneTitle}>
              JSON input
            </h2>
          </div>
          <div className={styles.paneBody}>
            <p className={styles.emptyHeadline}>Paste some JSON.</p>
            <p className={styles.emptyBody}>
              Runs in your browser — the app does not upload what you paste.
            </p>
          </div>
        </section>
      </ErrorBoundary>

      <ErrorBoundary scope="analysis">
        <section className={styles.pane} aria-labelledby="json-analysis-heading">
          <div className={styles.paneHeader}>
            <h2 id="json-analysis-heading" className={styles.paneTitle}>
              Explanation
            </h2>
          </div>
          <div className={styles.paneBody}>
            <p className={styles.emptyBody}>Your explanation will appear here.</p>
          </div>
        </section>
      </ErrorBoundary>
    </div>
  );
}
