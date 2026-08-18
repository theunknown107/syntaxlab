import { err, ok, type Result } from '@/domain/shared/result';
import {
  parseWorkerResponse,
  validateResult,
  workerError,
  type PayloadFor,
  type ResultFor,
  type WorkerError,
  type WorkerOp,
  type WorkerRequest,
} from './protocol';

/**
 * WorkerClient — 02_ARCHITECTURE.md §4.3
 *
 * Owns one worker and everything around it: request correlation, deadlines,
 * supersession, termination, and respawn.
 *
 * Two instances exist with different lifecycle policies rather than two
 * classes, because the only real difference is what happens on a deadline:
 *
 *   analysis  long-lived      timeout is a bug; the worker survives
 *   exec      disposable      timeout terminates and respawns the worker
 *
 * Every method settles its promise exactly once and clears its timer. A leaked
 * timer or an unresolved promise here would be invisible and permanent, so the
 * settle path is centralised in `settle()` and nothing else resolves.
 */

export type WorkerClientStatus = 'unavailable' | 'idle' | 'ready';

export interface WorkerClientOptions {
  /** Used in user-facing messages; never a file path or internal identifier. */
  readonly name: string;
  /**
   * Constructs the underlying worker. Injected so the client is testable
   * without a real Worker, and so worker construction failure is observable
   * rather than thrown from a constructor.
   */
  readonly createWorker: () => Worker;
  readonly defaultTimeoutMs: number;
  /**
   * Disposable policy. When true, a deadline expiry terminates the worker and
   * eagerly spawns a replacement — the only reliable way to stop
   * uninterruptible code.
   */
  readonly terminateOnTimeout: boolean;
}

export interface RequestOptions {
  readonly timeoutMs?: number;
  /**
   * Requests sharing a key supersede one another: issuing a new one settles
   * any in-flight request with the same key as SUPERSEDED.
   *
   * This is what stops a slow earlier response overwriting a newer result
   * when a user types quickly (11_STATE_MANAGEMENT.md §5.1).
   */
  readonly supersedeKey?: string;
}

interface PendingRequest {
  readonly id: number;
  /** Needed to pick the right result validator when the response arrives. */
  readonly op: WorkerOp;
  readonly supersedeKey: string | undefined;
  readonly settle: (result: Result<unknown, WorkerError>) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class WorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private disposed = false;
  private unavailableReason: string | null = null;

  constructor(private readonly options: WorkerClientOptions) {}

  get status(): WorkerClientStatus {
    if (this.disposed || this.unavailableReason !== null) return 'unavailable';
    return this.worker === null ? 'idle' : 'ready';
  }

  /** Number of in-flight requests. Exposed for tests and leak assertions. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Starts the worker ahead of first use. Optional — `request` starts it
   * lazily — but calling it after a termination removes startup latency from
   * the user's next action.
   */
  start(): Result<void, WorkerError> {
    if (this.disposed) {
      return err(workerError('TERMINATED', `${this.options.name} has been disposed.`));
    }
    if (this.worker !== null) return ok(undefined);

    try {
      const worker = this.options.createWorker();
      worker.addEventListener('message', this.handleMessage);
      worker.addEventListener('error', this.handleError);
      worker.addEventListener('messageerror', this.handleMessageError);
      this.worker = worker;
      this.unavailableReason = null;
      return ok(undefined);
    } catch {
      // Construction can fail where workers are blocked by policy or an
      // exotic CSP. This is reported, never worked around by moving the work
      // to the main thread (05_SECURITY.md, 02_ARCHITECTURE.md §4.5).
      this.unavailableReason = `${this.options.name} could not start in this browser.`;
      return err(workerError('UNAVAILABLE', this.unavailableReason));
    }
  }

