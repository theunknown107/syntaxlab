# 12 — Performance

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

> **No invented benchmark numbers.** Every figure below is either a **budget** (a CI-enforced threshold), a **target** (where we intend to sit), or a **limit** (an enforced constraint). Nothing here is a measured result. Measurements are recorded in §10 and are the only authority — first entry due at **Milestone 1**.

---

## 1. Why performance is a feature here

The product competes with "open a browser tab and paste". If SyntaxLab is not faster than the alternative, it has no reason to exist. Slowness is not a polish issue for this product; it is a correctness-of-premise issue.

Second reason: this tool's inputs are user-supplied and can be adversarial. Performance work here overlaps directly with denial-of-service defence.

---

## 2. Budgets

> **Scope note (Phase 1.5).** V1.0 is Regex + JSON; the cron chunk arrives in V1.1. Share/compression code is deferred, so it is not in the V1.0 budget.

### 2.1 How budgets are treated — read this before the numbers

The Phase 1 draft presented an estimated total of ~198 KB against a 200 KB budget as though that were headroom. **It is not.** Two kilobytes is measurement noise, and treating an estimate as a result is how budgets get quietly broken.

The revised planning stance:

| Term | Meaning |
|---|---|
| **Hard budget: 200 KB gz initial JS** | A CI failure threshold. Crossing it fails the build. It is the point at which we stop and think, not a target to approach. |
| **Target operating region: ≤ 170 KB gz** | Where the build should actually sit. This leaves real room for a feature, a fix, or a dependency bump without an emergency. |
| **Estimates** | Planning inputs only. They are not evidence and they never satisfy a criterion. |
| **Measurements** | The only authority. A production build measured with `rollup-plugin-visualizer` is the number that counts. |

**Nothing about the bundle is decided before it is measured.** Specifically, the Phase 1 note that we would "switch to Preact if the estimate is exceeded" is withdrawn as a plan: swapping a framework on the strength of an estimate would be optimising before observing.

### 2.2 The order of operations

```
build  ->  measure  ->  analyse  ->  optimise  ->  measure again
```

1. **Build.** Produce a real production bundle (first done at M1, then at every milestone).
2. **Measure.** Record actual gzipped sizes per chunk in §10.
3. **Analyse.** If over target, find out *what* is large and *why* — a treemap, not a guess. Common causes are unexpected: a barrel import pulling a whole package, a polyfill, a duplicated transitive dependency, a language mode imported eagerly.
4. **Optimise — smallest justified change first.** Escalation order:
   1. Fix accidental inclusion (barrel imports, eager imports that should be lazy, duplicate transitive versions)
   2. Split more aggressively / move something behind a lazy boundary
   3. Drop a feature-level dependency we can implement in less code (e.g. `@codemirror/search` in favour of searching the CST we already build)
   4. Reduce a feature's scope
   5. **Only then** consider a framework-level change such as Preact — and only with a measurement showing it is both necessary and sufficient
5. **Measure again.** An optimisation that is not re-measured did not happen.

**No dependency is removed before measuring.** "This package feels big" is not a reason; a treemap showing it costs 40 KB is.

### 2.3 Budget table

| Chunk | Hard budget (gz) | Target | Contents |
|---|---|---|---|
| Initial JS (entry + vendor + CM core) | **200 KB** | ≤ 170 KB | Shell, stores, one editor |
| CSS | 20 KB | ≤ 15 KB | Tokens + all component styles |
| Fonts | 45 KB | ≤ 40 KB | Two subsetted woff2 |
| `regex` chunk | 25 KB | — | |
| `json` chunk | 35 KB | — | Includes CM JSON language |
| `history` chunk | 15 KB | — | |
| `theme` chunk | 10 KB | — | |
| `analysis.worker` | 40 KB | — | Regex + JSON parsers and explainers (V1.0) |
| `exec.worker` | 3 KB | — | Deliberately tiny — it gets killed regularly |
| `cron` chunk *(V1.1)* | 30 KB | — | Not in the V1.0 build |
| **Total precache** | **2 MB** | ≤ 1.5 MB | Enforced by the PWA build step |

