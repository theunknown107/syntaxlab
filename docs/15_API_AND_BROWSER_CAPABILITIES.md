# 15 — Browser Capabilities

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

> There is no HTTP API — the application makes no network requests after load (`connect-src 'none'`). This document therefore covers the **browser platform APIs** that constitute the app's entire "API surface", with the feature detection and degradation strategy for each.

---

> **Scope note (Phase 1.5).** V1.0 uses no compression API and no URL state, because share URLs are deferred. `Intl` timezone use begins in V1.1 and is limited to browser-local and UTC.

## 1. Summary

| Capability | Required? | Used for | If unavailable |
|---|---|---|---|
| Web Workers | **Critical** | Parsing, regex execution | Degraded mode: 64 KB limit, regex testing disabled |
| IndexedDB | Important | History | Memory-only session + notice |
| localStorage | Important | Theme, settings | Defaults each load + notice |
| Service Worker | Important | Offline, PWA | Online-only; app still works |
| Cache Storage | Important | Precache | Tied to SW |
| Clipboard API | Nice | Copy | `execCommand` fallback, then manual selection |
| File API | Nice | Import/export | Feature hidden |
| `CompressionStream` | *(V1.1+)* | Would compress share URLs | **Unused in V1.0** |
| `Intl.DateTimeFormat` | *(V1.1)* **Critical** for cron | Browser-local and UTC display | Cron falls back to UTC only |
| ~~`Intl.supportedValuesOf`~~ | Not used | Was for a named-zone picker | **Not needed** — V1.1 offers browser-local and UTC only |
| `crypto.randomUUID` | Important | Entry ids | `getRandomValues` fallback |
| `BroadcastChannel` | Nice | Cross-tab sync | `storage` events, then no sync |
| `structuredClone` | Nice | Deep copies | `JSON.parse(JSON.stringify())` for plain data |
| `navigator.storage` | Nice | Persistence, quota display | No usage bar; pruning still works |
| `matchMedia` | Important | Reduced motion, contrast | Assume no preference |
| `ResizeObserver` | Nice | Panel resize | Window resize events |

For V1.0, only **Web Workers** are genuinely load-bearing. `Intl.DateTimeFormat` becomes load-bearing for cron in V1.1. Everything else degrades.

---

## 2. Web Workers

```ts
new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
```

**Protocol** — every message carries an id; every response is matched to its request; unknown ops are discarded:

```ts
type WorkerRequest =
  | { id: number; op: 'parse.regex'; payload: { source: string; flags: RegexFlags } }
  | { id: number; op: 'parse.json';  payload: { source: string } }
  | { id: number; op: 'parse.cron';  payload: { source: string; dialect: CronDialect; tz: TimezoneContext } }
  | { id: number; op: 'format.json'; payload: { source: string; indent: 2|4|'tab'; minify: boolean } }
  | { id: number; op: 'regex.exec';  payload: { pattern: string; flags: string; subject: string; maxMatches: number } };

type WorkerResponse =
  | { id: number; ok: true;  result: unknown }
  | { id: number; ok: false; error: DomainError };
```

**Security rules:**
- The worker **re-validates every payload**; it never trusts the main thread (a compromised main thread is the scenario where this matters)
- Only structured-clone-safe plain data crosses the boundary
- No worker is constructed from a `blob:` URL or a string
- Errors inside a worker are caught at the top level and returned as `INTERNAL` errors; an uncaught throw would kill the worker silently

**Client-side errors (added at M2).** The wire protocol above carries
`DomainError`, which describes failures the worker reports *about the input*.
Conditions the client detects — `TIMEOUT`, `SUPERSEDED`, `UNAVAILABLE`,
`TERMINATED`, `PROTOCOL` — never cross the wire, because a timed-out worker
sends nothing by definition. They are therefore a separate `WorkerError` type
at the infrastructure layer, so the domain never grows codes describing
transport problems it has no opinion about. `WorkerClient.request()` returns
`Result<T, WorkerError>`; a worker-reported `DomainError` arrives wrapped as
code `DOMAIN` with the original in `cause`.

**Timeout and termination:** only the execution worker is terminated (`04_PARSER_ARCHITECTURE.md` §2.6). The analysis worker runs our own provably-terminating code and has never a reason to be killed — if it ever needs killing, that is a bug to fix, not a behaviour to design around.

