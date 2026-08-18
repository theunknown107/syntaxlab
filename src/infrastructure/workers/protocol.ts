import type { DomainError } from '@/domain/shared/result';
import type { RegexAnalysis } from '@/domain/regex/ast';
import type {
  MatchCapture,
  NamedCapture,
  RegexExecResult,
  RegexMatch,
} from '@/domain/regex/execute';
import { isValidRegexAnalysis, isValidRegexExecResult } from '@/domain/regex/validate';

/**
 * Worker wire protocol — 15_API_AND_BROWSER_CAPABILITIES.md §2
 *
 * Both ends of this boundary ship in the same build, so there is no version
 * negotiation: a mismatched protocol cannot occur in practice and a version
 * field would be ceremony.
 *
 * What the boundary *does* need is validation. The worker re-validates every
 * payload rather than trusting its caller — the scenario that matters is a
 * compromised main thread, where trusting the sender is exactly wrong. The
 * main thread likewise validates every response before acting on it.
 *
 * Only structured-clone-safe plain data crosses. No functions, no class
 * instances, no Date, no RegExp objects.
 */

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

/**
 * M2 ships infrastructure only. These two operations exist to prove the
 * boundary works end to end; they are NOT analysis and do not pretend to be.
 * `parse.regex` and `parse.json` replace them at M3 and M5.
 */
export const ANALYSIS_OPS = ['analysis.ping', 'analysis.echo', 'analysis.regex'] as const;
export type AnalysisOp = (typeof ANALYSIS_OPS)[number];

/**
 * `exec.spin` is an infrastructure test primitive, not a product feature: it
 * busy-loops for a requested duration so termination can be proven against
 * genuinely blocked thread. A `setTimeout` would leave the worker responsive
 * and would prove nothing — the whole point is that the thread cannot yield,
 * which is precisely the situation a catastrophically backtracking regex
 * creates at M4.
 *
 * It is never exposed in the UI.
 */
export const EXEC_OPS = ['exec.spin', 'exec.regex'] as const;
export type ExecOp = (typeof EXEC_OPS)[number];

export type WorkerOp = AnalysisOp | ExecOp;

/* ------------------------------------------------------------------ *
 * Payloads and results
 * ------------------------------------------------------------------ */

export interface AnalysisPingPayload {
  readonly sentAt: number;
}
export interface AnalysisPingResult {
  readonly pong: true;
  readonly sentAt: number;
  readonly receivedAt: number;
}

export interface AnalysisEchoPayload {
  readonly text: string;
}
export interface AnalysisEchoResult {
  readonly text: string;
  readonly length: number;
}

export interface AnalysisRegexPayload {
  readonly source: string;
  /** Raw flag string, validated in the worker rather than trusted. */
  readonly flags: string;
}

/**
 * The only operation that runs foreign code. It lives on the disposable
 * worker so its deadline can be enforced by destroying the thread, which is
 * the only reliable stop for an uninterruptible regex.
 */
export interface ExecRegexPayload {
  readonly source: string;
  /** Raw flag string, re-validated in the worker rather than trusted. */
  readonly flags: string;
  readonly subject: string;
}

export interface ExecSpinPayload {
  /** Milliseconds to occupy the worker thread for. */
  readonly durationMs: number;
}
export interface ExecSpinResult {
  readonly completed: true;
  readonly elapsedMs: number;
}

/** Maps an operation to its payload and result types. */
export interface OpTypes {
  'analysis.ping': { payload: AnalysisPingPayload; result: AnalysisPingResult };
  'analysis.echo': { payload: AnalysisEchoPayload; result: AnalysisEchoResult };
  'analysis.regex': { payload: AnalysisRegexPayload; result: RegexAnalysis };
  'exec.spin': { payload: ExecSpinPayload; result: ExecSpinResult };
  'exec.regex': { payload: ExecRegexPayload; result: RegexExecResult };
}

export type PayloadFor<TOp extends WorkerOp> = OpTypes[TOp]['payload'];
export type ResultFor<TOp extends WorkerOp> = OpTypes[TOp]['result'];

/* ------------------------------------------------------------------ *
 * Envelopes
 * ------------------------------------------------------------------ */

/**
 * Distributive on purpose: `WorkerRequest` expands to a union of concrete
 * shapes rather than one shape with union members, so `switch (request.op)`
 * narrows `payload` correctly and the exhaustiveness check has teeth.
 */
export type WorkerRequest<TOp extends WorkerOp = WorkerOp> = TOp extends WorkerOp
  ? { readonly id: number; readonly op: TOp; readonly payload: PayloadFor<TOp> }
  : never;

/** Requests the analysis worker accepts. */
export type AnalysisRequest = WorkerRequest<AnalysisOp>;
/** Requests the execution worker accepts. */
export type ExecRequest = WorkerRequest<ExecOp>;