CI fails the build when a hard budget is exceeded, and reports a warning when a target is exceeded. A budget that is not enforced is a wish; a target that is not reported is ignored.

### 2.4 The known pressure point

CodeMirror is expected to dominate the initial bundle. That expectation is why the dependency list is short (`16_DEPENDENCIES.md`) and why every addition is measured against remaining headroom rather than against the hard budget.

**This is flagged as R-05 in `23_RISK_REGISTER.md` and its first real measurement is a Milestone 1 deliverable**, not a Milestone 13 discovery. Finding out at the end that the budget never fitted would be the expensive version of this problem.

### 2.5 Runtime targets

| Metric | Target | Rationale |
|---|---|---|
| First Contentful Paint (cold, Fast 3G, mid-tier laptop) | < 1.5 s | Lighthouse "good" threshold |
| Largest Contentful Paint | < 2.0 s | |
| Time to Interactive | < 2.5 s | |
| Cumulative Layout Shift | < 0.05 | Skeletons match final layout |
| Interaction to Next Paint | < 200 ms | Typing must never feel laggy |
| Warm load (SW cache) | < 300 ms to interactive | The common case |
| Keystroke → editor paint | < 16 ms | One frame |
| Analysis round trip (typical input) | < 100 ms | Debounce dominates perception |
| Analysis round trip (1 MB JSON) | < 500 ms | In-worker; UI stays responsive |
| Longest main-thread task | < 50 ms | Nothing blocks input handling |
| History list render (50 entries) | < 50 ms | |
| Theme change → repaint | < 50 ms | CSS-variable write, no re-render |

These are targets to be **verified by measurement**, not assumptions.

### 2.6 Lighthouse gates

Performance ≥ 95 · Accessibility ≥ 95 · Best Practices ≥ 95 · SEO ≥ 90 · PWA installable. Run against a production build in CI; a drop below gate fails the PR.

---

## 3. Rendering strategy

### 3.1 The keystroke path — the one that matters

Typing must never involve React re-rendering the analysis tree. The chain:

```
keystroke
  → CM6 updates its own document (internal, incremental, no React)
  → onChange writes to workspaceStore.input
  → ONLY the editor component subscribes to `input`  ← the critical constraint
  → debounce 200 ms
  → worker analysis
  → result written to store
  → analysis pane re-renders ONCE
```

If the analysis pane ever subscribes to `input`, typing performance collapses. This is enforced by a test that counts renders while typing 100 characters and asserts the analysis pane rendered ≤ 2 times.

### 3.2 Debouncing

Adaptive, because a fixed value is wrong at both ends of the size range:

| Input size | Debounce | Mode |
|---|---|---|
| < 1 KB | 150 ms | Auto |
| 1–50 KB | 300 ms | Auto |
| 50–500 KB | 600 ms | Auto |
| 500 KB–5 MB | — | **Manual** — an explicit Analyze button |
| > 5 MB | — | Rejected with a size message |

Above 500 KB, auto-analysis wastes work on every keystroke of a paste-and-edit cycle. An explicit button is both faster and more honest about what is happening.

Debounce is on the **trailing** edge with no leading call, and it is cancelled on unmount and on mode change.

### 3.3 Virtualisation — only where measured

| Surface | Virtualised? |
|---|---|
| JSON tree | ✅ above 500 visible rows |
| Regex AST tree | ❌ — realistic patterns produce tens of nodes |
| Match table | ✅ above 200 rows |
| Token table | ❌ — bounded by pattern length |
| History list | ❌ — paginated at 50 |
| Next runs | ❌ — 10 rows |

Virtualising a 30-row list adds complexity, breaks `Ctrl+F`, and complicates screen-reader navigation for no gain.

### 3.4 Re-render discipline

- Selector subscriptions everywhere (`11_STATE_MANAGEMENT.md` §3)
- `React.memo` only on components proven expensive by profiling
- Stable keys (entry ids, not indices)
- No object/array literals in props of memoised children
- No expensive derivation in render — memoise or precompute in the worker

