# 11 — State Management

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

---

> **Scope note.** V1.0 state covers regex and JSON. **M14 added no state** — the cron domain is pure and stateless. Cron state arrived with the UI at M15, and M16 added three fields for the schedule (§4.1.1). Nothing cron-shaped is persisted, and no share state exists.

## 1. A note on the brief's framing

The brief asks this document to define "server/cache/local state boundaries". **There is no server** (ADR-001), so there is no server state and no server cache. Rather than invent one to fill the section, the boundaries that actually exist in this application are:

| Boundary | Meaning here | Lives in |
|---|---|---|
| **Domain state** | The parsed result of an analysis: AST/CST, explanation, warnings. Produced by the domain layer in a worker; **never persisted**; recomputed from input. | `workspaceStore.result` |
| **UI state** | What the interface is currently showing: open drawers, expanded tree nodes, hovered spans, toasts, cursor position. Disposable. | React local state + `uiStore` |
| **Transient worker state** | In-flight request ids, deadline timers, worker readiness. Not application state at all — an infrastructure detail. ✅ Implemented at M2: `pending` map, per-request timers, and lifecycle status live entirely inside `WorkerClient` and are never mirrored into a store. | `WorkerClient` internals |
| **Persistent history** | Analysis inputs and metadata. Survives reload. | IndexedDB via `historyStore` |
| **Theme and settings** | Small preference data, read synchronously before first paint. | localStorage via `themeStore` / `settingsStore` |

These five are the boundaries that actually exist. The brief's "server/cache" framing presumes a backend; substituting the real boundaries is more useful than inventing one to fill the section.

This substitution is deliberate and is listed in `22_OPEN_QUESTIONS.md` §3 as a documented deviation.

---

## 2. Inventory

| State | Category | Home | Persisted | Why there |
|---|---|---|---|---|
| Editor text | Session | `workspaceStore` + CM6 internal | ❌ (except across an SW update) | Needs to survive mode switches and drawer opens |
| Current mode | Session | `workspaceStore` | ❌ | Ephemeral choice; `regex` or `json` in V1.0 |
| Regex flags | Session | `workspaceStore` | ⚠️ defaults in settings | Per-analysis, but the default is a preference |
| Analysis result | Derived | `workspaceStore` | ❌ | Recomputed in ms; storing it invites staleness. M3 measured a typical regex analysis at 0.02–0.06 ms, so recomputation is genuinely cheaper than cache invalidation. |
| Analysis status | Session | `workspaceStore` | ❌ | idle / parsing / ready / error / timeout |
| Cursor, selection | Ephemeral | CM6 | ❌ | Belongs to the editor |
| Tree expansion | Ephemeral | Component | ❌ | Resets per analysis, correctly |
| Hovered span | Ephemeral | Feature-local | ❌ | Nothing outside the feature needs it |
| Drawer open/closed | Session | `uiStore` | ❌ | Needs to be closable from a global `Escape` handler |
| Toasts | Session | `uiStore` | ❌ | |
| SW update available | Session | `uiStore` | ❌ | |
| Online/offline | Session | `uiStore` | ❌ | Mirrors a browser event |
| History list | Session cache of persistent | `historyStore` | ✅ IndexedDB | Cached in memory for list rendering; IDB is authoritative |
| History paused | Session + persistent | `settingsStore` | ✅ localStorage | Must survive reload or it is a privacy trap |
| First-run notice seen | Persistent | `settingsStore` | ✅ localStorage | Shown once; must not reappear |
| Theme | Persistent | `themeStore` | ✅ localStorage | Must be readable pre-paint |
| Settings | Persistent | `settingsStore` | ✅ localStorage | |
| Panel split ratio | Persistent | `settingsStore` | ✅ localStorage | Users expect layout to stick |
| Worker readiness | Session | `workerClient` internal | ❌ | Infrastructure detail, not app state |

---

## 3. The store implementation

```ts
type Listener = () => void;

export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    get: () => state,
    set(updater: T | ((prev: T) => T)) {
      const next = typeof updater === 'function'
        ? (updater as (p: T) => T)(state) : updater;
      if (Object.is(next, state)) return;
      state = next;
      listeners.forEach(l => l());
    },
    subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

export function useStore<T, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
```

