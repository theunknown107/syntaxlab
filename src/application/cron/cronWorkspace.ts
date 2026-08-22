import type { CronTimezoneMode } from '@/domain/cron/ast';
import { LIMITS } from '@/domain/shared/limits';
import type { DomainError } from '@/domain/shared/result';
import type { WorkerError } from '@/infrastructure/workers/protocol';
import { getAnalysisClient } from '@/infrastructure/workers/workers';

import { workspaceStore, type WorkspaceFailure } from '../stores/workspaceStore';

/**
 * Cron workspace use-cases — 11_STATE_MANAGEMENT.md §4.1, 04_PARSER_ARCHITECTURE.md §4
 *
 * The same shape as the regex and JSON workspaces, deliberately: one draft,
 * one committed expression, one explicit action. A third way of doing this
 * would be a third thing to learn.
 *
 * Two requests, not one. The analysis explains the expression; the schedule
 * says when it runs next. They are separate operations because they go stale
 * at different rates — a meaning stays true, a countdown does not — and
 * because the times can then be recomputed without re-explaining anything.
 *
 * **No timer recomputes them.** The times carry the instant they were computed
 * at and there is a control to compute them again. A page that quietly
 * refreshed itself would be an app that runs work the user did not ask for,
 * which is the whole thing the explicit Analyze action exists to avoid.
 */

const ANALYSIS_KEY = 'cron-analysis';
const SCHEDULE_KEY = 'cron-schedule';

function fromDomainError(error: DomainError): WorkspaceFailure {
  return {
    message: error.message,
    ...(error.hint === undefined ? {} : { hint: error.hint }),
    ...(error.span === undefined ? {} : { span: error.span }),
  };
}

function fromWorkerError(error: WorkerError): WorkspaceFailure {
  switch (error.code) {
    case 'DOMAIN':
      return error.cause ? fromDomainError(error.cause) : { message: error.message };
    case 'UNAVAILABLE':
      return {
        message: 'The analysis engine could not start in this browser.',
        hint: 'Cron expressions are parsed in a Web Worker so the page cannot freeze.',
      };
    case 'TIMEOUT':
      return {
        message: 'The expression took too long to analyse.',
        hint: 'Try a shorter expression.',
      };
    default:
      return { message: 'Something went wrong in the analysis engine.', hint: 'Try again.' };
  }
}

function clearAnalysis(): void {
  workspaceStore.setState((previous) => ({
    ...previous,
    cronCommitted: null,
    cronAnalysis: null,
    cronStatus: 'idle',
    cronError: null,
    ...EMPTY_SCHEDULE,
  }));
}

const EMPTY_SCHEDULE = {
  cronSchedule: null,
  cronScheduleStatus: 'idle',
  cronScheduleError: null,
} as const;

/**
 * Asks when the committed expression runs next.
 *
 * Runs after the analysis rather than instead of it: an expression that cannot
 * be explained cannot be scheduled either, and the explanation is the part
 * that says *why*. A failure here leaves the analysis on screen — the meaning
 * of the expression is still worth reading when the times are not available.
 */
async function runSchedule(committed: string, timezoneMode: CronTimezoneMode): Promise<void> {
  const source = committed.trim();
  if (source === '') return;

  workspaceStore.setState((previous) => ({
    ...previous,
    cronScheduleStatus: 'analyzing',
    cronScheduleError: null,
  }));

  const response = await getAnalysisClient().request(
    'analysis.cronSchedule',
    {
      source,
      timezoneMode,
      // The clock is read here, on the thread that knows what "now" the user
      // is looking at, and travels with the request. A worker reading its own
      // clock would be a worker whose answers cannot be tested.
      after: Date.now(),
      count: LIMITS.cron.maxOccurrences,
    },
    { supersedeKey: SCHEDULE_KEY },
  );

  const now = workspaceStore.getState();
  if (now.cronCommitted !== committed || now.cronTimezoneMode !== timezoneMode) return;

  if (response.ok) {
    workspaceStore.setState((previous) => ({
      ...previous,
      cronSchedule: response.value,
      cronScheduleStatus: 'ready',
      cronScheduleError: null,
    }));
    return;
  }

  if (response.error.code === 'SUPERSEDED') return;

  workspaceStore.setState((previous) => ({
    ...previous,
    cronSchedule: null,
    cronScheduleStatus: 'error',
    cronScheduleError: fromWorkerError(response.error),
  }));
}

