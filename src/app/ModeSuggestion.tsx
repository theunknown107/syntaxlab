import { useEffect } from 'react';
import { dismissSuggestion, suggestionFor } from '@/application/json/jsonWorkspace';
import { MODE_LABELS, setMode, workspaceStore } from '@/application/stores/workspaceStore';
import { useStore } from '@/components/hooks/useStore';
import { Button } from '@/components/primitives/Button';
import styles from './ModeSuggestion.module.css';

/**
 * The detection suggestion bar — 08_UI_UX_SPEC.md §3, §4
 *
 * Detection **suggests, never traps.** Three rules, all visible in the code
 * below:
 *
 *   - A switch happens on its own only when confidence is at or above the
 *     auto-select line *and* the other mode's editor is empty. Switching out
 *     from under someone mid-edit is the failure this exists to avoid.
 *   - Below that, it offers, and the offer is dismissible.
 *   - Dismissal lasts the session. It is deliberately not persisted: a user
 *     who dismissed it last week should still be told when they paste JSON
 *     today.
 *
 * There is no cron branch, because cron does not exist in V1.0 — not as a
 * button, not as a disabled button, and not as a detection result nothing can
 * act on.
 */
export function ModeSuggestion(): React.JSX.Element | null {
  const state = useStore(workspaceStore, (current) => current);
  const suggestion = suggestionFor(state);
  const detected = state.detected;

  // The auto-switch. In an effect rather than during render because it is a
  // state change, and it only ever fires into an empty editor.
  useEffect(() => {
    if (suggestion.auto && detected && detected.type !== state.mode) setMode(detected.type);
  }, [suggestion.auto, detected, state.mode]);

  if (!suggestion.show || !detected || detected.type === 'unknown') return null;

  const label = MODE_LABELS[detected.type];

  return (
    <div className={styles.bar} role="status">
      <span className={styles.text}>
        This looks like {label === 'JSON' ? 'JSON' : 'a regular expression'}.
      </span>
      <Button
        onClick={() => {
          setMode(detected.type);
        }}
        variant="secondary"
      >
        Switch to {label}
      </Button>
      {/* Named for what it dismisses. Three different things in this app
          offer a "Dismiss" button, and a screen-reader user listing the
          buttons on the page would otherwise hear the same word three times
          with no way to tell them apart. The visible text is unchanged, and
          the accessible name still begins with it (WCAG 2.5.3). */}
      <Button onClick={dismissSuggestion} variant="ghost" ariaLabel="Dismiss this suggestion">
        Dismiss
      </Button>
    </div>
  );
}
