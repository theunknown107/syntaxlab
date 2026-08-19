/**
 * Feature detection — 15_API_AND_BROWSER_CAPABILITIES.md §13
 *
 * Rules that matter more than the code:
 *   1. Detect the feature, never the browser. No user-agent sniffing.
 *   2. Detect by trying where presence is not sufficient — localStorage and
 *      IndexedDB both lie in private modes.
 *   3. Detect once at startup and cache.
 *   4. Every degradation is visible to the user, never silent.
 */

export interface Capabilities {
  readonly workers: boolean;
  readonly localStorage: boolean;
  readonly clipboard: boolean;
  readonly randomUUID: boolean;
  readonly structuredClone: boolean;
}

function canConstructWorker(): boolean {
  if (typeof Worker === 'undefined') return false;
  // Presence is not sufficient: construction can still be blocked by policy
  // or an embedding context. We do not build a probe worker here — that would
  // cost a thread on every startup — so this remains a presence check, and
  // real construction failure is handled by WorkerClient.start().
  return true;
}

function canUseLocalStorage(): boolean {
  try {
    const probe = '__syntaxlab_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

let cached: Capabilities | null = null;

export function detectCapabilities(): Capabilities {
  cached ??= {
    workers: canConstructWorker(),
    localStorage: canUseLocalStorage(),
    clipboard: typeof navigator !== 'undefined' && 'clipboard' in navigator,
    randomUUID: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function',
    structuredClone: typeof structuredClone === 'function',
  };
  return cached;
}

/** Test-only: clears the memoised result. */
export function resetCapabilitiesCache(): void {
  cached = null;
}

/**
 * How much storage this origin is using — 06_DATA_STORAGE.md §6.1
 *
 * Both numbers are approximations by design: browsers deliberately blur the
 * quota to keep it from being a fingerprinting signal, and the usage covers
 * the whole origin rather than any one feature. Null means the browser does
 * not answer, which is an ordinary outcome rather than a failure.
 */
export async function storageUsage(): Promise<{ usage: number | null; quota: number | null }> {
  if (typeof navigator === 'undefined' || (navigator.storage as unknown) === undefined) {
    return { usage: null, quota: null };
  }
  if (typeof navigator.storage.estimate !== 'function') return { usage: null, quota: null };

  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}
