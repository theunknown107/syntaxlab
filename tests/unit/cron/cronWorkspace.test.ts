import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok } from '@/domain/shared/result';
import { workerError } from '@/infrastructure/workers/protocol';

/**
 * The cron seam between the editor and the analysis worker — M15
 *
 * The worker is replaced so responses can be delivered on demand. What is
 * tested here is the orchestration: which request is sent, when, which
 * response is applied and which is discarded. The parser itself is exercised
 * for real in `tests/unit/cron/`.
 */

type RequestCall = (
  op: string,
  payload: unknown,
  options?: { supersedeKey?: string },
) => Promise<unknown>;

const analysisRequest = vi.fn<RequestCall>();

vi.mock('@/infrastructure/workers/workers', () => ({
  getAnalysisClient: () => ({ request: analysisRequest }),
  getExecClient: () => ({ request: vi.fn() }),
  isRegexExecutionAvailable: () => true,
}));

const { workspaceStore, submissionOf } = await import('@/application/stores/workspaceStore');
const { analyzeCronNow, clearCron, loadCronExample, setCronInput, setCronTimezoneMode } =
  await import('@/application/cron/cronWorkspace');

/** A minimal successful analysis, shaped like the worker's real reply. */
function analysisFor(source: string, mode: 'browserLocal' | 'utc' = 'browserLocal') {
  return ok({
    kind: 'cron',
    source,
    dialect: 'standard5',
    tokens: [],
    fields: [],
    explanation: { summary: [{ kind: 'text', value: `Runs: ${source}` }], details: [] },
    warnings: [],
    timezone: {
      mode,
      ianaZone: mode === 'utc' ? 'UTC' : 'Europe/London',
      resolvedFrom: mode === 'utc' ? 'userSelection' : 'browserResolvedOptions',
      currentOffsetMinutes: 0,
      observesDst: mode !== 'utc',
    },
    errors: [],
  });
}

const submission = () => {
  const state = workspaceStore.getState();
  return submissionOf(state.cronInput, state.cronCommitted);
};