  async request<TOp extends WorkerOp>(
    op: TOp,
    payload: PayloadFor<TOp>,
    requestOptions: RequestOptions = {},
  ): Promise<Result<ResultFor<TOp>, WorkerError>> {
    if (this.disposed) {
      return err(workerError('TERMINATED', `${this.options.name} has been disposed.`));
    }

    const started = this.start();
    if (!started.ok) return err(started.error);

    const worker = this.worker;
    if (!worker) {
      return err(workerError('UNAVAILABLE', `${this.options.name} is not available.`));
    }

    const { supersedeKey } = requestOptions;
    if (supersedeKey !== undefined) this.supersede(supersedeKey);

    const id = this.nextId++;
    const timeoutMs = requestOptions.timeoutMs ?? this.options.defaultTimeoutMs;

    return new Promise<Result<ResultFor<TOp>, WorkerError>>((resolve) => {
      const timer = setTimeout(() => {
        this.handleTimeout(id, timeoutMs);
      }, timeoutMs);

      this.pending.set(id, {
        id,
        op,
        supersedeKey,
        timer,
        settle: resolve as (result: Result<unknown, WorkerError>) => void,
      });

      const request: WorkerRequest<TOp> = { id, op, payload };
      try {
        worker.postMessage(request);
      } catch {
        // Thrown when the payload is not structured-clone-safe. Caught here
        // so a protocol mistake surfaces immediately instead of as a timeout.
        this.settle(
          id,
          err(workerError('PROTOCOL', 'This request could not be sent to the worker.')),
        );
      }
    });
  }

  /** Settles every in-flight request and releases the worker and its listeners. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.settleAll(workerError('TERMINATED', `${this.options.name} has been disposed.`));
    this.teardownWorker();
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  /**
   * The single settle path. Clears the timer, drops the entry, resolves once.
   * Nothing else in this class resolves a promise.
   */
  private settle(id: number, result: Result<unknown, WorkerError>): void {
    const entry = this.pending.get(id);
    if (!entry) return; // already settled — a late response, or a double timeout
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.settle(result);
  }

  private settleAll(error: WorkerError): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, err(error));
    }
  }

  private supersede(key: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.supersedeKey === key) {
        this.settle(entry.id, err(workerError('SUPERSEDED', 'A newer request replaced this one.')));
      }
    }
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const response = parseWorkerResponse(event.data);

    if (!response) {
      // Malformed responses are discarded rather than guessed at. The
      // originating request settles on its deadline.
      return;
    }

    // Correlation. A response whose id is not pending is stale — its request
    // was superseded, timed out, or already settled — and must never reach
    // application state.
    const entry = this.pending.get(response.id);
    if (!entry) return;

    if (!response.ok) {
      this.settle(response.id, err(workerError('DOMAIN', response.error.message, response.error)));
      return;
    }

    // Per-operation result validation. The envelope check alone is not enough:
    // without this the result reached application state as an unvalidated
    // `unknown` behind a TypeScript cast, trusting the type rather than the
    // value. A malformed result settles as PROTOCOL rather than being acted on.
    const validated = validateResult(entry.op, response.result);
    if (validated === null) {
      this.settle(
        response.id,
        err(workerError('PROTOCOL', 'The worker returned an unexpected result.')),
      );
      return;
    }

    this.settle(response.id, ok(validated));
  };

  private handleTimeout(id: number, timeoutMs: number): void {
    if (!this.options.terminateOnTimeout) {
      // Long-lived policy: report the timeout, keep the worker. A timeout
      // here means our own bounded code overran, which is a bug to fix.
      this.settle(
        id,
        err(workerError('TIMEOUT', `${this.options.name} did not respond within ${timeoutMs} ms.`)),
      );
      return;
    }

    // Disposable policy. The thread may be unable to yield, so terminating it
    // is the only reliable stop. Settle the offender as TIMEOUT first, then
    // any siblings as TERMINATED — they are collateral, not timed out.
    this.settle(
      id,
      err(
        workerError(
          'TIMEOUT',
          `Execution stopped after ${timeoutMs} ms. The worker was terminated.`,
        ),
      ),
    );
    this.settleAll(
      workerError('TERMINATED', 'The execution worker was terminated by another timeout.'),
    );

    this.teardownWorker();

    // Eager respawn: the replacement is created now rather than on the next
    // request, so the user does not pay startup latency on top of having just
    // waited out the deadline.
    if (!this.disposed) this.start();
  }

  private readonly handleError = (): void => {
    // A worker-level error means the thread is no longer trustworthy.
    this.settleAll(workerError('INTERNAL', `${this.options.name} stopped unexpectedly.`));
    this.teardownWorker();
    if (!this.disposed && this.options.terminateOnTimeout) this.start();
  };

  private readonly handleMessageError = (): void => {
    // A message that could not be deserialised carries no id, so the
    // originating request cannot be identified. Its deadline covers it.
  };

  private teardownWorker(): void {
    const worker = this.worker;
    if (!worker) return;
    worker.removeEventListener('message', this.handleMessage);
    worker.removeEventListener('error', this.handleError);
    worker.removeEventListener('messageerror', this.handleMessageError);
    worker.terminate();
    this.worker = null;
  }
}
