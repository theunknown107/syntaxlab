import { RegexWorkspace } from '@/features/regex/RegexWorkspace';
import { JsonWorkspace } from '@/features/json/JsonWorkspace';
import { CronWorkspace } from '@/features/cron/CronWorkspace';
import { workspaceStore, type AnalysisMode } from '@/application/stores/workspaceStore';
import { useStore } from '@/components/hooks/useStore';
import styles from './Workspace.module.css';

/**
 * Mode switch — 08_UI_UX_SPEC.md §4
 *
 * Mode is state, not a route (ADR-009), so this is a plain branch rather than
 * a router.
 *
 * All three modes are real features. Each owns its own two-column layout and
 * its own error boundaries, because where a boundary belongs depends on which
 * pane holds the input the user cannot afford to lose.
 *
 * A `switch` rather than a chain of ternaries: adding a fourth mode should be
 * a compile error here, not a silent fall-through to whichever branch happened
 * to be last.
 */
export function Workspace(): React.JSX.Element {
  const mode = useStore(workspaceStore, (state) => state.mode);

  return <div className={styles.workspace}>{workspaceFor(mode)}</div>;
}

function workspaceFor(mode: AnalysisMode): React.JSX.Element {
  switch (mode) {
    case 'regex':
      return <RegexWorkspace />;
    case 'json':
      return <JsonWorkspace />;
    case 'cron':
      return <CronWorkspace />;
  }
}