About forty lines including types. It gives us: selector subscriptions, concurrent-safe reads via `useSyncExternalStore`, tearing protection, SSR-safe signature (unused, but free), and full usability from non-React code — which matters because the application layer must update state without touching React.

**Selector results must be referentially stable.** A selector returning a fresh object each call causes an infinite re-render loop. Rule: selectors return primitives or stable references; composites use `useMemo` at the call site or a shallow-equality wrapper. This is written down because it is the single failure mode of this pattern.

### 3.1 Why not a library — recorded honestly

| Option | Verdict |
|---|---|
| **Hand-rolled (chosen)** | Zero bytes, complete understanding, exactly the features we use |
| Zustand (~1.2 KB) | Genuinely good and about as small. If a reviewer prefers it, the swap is mechanical — the store interface is deliberately Zustand-shaped. Not adopted because 40 lines of ours does the same job. |
| Jotai / Recoil | Atomic model suits fine-grained derived graphs. Ours is coarse and shallow. |
| Redux Toolkit | Devtools and middleware are real benefits; ~13 KB and a large amount of ceremony for seven pieces of state is not warranted. |
| Context only | Every context consumer re-renders on any change. With an editor firing updates at typing speed this is measurably bad. |
| TanStack Query | Solves server-cache problems. There is no server. |

---

## 4. Stores

### 4.1 `workspaceStore`

```ts
interface WorkspaceState {
  mode: 'regex' | 'json';          // 'cron' added at M15, not M14
  detectedType: DetectionResult | null;
  suggestionDismissed: boolean;
  input: string;
  regexFlags: RegexFlags;
  testSubject: string;
  // M15: cronTimezone: CronTimezoneMode;   (dialect is fixed at standard5)
  // Note it is the *mode* that would be stored, not a resolved context: the
  // context is derived per analysis, and persisting an offset would persist a
  // fact that expires.
  status: 'idle' | 'analyzing' | 'ready' | 'error' | 'timeout';
  result: AnalysisResult | null;
  error: DomainError | null;
  execResult: MatchResult | null;
  execStatus: 'idle' | 'running' | 'ready' | 'timeout' | 'error';
  restoredFromId: string | null;
  isDirty: boolean;
}
```

The hot path. `input` changes on every keystroke, so **only the editor subscribes to it**; the analysis pane subscribes to `result` and `status`, which change at most once per debounce interval.

#### 4.1.1 The schedule fields — M16

```ts
  cronSchedule: CronSchedulePreview | null;
  cronScheduleStatus: 'idle' | 'analyzing' | 'ready' | 'error';
  cronScheduleError: WorkspaceFailure | null;
```

**Three fields rather than one, and separate from `cronAnalysis`.** The times
come from their own worker operation, so they get their own loading and failure
states: a schedule that could not be computed must not blank the explanation,
which is still worth reading.

**They are cleared the moment a new expression is committed**, before the
worker answers. Times held over from the previous expression would be the worst
kind of wrong — plausible, and about something else.

**Nothing derived is stored.** `computedAt` lives inside the preview, where the
domain put it; there is no separate "last calculated" field that could disagree
with the times beside it. Whether a time has gone stale is the user's to judge
from that timestamp, and Recalculate is how they act on it. **No timer writes
to this store.**

#### Draft and committed input — M15

Every mode holds two versions of its input:

| | |
|---|---|
| `pattern` / `jsonInput` / `cronInput` | The draft. Changes on every keystroke. |
| `committedPattern` / `jsonCommitted` / `cronCommitted` | What the visible result was produced from. Changes only on Analyze. `null` until the first one. |

```mermaid
flowchart LR
    A["Editor"] -->|"every keystroke"| B["draft"]
    B -->|"Analyze, and nothing else"| C["committed"]
    C --> D["worker request"]
    D --> E["result"]
    E --> F["panels"]
    B -.->|"differs from committed"| G["stale badge"]

    classDef safe fill:#0a1f14,stroke:#5fbf85,color:#d4f5e2
    classDef warn fill:#2a2414,stroke:#a08040,color:#fff0d9
    class C,E safe
    class G warn
```

**Staleness is derived, not stored.** `submissionOf(draft, committed)` returns
`{ untouched, stale, submittable }`. A `stale` boolean kept beside the two
strings would be a third thing that can disagree with them, and the
disagreement would show as a result presented as current when it is not.

