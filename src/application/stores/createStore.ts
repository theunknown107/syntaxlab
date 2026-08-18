/**
 * Store primitive — 11_STATE_MANAGEMENT.md §3
 *
 * Deliberately not a state library. Total application state is: current input,
 * mode, result, history list, theme, settings, and a few UI flags. There is no
 * server cache, no optimistic update, and no normalised entity graph.
 *
 * This file plus `useStore.ts` is the whole state layer. It is usable from
 * non-React code, which matters because the application layer must update
 * state without importing React (02_ARCHITECTURE.md §3).
 */

type Listener = () => void;

export interface Store<T> {
  /** Current state. Safe to call from anywhere, including outside React. */
  getState: () => T;
  /** Replace state, or derive it from the previous value. */
  setState: (updater: T | ((previous: T) => T)) => void;
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe: (listener: Listener) => () => void;
  /** Restore the initial state. Used by tests and by "reset to default". */
  reset: () => void;
}

export function createStore<T>(initialState: T): Store<T> {
  let state = initialState;
  const listeners = new Set<Listener>();

  const notify = (): void => {
    // Iterate a copy: a listener may unsubscribe during notification, and
    // mutating a Set while iterating it skips entries.
    for (const listener of [...listeners]) listener();
  };

  return {
    getState: () => state,

    setState: (updater) => {
      const next = typeof updater === 'function' ? (updater as (previous: T) => T)(state) : updater;

      // Reference equality short-circuit. Without this, a setState that
      // produces an identical value still re-renders every subscriber.
      if (Object.is(next, state)) return;

      state = next;
      notify();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    reset: () => {
      if (Object.is(initialState, state)) return;
      state = initialState;
      notify();
    },
  };
}