---

## 4. Worker strategy

Everything expensive is off the main thread:

| Work | Thread |
|---|---|
| Tokenising, parsing, explanation generation | Analysis worker |
| Regex execution | Execution worker |
| Cron next-run computation | Analysis worker |
| Detection heuristics | Main (bounded to a 1 KB sample — cheaper than the postMessage round trip) |
| JSON formatting | Analysis worker above 100 KB, main below |
| Tree rendering | Main (it is DOM work) |

### 4.1 Transfer cost is real

`postMessage` copies. A 5 MB string costs a structured clone in each direction and is not free.

Mitigations:
- Workers are started **once** and reused; startup is ~10–30 ms
- Only the input string goes in; only the compact result comes back
- The result is deliberately compact — no source text is echoed back, only spans into the original the main thread already holds
- The 5 MB input limit caps transfer cost
- Above 1 MB, transfer is measured and reported in dev builds; if it becomes the bottleneck, chunked transfer or `SharedArrayBuffer` is the next step (`SharedArrayBuffer` needs COOP/COEP, which we already set — see `05_SECURITY.md` §4.4)

### 4.2 Startup

Workers spawn **after first paint**, on idle, not during module initialisation. A worker constructed at import time delays interactivity for a capability the user may not need for several seconds.

---

## 5. Loading strategy

### 5.1 Critical path

```
index.html (≈2 KB)
  └─ theme-bootstrap.js (<1 KB, blocking — deliberately, to prevent a theme flash)
  └─ main.js  (preload)
  └─ main.css (preload)

After paint, on idle:
  - service worker registration
  - analysis worker spawn
  - IndexedDB open + first history page
  - prefetch json/cron chunks
```

The single blocking script is the theme bootstrap, and it is under 1 KB. A flash of the wrong theme on every load is a worse experience than 1 KB of blocking script.

### 5.2 Fonts

Self-hosted, subsetted, `woff2`, `font-display: swap`, preloaded, and precached. A system-font fallback stack is metric-matched closely enough that the swap does not cause a visible reflow.

### 5.3 Code splitting

Per `10_COMPONENT_ARCHITECTURE.md` §6. Rules: split at mode boundaries and overlay boundaries; do not split anything under 10 KB (the request overhead exceeds the saving); prefetch on idle only what is likely (modes), not what is speculative (drawers).

---

## 6. Large-input strategy

| Size | Behaviour |
|---|---|
| < 50 KB | Auto-analyse, full features, no warnings |
| 50–500 KB | Auto-analyse with a longer debounce; tree collapsed beyond depth 2 by default |
| 500 KB–2 MB | Manual analyse; a size notice; tree virtualised; search debounced further |
| 2–5 MB | Manual analyse; explicit warning that it may take a moment; progress indicator with Cancel |
| > 5 MB | Rejected before parsing, with the actual size shown |

Additional protections at scale: node cap (500k), depth cap (500), match cap (10k) — all from `05_SECURITY.md` §6.

---

## 7. Memory

| Concern | Control |
|---|---|
| Duplicate copies of a large document | One copy in CM6, one in the store, one transient in the worker. Never more. Explicitly not kept in history for large inputs (truncated at 100k chars). |
| AST retention | Only the current analysis is retained; the previous result is dropped on new input |
| Worker leaks | Message handlers are removed with their requests; the exec worker is destroyed on timeout |
| Event-listener leaks | All listeners registered in `useEffect` return a cleanup |
| CM6 lifecycle | `EditorView.destroy()` on unmount, always |
| History cache | One page (50 entries) in memory, not the whole store |
| Detached DOM | Verified by a heap snapshot before release: open/close each drawer 20 times and confirm node count returns to baseline |

---

## 8. Measurement plan

### 8.1 In CI, every PR

| Check | Tool | Gate |
|---|---|---|
| Bundle size per chunk | `rollup-plugin-visualizer` + a size script | Fails over budget |
| Lighthouse | Lighthouse CI on the production build | Fails below gate |
| Long tasks during a scripted session | Playwright + PerformanceObserver | Fails on any task > 50 ms |
| Parser microbenchmarks | Vitest bench | Fails on > 20% regression vs baseline |
| Render counts on the typing path | RTL + a render counter | Fails if the analysis pane re-renders while typing |

