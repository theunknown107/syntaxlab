import { useCallback, useRef } from 'react';
import {
  ANALYSIS_MODES,
  MODE_LABELS,
  setMode,
  workspaceStore,
  type AnalysisMode,
} from '@/application/stores/workspaceStore';
import { useStore } from '@/components/hooks/useStore';
import styles from './ModeSelector.module.css';

/**
 * Mode selector — 08_UI_UX_SPEC.md §6
 *
 * Two segments in V1.0, presented as the complete set. A two-segment control
 * looks deliberate; a three-segment control with one greyed out reads as
 * broken and gets filed as a bug (§2.1). Cron adds a third segment in V1.1.
 *
 * Radiogroup semantics rather than plain buttons: arrow keys move between
 * options and only the selected one is in the tab order (roving tabindex),
 * which is what a screen-reader user expects from a set of mutually exclusive
 * choices.
 *
 * The keydown handler lives on each radio rather than on the group, because
 * the focused element should handle its own keys — and it keeps the group a
 * pure container that needs no tabindex of its own.
 */
export function ModeSelector(): React.JSX.Element {
  const mode = useStore(workspaceStore, (state) => state.mode);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const isNext = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      const isPrevious = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
      if (!isNext && !isPrevious) return;

      event.preventDefault();
      const currentIndex = ANALYSIS_MODES.indexOf(mode);
      const delta = isNext ? 1 : -1;
      const nextIndex = (currentIndex + delta + ANALYSIS_MODES.length) % ANALYSIS_MODES.length;
      const nextMode = ANALYSIS_MODES[nextIndex];
      if (!nextMode) return;

      setMode(nextMode);
      // Move focus with the selection so the keyboard user stays on the
      // control they just changed.
      containerRef.current?.querySelector<HTMLButtonElement>(`[data-mode="${nextMode}"]`)?.focus();
    },
    [mode],
  );

  return (
    <div ref={containerRef} className={styles.group} role="radiogroup" aria-label="Analysis mode">
      {ANALYSIS_MODES.map((candidate: AnalysisMode) => {
        const isSelected = candidate === mode;
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            data-mode={candidate}
            className={styles.segment}
            onKeyDown={handleKeyDown}
            onClick={() => {
              setMode(candidate);
            }}
          >
            {MODE_LABELS[candidate]}
          </button>
        );
      })}
    </div>
  );
}
