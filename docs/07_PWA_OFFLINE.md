# 07 — PWA and Offline

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

---

## 1. Offline requirement

SyntaxLab must be **fully functional with no network** after the first load, for everything the user actually does with it. All analysis is local computation, so there is no honest reason for any of it to need a network. The one exception — checking for application updates — is defined precisely in §1.1.

| Capability | Offline? | Why |
|---|---|---|
| Load the app | ✅ | Precached app shell |
| Regex parse, explain, test | ✅ | Runs in a worker, locally |
| JSON parse, tree, format | ✅ | Local |
| Cron parse, explain, next runs *(V1.1)* | ✅ | Local — `Intl` timezone data ships with the browser |
| History read/write | ✅ | IndexedDB |
| Theme customisation | ✅ | localStorage + CSS |
| Import / export | ✅ | File APIs |
| Copy to clipboard | ✅ | Local |
| ~~Share URLs~~ | — | Deferred to V1.1+ (`01_PRD.md` §12) |
| Check for app updates | ❌ | Genuinely requires network; fails silently and retries later |

### 1.1 The offline guarantee, stated precisely

> **Core application functionality is offline.** Parsing, explanation, regex execution, history, theming, and import/export all run locally after the first load.
>
> **Network access is required only for activities that are inherently networked** — namely fetching the application the first time, and checking for a new version afterwards.

**Update checks are explicitly excluded from the offline guarantee.** This matters for how the product is described and tested:

- An update check that fails offline is **not a failure of offline support**. It is the expected behaviour, it is silent, and it retries on the next load or the next hourly tick.
- The offline acceptance tests (`21_ACCEPTANCE_CRITERIA.md` O-2 to O-5) assert that *analysis, history, and theming* work with the network disabled. They do not assert anything about updates.
- The UI never reports an update-check failure. A user offline on a plane should see no error, because nothing has gone wrong.

Stated as a scope line: **cron is V1.1**, so V1.0's offline guarantee covers regex and JSON.

---

## 2. Service worker strategy

### 2.1 Tooling

`vite-plugin-pwa` in `generateSW` mode (Workbox under the hood).

| Option | Choice | Why |
|---|---|---|
| `generateSW` vs `injectManifest` | **`generateSW`** | Our caching needs are "precache everything, serve from cache". A hand-written SW would be more code for identical behaviour, and SW bugs are the worst class of bug to debug — they persist across reloads. Ladder rung: the tool already does it. |
| `registerType` | **`prompt`** | Never `autoUpdate`. An unrequested reload while a user is mid-edit destroys their work. |
| `injectRegister` | `null` — we register manually | Registration is deferred until after `load` so it never competes with first paint. |

If a later requirement needs custom fetch logic (none is foreseen), switching to `injectManifest` is a contained change.

### 2.2 Caching strategy: precache only

```
┌─────────────────────────────────────────────────┐
│ Precache (Workbox, revisioned)                  │
│  index.html · JS chunks · CSS · fonts · icons   │
│  manifest.webmanifest                           │
│  Strategy: cache-first, network never consulted │
└─────────────────────────────────────────────────┘
```

**There is no runtime cache, and that is deliberate.** Runtime caching exists to handle requests that were not known at build time. This app issues no such requests, and CSP `connect-src 'none'` blocks the APIs that would make them. Adding a runtime cache would mean configuring a strategy for traffic the application does not generate — complexity with no corresponding behaviour.

**We do not add a runtime caching strategy unless a genuine need appears.** If one ever does (a new feature that legitimately fetches something), it arrives with its own justification, its own CSP change, and a threat-model review — not as speculative configuration.

| Asset class | Strategy |
|---|---|
| App shell + JS + CSS + fonts + icons | Precache, cache-first |
| Navigation requests | `NavigationRoute` → precached `index.html` |
| Everything else | No handler — the request simply fails, which is correct, because it should not have happened |

### 2.3 Precache manifest

Included: `index.html`, all hashed JS chunks (including worker bundles), CSS, self-hosted font subsets, PWA icons, `manifest.webmanifest`.

Excluded: source maps (do not ship them to production — see `17_DEPLOYMENT.md`), `_headers`, and anything in `docs/`.

Total precache budget: **≤ 2 MB**. Exceeding it fails the build, because a PWA that takes 30 seconds to become offline-ready on a slow connection has not solved the problem it set out to solve.

