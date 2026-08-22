import type { DomainError } from '@/domain/shared/result';
import { LIMITS } from '@/domain/shared/limits';
import { detectInput, AUTO_SELECT, SUGGEST } from '@/domain/shared/detect';
import { formatJson, minifyJson, type IndentStyle } from '@/domain/json/format';
import type { WorkerError } from '@/infrastructure/workers/protocol';
import { getAnalysisClient } from '@/infrastructure/workers/workers';
import { scheduleCapture } from '../history/capture';
import {
  workspaceStore,
  type WorkspaceFailure,
  type WorkspaceState,
} from '../stores/workspaceStore';

/**
 * JSON workspace use-cases — 11_STATE_MANAGEMENT.md §5
 *
 * The same seam the regex feature uses, for the same reasons: every
 * asynchronous step lives here, so the components stay synchronous functions
 * of props, and the staleness rules live in one place.
 *
 * Two rules carry over unchanged, and one is new:
 *
 *   1. **No parsing on this thread.** `analysis.json` goes to the long-lived
 *      worker. There is no local fallback.
 *   2. **A stale response never overwrites newer input.** Guarded twice — the
 *      client supersedes an in-flight request, and every response is
 *      re-checked against the input current when it arrives.
 *   3. **Large documents are analysed on demand.** Above
 *      `manualAnalyzeBytes` the debounce is not armed at all; the user asks.
 *      A multi-megabyte paste re-parsed on every keystroke would be the
 *      "expensive work nobody asked for" the UX flow exists to prevent.
 */

const ANALYSIS_KEY = 'json-analysis';

/* ------------------------------------------------------------------ *
 * Failure translation
 * ------------------------------------------------------------------ */

function fromDomainError(error: DomainError): WorkspaceFailure {
  // Spread the optional fields in rather than assigning them: under
  // `exactOptionalPropertyTypes` a key holding undefined is not the same as an
  // absent key, and a failure with no hint should have no hint key.
  return {
    message: error.message,
    ...(error.hint !== undefined && { hint: error.hint }),
    ...(error.span !== undefined && { span: error.span }),
  };
}

