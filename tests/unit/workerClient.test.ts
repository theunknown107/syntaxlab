import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerClient } from '@/infrastructure/workers/workerClient';
import { FakeWorker } from './fakeWorker';

function makeClient(overrides: { terminateOnTimeout?: boolean; defaultTimeoutMs?: number } = {}) {
  return new WorkerClient({
    name: 'The test engine',
    createWorker: () => new FakeWorker(),
    defaultTimeoutMs: overrides.defaultTimeoutMs ?? 1000,
    terminateOnTimeout: overrides.terminateOnTimeout ?? false,
  });
}

/** The id the client assigned to the nth message it posted. */
function postedId(worker: FakeWorker, index = 0): number {
  return (worker.posted[index] as { id: number }).id;
}

describe('WorkerClient', () => {
  beforeEach(() => {
    FakeWorker.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('lifecycle', () => {
    it('starts idle and becomes ready on first request', async () => {
      const client = makeClient();
      expect(client.status).toBe('idle');

      const pending = client.request('analysis.ping', { sentAt: 1 });
      expect(client.status).toBe('ready');

      FakeWorker.latest?.respond({
        id: postedId(FakeWorker.latest),
        ok: true,
        result: { pong: true, sentAt: 1, receivedAt: 2 },
      });
      await pending;
      client.dispose();
    });

    it('reports UNAVAILABLE when worker construction throws', async () => {
      const client = new WorkerClient({
        name: 'The test engine',
        createWorker: () => {
          throw new Error('blocked by policy');
        },
        defaultTimeoutMs: 1000,
        terminateOnTimeout: false,
      });

      const result = await client.request('analysis.ping', { sentAt: 1 });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('UNAVAILABLE');
      expect(client.status).toBe('unavailable');
    });

    it('does not leak the internal failure reason into the message', async () => {
      const client = new WorkerClient({
        name: 'The test engine',
        createWorker: () => {
          throw new Error('SECRET_INTERNAL_DETAIL');
        },
        defaultTimeoutMs: 1000,
        terminateOnTimeout: false,
      });

      const result = await client.request('analysis.ping', { sentAt: 1 });

      if (!result.ok) expect(result.error.message).not.toContain('SECRET_INTERNAL_DETAIL');
    });

    it('removes listeners and terminates the worker on dispose', () => {
      const client = makeClient();
      void client.request('analysis.ping', { sentAt: 1 });
      const worker = FakeWorker.latest;

      client.dispose();

      expect(worker?.terminated).toBe(true);
      expect(worker?.listenerCount).toBe(0);
    });

    it('settles in-flight requests when disposed rather than leaking them', async () => {
      const client = makeClient();
      const pending = client.request('analysis.ping', { sentAt: 1 });

      client.dispose();
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('TERMINATED');
      expect(client.pendingCount).toBe(0);
    });

    it('refuses requests after disposal', async () => {
      const client = makeClient();
      client.dispose();

      const result = await client.request('analysis.ping', { sentAt: 1 });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('TERMINATED');
    });
  });

  describe('correlation', () => {
    it('resolves each request with its own response', async () => {
      const client = makeClient();
      const first = client.request('analysis.echo', { text: 'one' });
      const second = client.request('analysis.echo', { text: 'two' });
      const worker = FakeWorker.latest!;

      // Respond out of order — correlation is by id, not arrival order.
      worker.respond({ id: postedId(worker, 1), ok: true, result: { text: 'two', length: 3 } });
      worker.respond({ id: postedId(worker, 0), ok: true, result: { text: 'one', length: 3 } });

      const [a, b] = await Promise.all([first, second]);
      expect(a.ok && a.value.text).toBe('one');
      expect(b.ok && b.value.text).toBe('two');
      client.dispose();
    });

    it('discards a response whose id was never issued', async () => {
      const client = makeClient({ defaultTimeoutMs: 500 });
      const pending = client.request('analysis.ping', { sentAt: 1 });
      const worker = FakeWorker.latest!;

      worker.respond({ id: 9999, ok: true, result: { pong: true, sentAt: 0, receivedAt: 0 } });
      expect(client.pendingCount).toBe(1); // untouched

      vi.advanceTimersByTime(500);
      const result = await pending;
      expect(result.ok).toBe(false);
      client.dispose();
    });

    it('discards a malformed response and lets the deadline settle the request', async () => {
      const client = makeClient({ defaultTimeoutMs: 500 });
      const pending = client.request('analysis.ping', { sentAt: 1 });
      const worker = FakeWorker.latest!;

      worker.respond({ id: postedId(worker), ok: 'yes' }); // ok is not a boolean
      worker.respond({ nonsense: true });
      worker.respond(null);

      expect(client.pendingCount).toBe(1);
      vi.advanceTimersByTime(500);

      const result = await pending;
      if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
      client.dispose();
    });

    it('surfaces a worker-reported domain error without discarding it', async () => {
      const client = makeClient();
      const pending = client.request('analysis.echo', { text: 'x' });
      const worker = FakeWorker.latest!;

      worker.respond({
        id: postedId(worker),
        ok: false,
        error: { code: 'SYNTAX', message: 'Unmatched (' },
      });

      const result = await pending;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOMAIN');
        expect(result.error.cause?.code).toBe('SYNTAX');
      }
      client.dispose();
    });
  });

  describe('supersession', () => {
    it('settles an earlier request when a newer one shares its key', async () => {
      const client = makeClient();
      const first = client.request('analysis.echo', { text: 'a' }, { supersedeKey: 'analyze' });
      const second = client.request('analysis.echo', { text: 'b' }, { supersedeKey: 'analyze' });

      const firstResult = await first;
      expect(firstResult.ok).toBe(false);
      if (!firstResult.ok) expect(firstResult.error.code).toBe('SUPERSEDED');

      const worker = FakeWorker.latest!;
      worker.respond({ id: postedId(worker, 1), ok: true, result: { text: 'b', length: 1 } });
      expect((await second).ok).toBe(true);
      client.dispose();
    });

    it('never lets a stale response overwrite a newer one', async () => {
      // A → B → C, then A's response arrives late. This is the scenario that
      // makes an analysis pane flicker between stale and current results.
      const client = makeClient();
      const a = client.request('analysis.echo', { text: 'a' }, { supersedeKey: 'analyze' });
      const b = client.request('analysis.echo', { text: 'b' }, { supersedeKey: 'analyze' });
      const c = client.request('analysis.echo', { text: 'c' }, { supersedeKey: 'analyze' });
      const worker = FakeWorker.latest!;

      worker.respond({ id: postedId(worker, 0), ok: true, result: { text: 'a', length: 1 } });
      worker.respond({ id: postedId(worker, 1), ok: true, result: { text: 'b', length: 1 } });
      worker.respond({ id: postedId(worker, 2), ok: true, result: { text: 'c', length: 1 } });

      const [ra, rb, rc] = await Promise.all([a, b, c]);
      expect(ra.ok).toBe(false);
      expect(rb.ok).toBe(false);
      expect(rc.ok && rc.value.text).toBe('c');
      client.dispose();
    });

    it('leaves requests with different keys alone', async () => {
      const client = makeClient();
      const parse = client.request('analysis.echo', { text: 'p' }, { supersedeKey: 'parse' });
      client
        .request('analysis.ping', { sentAt: 1 }, { supersedeKey: 'ping' })
        .catch(() => undefined);

      expect(client.pendingCount).toBe(2);
      const worker = FakeWorker.latest!;
      worker.respond({ id: postedId(worker, 0), ok: true, result: { text: 'p', length: 1 } });

      expect((await parse).ok).toBe(true);
      client.dispose();
    });

    it('leaves keyless requests alone', () => {
      const client = makeClient();
      void client.request('analysis.echo', { text: 'a' });
      void client.request('analysis.echo', { text: 'b' });

      // Without a key there is nothing to supersede, so both stay in flight.
      expect(client.pendingCount).toBe(2);
      client.dispose();
    });
  });

  describe('timeout — long-lived policy', () => {
    it('reports a timeout without terminating the worker', async () => {
      const client = makeClient({ terminateOnTimeout: false, defaultTimeoutMs: 1000 });
      const pending = client.request('analysis.ping', { sentAt: 1 });
      const worker = FakeWorker.latest!;

      vi.advanceTimersByTime(1000);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
      // The analysis worker runs our own bounded code; a timeout is a bug to
      // fix, not grounds for destroying warm state.
      expect(worker.terminated).toBe(false);
      expect(FakeWorker.instances).toHaveLength(1);
      client.dispose();
    });
  });

  describe('timeout — disposable policy', () => {
    it('terminates the worker and eagerly spawns a replacement', async () => {
      const client = makeClient({ terminateOnTimeout: true, defaultTimeoutMs: 2000 });
      const pending = client.request('exec.spin', { durationMs: 60_000 });
      const first = FakeWorker.latest!;

      vi.advanceTimersByTime(2000);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
      expect(first.terminated).toBe(true);
      // Eager, not lazy: the user must not pay startup latency on top of
      // having just waited out the deadline.
      expect(FakeWorker.instances).toHaveLength(2);
      expect(FakeWorker.latest?.terminated).toBe(false);
      client.dispose();
    });

    it('serves the next request from the replacement worker', async () => {
      const client = makeClient({ terminateOnTimeout: true, defaultTimeoutMs: 2000 });
      const timedOut = client.request('exec.spin', { durationMs: 60_000 });
      vi.advanceTimersByTime(2000);
      await timedOut;

      const replacement = FakeWorker.latest!;
      const next = client.request('exec.spin', { durationMs: 1 });
      replacement.respond({
        id: postedId(replacement),
        ok: true,
        result: { completed: true, elapsedMs: 1 },
      });

      const result = await next;
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.completed).toBe(true);
      client.dispose();
    });

    it('settles sibling requests as TERMINATED, not TIMEOUT', async () => {
      // A sibling did not exceed its own deadline — it was collateral damage
      // from the termination, and the distinction matters for the message.
      const client = makeClient({ terminateOnTimeout: true, defaultTimeoutMs: 2000 });
      const offender = client.request('exec.spin', { durationMs: 60_000 });
      const sibling = client.request('exec.spin', { durationMs: 60_000 }, { timeoutMs: 30_000 });

      vi.advanceTimersByTime(2000);

      const [a, b] = await Promise.all([offender, sibling]);
      if (!a.ok) expect(a.error.code).toBe('TIMEOUT');
      if (!b.ok) expect(b.error.code).toBe('TERMINATED');
      expect(client.pendingCount).toBe(0);
      client.dispose();
    });

    it('leaves no pending requests or timers after a timeout', async () => {
      const client = makeClient({ terminateOnTimeout: true, defaultTimeoutMs: 2000 });
      const pending = client.request('exec.spin', { durationMs: 60_000 });

      vi.advanceTimersByTime(2000);
      await pending;

      expect(client.pendingCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      client.dispose();
    });

    it('ignores a response that arrives after termination', async () => {
      const client = makeClient({ terminateOnTimeout: true, defaultTimeoutMs: 2000 });
      const pending = client.request('exec.spin', { durationMs: 60_000 });
      const first = FakeWorker.latest!;
      const id = postedId(first);

      vi.advanceTimersByTime(2000);
      const result = await pending;

      // The terminated worker cannot actually send this, but a late message
      // must be inert regardless.
      first.respond({ id, ok: true, result: { completed: true, elapsedMs: 60_000 } });

      if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
      expect(client.pendingCount).toBe(0);
      client.dispose();
    });
  });

  describe('worker errors', () => {
    it('settles pending requests when the worker fails', async () => {
      const client = makeClient({ terminateOnTimeout: true });
      const pending = client.request('exec.spin', { durationMs: 10 });

      FakeWorker.latest?.failWith();

      const result = await pending;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INTERNAL');
      client.dispose();
    });

    it('rejects a payload that cannot be structured-cloned', async () => {
      const client = makeClient();
      const unclonable = { text: 'x', callback: () => undefined } as unknown as {
        text: string;
      };

      const result = await client.request('analysis.echo', unclonable);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('PROTOCOL');
      client.dispose();
    });
  });
});
