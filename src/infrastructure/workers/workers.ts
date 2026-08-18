import { LIMITS } from '@/domain/shared/limits';
import { detectCapabilities } from '@/infrastructure/browser/capabilities';
import { WorkerClient } from './workerClient';

/**
 * Worker wiring — the two clients and their lifecycle policies.
 *
 * Worker URLs are built with `new URL(..., import.meta.url)` so Vite emits
 * them as same-origin bundled assets. No worker is ever constructed from a
 * `blob:` URL or from a string, and CSP `worker-src 'self'` enforces that
 * (05_SECURITY.md §3.3).
 */

/**
 * How long the analysis worker may take before we report a problem. Generous:
 * this code is ours and bounded by input limits, so a timeout here indicates
 * a bug rather than hostile input, and the worker is not terminated for it.
 */
const ANALYSIS_TIMEOUT_MS = 10_000;

let analysisClient: WorkerClient | null = null;
let execClient: WorkerClient | null = null;

export function getAnalysisClient(): WorkerClient {
  analysisClient ??= new WorkerClient({
    name: 'The analysis engine',
    createWorker: () =>
      new Worker(new URL('../../workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
      }),
    defaultTimeoutMs: ANALYSIS_TIMEOUT_MS,
    // Long-lived: terminating it would discard warm module state and any
    // unrelated in-flight parse, turning a contained problem into a broad one.
    terminateOnTimeout: false,
  });
  return analysisClient;
}

export function getExecClient(): WorkerClient {
  execClient ??= new WorkerClient({
    name: 'The execution engine',
    createWorker: () =>
      new Worker(new URL('../../workers/exec.worker.ts', import.meta.url), { type: 'module' }),
    defaultTimeoutMs: LIMITS.regex.execMs,
    // Disposable: the thread may be running uninterruptible code, so
    // termination is the only reliable stop.
    terminateOnTimeout: true,
  });
  return execClient;
}

/**
 * Whether regex execution can be offered at all.
 *
 * When workers are unavailable the tester is **disabled**, never relocated to
 * the main thread. Running uninterruptible foreign code on the thread that
 * owns the UI would trade a missing feature for a frozen tab — the security
 * model does not degrade silently (02_ARCHITECTURE.md §4.5).
 */
export function isRegexExecutionAvailable(): boolean {
  return detectCapabilities().workers;
}

/** Releases both clients. Used by tests and by a full application reset. */
export function disposeWorkers(): void {
  analysisClient?.dispose();
  execClient?.dispose();
  analysisClient = null;
  execClient = null;
}
