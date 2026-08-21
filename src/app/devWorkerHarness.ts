import { LIMITS } from '@/domain/shared/limits';
import {
  disposeWorkers,
  getAnalysisClient,
  getExecClient,
  isRegexExecutionAvailable,
} from '@/infrastructure/workers/workers';

/**
 * Development-only worker harness.
 *
 * M2 delivers infrastructure, so there is no product surface that exercises a
 * timeout yet — the regex tester that will is M4. Proving termination in a
 * real browser nevertheless has to happen now, because the whole ReDoS
 * defence rests on it (risk R-10), and a unit test with a fake worker cannot
 * prove that a real thread stops.
 *
 * This attaches a small control surface to `window` so the E2E suite can
 * drive real workers across Chromium, Firefox, and WebKit.
 *
 * It is guarded by `import.meta.env.DEV`, which Vite replaces with `false` in
 * production builds; the whole module is then dropped by the minifier. An E2E
 * test asserts it is absent from the production bundle, so the guarantee is
 * verified rather than assumed.
 *
 * It is never referenced by the UI and is not a product feature.
 */

interface HarnessOutcome {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly value?: unknown;
}

declare global {
  interface Window {
    __syntaxlabDev?: {
      ping: () => Promise<HarnessOutcome>;
      echo: (text: string) => Promise<HarnessOutcome>;
      regex: (source: string, flags?: string) => Promise<HarnessOutcome>;
      json: (source: string) => Promise<HarnessOutcome>;
      spin: (durationMs: number, timeoutMs?: number) => Promise<HarnessOutcome>;
      execStatus: () => string;
      analysisStatus: () => string;
      executionAvailable: () => boolean;
      reset: () => void;
    };
  }
}

function toOutcome(result: {
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
}): HarnessOutcome {
  if (result.ok) return { ok: true, value: result.value };
  // Spread rather than read field by field: `exactOptionalPropertyTypes` draws
  // a distinction between an absent key and one holding undefined, and an
  // absent error should leave both keys absent.
  return result.error ? { ok: false, ...result.error } : { ok: false };
}

export function installDevWorkerHarness(): void {
  if (!import.meta.env.DEV) return;

  window.__syntaxlabDev = {
    ping: async () =>
      toOutcome(await getAnalysisClient().request('analysis.ping', { sentAt: Date.now() })),

    echo: async (text: string) =>
      toOutcome(await getAnalysisClient().request('analysis.echo', { text })),

    regex: async (source: string, flags = '') =>
      toOutcome(await getAnalysisClient().request('analysis.regex', { source, flags })),

    json: async (source: string) =>
      toOutcome(await getAnalysisClient().request('analysis.json', { source })),

    spin: async (durationMs: number, timeoutMs?: number) =>
      toOutcome(
        await getExecClient().request(
          'exec.spin',
          { durationMs },
          timeoutMs === undefined ? {} : { timeoutMs },
        ),
      ),

    execStatus: () => getExecClient().status,
    analysisStatus: () => getAnalysisClient().status,
    executionAvailable: () => isRegexExecutionAvailable(),
    reset: () => {
      disposeWorkers();
    },
  };
}

/** The execution deadline, re-exported so E2E timings stay in step with it. */
export const EXEC_DEADLINE_MS = LIMITS.regex.execMs;
