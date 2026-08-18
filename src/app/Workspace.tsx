import { RegexWorkspace } from '@/features/regex/RegexWorkspace';
import { workspaceStore } from '@/application/stores/workspaceStore';
import { useStore } from '@/components/hooks/useStore';
import { JsonPlaceholder } from './JsonPlaceholder';
import styles from './Workspace.module.css';

/**
 * Mode switch — 08_UI_UX_SPEC.md §4
 *
 * Mode is state, not a route (ADR-009), so this is a plain branch rather than
 * a router. The regex feature is the whole workspace in regex mode, including
 * its own error boundaries, because the boundary placement depends on which
 * pane holds the input.
 *
 * JSON keeps its empty state until M6. It is shown as a real, selectable mode
 * with an honest "not built yet" panel rather than being hidden or disabled,
 * because a disabled segment reads as broken (§2.1).
 */
export function Workspace(): React.JSX.Element {
  const mode = useStore(workspaceStore, (state) => state.mode);

  return (
    <div className={styles.workspace}>
      {mode === 'regex' ? <RegexWorkspace /> : <JsonPlaceholder />}
    </div>
  );
}