**Fallback:** `typeof Worker === 'undefined'` or construction throwing → main-thread parsing with a 64 KB limit, a visible "reduced-safety mode" indicator, and **regex execution disabled entirely**. We do not run uninterruptible foreign code on the thread that owns the UI.

---

## 3. IndexedDB

Used via `idb` (ADR-010). Schema in `06_DATA_STORAGE.md`.

**Detection:** `'indexedDB' in window` plus a trial `open()` — Firefox private mode historically exposed the API and then failed on open, so presence alone is not sufficient.

**Failure handling:** `UNAVAILABLE` → memory repository + notice; `QUOTA` → prune, retry once, notify, disable auto-capture; `CORRUPT` → memory mode + an explicit user-initiated reset (never automatic deletion); `BLOCKED` → prompt to close other tabs.

**Persistence:** `navigator.storage.persist()` is requested after the user's **third** history entry — a permission prompt on first load has no earned context and gets denied.

---

## 4. localStorage

Keys and validation in `06_DATA_STORAGE.md` §5. Three rules:

1. **Every read is validated** — this is a security boundary (`05_SECURITY.md` §2.2), not a convenience.
2. **Every write is wrapped in try/catch** — localStorage throws on quota and in some privacy modes.
3. **Only small preference data.** No user content, ever. The 5 MB shared budget is not a place for pasted payloads.

Cross-tab sync uses the `storage` event, which fires only in *other* tabs — exactly the semantics we want.

---

## 5. Service Worker and Cache Storage

Covered in `07_PWA_OFFLINE.md`. Platform-level notes:

- Registration is deferred until after `load` so it never competes with first paint
- Requires HTTPS (localhost exempt)
- Scope is `/`
- `updateViaCache: 'none'` so the SW script itself is never served from HTTP cache — a stale SW script is how update flows break for weeks
- Availability check: `'serviceWorker' in navigator`; unavailable → app works online-only, no error shown

---

## 6. Clipboard

**Write:**

```ts
async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* permission denied or insecure context */ }
  return legacyCopy(text);   // hidden textarea + execCommand
}
```

`text/plain` only — never `text/html`. A payload landing in someone's rich-text editor is a vulnerability we would be handing to a third party.

**Read:** `navigator.clipboard.readText()` is **not used**. We read the clipboard only through the user's own paste gesture, which requires no permission and no prompt. Silently reading a developer's clipboard would be indefensible for a privacy-first tool.

Requires a secure context. Failures produce a toast with a manual-copy hint, never an error state.

---

## 7. File API

**Export:**
```ts
const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = Object.assign(document.createElement('a'), {
  href: url, download: `syntaxlab-history-${new Date().toISOString().slice(0,10)}.json`,
});
a.click();
URL.revokeObjectURL(url);   // always — leaked object URLs hold the whole blob in memory
```

Filename is app-generated. `File System Access API` (`showSaveFilePicker`) is deliberately **not** used: Chromium-only, requires a permission prompt, and the anchor-download approach works everywhere with zero prompts.

**Import:** `<input type="file" accept="application/json,.json">`, then the full validation pipeline (`05_SECURITY.md` §10.2). The `accept` attribute is a UX hint, not a control — the file is validated regardless of what the OS dialog filtered.

Drag-and-drop import is **not** in V1: it adds a drop-target surface and an accidental-drop failure mode for no real gain over the file picker.

---

## 8. URL and share state

`window.location.hash` only, never the query string (ADR-008). Written with `history.replaceState` so a shared link does not stack history entries and a refresh does not re-trigger the load.

Full read/write pipeline in `05_SECURITY.md` §11.

**`CompressionStream`** (`deflate-raw`) is used when available — native, zero bytes, typically 60–80% reduction on JSON. Unavailable (older Safari) → plain base64url with a correspondingly smaller effective payload limit, and the share dialog says so rather than failing silently.

---

## 9. `Intl` — the cron dependency

Load-bearing for cron, and the reason we need no timezone library.

```ts
// instant → wall-clock fields in a named zone
new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/London', year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false,
}).formatToParts(date);

// zone list, if supported
Intl.supportedValuesOf?.('timeZone');
```

