import { useSyncExternalStore } from 'react';
import type { Store } from '@/application/stores/createStore';

/**
 * React binding for the store primitive — 11_STATE_MANAGEMENT.md §3
 *
 * `useSyncExternalStore` gives tearing protection under concurrent rendering
 * for free, which a hand-rolled `useEffect` + `useState` subscription does not.
 *
 * IMPORTANT: the selector must return a referentially stable value. A selector
 * that builds a fresh object or array on every call causes an infinite render
 * loop, because React re-runs it, sees a new reference, and re-renders.
 *
 *   ✅ useStore(uiStore, (s) => s.historyOpen)
 *   ❌ useStore(uiStore, (s) => ({ open: s.historyOpen }))
 *
 * This is the single failure mode of the pattern, which is why it is documented
 * here rather than in a wiki nobody reads.
 */
export function useStore<T, Selected>(store: Store<T>, selector: (state: T) => Selected): Selected {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
