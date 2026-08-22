import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CAPTURE_DELAY_MS,
  captureNow,
  markCaptured,
  resetCaptureState,
  scheduleCapture,
  setHistoryEnabled,
} from '@/application/history/capture';
import {
  __setRepositoryForTests,
  historyStore,
  refresh,
  resumeCapture,
  touchEntry,
} from '@/application/history/historyStore';
import {
  DEFAULT_SETTINGS,
  settingsStore,
  updateSettings,
} from '@/application/stores/settingsStore';
import { workspaceStore } from '@/application/stores/workspaceStore';
import type { JsonAnalysis } from '@/domain/json/ast';
import type { RegexAnalysis } from '@/domain/regex/ast';
import { EMPTY_FLAGS } from '@/domain/regex/ast';
import { HistoryStore } from '@/infrastructure/storage/historyRepository';

import { createFakeBackend, quotaError, type FakeBackend } from './fakeBackend';

/**
 * Capture policy — 06_DATA_STORAGE.md §4.1
 *
 * What must never be recorded is the interesting half: an input mid-edit, an
 * invalid document, or anything at all while history is paused.
 */

function regexAnalysis(source: string): RegexAnalysis {
  return {
    kind: 'regex',
    source,
    flags: { ...EMPTY_FLAGS, global: true, ignoreCase: true },
    ast: { kind: 'alternation', alternatives: [], span: { start: 0, end: 0, line: 1, column: 1 } },
    tokens: [],
    groups: [],
    explanation: { nodes: [] },
    warnings: [],
    compatibility: { javascript: true, notes: [] },
    errors: [],
  } as unknown as RegexAnalysis;
}

function jsonAnalysis(source: string, valid: boolean): JsonAnalysis {
  return {
    kind: 'json',
    source,
    cst: null,
    valid,
    errors: [],
    stats: {
      nodeCount: 3,
      maxDepth: 1,
      objectCount: 1,
      arrayCount: 0,
      stringCount: 0,
      numberCount: 1,
      booleanCount: 0,
      nullCount: 0,
      totalKeys: 1,
      byteLength: source.length,
    },
    duplicateKeys: [],
    unsafeNumbers: [],
    explanation: { nodes: [] },
  } as unknown as JsonAnalysis;
}

let backend: FakeBackend;

async function savedInputs(): Promise<string[]> {
  await refresh();
  return historyStore.getState().page.entries.map((entry) => entry.input);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  settingsStore.setState(DEFAULT_SETTINGS);
  workspaceStore.reset();
  resetCaptureState();

  backend = createFakeBackend();
  __setRepositoryForTests(new HistoryStore(backend));
});

afterEach(() => {
  vi.useRealTimers();
  __setRepositoryForTests(null);
});

describe('when captures happen', () => {
  it('does not record until the quiet period has passed', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      analysis: regexAnalysis('ab+c'),
    }));

    scheduleCapture();
    await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS - 100);
    expect(backend.records).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    expect(await savedInputs()).toEqual(['ab+c']);
  });

  it('records once for a continuous edit, not once per keystroke', async () => {
    for (const pattern of ['a', 'ab', 'ab+', 'ab+c']) {
      workspaceStore.setState((previous) => ({
        ...previous,
        mode: 'regex',
        pattern,
        analysis: regexAnalysis(pattern),
      }));
      scheduleCapture();
      await vi.advanceTimersByTimeAsync(500);
    }

    await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS);
    expect(await savedInputs()).toEqual(['ab+c']);
  });

  it('does not record the same input twice', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      analysis: regexAnalysis('ab+c'),
    }));

    scheduleCapture();
    await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS);
    const writes = backend.writes;

    scheduleCapture();
    await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS);
    expect(backend.writes).toBe(writes);
  });
});

describe('what is never captured', () => {
  it('records nothing for a draft nobody asked to analyse', async () => {
    // M15: typing produces no analysis, so there is nothing to record. A
    // history full of half-typed patterns helps nobody, and the guard is that
    // capture is only ever reached from a completed analysis.
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      // No analysis: the user typed and stopped.
      analysis: null,
    }));

    scheduleCapture(true);
    await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS * 2);
    expect(backend.records).toHaveLength(0);
  });

  it('records nothing in cron mode, which has no entry type yet', async () => {
    // Before M15 the candidate was chosen with `mode === 'regex' ? … : …`, so
    // a cron analysis would have re-saved whatever JSON sat in the other
    // editor. The switch is exhaustive now and cron returns nothing.
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'cron',
      cronInput: '*/15 * * * *',
      jsonInput: '{"leftover": true}',
      jsonAnalysis: jsonAnalysis('{"leftover": true}', true),
    }));

    scheduleCapture(true);
    await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS * 2);
    expect(backend.records).toHaveLength(0);
  });

  it('records nothing while history is paused', async () => {
    setHistoryEnabled(false);
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      analysis: regexAnalysis('ab+c'),
    }));

    scheduleCapture();
    await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS * 2);
    expect(backend.records).toHaveLength(0);
  });

  it('cancels a capture already waiting when history is paused', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      analysis: regexAnalysis('ab+c'),
    }));
    scheduleCapture();

    await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS - 100);
    setHistoryEnabled(false);
    await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS);

    expect(backend.records).toHaveLength(0);
  });

  it('records nothing when there is no analysis', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+[',
      analysis: null,
    }));
    await captureNow();
    expect(backend.records).toHaveLength(0);
  });

  it('records nothing for an empty input', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: '   ',
      analysis: regexAnalysis('   '),
    }));
    await captureNow();
    expect(backend.records).toHaveLength(0);
  });

  it('records nothing for an invalid JSON document', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'json',
      jsonInput: '{"a":',
      jsonAnalysis: jsonAnalysis('{"a":', false),
    }));
    await captureNow();
    expect(backend.records).toHaveLength(0);
  });

  it('records a valid JSON document', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'json',
      jsonInput: '{"a":1}',
      jsonAnalysis: jsonAnalysis('{"a":1}', true),
    }));
    await captureNow();
    expect(await savedInputs()).toEqual(['{"a":1}']);
  });

  it('does not re-record an input that was just restored from history', async () => {
    markCaptured('regex', 'ab+c');
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      analysis: regexAnalysis('ab+c'),
    }));
    await captureNow();
    expect(backend.records).toHaveLength(0);
  });
});

