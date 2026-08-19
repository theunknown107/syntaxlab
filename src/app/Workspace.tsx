import { RegexWorkspace } from '@/features/regex/RegexWorkspace';
import { JsonWorkspace } from '@/features/json/JsonWorkspace';
import { workspaceStore } from '@/application/stores/workspaceStore';
import { useStore } from '@/components/hooks/useStore';
import styles from './Workspace.module.css';

/**
 * Mode switch — 08_UI_UX_SPEC.md §4
 *
 * Mode is state, not a route (ADR-009), so this is a plain branch rather than
 * a router.
 *
 * Both modes are now real features. Each owns its own two-column layout and
 * its own error boundaries, because where a boundary belongs depends on which
 * pane holds the input the user cannot afford to lose.
 */
export function Workspace(): React.JSX.Element {
  const mode = useStore(workspaceStore, (state) => state.mode);

  return (
    <div className={styles.workspace}>
      {mode === 'regex' ? <RegexWorkspace /> : <JsonWorkspace />}
    </div>
  );
}
