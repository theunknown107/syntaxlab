# 06 — Data Storage

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

---

> **Scope note (Phase 1.5).** History auto-capture is **ON by default**, introduced by a one-time first-run notice (§4.2). Cron entries appear from V1.1. Share URLs are deferred, so no share state is persisted or encoded.

## 1. Storage strategy

Three storage mechanisms, chosen by access pattern rather than habit.

| Mechanism | Contents | Size | Sync/async | Why this one |
|---|---|---|---|---|
| **IndexedDB** | History entries | ≤ 50 MB self-imposed | Async | Structured, indexed, queryable, large capacity. The only browser store that can search 500 records by type and timestamp without loading all of them. |
| **localStorage** | Theme, settings, schema markers | < 8 KB | **Sync** | Synchronous read before first paint. This is the entire reason it is used — an async theme read guarantees a flash of the wrong theme on every load. |
| **Cache Storage** | App shell, JS, CSS, fonts, icons | ~1–2 MB | Async | Service-worker-managed; the offline story. |

Not used: cookies (no server), `sessionStorage` (no requirement), OPFS (no file-shaped data), WebSQL (dead).

---

## 2. IndexedDB schema

**Database:** `syntaxlab` · **Version:** 1

### 2.1 Object store: `history`

```ts
{
  keyPath: 'id',            // crypto.randomUUID()
  autoIncrement: false,
}
```

| Index | Key path | Unique | Purpose |
|---|---|---|---|
| `by-created` | `createdAt` | no | Default reverse-chronological list |
| `by-opened` | `lastOpenedAt` | no | "Recently used" ordering |
| `by-type` | `type` | no | Filter by regex/json/cron |
| `by-type-created` | `['type','createdAt']` | no | Filtered list without a full scan — the compound index is what keeps filtering O(results) instead of O(all) |
| ~~`by-pinned`~~ | ~~`pinned`~~ | — | **Not created.** See below. |

**`by-pinned` cannot exist as specified.** `pinned` is a boolean, and IndexedDB
rejects booleans as keys: the index would be created successfully and then
silently contain no records at all, which is worse than not having it. Pinned
ordering and prune exemption are done in `queryEntries` and `selectForPruning`
instead. Storing `pinned` as `0 | 1` purely to make it indexable was rejected —
it would put a storage detail into the domain model to serve an index nothing
currently reads.

**The other four indices are created but not yet read.** The repository loads
the whole store — capped at 500 entries — and filters in memory, which measures
at 27 ms for a search across 500 records and 33 ms across 1 000. They are
declared now because adding an index later needs a version bump and an upgrade
path, and an unused index on a store this size costs nothing measurable.

**Record shape:** `HistoryEntry` as defined in `03_DOMAIN_MODEL.md` §6.

**Note on `searchText`:** a precomputed lowercased concatenation of title + input prefix (first 2 KB). IndexedDB has no full-text index; search is a cursor scan with an in-memory substring match over this field. At the 500-entry cap that is sub-millisecond, so no external search index is warranted. If the cap ever rises past a few thousand, revisit — noted in `12_PERFORMANCE.md`.

### 2.2 Object store: `meta`

```ts
{ keyPath: 'key' }   // { key: string, value: unknown }
```

| Key | Value | Purpose |
|---|---|---|
| `dbSchemaVersion` | number | Migration tracking independent of IDB's own version |
| `lastPrunedAt` | number | Rate-limits pruning work |
| `entryCount` | number | Cheap count without a full scan |
| `quarantine` | `QuarantinedRecord[]` | Records that failed validation, retained for export/debug — **implemented at M7**, bounded to the most recent 50 |

`dbSchemaVersion`, `lastPrunedAt` and `entryCount` are **not written at M7**.
Each exists to avoid a full scan, and the M7 repository does a full read at
startup by design, so all three would be state that can only fall out of sync
with the thing it is caching. They become worth writing if the cap rises far
enough to make the full read expensive.

### 2.3 Why two stores and not more

Everything else is either small enough for `localStorage` (preferences) or derived (analysis results, which are deliberately not persisted — see `03_DOMAIN_MODEL.md` §6.1).