describe('what a captured entry holds', () => {
  it('stores the pattern and its flags, but never the test subject', async () => {
    // The test subject is the field most likely to hold real production data,
    // so it is deliberately not persisted (06_DATA_STORAGE.md §6.1).
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      testSubject: 'customer@example.com, 4111 1111 1111 1111',
      analysis: regexAnalysis('ab+c'),
    }));

    await captureNow();
    await refresh();
    const entry = historyStore.getState().page.entries[0];

    expect(entry?.input).toBe('ab+c');
    expect(entry?.metadata).toEqual({
      type: 'regex',
      flags: 'gi',
      groupCount: 0,
      hadErrors: false,
      nodeCount: 0,
    });
    expect(JSON.stringify(entry)).not.toContain('4111');
  });

  it('titles a regex entry as a literal', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      analysis: regexAnalysis('ab+c'),
    }));
    await captureNow();
    await refresh();
    expect(historyStore.getState().page.entries[0]?.title).toBe('/ab+c/gi');
  });
});

describe('the pause setting', () => {
  it('persists so a reload does not silently resume recording', () => {
    setHistoryEnabled(false);
    expect(settingsStore.getState().historyEnabled).toBe(false);
    expect(localStorage.getItem('syntaxlab.settings.v1')).toContain('"historyEnabled":false');
  });

  it('leaves existing entries alone: pausing is not deleting', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      analysis: regexAnalysis('ab+c'),
    }));
    await captureNow();
    expect(backend.records).toHaveLength(1);

    setHistoryEnabled(false);
    expect(backend.records).toHaveLength(1);
  });

  it('survives a corrupt settings value', () => {
    localStorage.setItem('syntaxlab.settings.v1', '{not json');
    updateSettings({});
    expect(settingsStore.getState().historyEnabled).toBe(true);
  });
});

describe('when storage fills up', () => {
  it('stops capturing rather than retrying a failing write after every analysis', async () => {
    // One entry saved, then every write refused for space with nothing
    // prunable — the state the doc calls Degraded.
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      analysis: regexAnalysis('ab+c'),
    }));
    await captureNow();

    backend.failAlwaysWith = quotaError();
    workspaceStore.setState((previous) => ({
      ...previous,
      pattern: 'second',
      analysis: regexAnalysis('second'),
    }));
    await captureNow();

    expect(historyStore.getState().captureSuspended).toBe(true);

    // A later analysis does not try again on its own.
    backend.failAlwaysWith = null;
    const writes = backend.writes;
    workspaceStore.setState((previous) => ({
      ...previous,
      pattern: 'third',
      analysis: regexAnalysis('third'),
    }));
    scheduleCapture();
    await vi.advanceTimersByTimeAsync(CAPTURE_DELAY_MS * 2);
    expect(backend.writes).toBe(writes);

    // Only when the user says so.
    resumeCapture();
    workspaceStore.setState((previous) => ({
      ...previous,
      pattern: 'fourth',
      analysis: regexAnalysis('fourth'),
    }));
    await captureNow();
    expect(await savedInputs()).toContain('fourth');
  });

  it('never deleted what was already saved', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'keep-me',
      analysis: regexAnalysis('keep-me'),
    }));
    await captureNow();

    backend.failAlwaysWith = quotaError();
    workspaceStore.setState((previous) => ({
      ...previous,
      pattern: 'wont-fit',
      analysis: regexAnalysis('wont-fit'),
    }));
    await captureNow();

    backend.failAlwaysWith = null;
    expect(await savedInputs()).toContain('keep-me');
  });
});

describe('an explicit analyse', () => {
  it('is recorded immediately, with no quiet period to wait through', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      analysis: regexAnalysis('ab+c'),
    }));

    scheduleCapture(true);
    // Only the microtasks the save itself needs, not the two-second timer.
    await vi.advanceTimersByTimeAsync(0);
    expect(await savedInputs()).toEqual(['ab+c']);
  });
});

describe('restoring an entry', () => {
  it('records that it was opened, without writing a second entry', async () => {
    workspaceStore.setState((previous) => ({
      ...previous,
      mode: 'regex',
      pattern: 'ab+c',
      analysis: regexAnalysis('ab+c'),
    }));
    await captureNow();
    await refresh();

    const saved = historyStore.getState().page.entries[0];
    expect(saved?.openCount).toBe(1);

    await touchEntry(saved!);
    await refresh();

    const reopened = historyStore.getState().page.entries;
    expect(reopened).toHaveLength(1);
    expect(reopened[0]?.openCount).toBe(2);
    expect(reopened[0]?.lastOpenedAt).toBeGreaterThanOrEqual(saved?.lastOpenedAt ?? 0);
  });
});
