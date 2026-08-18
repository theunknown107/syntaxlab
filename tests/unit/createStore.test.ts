import { describe, expect, it, vi } from 'vitest';
import { createStore } from '@/application/stores/createStore';

describe('createStore', () => {
  it('exposes the initial state', () => {
    const store = createStore({ count: 0 });
    expect(store.getState()).toEqual({ count: 0 });
  });

  it('replaces state with a value', () => {
    const store = createStore({ count: 0 });
    store.setState({ count: 5 });
    expect(store.getState().count).toBe(5);
  });

  it('derives state from the previous value', () => {
    const store = createStore({ count: 1 });
    store.setState((previous) => ({ count: previous.count + 1 }));
    expect(store.getState().count).toBe(2);
  });

  it('notifies subscribers on change', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the next state is reference-equal', () => {
    const state = { count: 0 };
    const store = createStore(state);
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState(state);

    // Without the Object.is short-circuit every no-op write would re-render
    // every subscriber. This is the assertion that protects the typing path.
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.setState({ count: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('survives a listener unsubscribing during notification', () => {
    // Mutating the listener Set while iterating it would skip the second
    // listener. The implementation iterates a copy to avoid that.
    const store = createStore({ count: 0 });
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(() => {
      unsubscribeFirst();
    });
    store.subscribe(second);

    store.setState({ count: 1 });

    expect(second).toHaveBeenCalledTimes(1);
  });

  it('restores the initial state on reset', () => {
    const store = createStore({ count: 0 });
    store.setState({ count: 9 });

    store.reset();

    expect(store.getState().count).toBe(0);
  });

  it('isolates state between independently created stores', () => {
    const a = createStore({ count: 0 });
    const b = createStore({ count: 0 });

    a.setState({ count: 3 });

    expect(b.getState().count).toBe(0);
  });
});