---

## 3. Repository abstraction

The domain and application layers never touch `indexedDB` directly. They depend on an interface, which makes the whole storage layer swappable for an in-memory implementation in tests and in the storage-unavailable fallback path.

```ts
interface HistoryRepository {
  list(query: HistoryQuery): Promise<Result<HistoryPage, StorageError>>;
  get(id: string): Promise<Result<HistoryEntry | null, StorageError>>;
  save(entry: NewHistoryEntry): Promise<Result<HistoryEntry, StorageError>>;
  update(id: string, patch: HistoryPatch): Promise<Result<HistoryEntry, StorageError>>;
  delete(id: string): Promise<Result<void, StorageError>>;
  clear(): Promise<Result<void, StorageError>>;
  count(): Promise<Result<number, StorageError>>;
  exportAll(): Promise<Result<ExportEnvelope, StorageError>>;
  importAll(env: ExportEnvelope, mode: 'merge'|'replace'): Promise<Result<ImportReport, StorageError>>;
  getQuarantined(): Promise<Result<QuarantinedRecord[], StorageError>>;
}

interface HistoryQuery {
  type?: 'regex'|'json'|'cron';
  search?: string;
  pinnedOnly?: boolean;
  sort: 'created'|'opened';
  limit: number;          // page size, default 50
  cursor?: string;        // opaque continuation token
}

type StorageErrorCode =
  | 'UNAVAILABLE'    // IndexedDB blocked or absent
  | 'QUOTA'          // QuotaExceededError
  | 'CORRUPT'        // db failed to open or record unreadable
  | 'BLOCKED'        // upgrade blocked by another tab
  | 'VALIDATION'     // record failed schema validation
  | 'UNKNOWN';
```

Three implementations:

| Implementation | Used when |
|---|---|
| `IdbHistoryRepository` | Normal operation |
| `MemoryHistoryRepository` | Storage unavailable (private mode, policy, corruption) — the app stays fully functional for the session |
| `FakeHistoryRepository` | Unit tests, with fault injection for quota/corruption paths |

**Every method returns `Result`, never throws.** Storage failure is an expected condition in a browser, not an exception.

---

## 4. Local storage flow

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Workspace UI
    participant App as saveToHistory use-case
    participant Repo as HistoryRepository
    participant IDB as IndexedDB
    participant BC as BroadcastChannel

    U->>UI: analyse input (explicit or debounced)
    UI->>App: analysis succeeded
    App->>App: historyEnabled?
    alt paused
        App-->>UI: skip — nothing persisted
    else enabled
        App->>App: derive title, metadata, searchText
        App->>Repo: save(entry)
        Repo->>Repo: dedupe — same (type,input) within 60 s?
        alt duplicate
            Repo->>IDB: update lastOpenedAt, openCount++
        else new
            Repo->>IDB: add(record)
            IDB-->>Repo: QuotaExceededError?
            alt quota hit
                Repo->>IDB: prune unpinned oldest 10%
                Repo->>IDB: retry add once
                Repo-->>App: still failing → StorageError QUOTA
                App-->>UI: toast + disable auto-capture, show indicator
            end
        end
        Repo->>BC: postMessage {type:'history-changed'}
        BC-->>UI: other tabs refresh their list
        Repo-->>App: Result.ok(entry)
        App-->>UI: history badge updates
    end
```

### 4.1 History lifecycle

```mermaid
stateDiagram-v2
    [*] --> FirstRun: first ever visit
    FirstRun --> Enabled: user acknowledges the notice
    note right of FirstRun
        One-time notice:
        · analyses are saved locally in this browser
        · the app does not send them anywhere
        · you can pause or clear them at any time
    end note

    Enabled --> Enabled: successful analysis → entry saved (deduped)
    Enabled --> Paused: user pauses
    Paused --> Enabled: user resumes
    Paused --> Paused: analysis runs, nothing written

    Enabled --> Degraded: QuotaExceededError after pruning
    Degraded --> Enabled: user frees space / re-enables
    note right of Degraded
        Auto-capture off, indicator shown,
        existing history still readable
    end note

    Enabled --> Unavailable: IndexedDB blocked or corrupt
    Unavailable --> Unavailable: memory-only for the session
    note right of Unavailable
        App fully functional,
        notice shown, nothing persisted
    end note

    Enabled --> [*]: clear all
    Paused --> [*]: clear all
