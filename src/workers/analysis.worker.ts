/// <reference lib="webworker" />
import { domainError, truncateForMessage } from '@/domain/shared/result';
import { analyzeRegex } from '@/domain/regex/analyze';
import {
  describeRequestRejection,
  isAnalysisOp,
  parseWorkerRequest,
  type AnalysisEchoPayload,
  type AnalysisEchoResult,
  type AnalysisPingPayload,
  type AnalysisPingResult,
  type AnalysisRegexPayload,
  type AnalysisRequest,
  type WorkerResponse,
} from '@/infrastructure/workers/protocol';

/**
 * Analysis worker — long-lived, one instance.
 *
 * This worker runs *our* code: parsers that are bounded by input limits and
 * whose termination is asserted. It therefore has no reason to be terminated,
 * and the client never does so on a deadline. If it ever needs killing, that
 * is a bug to fix rather than a behaviour to design around
 * (04_PARSER_ARCHITECTURE.md §2.7).
 *
 * M2 scope: dispatch, validation, and error containment. The regex parser
 * (M3) and JSON parser (M5) register their operations here without changing
 * anything below.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

function respond(response: WorkerResponse): void {
  scope.postMessage(response);
}

/* ------------------------------------------------------------------ *
 * M2 stub operations
 *
 * These prove the boundary works. They are not analysis and are labelled so
 * nobody mistakes them for it.
 * ------------------------------------------------------------------ */

function handlePing(payload: AnalysisPingPayload): AnalysisPingResult {
  return { pong: true, sentAt: payload.sentAt, receivedAt: Date.now() };
}

function handleEcho(payload: AnalysisEchoPayload): AnalysisEchoResult {
  // Returns a derived value rather than the input verbatim, so the test
  // proves the worker actually processed the payload rather than the client
  // reading back something it already had.
  return { text: payload.text, length: payload.text.length };
}

/**
 * Regex parsing and explanation.
 *
 * The worker re-validates limits and flags itself rather than trusting the
 * caller: a compromised main thread is exactly the case where trusting the
 * sender would be wrong (05_SECURITY.md §6).
 */
function handleRegex(id: number, payload: AnalysisRegexPayload): WorkerResponse {
  const result = analyzeRegex({ source: payload.source, flags: payload.flags });
  return result.ok
    ? { id, ok: true, result: result.value }
    : { id, ok: false, error: result.error };
}

function dispatch(request: AnalysisRequest): WorkerResponse {
  // Exhaustive by design: adding an operation without handling it is a lint
  // error. That rule is what caught this case being missing during M3.
  switch (request.op) {
    case 'analysis.ping':
      return { id: request.id, ok: true, result: handlePing(request.payload) };

    case 'analysis.echo':
      return { id: request.id, ok: true, result: handleEcho(request.payload) };

    case 'analysis.regex':
      return handleRegex(request.id, request.payload);
  }
}

scope.onmessage = (event: MessageEvent<unknown>): void => {
  const request = parseWorkerRequest(event.data);

  if (!request) {
    // No valid id means no correlation is possible, so there is nobody to
    // reply to. Discard rather than guess.
    return;
  }

  if (!isAnalysisOp(request.op)) {
    // Execution operations belong to the disposable worker. Receiving one
    // here means a routing bug, not a user error.
    respond({
      id: request.id,
      ok: false,
      error: domainError('INTERNAL', 'This operation is not available in the analysis worker.'),
    });
    return;
  }

  try {
    respond(dispatch(request));
  } catch (error) {
    // A top-level catch is what keeps one malformed request from killing the
    // worker and silently breaking every later analysis. The message stays
    // generic; detail is development-only (05_SECURITY.md §11).
    respond({
      id: request.id,
      ok: false,
      error: domainError('INTERNAL', 'The analysis engine hit an unexpected error.', {
        detail: import.meta.env.DEV
          ? truncateForMessage(error instanceof Error ? error.message : String(error))
          : undefined,
      }),
    });
  }
};

/**
 * Messages that fail validation carry no id, so `onmessage` cannot reply.
 * `messageerror` fires when a message could not be deserialised at all —
 * also uncorrelatable, also discarded. Both are surfaced to the caller by its
 * deadline expiring, which is the correct outcome.
 */
scope.onmessageerror = (): void => {
  /* discarded — see above */
};

export function describeRejection(value: unknown): string {
  return describeRequestRejection(value);
}