describe('cron workspace use-cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    workspaceStore.reset();
    analysisRequest.mockReset();
    analysisRequest.mockResolvedValue(analysisFor(''));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('explicit submission', () => {
    it('sends nothing while the user is only typing', async () => {
      setCronInput('*');
      setCronInput('*/1');
      setCronInput('*/15 9-17 * * 1-5');
      await vi.advanceTimersByTimeAsync(5_000);

      expect(analysisRequest).not.toHaveBeenCalled();
      expect(workspaceStore.getState().cronStatus).toBe('idle');
    });

    it('sends exactly one request per Analyze', async () => {
      setCronInput('*/15 9-17 * * 1-5');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      expect(analysisRequest).toHaveBeenCalledTimes(1);
      const [op, payload, options] = analysisRequest.mock.calls[0] ?? [];
      expect(op).toBe('analysis.cron');
      expect(payload).toEqual({ source: '*/15 9-17 * * 1-5', timezoneMode: 'browserLocal' });
      expect(typeof options?.supersedeKey).toBe('string');
    });

    it('trims the expression it submits but keeps what the user typed', async () => {
      setCronInput('  0 0 * * *  ');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      expect(analysisRequest.mock.calls[0]?.[1]).toMatchObject({ source: '0 0 * * *' });
      expect(workspaceStore.getState().cronInput).toBe('  0 0 * * *  ');
    });

    it('analyses nothing when the editor holds only whitespace', async () => {
      setCronInput('   ');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      expect(analysisRequest).not.toHaveBeenCalled();
      expect(workspaceStore.getState().cronStatus).toBe('idle');
    });

    it('has nothing to submit once the visible result matches the editor', async () => {
      setCronInput('0 0 * * *');
      expect(submission().submittable).toBe(true);

      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      expect(submission().submittable).toBe(false);
      expect(submission().stale).toBe(false);
    });
  });

  describe('draft and committed', () => {
    it('keeps the previous analysis on screen and marks it stale', async () => {
      analysisRequest.mockResolvedValue(analysisFor('0 0 * * *'));
      setCronInput('0 0 * * *');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      setCronInput('0 0 * * 1');

      // The old answer is still correct — it describes what was submitted —
      // so it stays, labelled rather than blanked.
      expect(workspaceStore.getState().cronAnalysis).not.toBeNull();
      expect(submission().stale).toBe(true);
      expect(workspaceStore.getState().cronCommitted).toBe('0 0 * * *');
    });

    it('is not stale before anything has been analysed', () => {
      setCronInput('0 0 * * *');
      expect(submission().untouched).toBe(true);
      expect(submission().stale).toBe(false);
    });

    it('applies a response that still belongs to the committed expression', async () => {
      analysisRequest.mockResolvedValue(analysisFor('0 0 * * *'));
      setCronInput('0 0 * * *');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      expect(workspaceStore.getState().cronAnalysis?.source).toBe('0 0 * * *');
      expect(workspaceStore.getState().cronStatus).toBe('ready');
    });

    it('discards a response the user has already superseded', async () => {
      let resolveFirst: ((value: unknown) => void) | undefined;
      analysisRequest.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      );

      setCronInput('0 0 * * *');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(10);

      // A second submission lands first.
      analysisRequest.mockResolvedValue(analysisFor('0 0 1 * *'));
      setCronInput('0 0 1 * *');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      resolveFirst?.(analysisFor('0 0 * * *'));
      await vi.advanceTimersByTimeAsync(100);

      expect(workspaceStore.getState().cronAnalysis?.source).toBe('0 0 1 * *');
    });

    it('ignores a superseded reply without flashing an error', async () => {
      analysisRequest.mockResolvedValueOnce(
        err(workerError('SUPERSEDED', 'A newer request replaced this one.')),
      );
      setCronInput('0 0 * * *');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      expect(workspaceStore.getState().cronError).toBeNull();
      expect(workspaceStore.getState().cronStatus).not.toBe('error');
    });
  });

  describe('refusals', () => {
    it('shows the refusal message and its hint rather than swallowing them', async () => {
      analysisRequest.mockResolvedValue(
        err(
          workerError('DOMAIN', 'refused', {
            code: 'UNSUPPORTED',
            message: 'This expression has 6 fields.',
            hint: 'If your first field is seconds, removing it may give the 5-field equivalent.',
          }),
        ),
      );

      setCronInput('0 0 12 * * ?');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      const state = workspaceStore.getState();
      expect(state.cronStatus).toBe('error');
      expect(state.cronError?.message).toBe('This expression has 6 fields.');
      expect(state.cronError?.hint).toMatch(/seconds/);
      expect(state.cronAnalysis).toBeNull();
    });

    it('never leaks an internal failure verbatim', async () => {
      analysisRequest.mockResolvedValue(
        err(workerError('INTERNAL', 'TypeError: cannot read x of undefined at cron.ts:12')),
      );
      setCronInput('0 0 * * *');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      const message = workspaceStore.getState().cronError?.message ?? '';
      expect(message).not.toMatch(/TypeError|\.ts:/);
      expect(message.length).toBeGreaterThan(0);
    });
  });

  describe('timezone', () => {
    it('offers exactly two modes and sends the selected one', async () => {
      setCronInput('0 3 * * *');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);
      expect(analysisRequest.mock.calls[0]?.[1]).toMatchObject({ timezoneMode: 'browserLocal' });

      setCronTimezoneMode('utc');
      await vi.advanceTimersByTimeAsync(100);
      expect(analysisRequest.mock.calls[1]?.[1]).toMatchObject({ timezoneMode: 'utc' });
    });

    it('re-analyses on a timezone change without making the result stale', async () => {
      analysisRequest.mockResolvedValue(analysisFor('0 3 * * *'));
      setCronInput('0 3 * * *');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      setCronTimezoneMode('utc');
      await vi.advanceTimersByTimeAsync(100);

      // The timezone is a question about the expression already on screen, not
      // an edit to it, so the committed input has not moved.
      expect(submission().stale).toBe(false);
      expect(analysisRequest).toHaveBeenCalledTimes(2);
    });

    it('does not analyse a timezone change before anything was submitted', async () => {
      setCronTimezoneMode('utc');
      await vi.advanceTimersByTimeAsync(100);
      expect(analysisRequest).not.toHaveBeenCalled();
    });

    it('ignores a change to the mode already selected', async () => {
      analysisRequest.mockResolvedValue(analysisFor('0 3 * * *'));
      setCronInput('0 3 * * *');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);
      analysisRequest.mockClear();

      setCronTimezoneMode('browserLocal');
      await vi.advanceTimersByTimeAsync(100);
      expect(analysisRequest).not.toHaveBeenCalled();
    });
  });

  describe('commands', () => {
    it('loads an example and explains it, because choosing one is the request', async () => {
      analysisRequest.mockResolvedValue(analysisFor('@weekly'));
      loadCronExample('@weekly');
      await vi.advanceTimersByTimeAsync(100);

      expect(workspaceStore.getState().cronInput).toBe('@weekly');
      expect(analysisRequest).toHaveBeenCalledTimes(1);
    });

    it('clears the editor and everything derived from it', async () => {
      analysisRequest.mockResolvedValue(analysisFor('0 0 * * *'));
      setCronInput('0 0 * * *');
      analyzeCronNow();
      await vi.advanceTimersByTimeAsync(100);

      clearCron();

      const state = workspaceStore.getState();
      expect(state.cronInput).toBe('');
      expect(state.cronCommitted).toBeNull();
      expect(state.cronAnalysis).toBeNull();
      expect(state.cronStatus).toBe('idle');
      expect(state.cronError).toBeNull();
    });
  });
});