export type WorkerResponse<TOp extends WorkerOp = WorkerOp> =
  | { readonly id: number; readonly ok: true; readonly result: ResultFor<TOp> }
  | { readonly id: number; readonly ok: false; readonly error: DomainError };

/** A response the analysis worker may produce. */
export type AnalysisResponse = WorkerResponse<AnalysisOp>;

/* ------------------------------------------------------------------ *
 * Client-side error type
 * ------------------------------------------------------------------ */

/**
 * Conditions the *client* detects. These never cross the wire — a timed-out
 * worker sends nothing, by definition — so they are deliberately separate
 * from `DomainError`, which describes failures the worker reports about the
 * input it was given.
 *
 * Keeping them apart means the domain never grows codes that describe
 * transport problems it has no opinion about.
 */
export type WorkerErrorCode =
  /** The deadline expired. For a disposable worker this implies termination. */
  | 'TIMEOUT'
  /** A newer request for the same key replaced this one before it settled. */
  | 'SUPERSEDED'
  /** Workers are unsupported or construction failed. */
  | 'UNAVAILABLE'
  /** The worker was terminated (timeout of a sibling request, or disposal). */
  | 'TERMINATED'
  /** A malformed or uncorrelatable message crossed the boundary. */
  | 'PROTOCOL'
  /** The worker reported a failure about the request itself. */
  | 'DOMAIN'
  /** An unexpected client-side failure. */
  | 'INTERNAL';

export interface WorkerError {
  readonly code: WorkerErrorCode;
  /** User-facing, plain language. Never a stack trace (05_SECURITY.md §11). */
  readonly message: string;
  /** Present only when `code` is 'DOMAIN' — the error the worker reported. */
  readonly cause?: DomainError;
}

export function workerError(
  code: WorkerErrorCode,
  message: string,
  cause?: DomainError,
): WorkerError {
  // Built field-by-field rather than by spreading, so an unexpected key can
  // never reach a WorkerError (18_CODING_STANDARDS.md S4).
  return cause === undefined ? { code, message } : { code, message, cause };
}

/* ------------------------------------------------------------------ *
 * Validation — both directions
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isAnalysisOp(value: unknown): value is AnalysisOp {
  return ANALYSIS_OPS.includes(value as AnalysisOp);
}

export function isExecOp(value: unknown): value is ExecOp {
  return EXEC_OPS.includes(value as ExecOp);
}

/** Per-operation payload validators. Each narrows `unknown` structurally. */
const PAYLOAD_VALIDATORS: {
  [TOp in WorkerOp]: (payload: unknown) => payload is PayloadFor<TOp>;
} = {
  'analysis.ping': (payload): payload is AnalysisPingPayload =>
    isRecord(payload) && typeof payload.sentAt === 'number',

  'analysis.echo': (payload): payload is AnalysisEchoPayload =>
    isRecord(payload) && typeof payload.text === 'string',

  'analysis.regex': (payload): payload is AnalysisRegexPayload =>
    isRecord(payload) && typeof payload.source === 'string' && typeof payload.flags === 'string',

  'exec.regex': (payload): payload is ExecRegexPayload =>
    isRecord(payload) &&
    typeof payload.source === 'string' &&
    typeof payload.flags === 'string' &&
    typeof payload.subject === 'string',

  'exec.spin': (payload): payload is ExecSpinPayload =>
    isRecord(payload) &&
    typeof payload.durationMs === 'number' &&
    Number.isFinite(payload.durationMs) &&
    payload.durationMs >= 0,
};

/**
 * Validates a message received *by a worker*. Returns null rather than
 * throwing: an unparseable message has no id, so there is nobody to reply to
 * and the only correct action is to discard it.
 */
export function parseWorkerRequest(value: unknown): WorkerRequest | null {
  if (!isRecord(value)) return null;
  if (!isRequestId(value.id)) return null;

  const op = value.op;
  if (!isAnalysisOp(op) && !isExecOp(op)) return null;

  const validate = PAYLOAD_VALIDATORS[op];
  const payload: unknown = value.payload;
  if (!validate(payload)) return null;

  // Reconstructed field-by-field: unknown keys on the wire are dropped rather
  // than carried into the worker.
  return { id: value.id, op, payload } as WorkerRequest;
}

/** Distinguishes a payload that failed validation from a wholly unknown op. */
export function describeRequestRejection(value: unknown): string {
  if (!isRecord(value)) return 'Message was not an object.';
  if (!isRequestId(value.id)) return 'Message had no valid request id.';
  const op = value.op;
  if (!isAnalysisOp(op) && !isExecOp(op)) return `Unknown operation: ${String(op)}.`;
  return `Invalid payload for operation ${op}.`;
}

