import type { RegexAnalysis } from '@/domain/regex/ast';
import type { JsonAnalysis } from '@/domain/json/ast';
import type { CronAnalysis, CronTimezoneMode } from '@/domain/cron/ast';
import type { IndentStyle } from '@/domain/json/format';
import type { DetectionResult } from '@/domain/shared/detect';
import type { RegexExecResult } from '@/domain/regex/execute';
import type { SourceSpan } from '@/domain/shared/result';
import { createStore } from './createStore';

/**
 * Workspace state — 11_STATE_MANAGEMENT.md §4.1
 *
 * Three modes from M15: regex, JSON and cron.
 *
 * **Draft and committed input are separate, and that is the point.** Every
 * mode holds what the user is typing *and* the input the visible result was
 * produced from. Typing changes the first; only Analyze changes the second.
 * The result on screen always belongs to the committed input, so it is never a
 * fresh-looking explanation of text the user has since edited away.
 *
 *     draft  →  Analyze  →  committed  →  worker  →  result
 *
 * `committed*` is `null` until the first analysis. Staleness is *derived* from
 * the two rather than stored as a third flag, because a boolean that can
 * disagree with the strings it summarises is a bug waiting to be written.
 *
 * `pattern` changes on every keystroke, so only the editor subscribes to it;
 * the analysis pane subscribes to `analysis` and `analysisStatus`, which now
 * change only when someone asks for an analysis.
 */

export type AnalysisMode = 'regex' | 'json' | 'cron';

export const ANALYSIS_MODES = ['regex', 'json', 'cron'] as const;

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

  /**
   * What a paste looked like, and whether the user has waved the suggestion
   * away. Dismissal is per session and deliberately not persisted: a user who
   * dismissed it last week should still be told when they paste JSON today.
   */
  readonly detected: DetectionResult | null;
  /**
   * Whether the detected text arrived into an *empty* editor.
   *
   * This is what separates a first paste from an edit, and it is the only
   * situation in which a mode may change on its own (08_UI_UX_SPEC.md §3).
   */
  readonly detectedOnEmpty: boolean;
  readonly suggestionDismissed: boolean;

  readonly pattern: string;
  readonly flags: string;
  readonly testSubject: string;

  /**
   * The pattern and flags the visible analysis was produced from.
   *
   * `null` before the first Analyze. Execution reads these rather than the
   * draft: testing a pattern the engine has not been asked about would report
   * matches for text that is not on screen.
   */
  readonly committedPattern: string | null;
  readonly committedFlags: string | null;

  readonly analysis: RegexAnalysis | null;
  readonly analysisStatus: AnalysisStatus;
  readonly analysisError: WorkspaceFailure | null;

  readonly exec: RegexExecResult | null;
  readonly execStatus: ExecStatus;
  readonly execError: WorkspaceFailure | null;

  /* ---- JSON ---- */

  readonly jsonInput: string;
  /** The document the visible tree was parsed from. `null` before the first Analyze. */
  readonly jsonCommitted: string | null;
  readonly jsonAnalysis: JsonAnalysis | null;
  readonly jsonStatus: AnalysisStatus;
  readonly jsonError: WorkspaceFailure | null;
  readonly jsonIndent: IndentStyle;

  /* ---- Cron — M15 ---- */

  readonly cronInput: string;
  /** The expression the visible analysis was produced from. */
  readonly cronCommitted: string | null;
  readonly cronAnalysis: CronAnalysis | null;
  readonly cronStatus: AnalysisStatus;
  readonly cronError: WorkspaceFailure | null;
  /**
   * Which clock the times are read in.
   *
   * Two values, and no more: named IANA zones are not implemented, and a
   * selector offering one would promise an answer the domain cannot give
   * (`04_PARSER_ARCHITECTURE.md` §4.5).
   */
  readonly cronTimezoneMode: CronTimezoneMode;
}

const initialState: WorkspaceState = {
  mode: 'regex',
  pattern: '',
  flags: 'g',
  testSubject: '',
  committedPattern: null,
  committedFlags: null,
  analysis: null,
  analysisStatus: 'idle',
  analysisError: null,
  exec: null,
  execStatus: 'idle',
  execError: null,

  detected: null,
  detectedOnEmpty: false,
  suggestionDismissed: false,

  jsonInput: '',
  jsonCommitted: null,
  jsonAnalysis: null,
  jsonStatus: 'idle',
  jsonError: null,
  jsonIndent: 'two',

  cronInput: '',
  cronCommitted: null,
  cronAnalysis: null,
  cronStatus: 'idle',
  cronError: null,
  cronTimezoneMode: 'browserLocal',
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
  return value === 'regex' || value === 'json' || value === 'cron';
}

export const MODE_LABELS: Readonly<Record<AnalysisMode, string>> = {
  regex: 'Regex',
  json: 'JSON',
  cron: 'Cron',
};

/* ------------------------------------------------------------------ *
 * Submission state
 * ------------------------------------------------------------------ */

/**
 * The draft and the committed input for one mode.
 *
 * Derived rather than stored. A `stale` boolean kept alongside the two strings
 * is a third thing that can disagree with them, and the disagreement would
 * show as a result presented as current when it is not.
 */
export interface SubmissionState {
  /** Nothing has been analysed yet, so there is no result to be stale. */
  readonly untouched: boolean;
  /** The editor holds changes the visible result does not reflect. */
  readonly stale: boolean;
  /** There is something worth submitting. */
  readonly submittable: boolean;
}

export function submissionOf(draft: string, committed: string | null): SubmissionState {
  return {
    untouched: committed === null,
    stale: committed !== null && draft !== committed,
    // An empty editor has nothing to explain, and re-submitting the exact text
    // that produced the visible result would spend a worker round trip to
    // arrive back where it started.
    submittable: draft.trim() !== '' && draft !== committed,
  };
}

/** The submission state of whichever mode is on screen. */
export function submissionFor(state: WorkspaceState): SubmissionState {
  switch (state.mode) {
    case 'regex':
      return regexSubmission(
        state.pattern,
        state.flags,
        state.committedPattern,
        state.committedFlags,
      );
    case 'json':
      return submissionOf(state.jsonInput, state.jsonCommitted);
    case 'cron':
      return submissionOf(state.cronInput, state.cronCommitted);
  }
}

/**
 * Regex is the one mode whose committed input is two values.
 *
 * Toggling a flag changes what an analysis would say without changing a
 * character of the pattern, so flags count as an edit.
 */
export function regexSubmission(
  pattern: string,
  flags: string,
  committedPattern: string | null,
  committedFlags: string | null,
): SubmissionState {
  const base = submissionOf(pattern, committedPattern);
  const flagsMoved = committedFlags !== null && flags !== committedFlags;
  return {
    untouched: base.untouched,
    stale: base.stale || flagsMoved,
    submittable: pattern.trim() !== '' && (base.submittable || flagsMoved),
  };
}