### 2.4 Worker bundles

The analysis and execution worker chunks **must** be in the precache manifest. A worker that 404s offline turns every analysis into a silent failure — and it is an easy thing to miss, because it works perfectly in development. An explicit E2E test loads offline and runs one analysis of each mode in the current release (regex and JSON for V1.0; cron added in V1.1).

---

## 3. Lifecycle

```mermaid
sequenceDiagram
    participant B as Browser
    participant P as Page
    participant SW as Service Worker
    participant C as Cache Storage
    participant N as Network

    Note over B,N: First visit
    B->>N: GET /
    N-->>B: index.html + assets
    B->>P: render (SW not yet involved)
    P->>P: window 'load' fires
    P->>SW: register('/sw.js')
    SW->>SW: install
    SW->>N: fetch precache manifest entries
    N-->>SW: assets
    SW->>C: put into cache "workbox-precache-v<build>"
    SW->>SW: activate → clients.claim()
    SW-->>P: 'offline ready' event
    P-->>P: subtle toast "Ready to work offline"

    Note over B,N: Return visit (online or offline)
    B->>SW: navigate
    SW->>C: match(index.html)
    C-->>SW: hit
    SW-->>B: serve from cache (no network)
    B->>P: render — fast, network-independent

    Note over B,N: Update available
    P->>SW: periodic update check (on load + hourly)
    SW->>N: GET /sw.js
    N-->>SW: new SW (byte-different)
    SW->>SW: install new version
    SW->>C: precache into NEW cache name
    Note right of C: old cache untouched —<br/>a failed update cannot break the working app
    SW-->>P: 'waiting' state
    P-->>P: banner "New version available — Reload"
    Note over P: user keeps working; nothing is forced
```

---

## 4. Update flow — the part most PWAs get wrong

### 4.1 Rules

1. **Never `skipWaiting()` automatically.** The new SW waits.
2. **Never reload without the user's consent.** A forced reload mid-edit is data loss and is the single most common PWA anti-pattern.
3. **Notify unobtrusively.** A dismissible banner, not a modal.
4. **Re-offer on the next load** if dismissed.
5. **Preserve state across the update reload** — the current editor content is written to `sessionStorage` immediately before reload and restored after.

### 4.2 Implementation shape

```ts
const updateSW = registerSW({
  onNeedRefresh() { uiStore.setUpdateAvailable(true); },
  onOfflineReady() { uiStore.toast('Ready to work offline'); },
  onRegisteredSW(url, r) { if (r) setInterval(() => r.update(), 60 * 60 * 1000); },
});

// Only on explicit user action:
async function applyUpdate() {
  sessionStorage.setItem('syntaxlab.pendingInput', JSON.stringify(workspaceStore.snapshot()));
  await updateSW(true);   // skipWaiting + reload
}
```

The hourly `r.update()` check fails harmlessly offline.

### 4.3 Cache versioning and cleanup

Workbox names the precache per build revision. On activation, caches not belonging to the current revision are deleted. Because the new cache is populated **before** activation, a failed or partial update leaves the previous version fully intact and serving.

### 4.4 Rollback

There is no in-app rollback (a page cannot install an older SW). Recovery paths, in order of severity:

| Situation | Recovery |
|---|---|
| Bad release detected quickly | Redeploy the previous build via Cloudflare Pages rollback. Clients pick up the "new" (reverted) SW on their next update check. |
| A user is stuck on a broken version | In-app **Reset app** (settings → advanced): unregister the SW, delete all caches, reload. Preserves IndexedDB history. |
| Total failure | Devtools → Application → Unregister. Documented in the README troubleshooting section. |

**Mitigation that actually matters:** every release is verified on a Cloudflare preview deployment *including the offline path* before promotion. A broken SW reaching production is far more expensive than any other bug class in this app, because it self-persists.

---

## 5. Offline UX

### 5.1 Status indication

| State | Indication |
|---|---|
| Online, up to date | Nothing. Silence is the correct UI for "everything is normal". |
| Offline, fully cached | A small, calm `⬤ Offline` chip in the header. Not a banner, not red, not an error. |
| Offline before caching completed | A one-time explanatory message: some features may be unavailable until the next online load |
| Update available | Dismissible banner with **Reload** |
| Offline-ready (first time only) | A single toast: "Ready to work offline" |