function isDomainError(value: unknown): value is DomainError {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

/**
 * Per-operation result validators — added at M3.
 *
 * The envelope check alone is not enough. Without these, a successful response
 * carried an unvalidated `unknown` straight into application state on the
 * strength of a TypeScript cast, which is exactly the "trust the type, not the
 * value" mistake the rest of the boundary avoids.
 *
 * Each validator narrows structurally and is paired with a reconstructor, so
 * unknown wire keys are dropped rather than carried inward.
 */
const RESULT_VALIDATORS: {
  [TOp in WorkerOp]: (result: unknown) => result is ResultFor<TOp>;
} = {
  'analysis.ping': (result): result is AnalysisPingResult =>
    isRecord(result) &&
    result.pong === true &&
    typeof result.sentAt === 'number' &&
    typeof result.receivedAt === 'number',

  'analysis.echo': (result): result is AnalysisEchoResult =>
    isRecord(result) && typeof result.text === 'string' && typeof result.length === 'number',

  'exec.spin': (result): result is ExecSpinResult =>
    isRecord(result) && result.completed === true && typeof result.elapsedMs === 'number',

  'analysis.regex': (result): result is RegexAnalysis => isValidRegexAnalysis(result),

  'exec.regex': (result): result is RegexExecResult => isValidRegexExecResult(result),
};

/**
 * Rebuilds one match. Unlike the analysis tree this *is* rebuilt in full: it
 * is small, bounded by `maxMatches`, and its offsets are used to slice the
 * subject and place editor decorations, so nothing unexamined should reach
 * the code that does that.
 */
function reconstructMatch(match: RegexMatch): RegexMatch {
  return {
    ordinal: match.ordinal,
    start: match.start,
    end: match.end,
    value: match.value,
    length: match.length,
    captures: match.captures.map(reconstructCapture),
    named: match.named.map((named): NamedCapture => ({
      name: named.name,
      value: named.value,
      length: named.length,
    })),
  };
}

function reconstructCapture(capture: MatchCapture): MatchCapture {
  const rebuilt: {
    number: number;
    value: string | null;
    length: number;
    start?: number;
    end?: number;
  } = { number: capture.number, value: capture.value, length: capture.length };
  if (capture.start !== undefined) rebuilt.start = capture.start;
  if (capture.end !== undefined) rebuilt.end = capture.end;
  return rebuilt;
}

/** Rebuilds a validated result field-by-field so no unknown key survives. */
const RESULT_RECONSTRUCTORS: {
  [TOp in WorkerOp]: (result: ResultFor<TOp>) => ResultFor<TOp>;
} = {
  'analysis.ping': (r) => ({ pong: true, sentAt: r.sentAt, receivedAt: r.receivedAt }),
  'analysis.echo': (r) => ({ text: r.text, length: r.length }),
  'exec.spin': (r) => ({ completed: true, elapsedMs: r.elapsedMs }),
  // RegexAnalysis is a large bounded tree. Rebuilding it node-by-node here
  // would duplicate the parser for no additional safety: it is produced by our
  // own code inside the worker, its shape is asserted by isValidRegexAnalysis,
  // and it is rendered as text rather than executed. Passed through as-is.
  'analysis.regex': (r) => r,
  'exec.regex': (r) => ({
    kind: 'regexExec',
    matches: r.matches.map(reconstructMatch),
    truncated: r.truncated,
    findsAll: r.findsAll,
    hasIndices: r.hasIndices,
    subjectLength: r.subjectLength,
    elapsedMs: r.elapsedMs,
  }),
};

/**
 * Validates a result against the operation that produced it. Returns null when
 * the shape is wrong, so the caller settles as a PROTOCOL error rather than
 * acting on a malformed object.
 */
export function validateResult<TOp extends WorkerOp>(
  op: TOp,
  result: unknown,
): ResultFor<TOp> | null {
  const validate = RESULT_VALIDATORS[op];
  if (!validate(result)) return null;
  const reconstruct = RESULT_RECONSTRUCTORS[op];
  return reconstruct(result);
}

/**
 * Validates a message received *by the main thread*. A response that fails
 * this check is discarded and its request settles as a PROTOCOL error, rather
 * than an unvalidated object reaching application state.
 */
export function parseWorkerResponse(value: unknown): WorkerResponse | null {
  if (!isRecord(value)) return null;
  if (!isRequestId(value.id)) return null;

  if (value.ok === true) {
    if (!('result' in value)) return null;
    return { id: value.id, ok: true, result: value.result } as WorkerResponse;
  }

  if (value.ok === false) {
    if (!isDomainError(value.error)) return null;
    return { id: value.id, ok: false, error: value.error };
  }

  return null;
}
