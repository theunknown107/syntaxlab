/// <reference lib="webworker" />
import { domainError } from '@/domain/shared/result';
import {
  isExecOp,
  parseWorkerRequest,
  type ExecSpinPayload,
  type ExecSpinResult,
  type WorkerResponse,
} from '@/infrastructure/workers/protocol';

/**
 * Execution worker — disposable, sacrificial.
 *
 * This is the thread that will run foreign, uninterruptible code: at M4,
 * `RegExp.exec` against a user-supplied pattern. JavaScript regex execution
 * cannot be interrupted — there is no timeout, no step limit, no abort
 * signal — so destroying the thread is the only reliable stop
 * (04_PARSER_ARCHITECTURE.md §2.7).
 *
 * It is deliberately tiny. It gets killed regularly, so it must have nothing
 * worth losing: no cache, no accumulated state, no other feature's work. That
 * is the entire reason it is separate from the analysis worker, and it is a
 * hard architectural invariant rather than a convenience.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Occupies the thread for `durationMs` without yielding.
 *
 * A busy loop, not `setTimeout`: a sleeping worker still processes messages
 * and could be asked politely to stop, which would prove nothing. The
 * condition being modelled is a thread that *cannot* yield, which is exactly
 * what catastrophic backtracking produces. Termination must be shown to work
 * against that, not against a cooperative task.
 *
 * Infrastructure test primitive only — never surfaced in the UI.
 */
function spin(payload: ExecSpinPayload): ExecSpinResult {
  const startedAt = Date.now();
  const deadline = startedAt + payload.durationMs;

  // eslint-disable-next-line no-empty -- an intentionally empty busy loop
  while (Date.now() < deadline) {}

  return { completed: true, elapsedMs: Date.now() - startedAt };
}

scope.onmessage = (event: MessageEvent<unknown>): void => {
  const request = parseWorkerRequest(event.data);

  if (!request) return; // uncorrelatable — discard

  if (!isExecOp(request.op)) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: domainError('INTERNAL', 'This operation is not available in the execution worker.'),
    } satisfies WorkerResponse);
    return;
  }

  try {
    scope.postMessage({
      id: request.id,
      ok: true,
      result: spin(request.payload),
    } satisfies WorkerResponse);
  } catch {
    // Reached only if the engine throws (for example, out of memory). The
    // client's deadline covers the case where nothing comes back at all.
    scope.postMessage({
      id: request.id,
      ok: false,
      error: domainError('INTERNAL', 'Execution failed unexpectedly.'),
    } satisfies WorkerResponse);
  }
};

scope.onmessageerror = (): void => {
  /* uncorrelatable — discarded; the caller's deadline covers it */
};