/**
 * Analyses the expression the user just submitted.
 *
 * The expression and the timezone mode are committed before the request goes
 * out, and the response is matched against them — the user may keep typing
 * while the worker is busy, and that is not a reason to discard a correct
 * answer about what they asked.
 */
async function runAnalysis(): Promise<void> {
  const { cronInput, cronTimezoneMode } = workspaceStore.getState();
  const source = cronInput.trim();
  if (source === '') {
    clearAnalysis();
    return;
  }

  workspaceStore.setState((previous) => ({
    ...previous,
    cronCommitted: cronInput,
    cronStatus: 'analyzing',
    // The previous times describe the previous expression. Holding them under
    // a new one would be the worst kind of wrong: plausible and unrelated.
    ...EMPTY_SCHEDULE,
  }));

  const response = await getAnalysisClient().request(
    'analysis.cron',
    { source, timezoneMode: cronTimezoneMode },
    { supersedeKey: ANALYSIS_KEY },
  );

  const now = workspaceStore.getState();
  if (now.cronCommitted !== cronInput || now.cronTimezoneMode !== cronTimezoneMode) return;

  if (response.ok) {
    workspaceStore.setState((previous) => ({
      ...previous,
      cronAnalysis: response.value,
      cronStatus: 'ready',
      cronError: null,
    }));
    void runSchedule(cronInput, cronTimezoneMode);
    // No history capture. `HistoryEntry` has no cron type yet, and the drawer
    // has nothing to render for one — see `capture.ts`.
    return;
  }

  if (response.error.code === 'SUPERSEDED') return;

  // A refusal is not a crash. `0 0 12 * * ?` is six fields, and the message
  // explaining why that is refused is the most useful thing this feature says
  // — it belongs on screen, not swallowed.
  workspaceStore.setState((previous) => ({
    ...previous,
    cronAnalysis: null,
    cronStatus: 'error',
    cronError: fromWorkerError(response.error),
    ...EMPTY_SCHEDULE,
  }));
}

/**
 * Recomputes the times for the expression already on screen.
 *
 * The times are computed once and then say when they were computed, so this is
 * how they stop being stale. It re-runs the search only — the explanation has
 * not changed, and re-deriving it would be work nobody asked for.
 */
export function refreshCronSchedule(): void {
  const { cronCommitted, cronTimezoneMode } = workspaceStore.getState();
  if (cronCommitted === null) return;
  void runSchedule(cronCommitted, cronTimezoneMode);
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

/** Records what the user is typing. Analyses nothing. */
export function setCronInput(cronInput: string): void {
  workspaceStore.setState((previous) =>
    previous.cronInput === cronInput ? previous : { ...previous, cronInput },
  );
}

/** The Analyze button, and `Ctrl/⌘ + Enter`. */
export function analyzeCronNow(): void {
  void runAnalysis();
}

/**
 * Switches between the browser's zone and UTC.
 *
 * Re-analyses immediately when there is already a committed expression,
 * because the timezone is not an edit to the expression — it is a question
 * about the expression already on screen, and answering it is what the control
 * is for. The committed input does not change, so nothing goes stale.
 */
export function setCronTimezoneMode(cronTimezoneMode: CronTimezoneMode): void {
  const previousMode = workspaceStore.getState().cronTimezoneMode;
  if (previousMode === cronTimezoneMode) return;

  workspaceStore.setState((previous) => ({ ...previous, cronTimezoneMode }));
  if (workspaceStore.getState().cronCommitted !== null) void runAnalysis();
}

export function clearCron(): void {
  workspaceStore.setState((previous) => ({
    ...previous,
    cronInput: '',
    cronCommitted: null,
    cronAnalysis: null,
    cronStatus: 'idle',
    cronError: null,
    ...EMPTY_SCHEDULE,
  }));
}

/** Loads a worked example and explains it, for the same reason regex does. */
export function loadCronExample(expression: string): void {
  workspaceStore.setState((previous) => ({ ...previous, cronInput: expression }));
  analyzeCronNow();
}

/** Whether the expression is too long for the editor to accept at all. */
export function isOverCronLimit(input: string): boolean {
  return input.length > LIMITS.cron.input;
}