```

Entry-level lifecycle within the `Enabled` state: **created** → **reopened** (updates `lastOpenedAt`, `openCount`) → optionally **pinned** (exempt from pruning) or **renamed** → **deleted** by the user, **pruned** automatically if unpinned and old, or **evicted** by the browser under storage pressure.

### 4.2 First-run notice *(decided in Phase 1.5)*

Auto-capture is ON by default because the user explicitly asked the product to remember previous analyses. An opt-in default would fail that requirement, since most users never discover a feature they must first enable.

The privacy cost is paid down by telling the user once, at the only moment they are paying attention:

| Property | Value |
|---|---|
| When | First visit, before any analysis is saved |
| Frequency | Once. Acknowledgement stored in `settings.hasSeenHistoryNotice`. |
| Blocking? | Non-blocking. The user can start working immediately; it does not gate the app. |
| Content | Analyses are saved **locally in this browser**; the app does not send them anywhere; history can be paused, individually deleted, or cleared entirely; local storage is device storage, not a password vault, and the browser may evict it. |
| Actions | `Got it` · `Turn history off` (sets `historyEnabled: false` immediately) |
| Reachable later | Full text in the help dialog and in settings |

The `Turn history off` action in the notice matters: a user who reads the notice and is uncomfortable must be able to act on it in that moment, not be told where to find a setting later.

### 4.3 When entries are written

| Trigger | Written? |
|---|---|
| Every keystroke | ❌ Never |
| Debounced auto-analysis succeeding | ✅ Yes, debounced a further 2 s so a user typing through several valid states produces one entry |
| Explicit Analyze click | ✅ Yes, immediately — **implemented**: an explicit analyse is the user saying they are done, so there is no pause left to wait for |
| Analysis failing with a syntax error | ❌ No — a half-typed regex is not worth remembering |
| Restoring an existing entry | ✅ Updates `lastOpenedAt` and `openCount` only |
| History paused | ❌ Never |

The dedupe window plus the "successful analyses only" rule are what keep history a useful list rather than a keystroke log.

---

## 5. Preferences

Two homes, chosen by what the preference *is*.

| Where | What | Why there |
|---|---|---|
| **URL query string** | Theme: preset, gradient stops, angle, intensity, accent, family, glow, contrast mode, motion mode, font scale | A theme is a description of how the page should look, and a URL is the one piece of state a browser already knows how to copy, bookmark, share and restore |
| `localStorage` | `syntaxlab.settings.v1` (`AppSettings`), `syntaxlab.meta.v1` (`{ lastVersion, firstSeenAt }`) | Device facts and consent state. Not something to put in a link |
| IndexedDB | History | Large, structured, and asynchronous — see §2 |
| **Nowhere** | Editor content | §6.1 |

Versioned key names, so a schema change can be introduced without a
destructive in-place migration.

### 5.1 Theme in the URL — the parameter namespace

**Moved out of `localStorage` at M15.** The full schema is in
`src/domain/theme/urlPreferences.ts`; this is the contract.

| Parameter | Value | Example |
|---|---|---|
| `theme` | A preset id, or `custom` | `theme=crimsonNight` |
| `gf` `gm1` `gm2` `gt` | Gradient stops, six hex digits, **no `#`** | `gf=00FF41` |
| `ga` | Angle, integer 0–359 | `ga=135` |
| `gi` | Gradient intensity, integer 0–100 | `gi=40` |
| `accent` `al` | Accent and its AA-safe companion | `accent=DC143C` |
| `fam` | Neutral ramp family | `fam=crimson` |
| `glow` | Glow intensity, 0–100 | `glow=25` |
| `contrast` | `normal` \| `high` | `contrast=high` |
| `motion` | `system` \| `always` \| `never` | `motion=never` |
| `font` | One of 0.875, 1, 1.125, 1.25 | `font=1.25` |
| `tv` | Theme schema version | `tv=2` |