Wall-clock → instant is done by offset probing, since the platform has no direct inverse before `Temporal`. The technique and its DST edge cases are in `04_PARSER_ARCHITECTURE.md` §4.4.

**Notes:** IANA data ships with the browser, so it works offline and stays current with browser updates — but it also means two users on different browser versions can theoretically see different results for a zone whose rules recently changed. Documented, not fixable client-side.

**Fallback:** no `Intl.DateTimeFormat` with `timeZone` support → cron mode restricts to UTC with an explicit notice. `Intl.supportedValuesOf` missing → a curated list of ~60 common zones.

---

## 10. Crypto

```ts
const id = crypto.randomUUID?.() ?? uuidV4FromRandomValues();
```

`crypto.randomUUID` requires a secure context. The fallback uses `crypto.getRandomValues` with correct v4 bit-setting. `Math.random()` is never used for ids — collisions across tabs are a real failure mode, and it costs nothing to do it properly.

No other cryptography is used. There is no encryption of local data (`05_SECURITY.md` §9.3) and no hashing requirement.

---

## 11. Observers and media queries

| API | Use | Fallback |
|---|---|---|
| `matchMedia('(prefers-reduced-motion: reduce)')` | Motion policy | Assume no preference |
| `matchMedia('(prefers-contrast: more)')` | Auto high-contrast | Manual setting only |
| `matchMedia('(pointer: coarse)')` | Larger touch targets | Desktop sizes |
| `ResizeObserver` | Panel resize, editor layout | `window.resize` |
| `IntersectionObserver` | Virtualisation viewport | Scroll-offset maths |
| `PerformanceObserver` | Dev-only long-task logging | Silently skipped |

All media-query listeners use `addEventListener('change', …)`, not the deprecated `addListener`.

---

## 12. Deliberately unused APIs

Listed so nobody adds them later thinking they were an oversight.

| API | Why not |
|---|---|
| `fetch` / `XMLHttpRequest` | No network requests. Blocked by CSP. |
| `WebSocket` / `EventSource` | No server. |
| `Notification` / Push | No use case; users dislike the prompt. |
| Geolocation | Not needed. Also blocked by `Permissions-Policy`. |
| Camera / microphone | Same. |
| `navigator.sendBeacon` | Would be telemetry. Blocked by CSP. |
| WebRTC | No use case, and it is a well-known IP-leak vector. |
| `SharedArrayBuffer` | Not needed yet. Would be available if required (COOP/COEP are already set). |
| WebAssembly | No use case in V1. Would be the vehicle for RE2 in a hypothetical V3. |
| `Web Share API` | Would push content into a system share sheet — an easy accidental disclosure. Copy-link is safer and works everywhere. |
| `File System Access API` | Chromium-only, prompts, no advantage. |
| `Background Sync` / Periodic Sync | Nothing to sync. |
| `Credential Management` | No accounts. |
| `Payment Request` | No payments. |
| `beforeunload` | Would fire on every close with content in the editor. Annoying, and modern browsers restrict it anyway. History covers the real need. |

---

## 13. Feature-detection policy

```ts
export const capabilities = {
  workers:      typeof Worker !== 'undefined',
  indexedDB:    typeof indexedDB !== 'undefined',
  localStorage: (() => { try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; } catch { return false; } })(),
  serviceWorker:'serviceWorker' in navigator,
  clipboard:    !!navigator.clipboard?.writeText,
  compression:  typeof CompressionStream !== 'undefined',
  intlTimeZone: (() => { try { new Intl.DateTimeFormat('en', { timeZone: 'UTC' }); return true; } catch { return false; } })(),
  broadcast:    typeof BroadcastChannel !== 'undefined',
  randomUUID:   !!crypto.randomUUID,
} as const;
```

Rules:
1. **Detect the feature, never the browser.** No user-agent sniffing anywhere.
2. **Detect by trying, where presence is not sufficient** — localStorage and IndexedDB both lie in private modes.
3. **Detect once at startup**, cache the result.
4. **Every degradation is visible to the user**, never silent. A feature that quietly does nothing is worse than one that explains why it is off.
5. Detection results are surfaced in the help dialog as a small diagnostics list — useful for support, and it costs nothing.
