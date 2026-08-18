/**
 * A controllable Worker double.
 *
 * Real workers cannot be driven deterministically from a unit test — timing
 * is at the mercy of the thread scheduler. This double records what was
 * posted and lets a test decide exactly when (or whether) a response arrives,
 * which is what makes timeout, supersession, and stale-response behaviour
 * testable rather than flaky.
 *
 * Real workers are exercised in the E2E suite, in real browsers.
 */
export class FakeWorker implements Worker {
  static instances: FakeWorker[] = [];

  readonly posted: unknown[] = [];
  terminated = false;

  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  static reset(): void {
    FakeWorker.instances = [];
  }

  static get latest(): FakeWorker | undefined {
    return FakeWorker.instances.at(-1);
  }

  postMessage(message: unknown): void {
    if (this.terminated) throw new Error('postMessage on a terminated worker');
    // Mirrors the real boundary: anything not structured-cloneable throws
    // here rather than silently succeeding.
    structuredClone(message);
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(): boolean {
    return true;
  }

  /** Count of live listeners, for leak assertions. */
  get listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  /** Delivers a response to the client as the real worker would. */
  respond(message: unknown): void {
    this.emit('message', { data: message } as unknown as Event);
  }

  /** Simulates a worker-level failure. */
  failWith(): void {
    this.emit('error', new Event('error'));
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }

  onmessage = null;
  onmessageerror = null;
  onerror = null;
}