### 8.2 Manual, before release

- Chrome Performance profile of a full session on a throttled CPU (4× slowdown)
- Memory heap snapshots before and after heavy use
- Real-device test: mid-range Android, Safari on iOS, Firefox on desktop
- Offline warm-load timing
- 5 MB JSON end-to-end with the profiler open

### 8.3 What we deliberately do not do

**No Real User Monitoring, no performance beacons, no analytics.** `connect-src 'none'` forbids it and the privacy promise forbids it. We measure in CI and in the lab. This is a genuine trade: we will not learn about performance problems that only appear on hardware we do not own. Accepted, and recorded as **R-13** in `23_RISK_REGISTER.md`.

---

## 9. Performance checklist for every PR

```
[ ] No new dependency, or a new one with a measured size and a written justification
[ ] Bundle budgets still pass
[ ] No new blocking resource on the critical path
[ ] Expensive work runs in a worker
[ ] New lists over 500 rows are virtualised
[ ] Store subscriptions use selectors
[ ] No new work in a render path
[ ] Effects clean up
[ ] Large-input path considered
[ ] Lighthouse gates still pass
```

---

## 10. Measured results

**This is the authoritative record.** Nothing elsewhere in the documentation may claim a size or timing that is not recorded here.

### 10.1 M1 — application shell

Production build, `vite build`, gzipped. Measured 2026-08-18.

| Asset | Raw | **Gzipped** |
|---|---|---|
| `assets/index-*.js` | 148.41 KB | **47.05 KB** |
| `assets/index-*.css` | 12.79 KB | **3.30 KB** |
| `index.html` | 2.86 KB | 1.35 KB |
| `theme-bootstrap.js` | 2.71 KB | 1.25 KB |
| **Total deployed** | | **53.55 KB** |

| Budget | Measured | Target | Hard | Status |
|---|---|---|---|---|
| Initial JS | 48.30 KB | 170 KB | 200 KB | ✅ ok |
| CSS | 3.30 KB | 15 KB | 20 KB | ✅ ok |
| Total precache | 53.55 KB | 1.5 MB | 2 MB | ✅ ok |

### 10.2 What this measurement does NOT prove

**It does not validate the 200 KB budget.** The M1 build contains React and the shell. It does **not** contain CodeMirror, which is expected to be the single largest dependency in the project and is installed at M4 where the editor is built (`16_DEPENDENCIES.md` §1.1).

Read plainly: **48 KB of the budget is spent and the largest item has not arrived.** The remaining headroom against the 170 KB target is roughly 122 KB, and the CodeMirror estimate is ~150 KB — which would exceed it.

**The budget-critical measurement is M4.** Reporting the M1 number as comfortable would be exactly the estimate-as-evidence error this section exists to prevent. Tracked as **R-05**.

### 10.3 M2 — worker infrastructure

Bundle impact is negligible: the workers are separate chunks, not part of the
initial payload.

| Asset | Raw | Gzipped |
|---|---|---|
| `assets/index-*.js` (initial, unchanged) | 148.41 KB | 47.05 KB |
| `assets/analysis.worker-*.js` | 1.44 KB | — |
| `assets/exec.worker-*.js` | 1.27 KB | — |
| **Total deployed** | | **54.78 KB** |

Worker timings, Chromium, dev server (unminified — production cold start will
be lower):

| Measurement | Value | Note |
|---|---|---|
| Cold start (first request incl. construction + module load) | **29 ms** | Paid once |
| Warm round trip, median of 20 | **< 0.1 ms** | |
| Warm round trip, max of 20 | **0.2 ms** | |
| Timeout detection and settle (2000 ms deadline) | **2011 ms** | 11 ms overhead |
| First request after respawn | **7 ms** | vs 29 ms cold — confirms the replacement was already warm |