**Encoded against a baseline, not dumped.** `?theme=matrix` is the whole of an
unmodified Matrix theme; only values that differ from the named preset are
written. Writing all fourteen every time would produce a URL nobody can read
that says nothing about what the user actually chose.

The accessibility settings — `contrast`, `motion`, `font` — are compared
against the documented defaults rather than the preset, because a preset is a
colour scheme and does not get to decide how large someone needs their text.

The `#` is dropped from colours because a URL has to carry it as `%23`, which
costs three characters and makes the parameter unreadable.

```mermaid
flowchart LR
    A["Theme changed"] --> B["encodeThemeParams<br/>only what differs"]
    B --> C["withThemeParams<br/>keeps params it does not own"]
    C --> D["history.replaceState<br/>debounced 250 ms"]
    D --> E["Address bar"]
    E -->|"reload, or a shared link"| F["decodeThemeCandidate"]
    F --> G["readTheme<br/>the one validator"]
    G --> H["in-memory store"]
    H --> I["applyTheme -> CSS custom properties"]

    classDef safe fill:#0a1f14,stroke:#5fbf85,color:#d4f5e2
    class G safe
```

### 5.2 What is never in the URL

**No editor content, ever.** No pattern, no JSON document, no cron expression,
no test subject, no history entry, no match output.

A URL is copied into chat messages, written to browser history, synced across
devices, kept in bookmarks and logged by proxies. Source code is exactly the
thing this application promises never to send anywhere, and putting it in the
address bar would break that promise in the most casual way possible — by
someone pasting a link.

It would also ship the deferred share-URL feature (`22_OPEN_QUESTIONS.md`
D-02) without the compression, size limits, versioning and threat modelling
that feature needs. **This is URL-backed *preferences*, and it is deliberately
not called sharing.**

### 5.3 Bounded, so a hostile link cannot be expensive

| Bound | Value |
|---|---|
| All theme parameters together | 512 characters. Over it, the theme is ignored **in full** — half of someone's choice is not their choice |
| Any single value | 32 characters |
| Unknown parameters | Not consulted at all, so ignored by construction rather than by a filter that could be forgotten |

### 5.4 Migration from localStorage

```mermaid
flowchart TD
    A["Load"] --> B{"Theme params in the URL?"}
    B -->|yes| C["Use them"]
    B -->|no| D{"syntaxlab.theme.v1 present?"}
    D -->|no| E["Defaults"]
    D -->|yes| F["readTheme it"]
    F --> G["Write to the URL"]
    G --> H["removeItem - that key only"]
    H --> C

    classDef safe fill:#0a1f14,stroke:#5fbf85,color:#d4f5e2
    class C safe
```

Read once, migrated, forgotten. The stored value still goes through
`readTheme` on the way, because it was attacker-writable while it existed and
being on its way out does not make it trustworthy.

**Only that key is removed.** History lives in IndexedDB and settings under
their own key; a migration that swept `localStorage` would destroy data it was
never asked about.

### 5.5 Pre-paint theme bootstrap

A small synchronous script, before the app bundle, reads the theme and sets CSS
custom properties on `<html>`. This eliminates the flash of default theme. From
M15 it reads the **URL** first and the legacy key second.

**It must be a same-origin script file, not an inline `<script>`**, because
`script-src 'self'` forbids inline scripts and we are not weakening the CSP for
a cosmetic fix.

It carries a copy of the preset palette, because a URL usually names a preset
and nothing else — without it, `?theme=crimsonNight` would paint green for one
frame and then correct itself, which is the flash the file exists to prevent.
That copy is a third place the palette lives, so `tests/unit/theme/bootstrap.test.ts`
reads the file as text and fails if it disagrees with the domain on any preset,
parameter name, allowlist, schema version or size cap.

### 5.6 Validation on read

Always, and now more than before. `localStorage` was attacker-writable; a URL
is attacker-*authored* — anyone can send anyone a link, which is a far easier
attack to mount. Every parameter goes through `readTheme`, the same total
allowlisting validator every persisted theme has passed through since M8, and
`applyTheme` accepts nothing else. Detailed in `05_SECURITY.md` §2.2 and §20.

