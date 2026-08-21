/**
 * The development-only worker harness surface, declared for the E2E project.
 *
 * `src/app/devWorkerHarness.ts` declares the same shape for the app project.
 * They are separate TypeScript programs (tsconfig.app vs tsconfig.node), so
 * the declarations do not collide, and the e2e specs get real types instead
 * of `any` — which the strict lint rules require.
 */
type HarnessOutcome = Promise<{
  ok: boolean;
  code?: string;
  message?: string;
  value?: unknown;
}>;

interface SyntaxLabDevHarness {
  regex: (source: string, flags?: string) => HarnessOutcome;
  json: (source: string) => HarnessOutcome;
  ping: () => Promise<{ ok: boolean; code?: string; message?: string; value?: unknown }>;
  echo: (
    text: string,
  ) => Promise<{ ok: boolean; code?: string; message?: string; value?: unknown }>;
  spin: (
    durationMs: number,
    timeoutMs?: number,
  ) => Promise<{ ok: boolean; code?: string; message?: string; value?: unknown }>;
  execStatus: () => string;
  analysisStatus: () => string;
  executionAvailable: () => boolean;
  reset: () => void;
}

interface Window {
  __syntaxlabDev?: SyntaxLabDevHarness;
  /**
   * CSP violations recorded in the page by the M12 release-QA watcher.
   *
   * Declared here rather than in a `declare global` block with an `export`:
   * this file has no imports or exports on purpose, which is what keeps its
   * declarations ambient. Making it a module would take `__syntaxlabDev` out
   * of scope for every worker spec.
   */
  __csp?: string[];
}