The last row is the measurement that justifies eager respawn: a lazily created
replacement would have cost the user a further ~29 ms on top of the 2 s they
had just waited.

### 10.4 M3 — regex parser latency

Measured 2026-08-18, Node 22 under Vitest, median of 25 runs per case. These
are parse + explain only; nothing is executed.

| Case | Input | Median |
|---|---|---|
| Typical short — `^[A-Z][a-z]+$` | 13 ch | **0.022 ms** |
| Typical medium — password rule with lookaheads | 37 ch | **0.050 ms** |
| Typical long — email shape | 28 ch | **0.030 ms** |
| URL matcher | 38 ch | 0.054 ms |
| 100 capture groups | 300 ch | 0.625 ms |
| Large valid pattern | 1 000 ch | 0.410 ms |
| Large valid pattern | 5 000 ch | 1.268 ms |
| **At the 10 000-character limit** | 10 000 ch | **2.558 ms** |
| Large character class | 1 002 ch | 0.279 ms |
| Deep nesting, under the cap | 199 ch | 2.941 ms |
| Deep nesting, over the cap | 1 001 ch | 2.970 ms |
| **Malformed — 2 000 unclosed groups** | 2 000 ch | **3.763 ms** (worst observed) |
| Malformed — 2 000 backslashes | 2 000 ch | 0.417 ms |
| Malformed — 500 unclosed classes | 1 500 ch | 0.576 ms |
| Adversarial shape `(a+)+$` | 6 ch | 0.008 ms |
| **Mixed-corpus throughput** | — | **~117 000 analyses/sec** |

**Scaling is approximately linear** across the valid-input range: 1 000 ch →
0.41 ms, 5 000 ch → 1.27 ms, 10 000 ch → 2.56 ms. No superlinear blow-up
appears, which is the property that matters — a parser that itself backtracks
catastrophically would defeat the point of the whole architecture.

**Worst observed case is 3.8 ms**, on deliberately malformed input at the
practical size limit. That is far below the 100 ms round-trip target in §2.5
and imperceptible next to the 150–300 ms debounce, so parse latency is not a
factor in the typing path.

**Not measured here:** regex *execution*, which is M4 and is the only unbounded
operation in the product (§7 of `04_PARSER_ARCHITECTURE.md`).

### 10.5 Measurement log

| Date | Milestone | Initial JS (gz) | CSS (gz) | Total (gz) | Notes |
|---|---|---|---|---|---|
| 2026-08-18 | M1 | 48.30 KB | 3.30 KB | 53.55 KB | Shell only. **No CodeMirror** — see §10.2 |
| 2026-08-18 | M2 | 49.52 KB | 3.30 KB | 54.78 KB | + worker chunks (separate, not initial) |
| 2026-08-18 | M3 | 59.54 KB | 3.30 KB | 64.79 KB | Entry chunk **47.05 KB**, unchanged by M3. The +10.64 KB is the analysis-worker chunk, which now carries the regex domain (34.6 KB raw). `check-size.mjs` counts every JS asset toward "initial JS", so the worker chunks are charged to the budget even though the browser fetches them separately — deliberately conservative. |
| — | M4 | — | — | — | First budget-meaningful measurement |

---

## 11. Known performance risks

| Risk | Impact | Mitigation |
|---|---|---|
| CodeMirror consumes most of the initial budget | Limited headroom for everything else | Measure at M1; aggressive splitting; lazy language modes; hard dependency-review gate; escalation ladder in §2.2 |
| A 5 MB structured clone is slow on low-end devices | Perceived hang despite the worker | Measure; consider chunked transfer; the size limit caps the worst case |
| The JSON tree can produce hundreds of thousands of nodes | Memory pressure | Node cap, virtualisation, collapsed-by-default at depth |
| *(V1.1)* Timezone handling for cron | Adds to the cron chunk | V1.1 supports browser-local and UTC only, so no zone list is shipped at all |
| Font loading | FOUT | Metric-matched fallback, preload, `swap` |
| Worker startup on first analysis | ~30 ms one-off delay | Spawn on idle after first paint |
