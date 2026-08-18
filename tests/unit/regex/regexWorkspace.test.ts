import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@/domain/shared/result';
import { workerError } from '@/infrastructure/workers/protocol';

/**
 * The application seam between the editor and the two workers.
 *
 * The worker clients are replaced so responses can be delivered on demand —
 * timing that a real worker cannot be made to reproduce. What is being tested
 * is the orchestration: which request is sent, which response is applied, and
 * which is discarded. The workers themselves are exercised for real in the
 * E2E suite.
 */

/** The shape `WorkerClient.request` is called with, typed so the assertions
 *  below read the arguments rather than an `any`. */
type RequestCall = (
  op: string,
  payload: unknown,
  options?: { supersedeKey?: string },
) => Promise<unknown>;

const analysisRequest = vi.fn<RequestCall>();
const execRequest = vi.fn<RequestCall>();
const workersAvailable = vi.fn(() => true);

vi.mock('@/infrastructure/workers/workers', () => ({
  getAnalysisClient: () => ({ request: analysisRequest }),
  getExecClient: () => ({ request: execRequest }),
  isRegexExecutionAvailable: () => workersAvailable(),
}));

const { workspaceStore } = await import('@/application/stores/workspaceStore');
const {
  analyzeNow,
  clearWorkspace,
  loadExample,
  resetFlags,
  resetScheduling,
  setFlags,
  setPattern,
  setTestSubject,
  toggleFlag,
} = await import('@/application/regex/regexWorkspace');

/** A minimal successful analysis, shaped like the worker's real reply. */
function analysisFor(source: string, flags = 'g') {
  return ok({
    kind: 'regex',
    source,
    flags: {
      global: flags.includes('g'),
      ignoreCase: false,
      multiline: false,
      dotAll: false,
      unicode: false,
      sticky: false,
      hasIndices: false,
      unicodeSets: false,
    },
    ast: { type: 'Literal', value: source, raw: source, span: span(0, source.length) },
    tokens: [],
    groups: [],
    explanation: { summary: [{ kind: 'text', value: `explains ${source}` }], details: [] },
    warnings: [],
    compatibility: { ecmascript: 'es5', notes: [] },
    errors: [],
  });
}

function span(start: number, end: number) {
  return { start, end, line: 1, column: start + 1 };
}

function execFor(matchCount: number) {
  return ok({
    kind: 'regexExec',
    matches: Array.from({ length: matchCount }, (_, index) => ({
      ordinal: index,
      start: index,
      end: index + 1,
      value: 'a',
      length: 1,
      captures: [],
      named: [],
    })),
    truncated: 'none',
    findsAll: true,
    hasIndices: false,
    subjectLength: 10,
    elapsedMs: 1,
  });
}