**Responses are matched against the committed input, not the editor.** The user
is free to keep typing while a worker is busy; that is not a reason to throw
away a correct answer about the text they actually asked about. It is also the
staleness guard: a response whose committed input has since been superseded is
dropped.

Regex is the one mode whose commitment is two values, because flags change what
an analysis would say without changing a character of the pattern.
`regexSubmission` treats a flag change as an edit.

### 4.2 `historyStore`

```ts
interface HistoryState {
  entries: HistoryEntry[];        // current page
  total: number;
  query: HistoryQuery;
  loading: boolean;
  error: StorageError | null;
  storageAvailable: boolean;
  quotaWarning: boolean;
}
```

An in-memory projection of IndexedDB. IDB is authoritative; the store is a render cache. Refreshed on: drawer open, any write, and a `BroadcastChannel` message from another tab.

**As built at M7** the shape differs from the sketch above, in ways worth recording:

```ts
interface HistoryState {
  page: HistoryPage;              // entries + total + integrity counts
  status: 'idle' | 'loading' | 'ready' | 'failed';
  error: StorageError | null;
  durable: boolean;               // false ⇒ this session only, and the UI says so
  search: string;
  typeFilter: HistoryType | null;
  pinnedOnly: boolean;
  pendingUndo: HistoryEntry | null;
  captureSuspended: boolean;      // storage filled up; capture stopped, with a reason
  usage: number | null;           // origin-wide estimate, null where unreported
  quota: number | null;
}
```

- **`page` rather than `entries` + `total`.** The two are computed together and are never meaningfully apart; splitting them invites a render where the count and the list disagree. `HistoryPage` also carries `fromNewerVersion` and `quarantined`, which the drawer must surface — see `06_DATA_STORAGE.md` §7.3.
- **`status` rather than `loading`.** A boolean cannot distinguish "not opened yet" from "opened and failed", and those need different things on screen.
- **`durable` rather than `storageAvailable`.** Storage can be available and still not be keeping anything: the memory fallback works, it is just not durable. That is the distinction the user needs stated.
- **`captureSuspended` rather than `quotaWarning`.** A warning is something to look at; this is a behaviour change — nothing new is being saved — so it is named for what it does and cleared only by an explicit user action.
- **The query fields live in the store, not in a `query` object**, because each is set by its own control and a nested object would be replaced wholesale on every keystroke.

The repository itself holds the entry set in memory and writes through. At the 500-entry cap that is affordable, and it is what lets search filter as the user types without a database round trip per keystroke.

### 4.3 `themeStore` and `settingsStore`

Both write through to `localStorage` on change (debounced 300 ms), and both validate on read at startup. `themeStore` additionally calls `applyTheme()` on every change to push CSS custom properties.

### 4.4 `uiStore`

Drawers, dialogs, toasts, online status, update availability. Deliberately separate from `workspaceStore` so that opening a drawer does not notify subscribers of analysis state.

---

## 5. Data flow

```mermaid
sequenceDiagram
    participant E as CodeEditor
    participant WS as workspaceStore
    participant UC as analyzeInput
    participant WC as WorkerClient
    participant W as Analysis Worker
    participant H as saveToHistory
    participant R as HistoryRepository

    E->>WS: set input (every keystroke)
    Note over WS: only the editor subscribes to `input`
    WS->>UC: debounced 200 ms
    UC->>WS: status = 'analyzing'
    UC->>WC: request(op, payload)
    WC->>W: postMessage {id, op, payload}
    Note over WC: supersede — an older in-flight<br/>request is abandoned, not applied
    W-->>WC: {id, ok, result}
    WC-->>UC: Result
    UC->>WS: status='ready', result
    Note over WS: analysis pane re-renders once
    UC->>H: onSuccess
    H->>H: historyEnabled?
    H->>R: save (debounced 2 s, deduped 60 s)
```

> **Detection built at M6.** `detected` and `detectedOnEmpty` live in
> `workspaceStore`. The second field is what separates a *first paste* from an
> edit, and it is the only condition under which a mode changes on its own —
> a first draft keyed the auto-switch off the target editor being empty, which
> allowed the mode to move while someone was mid-edit. `suggestionDismissed`
> is per session and deliberately not persisted.

### 5.1 Race handling