Detection uses `navigator.onLine` plus `online`/`offline` events. `navigator.onLine` is unreliable for "is the internet reachable" — but it is entirely adequate for "is the network interface down", and since **we make no requests**, we never need the stronger signal. We deliberately do not ping a server to test connectivity; that would break `connect-src 'none'` and the privacy promise for a cosmetic indicator.

### 5.2 What must never happen

- A full-screen "you are offline" interstitial. The app works offline; saying otherwise is a lie.
- Disabling features that work perfectly offline.
- Nagging. One toast, one chip, one dismissible banner. That is the entire offline UI budget.

---

## 6. Web App Manifest

```json
{
  "name": "SyntaxLab — Regex, JSON & Cron Explainer",
  "short_name": "SyntaxLab",
  "description": "Understand regex, JSON, and cron expressions. Runs entirely in your browser.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0a0e0c",
  "theme_color": "#0a0e0c",
  "orientation": "any",
  "categories": ["developer", "utilities", "productivity"],
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "New Regex", "url": "/?mode=regex" },
    { "name": "New JSON",  "url": "/?mode=json"  },
    { "name": "New Cron",  "url": "/?mode=cron"  }
  ]
}
```

**Note on `?mode=` and ADR-009.** There is no router, and mode is otherwise not deep-linkable. These shortcuts are the one exception: on startup the app reads `?mode=` and accepts it **only if it is exactly `regex`, `json`, or `cron`** — a three-value enum check, not a parser. Anything else is ignored and the parameter is stripped with `history.replaceState`. This is a query parameter rather than a fragment because manifest shortcuts must work before any JavaScript runs, and it is safe because the value is an enum, never user content (`18_CODING_STANDARDS.md` S8 forbids user content in the query string, which this is not).

`background_color` and `theme_color` are fixed to the **default** dark base, not the user's custom theme. The manifest is a static build artefact; the splash screen cannot follow runtime customisation. Documented so nobody files it as a bug.

Deliberately omitted: `share_target` (would require handling arbitrary shared content — new attack surface for little value), `file_handlers` (same), `protocol_handlers` (no use case).

The install prompt is **not** auto-triggered. The `beforeinstallprompt` event is captured and surfaced as a quiet "Install" item in the settings menu. Interrupting a developer with an install modal is exactly the behaviour this product is positioning against.

---

## 7. Fonts and offline

Self-hosted, subsetted, `woff2`, precached, with `font-display: swap` and a system-font fallback stack.

No Google Fonts, no CDN. A font CDN would: break offline, leak the user's IP on every load, add a DNS+TLS round trip to first paint, and require loosening `font-src`. Four separate reasons, any one of which is sufficient.

---

## 8. Testing

| Test | Method |
|---|---|
| Offline load | Playwright, `context.setOffline(true)` after first load; assert app renders |
| Offline analysis | Every mode in the current release offline (two in V1.0, three in V1.1); assert workers load and produce results |
| Offline history | Write and read entries offline |
| Worker precaching | Assert worker chunks are in the precache manifest |
| Update flow | Deploy build A, load, deploy build B, assert banner appears and no auto-reload |
| State preservation across update | Type input, apply update, assert input restored |
| Cache cleanup | Assert old caches are deleted after activation |
| Precache size | CI check against the 2 MB budget |
| Manifest validity | Lighthouse PWA audit in CI |
| First-load performance | SW registration must not delay first paint — assert registration occurs after `load` |
| Install prompt | Assert not auto-shown |

Manual checks before each release: install on Chrome desktop and Android, verify standalone launch, verify offline in the installed context, and verify the update banner appears in a real installed app (behaviour differs subtly from a browser tab).

---

## 9. Known limitations

| Limitation | Detail |
|---|---|
| iOS Safari PWA | Storage can be evicted after ~7 days of non-use under ITP. History may vanish. Documented in the README; export is the mitigation. |
| No background sync | Nothing to sync. Deliberate. |
| No push notifications | No use case; would require a server and a permission prompt users hate. |
| Update requires network | Unavoidable and correct. |
| First visit requires network | Unavoidable. |
| Private browsing | SW and IDB may be unavailable; app runs in memory-only mode with a notice. |
| Cache eviction under disk pressure | Browser may evict the whole origin. `navigator.storage.persist()` is requested after the third history entry to reduce the risk. |