function fromWorkerError(error: WorkerError): WorkspaceFailure {
  switch (error.code) {
    case 'DOMAIN':
      return error.cause ? fromDomainError(error.cause) : { message: error.message };
    case 'UNAVAILABLE':
      return {
        message: 'The analysis engine could not start in this browser.',
        hint: 'JSON is parsed in a Web Worker so a large document cannot freeze the page.',
      };
    case 'TIMEOUT':
      return {
        message: 'The document took too long to analyse.',
        hint: 'Try a smaller section.',
      };
    default:
      return { message: 'Something went wrong in the analysis engine.', hint: 'Try again.' };
  }
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

function clearAnalysis(): void {
  workspaceStore.setState((previous) => ({
    ...previous,
    jsonCommitted: null,
    jsonAnalysis: null,
    jsonStatus: 'idle',
    jsonError: null,
  }));
}

/**
 * Analyses the document the user just submitted.
 *
 * The submitted text is committed to the store *before* the request goes out,
 * so the result that comes back has something to belong to. Everything after
 * this point compares against `jsonCommitted`, not against the editor: the
 * user is free to keep typing while the worker is busy, and the answer will
 * still be labelled with the document it actually describes.
 */
async function runAnalysis(): Promise<void> {
  const source = workspaceStore.getState().jsonInput;
  if (source === '') {
    clearAnalysis();
    return;
  }

  workspaceStore.setState((previous) => ({
    ...previous,
    jsonCommitted: source,
    jsonStatus: 'analyzing',
  }));

  const response = await getAnalysisClient().request(
    'analysis.json',
    { source },
    { supersedeKey: ANALYSIS_KEY },
  );

  // The second staleness guard: a response can already be in the message queue
  // when a newer request is issued, so supersession alone is not enough. The
  // comparison is against the committed document — the draft may well have
  // moved on, and that is not a reason to throw away a correct answer.
  if (workspaceStore.getState().jsonCommitted !== source) return;

  if (response.ok) {
    workspaceStore.setState((previous) => ({
      ...previous,
      jsonAnalysis: response.value,
      jsonStatus: 'ready',
      jsonError: null,
    }));
    // Only a *valid* document is eventually recorded; capture itself decides
    // that (06_DATA_STORAGE.md §4.1). Always explicit now: nothing else
    // reaches this function.
    scheduleCapture(true);
    return;
  }

  if (response.error.code === 'SUPERSEDED') return;

  workspaceStore.setState((previous) => ({
    ...previous,
    jsonAnalysis: null,
    jsonStatus: 'error',
    jsonError: fromWorkerError(response.error),
  }));
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

/**
 * Records what the user is typing. **Analyses nothing.**
 *
 * Before M15 this started a debounce that parsed the document a moment after
 * the last keystroke. It no longer does: typing is not a request for an
 * answer, and treating it as one meant every intermediate, half-typed document
 * cost a worker round trip and replaced a correct explanation with an error
 * about text the user was still in the middle of writing.
 *
 * The previous tree stays on screen, and `jsonCommitted` still names the
 * document it came from, so the UI can say the editor has moved on.
 */
export function setJsonInput(jsonInput: string): void {
  workspaceStore.setState((previous) => {
    if (previous.jsonInput === jsonInput) return previous;
    return {
      ...previous,
      jsonInput,
      detected: detectInput(jsonInput),
      detectedOnEmpty: previous.jsonInput === '',
    };
  });
}

/** The Analyze button, and `Ctrl/⌘ + Enter`. The only way a document is parsed. */
export function analyzeJsonNow(): void {
  void runAnalysis();
}

export function clearJson(): void {
  workspaceStore.setState((previous) => ({
    ...previous,
    jsonInput: '',
    jsonCommitted: null,
    jsonAnalysis: null,
    jsonStatus: 'idle',
    jsonError: null,
    detected: null,
  }));
}

export function setJsonIndent(jsonIndent: IndentStyle): void {
  workspaceStore.setState((previous) => ({ ...previous, jsonIndent }));
}

/**
 * Rewrites the editor from the parsed tree.
 *
 * Refuses on an invalid document rather than guessing: formatting invalid
 * JSON would mean inventing the missing pieces, and the result would be a
 * document the user never wrote. The UI disables the buttons for the same
 * reason; this is the guard behind them.
 */
export function prettifyJson(): boolean {
  return rewrite((state) =>
    state.jsonAnalysis?.cst ? formatJson(state.jsonAnalysis.cst, state.jsonIndent) : null,
  );
}

export function minifyJsonInput(): boolean {
  return rewrite((state) => (state.jsonAnalysis?.cst ? minifyJson(state.jsonAnalysis.cst) : null));
}

function rewrite(produce: (state: WorkspaceState) => string | null): boolean {
  const state = workspaceStore.getState();
  if (!state.jsonAnalysis?.valid) return false;

  const next = produce(state);
  if (next === null || next === state.jsonInput) return false;

  setJsonInput(next);
  // The tree is unchanged by reformatting, but every span in it now points at
  // the wrong offsets, so a fresh analysis is not optional.
  analyzeJsonNow();
  return true;
}

/* ------------------------------------------------------------------ *
 * Detection
 * ------------------------------------------------------------------ */

export function dismissSuggestion(): void {
  workspaceStore.setState((previous) => ({ ...previous, suggestionDismissed: true }));
}

/**
 * Whether to offer a mode switch, and whether it is safe to take it.
 *
 * `auto` is only ever true on an editor the user has not filled in, because
 * switching out from under someone mid-edit is the trap the UX spec rules out.
 */
export function suggestionFor(state: WorkspaceState): {
  readonly show: boolean;
  readonly auto: boolean;
} {
  const detected = state.detected;
  if (!detected || detected.type === 'unknown' || state.suggestionDismissed) {
    return { show: false, auto: false };
  }
  if (detected.type === state.mode) return { show: false, auto: false };

  // Auto-select only on a *first* paste into an empty editor, and only when
  // the mode being switched to has nothing in it either. Switching once
  // someone has started editing is the trap the spec rules out, and switching
  // onto work they already have would hide it.
  const targetIsEmpty = state.mode === 'regex' ? state.jsonInput === '' : state.pattern === '';
  return {
    show: detected.confidence >= SUGGEST,
    auto: detected.confidence >= AUTO_SELECT && state.detectedOnEmpty && targetIsEmpty,
  };
}

/** Whether the document is too large for the editor to accept at all. */
export function isOverJsonLimit(input: string): boolean {
  return input.length > LIMITS.json.input;
}

/**
 * Test-only. Kept as a no-op so the suites that call it keep compiling.
 *
 * There is no longer a pending debounce to drop: nothing is scheduled, because
 * nothing is analysed without being asked for.
 */
export function resetJsonScheduling(): void {
  /* nothing to cancel — analysis is explicit */
}