/** Lets pending microtasks settle without advancing the debounce clock. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('regex workspace use-cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetScheduling();
    workspaceStore.reset();
    analysisRequest.mockReset();
    execRequest.mockReset();
    workersAvailable.mockReturnValue(true);
    analysisRequest.mockResolvedValue(analysisFor(''));
    execRequest.mockResolvedValue(execFor(0));
  });

  afterEach(() => {
    resetScheduling();
    vi.useRealTimers();
  });

  describe('requests', () => {
    it('sends the pattern and flags exactly as shown', async () => {
      setFlags('gi');
      setPattern('abc');
      await vi.advanceTimersByTimeAsync(500);

      const [op, payload, options] = analysisRequest.mock.calls[0] ?? [];
      expect(op).toBe('analysis.regex');
      expect(payload).toEqual({ source: 'abc', flags: 'gi' });
      // Supersession is half of the staleness guard, so its presence is
      // asserted rather than assumed.
      expect(typeof options?.supersedeKey).toBe('string');
    });

    it('sends pattern, flags and subject to the execution worker', async () => {
      setPattern('a');
      setTestSubject('aaa');
      await vi.advanceTimersByTimeAsync(500);

      const [op, payload, options] = execRequest.mock.calls[0] ?? [];
      expect(op).toBe('exec.regex');
      expect(payload).toEqual({ source: 'a', flags: 'g', subject: 'aaa' });
      expect(typeof options?.supersedeKey).toBe('string');
    });

    it('debounces rather than sending one request per keystroke', async () => {
      setPattern('a');
      setPattern('ab');
      setPattern('abc');
      await vi.advanceTimersByTimeAsync(500);

      expect(analysisRequest).toHaveBeenCalledTimes(1);
      expect(analysisRequest.mock.calls[0]?.[1]).toEqual({ source: 'abc', flags: 'g' });
    });

    it('does not analyse an empty pattern', async () => {
      setPattern('a');
      await vi.advanceTimersByTimeAsync(500);
      analysisRequest.mockClear();

      setPattern('');
      await vi.advanceTimersByTimeAsync(500);

      expect(analysisRequest).not.toHaveBeenCalled();
      expect(workspaceStore.getState().analysisStatus).toBe('idle');
    });

    it('does not execute without a test string', async () => {
      setPattern('a');
      await vi.advanceTimersByTimeAsync(500);
      expect(execRequest).not.toHaveBeenCalled();
    });

    it('re-runs both when a flag changes', async () => {
      setPattern('a');
      setTestSubject('aaa');
      await vi.advanceTimersByTimeAsync(500);
      analysisRequest.mockClear();
      execRequest.mockClear();

      toggleFlag('i');
      await vi.advanceTimersByTimeAsync(500);

      expect(analysisRequest).toHaveBeenCalledTimes(1);
      expect(execRequest).toHaveBeenCalledTimes(1);
      expect(execRequest.mock.calls[0]?.[1]).toMatchObject({ flags: 'gi' });
    });
  });

  describe('staleness', () => {
    it('discards a response that describes input the user has replaced', async () => {
      // The response arrives after the pattern moved on. Applying it would
      // show an explanation of text that is no longer on screen.
      let resolveFirst: ((value: unknown) => void) | undefined;
      analysisRequest.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      );

      setPattern('old');
      await vi.advanceTimersByTimeAsync(200);

      setPattern('new');
      resolveFirst?.(analysisFor('old'));
      await flush();

      expect(workspaceStore.getState().analysis).toBeNull();
    });

    it('applies a response that still matches the current input', async () => {
      setPattern('abc');
      analysisRequest.mockResolvedValue(analysisFor('abc'));
      await vi.advanceTimersByTimeAsync(500);

      expect(workspaceStore.getState().analysis?.source).toBe('abc');
      expect(workspaceStore.getState().analysisStatus).toBe('ready');
    });

    it('ignores a superseded request without flashing an error', async () => {
      analysisRequest.mockResolvedValueOnce(
        err(workerError('SUPERSEDED', 'A newer request replaced this one.')),
      );
      setPattern('a');
      await vi.advanceTimersByTimeAsync(500);

      expect(workspaceStore.getState().analysisStatus).not.toBe('error');
      expect(workspaceStore.getState().analysisError).toBeNull();
    });

    it('discards a stale execution result too', async () => {
      let resolveFirst: ((value: unknown) => void) | undefined;
      execRequest.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      );

      setPattern('a');
      setTestSubject('aaa');
      await vi.advanceTimersByTimeAsync(200);

      setTestSubject('bbb');
      resolveFirst?.(execFor(3));
      await flush();

      expect(workspaceStore.getState().exec).toBeNull();
    });
  });

  describe('failures', () => {
    it('reports a timeout in its own state, with honest wording', async () => {
      execRequest.mockResolvedValue(
        err(workerError('TIMEOUT', 'Execution stopped after 2000 ms. The worker was terminated.')),
      );

      setPattern('(a+)+$');
      setTestSubject('aaaa!');
      await vi.advanceTimersByTimeAsync(500);

      const state = workspaceStore.getState();
      expect(state.execStatus).toBe('timeout');
      expect(state.execError?.message).toMatch(/timed out after 2 seconds/);
      expect(JSON.stringify(state.execError)).not.toMatch(/malicious|attack|prevented/i);
    });

    it('surfaces a domain error with its hint and position', async () => {
      analysisRequest.mockResolvedValue(
        err(
          workerError('DOMAIN', 'Unmatched `(`', {
            code: 'SYNTAX',
            message: 'Unmatched `(` at position 0.',
            hint: 'Add a closing parenthesis.',
            span: span(0, 1),
          }),
        ),
      );

      setPattern('(');
      await vi.advanceTimersByTimeAsync(500);

      const state = workspaceStore.getState();
      expect(state.analysisStatus).toBe('error');
      expect(state.analysisError?.message).toBe('Unmatched `(` at position 0.');
      expect(state.analysisError?.hint).toBe('Add a closing parenthesis.');
      expect(state.analysisError?.span).toEqual(span(0, 1));
    });

    it('never leaks an internal failure verbatim', async () => {
      execRequest.mockResolvedValue(
        err(workerError('INTERNAL', 'TypeError: cannot read x of undefined at foo.ts:12')),
      );

      setPattern('a');
      setTestSubject('a');
      await vi.advanceTimersByTimeAsync(500);

      const message = workspaceStore.getState().execError?.message ?? '';
      expect(message).not.toMatch(/TypeError|\.ts:/);
      expect(message.length).toBeGreaterThan(0);
    });
  });

  describe('the worker-unavailable invariant', () => {
    it('disables testing rather than running the pattern on this thread', async () => {
      workersAvailable.mockReturnValue(false);

      setPattern('a');
      setTestSubject('aaa');
      await vi.advanceTimersByTimeAsync(500);

      expect(workspaceStore.getState().execStatus).toBe('unavailable');
      // The security invariant: no execution request is made anywhere, and
      // there is no local fallback path for one to take.
      expect(execRequest).not.toHaveBeenCalled();
    });

    it('keeps explanations working when testing is unavailable', async () => {
      workersAvailable.mockReturnValue(false);
      analysisRequest.mockResolvedValue(analysisFor('abc'));

      setPattern('abc');
      await vi.advanceTimersByTimeAsync(500);

      expect(workspaceStore.getState().analysis?.source).toBe('abc');
    });
  });

  describe('flags', () => {
    it('turns off v when u is switched on, and the reverse', () => {
      toggleFlag('v');
      expect(workspaceStore.getState().flags).toContain('v');

      toggleFlag('u');
      const { flags } = workspaceStore.getState();
      expect(flags).toContain('u');
      expect(flags).not.toContain('v');
    });

    it('restores the default set', () => {
      setFlags('imsy');
      resetFlags();
      expect(workspaceStore.getState().flags).toBe('g');
    });
  });

  describe('commands', () => {
    it('analyses immediately, skipping the debounce', async () => {
      setPattern('abc');
      analyzeNow();
      await flush();

      expect(analysisRequest).toHaveBeenCalledTimes(1);
    });

    it('loads an example as one change, not three', async () => {
      loadExample('a+', 'aaa', 'gi');
      await vi.advanceTimersByTimeAsync(500);

      expect(analysisRequest).toHaveBeenCalledTimes(1);
      expect(workspaceStore.getState()).toMatchObject({
        pattern: 'a+',
        testSubject: 'aaa',
        flags: 'gi',
      });
    });

    it('clears everything and cancels pending work', async () => {
      setPattern('abc');
      setTestSubject('abc');
      clearWorkspace();
      await vi.advanceTimersByTimeAsync(500);

      expect(analysisRequest).not.toHaveBeenCalled();
      expect(workspaceStore.getState()).toMatchObject({
        pattern: '',
        testSubject: '',
        analysis: null,
        analysisStatus: 'idle',
        exec: null,
        execStatus: 'idle',
      });
    });
  });
});
