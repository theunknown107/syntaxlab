import type { RegexAnalysis } from '@/domain/regex/ast';
import type { RegexExecResult } from '@/domain/regex/execute';
import type { SourceSpan } from '@/domain/shared/result';
import { createStore } from './createStore';

/**
 * Workspace state — 11_STATE_MANAGEMENT.md §4.1
 *
 * V1.0 has two modes. Cron is V1.1 and must not appear here, in the type or
 * anywhere else, until that milestone (`22_OPEN_QUESTIONS.md` D-01).
 *
 * The regex fields arrive at M4 with the feature that uses them. `pattern`
 * changes on every keystroke, so only the editor subscribes to it; the
 * analysis pane subscribes to `analysis` and `analysisStatus`, which change at
 * most once per debounce interval.
 */

export type AnalysisMode = 'regex' | 'json';

export const ANALYSIS_MODES = ['regex', 'json'] as const;

export type AnalysisStatus = 'idle' | 'analyzing' | 'ready' | 'error';

/**
 * Execution has states analysis does not: it can time out (the worker was
 * destroyed mid-run) and it can be unavailable entirely (no Worker support,
 * in which case the tester is disabled rather than moved to the main thread).
 */
export type ExecStatus = 'idle' | 'running' | 'ready' | 'timeout' | 'error' | 'unavailable';

/**
 * A failure in a form the presentation layer can render directly.
 *
 * Deliberately not `WorkerError` or `DomainError`: those are infrastructure
 * and domain types, and features are not permitted to import infrastructure.
 * Translating once here means every panel renders the same three fields
 * — what failed, where, what to do next (08_UI_UX_SPEC.md §14).
 */
export interface WorkspaceFailure {
  readonly message: string;
  readonly hint?: string;
  readonly span?: SourceSpan;
}

export interface WorkspaceState {
  readonly mode: AnalysisMode;

  readonly pattern: string;
  readonly flags: string;
  readonly testSubject: string;

  readonly analysis: RegexAnalysis | null;
  readonly analysisStatus: AnalysisStatus;
  readonly analysisError: WorkspaceFailure | null;

  readonly exec: RegexExecResult | null;
  readonly execStatus: ExecStatus;
  readonly execError: WorkspaceFailure | null;
}

const initialState: WorkspaceState = {
  mode: 'regex',
  pattern: '',
  flags: 'g',
  testSubject: '',
  analysis: null,
  analysisStatus: 'idle',
  analysisError: null,
  exec: null,
  execStatus: 'idle',
  execError: null,
};

export const workspaceStore = createStore<WorkspaceState>(initialState);

/** The flag defaults a fresh workspace starts from, and that Reset restores. */
export const DEFAULT_FLAGS = initialState.flags;

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
