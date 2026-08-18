import { MODE_LABELS, workspaceStore } from '@/application/stores/workspaceStore';
import { useStore } from '@/components/hooks/useStore';
import { ErrorBoundary } from './ErrorBoundary';
import styles from './WorkspacePlaceholder.module.css';

/**
 * Workspace — 08_UI_UX_SPEC.md §4
 *
 * M1 builds the real two-pane layout, the real responsive behaviour, and the
 * real empty-state copy. What it does not contain is the editor and the
 * analysis panels, which arrive with their milestones (M4 regex, M6 JSON).
 *
 * This is deliberately the actual layout rather than a stub: the split, the
 * panel chrome, and the breakpoints are the parts that are expensive to change
 * later, so they are established now and the feature code drops into them.
 *
 * The build notice is scoped to development and disappears at M4 — it exists
 * so nobody mistakes a foundation build for a finished product.
 */
export function WorkspacePlaceholder(): React.JSX.Element {
  const mode = useStore(workspaceStore, (state) => state.mode);
  const label = MODE_LABELS[mode];

  return (
    <div className={styles.workspace}>
      <ErrorBoundary scope="input">
        <section className={styles.pane} aria-labelledby="input-pane-heading">
          <div className={styles.paneHeader}>
            <h2 id="input-pane-heading" className={styles.paneTitle}>
              {label} input
            </h2>
            {mode === 'regex' && (
              /* Permanent, non-dismissible flavour label. The tester runs the
                 browser's own engine, so a user must never assume PCRE or
                 Python equivalence (01_PRD.md §7.2, risk R-21). It is present
                 from M1 so it can never be forgotten at M4. */
              <span className={styles.flavourLabel}>ECMAScript (JavaScript)</span>
            )}
          </div>

          <div className={styles.paneBody}>
            <p className={styles.emptyHeadline}>
              {mode === 'regex' ? 'Paste a regular expression.' : 'Paste some JSON.'}
            </p>
            <p className={styles.emptyBody}>
              Runs in your browser — the app does not upload what you paste.
            </p>
          </div>
        </section>
      </ErrorBoundary>

      <ErrorBoundary scope="analysis">
        <section className={styles.pane} aria-labelledby="analysis-pane-heading">
          <div className={styles.paneHeader}>
            <h2 id="analysis-pane-heading" className={styles.paneTitle}>
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