> **Built at M4, with two guards rather than one.** The client supersedes an
> in-flight request sharing a key, *and* every response is re-checked against
> the input that is current when it arrives. Supersession alone is not enough:
> a response can already be sitting in the message queue when the newer request
> is issued, so it is never superseded and would otherwise be applied. Both
> guards are asserted in `tests/unit/regex/regexWorkspace.test.ts`.

Every worker request carries a monotonically increasing id. When a response arrives whose id is not the newest for that operation, **it is discarded**. Without this, fast typing produces out-of-order responses and the pane flickers between stale and current results — a bug that is trivially avoided at design time and miserable to diagnose later.

---

## 6. Persistence

| Data | Store | Write timing |
|---|---|---|
| Theme | **URL query string** | Debounced 250 ms after change, via `history.replaceState` |
| Settings | localStorage | Immediately (rare, small) |
| Panel split | localStorage | Debounced 500 ms after drag end |
| History | IndexedDB | Debounced 2 s after a successful analysis; immediately on explicit save/rename/pin |
| Editor content | **Not persisted** | Except: written to `sessionStorage` immediately before an SW update reload, restored after |

### 6.1 Why editor content is not persisted

Tempting, and rejected. Persisting the editor buffer would mean the most sensitive live content (mid-paste production JSON) is written to disk continuously, outside the history-pause control. The pause toggle would then be a lie. Users who want persistence have history; users who want privacy get it.

Exception: the SW-update reload, where we save to `sessionStorage`, restore, and immediately delete the key. Bounded, purposeful, and cleared.

---

## 7. Hydration order

```
1. index.html loads
2. theme-bootstrap.js (blocking, same-origin, tiny)
     → read localStorage → validate → set CSS custom properties
     → no flash of default theme
3. App bundle loads
4. Stores initialise from validated localStorage
5. React renders — theme already correct
6. After paint:
     - register the service worker
     - open IndexedDB, load the first history page
     - spawn the analysis worker
     - show the first-run history notice if `hasSeenHistoryNotice` is false
7. Idle: prefetch the json/cron chunks
```

Nothing in steps 6–7 blocks first paint. Every one of them can fail without preventing the app from working.

---

## 8. Cross-tab synchronisation

| Data | Mechanism | Behaviour |
|---|---|---|
| History | `BroadcastChannel('syntaxlab')` | Other tabs refetch their page on `history-changed` |
| Theme | **None, deliberately** | Two tabs on two URLs are two documents with two themes — see below |
| Settings | `storage` event | Applied live |
| Editor content | None | Independent per tab, by design — two tabs are two workspaces |
| First-run notice | `storage` event | Acknowledging in one tab suppresses it in the others |
| DB upgrade | IDB `versionchange` | Old tabs close their connection and prompt a reload |

**Theme lost its cross-tab channel at M15, and that is the correct
behaviour.** It synchronised through the `storage` event, which the URL has no
equivalent for. Nothing was added to replace it: a `BroadcastChannel` here
would be rebuilding the coupling that moving to the URL removed, and it would
make two tabs showing two different links agree with each other — which is not
how any other page on the web behaves. What *is* listened for is `popstate`,
because Back and Forward are the one navigation that can change a theme
underneath a running document; ordinary theme edits use `replaceState`
precisely so they do not.

**Implemented at M7, with one deliberate detail:** the `history-changed`
message carries *no payload*. The receiving tab drops its cached repository
and re-reads from the database. Sending the entry would be faster and would
also create a second path by which a record reaches application state — one
that skips `readEntry`. There is one validation path, and it is the one that
reads from disk.

Both mechanisms are covered end to end across two real tabs
(`tests/e2e/history.spec.ts`): a save in one tab appears in the other, and
pausing in one pauses the other.

---

## 9. Anti-patterns explicitly avoided

| Anti-pattern | Why it is banned here |
|---|---|
| Editor value as fully controlled React state | Re-renders the tree on every keystroke; unusable at document scale |
| A single god store | Every change notifies every subscriber |
| Storing derived data | Staleness bugs, and it duplicates sensitive content |
| Context for high-frequency values | No selector granularity |
| Persisting everything "just in case" | Privacy cost, quota cost, migration cost |
| `useEffect` chains for derivation | Derive during render or in the worker; effect chains produce extra renders and ordering bugs |
| Global state for feature-local UI | Hover state, expansion state, and scroll position stay local |
| Optimistic updates on storage writes | IDB is fast and local; showing a lie to save 3 ms is not a trade worth making |

