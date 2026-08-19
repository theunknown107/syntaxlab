import { Header } from './Header';
import { ModeSuggestion } from './ModeSuggestion';
import { StatusBar } from './StatusBar';
import { Workspace } from './Workspace';
import styles from './AppShell.module.css';

/**
 * Application shell — 08_UI_UX_SPEC.md §4
 *
 * One page, no router: mode is state, not a route (02_ARCHITECTURE.md ADR-009).
 *
 * Landmark structure is set here so every later feature inherits it:
 *   header  → banner
 *   main    → the workspace, skip-link target
 *   footer  → status
 */
export function AppShell(): React.JSX.Element {
  return (
    <>
      <a className="skipLink" href="#main">
        Skip to content
      </a>

      <Header />
      <ModeSuggestion />

      <main id="main" className={styles.main} tabIndex={-1}>
        <h1 className="srOnly">SyntaxLab — understand developer syntax instantly</h1>
        <Workspace />
      </main>

      <StatusBar />
    </>
  );
}
