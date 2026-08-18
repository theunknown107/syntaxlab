import { createStore } from './createStore';

/**
 * Workspace state — 11_STATE_MANAGEMENT.md §4.1
 *
 * V1.0 has two modes. Cron is V1.1 and must not appear here, in the type or
 * anywhere else, until that milestone (`22_OPEN_QUESTIONS.md` D-01).
 *
 * M1 scope: mode only. Input, analysis status, and results arrive with the
 * worker boundary (M2) and the parsers (M3, M5). Adding those fields now would
 * be speculative structure with nothing to put in it.
 */

export type AnalysisMode = 'regex' | 'json';

export const ANALYSIS_MODES = ['regex', 'json'] as const;

export interface WorkspaceState {
  readonly mode: AnalysisMode;
}

const initialState: WorkspaceState = { mode: 'regex' };

export const workspaceStore = createStore<WorkspaceState>(initialState);

export function setMode(mode: AnalysisMode): void {
  workspaceStore.setState((previous) =>
    previous.mode === mode ? previous : { ...previous, mode },
  );
}

/** Narrows an untrusted string to a mode. Used at every boundary that can
 *  supply one (the `?mode=` PWA shortcut, restored state, tests). */
export function isAnalysisMode(value: unknown): value is AnalysisMode {
  return value === 'regex' || value === 'json';
}

export const MODE_LABELS: Readonly<Record<AnalysisMode, string>> = {
  regex: 'Regex',
  json: 'JSON',
};