---

## 10. Testing

| Area | Test |
|---|---|
| Store primitive | Subscribe/notify/unsubscribe; `Object.is` short-circuit; selector isolation |
| Selectors | Assert stable references; assert non-subscribed changes do not notify |
| Use-cases | Pure functions over fake stores + fake infrastructure |
| Race handling | Dispatch three overlapping requests; assert only the newest result is applied |
| Persistence | Change → reload → assert restored |
| Corrupt persistence | Poison `localStorage`; assert defaults and no crash |
| Cross-tab | Two contexts; assert propagation |
| Hydration | Assert no theme flash; assert app renders before IDB resolves |

---

## M8 — theme state

### The store

```ts
themeStore: Store<ThemePreferences>
```

One store, one subscriber. The theme drawer subscribes so its controls can
show current values; **nothing else in the application does.** That is the
point of the token architecture: a preset change writes eight custom
properties and the whole interface follows through the cascade, with no React
render involved.

> **Superseded at M15.** The diagram below described the localStorage flow.
> Theme preferences now live in the **URL** — `domain/theme/urlPreferences.ts`
> and `application/theme/themeStore.ts`. What follows is what shipped in
> v1.1.0.

```mermaid
stateDiagram-v2
    [*] --> Read: readTheme(URLSearchParams) at module load
    Read --> Applied: applyTheme — synchronous, before first paint

    Applied --> Applied: selectPreset / updateTheme / resetTheme
    note right of Applied
        A discrete choice writes at once:
        1. readTheme — revalidate
        2. store.setState
        3. applyTheme — synchronous
        4. flushTheme → history.replaceState
    end note

    Applied --> Applied: updateGradient
    note left of Applied
        The one debounced action.
        A slider drag fires every frame;
        250 ms, then replaceState.
    end note

    Applied --> Applied: popstate → re-read the address bar
    Applied --> [*]: pagehide / visibilitychange → flushTheme
```

**`replaceState`, never `pushState`.** Dragging the intensity slider changes the
theme dozens of times, and each one pushing an entry would bury the page the
user arrived from under a hundred near-identical URLs. Asserted by spy.

**A discrete choice flushes immediately; only the gradient drag is debounced.**
Picking a preset and reloading within 250 ms used to lose the choice, because
the reload read a URL the debounce had not written yet.

### Cross-tab, and why it is gone

**There is none, deliberately.** Two tabs on two URLs are two documents with two
themes, exactly as with any other page. Restoring the old coupling with a
`BroadcastChannel` would be rebuilding what the move to the URL removed.

`popstate` *is* listened for: Back is the one navigation that can change a
theme underneath a running document.

**Nothing writes a theme key to storage.** The old key is read once, migrated
into the URL and deleted — and only that key, because history and settings live
under their own. Verified against the live release: `localStorage` holds no
theme key at all.

### Why the preset name is derived, not remembered

`updateGradient` recomputes the preset id from the resulting gradient values
rather than carrying the previous one forward. A theme that reached `custom`
by one edit and was edited back to exactly Amber **is** Amber; remembering
`custom` would leave the drawer marking no preset selected while displaying
one precisely. The label describes the state, not the route to it.

---

## M11 — the split position

One field, `splitPercent`, added to `settingsStore`. It follows the rules
already established rather than inventing any:

- **localStorage, not IndexedDB.** It has to be readable synchronously during
  the first render, like every other setting.
- **Validated on read.** `readSplitPercent` rejects anything that is not a
  finite number and clamps the rest to 25–75. A corrupt entry gives 45, not a
  broken layout — asserted by an E2E test that plants a string in storage.
- **Written once per gesture.** A drag updates a CSS custom property directly
  and only writes the store on `pointerup`. Keyboard adjustments are discrete,
  so they persist immediately.

**It is deliberately not React state.** The value drives
`grid-template-columns` through a custom property on the grid element, the same
mechanism `applyTheme` uses. Holding it in state would reconcile both panels —
including a 200-row match table — on every `pointermove`. The `Splitter`
component seeds itself from the store once and owns the live value during a
drag; nothing else subscribes.

This is the second place in the codebase where the answer to "where does this
state live?" is *a CSS custom property*, and for the same reason both times:
the value changes at input frequency and only the layout cares.