---

## 6. Quota management

### 6.1 Budget

| Layer | Budget |
|---|---|
| Hard entry cap | 500 entries |
| Per-entry input cap | 100 000 chars (truncated, flagged) |
| Soft total budget | 50 MB |
| Browser quota | Typically 10 MB–60% of free disk; **not knowable in advance** |

We do not rely on `navigator.storage.estimate()` for correctness — it is an estimate, is coarse in some browsers, and is deliberately fuzzed in others. It is used only to display a usage bar and to trigger early pruning.

**As built at M7:** the entry cap and the per-entry cap are enforced, and
`QuotaExceededError` drives pruning. The **soft 50 MB budget is not enforced**
and the estimate is shown but does not trigger anything. Pruning on a fuzzed
number would mean deleting a user's entries because of a figure the browser
declined to be precise about; `QuotaExceededError` is the one signal that is
not a guess, and it arrives in time to act on. The estimate is displayed in
the drawer, worded as approximate, because "how much is this using?" is a
reasonable question even when the answer is imprecise.

### 6.2 Pruning

Triggered on: entry count > 500, estimated usage > 50 MB, or a `QuotaExceededError`.

Order: unpinned entries only, oldest `lastOpenedAt` first, in a single transaction, 10% of entries at a time. **Pinned entries are never pruned.** If pruning cannot free space because everything is pinned, auto-capture is disabled with an explicit message rather than silently failing forever.

### 6.3 Failure handling

| Failure | User-visible behaviour |
|---|---|
| `QuotaExceededError` | Prune → retry once → **capture suspends** with the reason and an explicit *Resume saving* control in the drawer. Implemented at M7; the message is in the drawer rather than a toast, because there is no toast system and a message about storage belongs beside the storage. |
| IDB unavailable | Startup notice "History is unavailable in this browser mode. Everything else works." Memory repository takes over. |
| DB fails to open (corrupt) | Notice + memory mode + an explicit **Reset history database** action. **We never auto-delete.** Implemented at M7: the action appears only on a `CORRUPT` error, states that it discards what the database still holds, and is the single place in the feature that destroys data it cannot show the user first. |
| Upgrade blocked by another tab | "Close other SyntaxLab tabs to finish updating." Retry on `versionchange`. |
| Write fails mid-transaction | IDB transactions are atomic; the entry simply is not saved. Toast, no partial state. |

The rule across all of these: **a storage failure degrades history, never the application.** The current input in the editor is React state and survives every storage failure.

---

## 7. Migrations

### 7.1 IDB version upgrade

```ts
openDB('syntaxlab', DB_VERSION, {
  upgrade(db, oldVersion, newVersion, tx) {
    if (oldVersion < 1) { /* create stores + indices */ }
    // if (oldVersion < 2) { … additive changes only where possible … }
  },
  blocked()        { notifyUser('Close other SyntaxLab tabs to finish updating.'); },
  blocking()       { db.close(); notifyUser('A new version is ready — reload.'); },
  terminated()     { switchToMemoryRepository(); reportStorageError('CORRUPT'); },
});
```

### 7.2 Record-level migration

Independent of DB version, applied lazily on read:

```ts
const RECORD_MIGRATIONS: Record<number, (r: any) => any> = {
  1: (r) => r,
  // 2: (r) => ({ ...r, schemaVersion: 2, newField: default }),
};
```

Rules (restating `03_DOMAIN_MODEL.md` §8.2 because this is where they are implemented): pure, idempotent, total, fixture-tested. A migration that throws on one record quarantines that record and continues; it never aborts the upgrade.

### 7.3 Forward compatibility

A record whose `schemaVersion` exceeds what this build understands is **kept, hidden from the list, and reported** ("2 entries were created by a newer version and are hidden"). Old code destroying newer data is how users lose everything by opening a stale tab.

---

## 8. Export and import

### 8.1 Format

