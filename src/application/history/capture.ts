import type { HistoryMetadata } from '@/domain/history/entry';
import { newEntry } from '@/domain/history/title';
import type { JsonAnalysis } from '@/domain/json/ast';
import type { RegexAnalysis } from '@/domain/regex/ast';

import { settingsStore, updateSettings } from '../stores/settingsStore';
import { workspaceStore } from '../stores/workspaceStore';
import { historyStore, saveEntry } from './historyStore';

/**
 * What gets captured, and when — 06_DATA_STORAGE.md §4, 08_UI_UX_SPEC.md §19
 *
 * The hard part of history is not storing things; it is *not* storing things.
 * Capturing every keystroke produces a list nobody can use, and capturing a
 * half-typed pattern records something the user never meant to keep.
 *
 * Three rules:
 *
 *   1. Only after a successful analysis. A pattern that does not parse is a
 *      state the user is passing through, not a result.
 *   2. Only after a further quiet period. Editing is continuous; a pause is
 *      the closest signal we have to "done".
 *   3. Never while paused. Off means off — no writes at all, not writes that
 *      are hidden from the list.
 */

/** Quiet period after a successful analysis before it is recorded. */
export const CAPTURE_DELAY_MS = 2_000;

let timer: ReturnType<typeof setTimeout> | null = null;
/** What was last captured, so an unchanged input is not written twice. */
let lastCaptured: string | null = null;

/**
 * Identifies an input for the "already captured" check.
 *
 * Separated by a NUL, the same convention the analysis signatures use: with any
 * printable separator a type and input could be concatenated two ways into the
 * same string.
 */
function fingerprintOf(type: string, input: string): string {
  return `${type}\u0000${input}`;
}

function cancel(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

export function regexMetadata(analysis: RegexAnalysis): HistoryMetadata {
  return {
    type: 'regex',
    flags: flagsToString(analysis.flags),
    groupCount: analysis.groups.length,
    hadErrors: analysis.errors.length > 0,
    nodeCount: analysis.tokens.length,
  };
}

function flagsToString(flags: RegexAnalysis['flags']): string {
  // Canonical order, matching how JavaScript itself prints them.
  return [
    flags.hasIndices ? 'd' : '',
    flags.global ? 'g' : '',
    flags.ignoreCase ? 'i' : '',
    flags.multiline ? 'm' : '',
    flags.dotAll ? 's' : '',
    flags.unicode ? 'u' : '',
    flags.unicodeSets ? 'v' : '',
    flags.sticky ? 'y' : '',
  ].join('');
}

export function jsonMetadata(analysis: JsonAnalysis): HistoryMetadata {
  return {
    type: 'json',
    valid: analysis.valid,
    nodeCount: analysis.stats.nodeCount,
    maxDepth: analysis.stats.maxDepth,
    byteLength: analysis.stats.byteLength,
  };
}

/**
 * Schedules a capture, replacing any capture already waiting.
 *
 * Called on every successful analysis. Because each call cancels the last, a
 * continuous edit produces exactly one entry when it stops, not one per pause
 * in typing.
 */
export function scheduleCapture(immediate = false): void {
  cancel();
  if (!capturing()) return;

  // An explicit Analyze is not a pause in typing — it is the user saying they
  // are done, so there is nothing left to wait for (06_DATA_STORAGE.md §4.3).
  if (immediate) {
    void captureNow();
    return;
  }

  timer = setTimeout(() => {
    timer = null;
    void captureNow();
  }, CAPTURE_DELAY_MS);
}

function capturing(): boolean {
  return settingsStore.getState().historyEnabled && !historyStore.getState().captureSuspended;
}

/** Writes the current workspace to history, if it is worth writing. */
export async function captureNow(): Promise<void> {
  // Re-checked here as well as when scheduling: the user may have paused
  // history, or storage may have run out, during the two seconds the timer
  // was waiting.
  if (!capturing()) return;

  const state = workspaceStore.getState();
  const candidate = state.mode === 'regex' ? regexCandidate(state) : jsonCandidate(state);
  if (candidate === null) return;

  const fingerprint = fingerprintOf(candidate.type, candidate.input);
  if (fingerprint === lastCaptured) return;
  lastCaptured = fingerprint;

  await saveEntry(candidate);
}

type Workspace = ReturnType<typeof workspaceStore.getState>;

function regexCandidate(state: Workspace): ReturnType<typeof newEntry> | null {
  const analysis = state.analysis;
  if (analysis === null || state.pattern.trim() === '') return null;
  // A pattern that could not be parsed at all never had an analysis; one that
  // recovered from a typo did, and is worth keeping — the user was working.
  return newEntry('regex', state.pattern, regexMetadata(analysis));
}

function jsonCandidate(state: Workspace): ReturnType<typeof newEntry> | null {
  const analysis = state.jsonAnalysis;
  if (analysis === null || state.jsonInput.trim() === '') return null;
  // Invalid JSON is *not* captured: an unfinished document is a state the user
  // is passing through, and a list of broken drafts helps nobody.
  if (!analysis.valid) return null;
  return newEntry('json', state.jsonInput, jsonMetadata(analysis));
}

/** Stops any pending capture. */
export function stopCapture(): void {
  cancel();
}

/**
 * Turns capture on or off.
 *
 * Turning it off cancels the capture already waiting, so the analysis the user
 * was looking at when they paused is not written a second later. Existing
 * entries are untouched: pausing is not deleting.
 */
export function setHistoryEnabled(historyEnabled: boolean): void {
  updateSettings({ historyEnabled });
  if (!historyEnabled) cancel();
}

/** Forgets what was last captured, so the same input can be recorded again. */
export function resetCaptureState(): void {
  cancel();
  lastCaptured = null;
}

/**
 * Marks an input as already captured.
 *
 * Used when restoring an entry: the text that appears in the editor came *from*
 * history, and re-analysing it must not immediately write it back as new.
 */
export function markCaptured(type: string, input: string): void {
  cancel();
  lastCaptured = fingerprintOf(type, input);
}
