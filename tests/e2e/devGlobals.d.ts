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
}