```jsonc
{
  "format": "syntaxlab-export",
  "formatVersion": 1,
  "generatedAt": "2026-08-17T10:30:00.000Z",
  "appVersion": "1.0.0",
  "entryCount": 42,
  "entries": [ /* HistoryEntry[] */ ],
  "preferences": { "theme": { /* … */ }, "settings": { /* … */ } }   // optional, user's choice
}
```

Plain UTF-8 JSON. Human-readable and inspectable on purpose — a privacy-first tool should not hand the user an opaque blob of their own data.

### 8.2 Export options

The user chooses: history only, preferences only, or both; and all entries or pinned only. A notice states the file is unencrypted plaintext.

### 8.3 Import

Full validation pipeline in `05_SECURITY.md` §10.2. Behaviour summary: merge or replace (user's choice, previewed with counts), duplicate `id`s resolved by keeping the newer `lastOpenedAt`, invalid entries skipped and counted, a report shown afterwards (`38 imported, 2 skipped, 1 updated`).

---

## 9. Retention and deletion

| Action | Effect |
|---|---|
| Delete one entry | Removed immediately; a 5-second undo toast holds it in memory before the transaction commits |
| Clear all | Confirmation dialog naming the count; wipes the `history` store |
| Clear everything | Also clears preferences and unregisters the service worker + caches — a genuine "leave no trace" action |
| Automatic pruning | Unpinned only, oldest-first, as in §6.2 |
| No time-based expiry | Entries are not deleted on a schedule. Silent time-based deletion of a user's own data would be surprising. |
| Browser-side eviction | Under storage pressure a browser may evict the origin. `navigator.storage.persist()` is requested **after the user creates their third entry** — asking on first load is a permission prompt with no earned context, and gets denied. |

### 9.1 Persistence is not a guarantee — and we must not imply it is

**We do not promise indefinite local persistence, in the UI or in the documentation.** Browser storage can disappear without the user or the application doing anything wrong:

| Cause | Notes |
|---|---|
| Storage-pressure eviction | Browsers evict origin data when the disk fills. `persist()` reduces but does not remove the risk, and the permission can be denied. |
| Safari / iOS ITP | Script-writable storage may be cleared after roughly seven days without interaction — a realistic loss scenario for an occasional-use developer tool. |
| User action | Clearing site data, clearing browsing data, using a private window, or using a different browser or profile. |
| Enterprise policy | Managed browsers may clear storage on exit. |
| Corruption | A failed database is recoverable only by reset. |

**Consequences for the product:**

1. **Export exists partly for this reason.** It is the only durable backup path available to a client-only application, and the help text says so.
2. **The wording is "saved in this browser", never "saved forever" or "your data is safe here".**
3. **History is a convenience, not a system of record.** No feature is designed on the assumption that an entry will still be there.
4. **The first-run notice mentions eviction** (§4.2), so the expectation is set before the user relies on it.

---

## 10. Multi-tab behaviour

| Concern | Handling |
|---|---|
| Concurrent writes | IDB transactions serialise them |
| Stale lists | `BroadcastChannel('syntaxlab')` publishes `history-changed`; open tabs refetch |
| Upgrade blocked | `blocking()` closes the old connection and prompts a reload |
| Preference divergence | `storage` events sync theme/settings across tabs live |
| Duplicate entries from two tabs | Dedupe is keyed on `(type, input)` within 60 s and applies regardless of origin tab |

---

## 11. Testing

> **Built at M7.** Where the implementation departs from this document, the
> departure is recorded inline above rather than by quietly editing the
> specification. In summary: `by-pinned` cannot exist (booleans are not IDB
> keys), three `meta` keys are not written because nothing reads them, the soft
> byte budget is not enforced, and `idb` was not adopted
> (`16_DEPENDENCIES.md` §2.3).


| Area | Test |
|---|---|
| CRUD | Round-trip every field; verify indices return correct ordering |
| Query | Filter by type, search, pinned; pagination cursors |
| Dedupe | Same input twice inside and outside the 60 s window |
| Quota | Inject `QuotaExceededError`; assert prune → retry → graceful disable |
| Corruption | Seed malformed records; assert quarantine, no crash, list still renders |
| Migration | Fixture files from every prior schema version; assert idempotence |
| Forward compat | Seed a `schemaVersion: 99` record; assert preserved and hidden |
| Unavailable | Stub `indexedDB` as undefined; assert memory mode and the notice |
| Multi-tab | Two contexts writing concurrently; assert consistency and invalidation |
| Import/export | Round-trip; hostile files per `05_SECURITY.md` §10.2 |
| Pre-paint theme | Assert no flash: computed background is correct on first paint |

---

## 12. M8 — theme persistence as built

`syntaxlab.theme.v1` holds the whole `ThemePreferences` object as JSON.
localStorage rather than IndexedDB, for one reason: the theme has to be
applied **before the first paint**, and an async read cannot do that
(ADR-007).

### 12.1 The pre-paint sequence

```mermaid
sequenceDiagram
    participant B as Browser
    participant BS as theme-bootstrap.js
    participant LS as localStorage
    participant R as :root style
    participant APP as App bundle
    participant TC as ThemeControls

    B->>BS: blocking <script src>, before the bundle
    BS->>LS: getItem('syntaxlab.theme.v1')
    LS-->>BS: string | null
    alt absent, unparseable, or storage throws
        BS-->>R: nothing written — tokens.css defaults stand
    else present
        BS->>BS: JSON.parse in try/catch
        BS->>BS: schemaVersion known?
        BS->>BS: validate each field (reject, never clamp)
        BS->>R: setProperty for each field that passed
    end
    Note over B,R: first paint happens here — correct theme, no flash

    B->>APP: load bundle
    APP->>LS: readStored() → readTheme()
    APP->>TC: mount
    TC->>R: applyTheme(state) — makes the DOM agree with app state
```

The last step is not redundant. The bootstrap may have written nothing —
storage blocked by policy, a theme from a newer build, a field that failed —
and the application must not assume the DOM matches the state it holds.

### 12.2 Why the bootstrap duplicates the validator

`public/theme-bootstrap.js` restates the rules in
`src/domain/theme/preferences.ts`. It has to: it runs with no module system,
no build output and no imports.

The duplication is a genuine risk, held in check from both ends:

- the rules are **reject, never clamp**, identical to the domain. A bootstrap
  that clamped `100000` to `359` while the domain reset it to `135` would
  paint one theme and replace it a moment later — a flash caused by nothing
  but disagreement between two copies of one rule.
- `tests/e2e/theme.spec.ts` drives eighteen hostile payloads through this file
  in three real browsers and asserts the computed styles.

The file is served verbatim, so every byte — comments included — ships to
every user. It is **1.64 KB gzipped** and the long rationale lives in
`09_DESIGN_SYSTEM.md` §11 rather than in the file.

### 12.3 Failure behaviour

| Failure | Behaviour |
|---|---|
| Key absent | Defaults. First visit is the normal case, not an error. |
| Unparseable JSON | Defaults. `readTheme` never throws. |
| `localStorage` throws on read | Defaults. Private mode and enterprise policy both do this. |
| `localStorage` throws on write | The theme applies for the session and is not saved. Not reported: the user can see their theme working, and a toast about a preference not persisting is noise. |
| One field corrupt | That field's default; every other field survives. |
| `schemaVersion` newer | The whole stored theme is ignored — see `09_DESIGN_SYSTEM.md` §11.2. |

**None of these can affect Regex, JSON or History.** The theme is applied by
writing custom properties; a failure means the default properties stand.

### 12.4 Writes are debounced, the paint is not

A slider drag repaints on every frame and writes once. Measured: a 21-step
drag produces **one** `localStorage` write (`12_PERFORMANCE.md` §10.9).
`flushTheme` runs on `visibilitychange` and `pagehide` so a change made in the
last 250 ms before the tab closes is not lost. Reset writes immediately —
it is a deliberate act, not a drag.

### 12.5 Theme and history are separate

Theme is a global preference in localStorage. A `HistoryEntry` has no theme
field, and `06_DATA_STORAGE.md` §2.1 does not define one. Restoring a history
entry does not touch the theme, and changing the theme does not rewrite a
saved analysis. An E2E test plants an entry, changes the theme, and asserts
that no theme vocabulary appears anywhere in the IndexedDB records.
