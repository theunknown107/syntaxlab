# Implementation Status

**Project:** SyntaxLab
**Phase:** 2 — implementation
**Current milestone:** M2 complete → M3 next (awaiting approval)
**Last updated:** 2026-08-18

> Living document, updated at the end of every milestone. The architecture
> package in [`docs/`](docs/) remains the source of truth; this file records
> what has actually been built and what was decided along the way.

---

## Release scope (locked, `docs/22_OPEN_QUESTIONS.md` D-01)

| Release | Scope | Status |
|---|---|---|
| **V1.0** | Regex · JSON · history · theme · PWA · a11y · security · tests · perf | **In progress** |
| V1.1 | Cron — standard 5-field only | Not started, **must not enter V1.0** |
| V1.2+ | Share URLs, JSONC/JSON5, other flavours | Deferred, unscheduled |

---

## Milestone progress

| # | Milestone | Status |
|---|---|---|
| M0 | Bootstrap planning | ✅ Complete |
| M1 | Tooling, design tokens, shell | ✅ Complete |
| M2 | Worker infrastructure | ✅ **Complete** |
| M3 | Regex domain | ⬜ Next |
| M4 | Regex UI | ⬜ |
| M5 | JSON domain | ⬜ |
| M6 | JSON UI | ⬜ |
| M7 | History and storage | ⬜ |
| M8 | Theme customisation | ⬜ |
| M9 | PWA and offline | ⬜ |
| M10 | Accessibility and security hardening | ⬜ |
| M11 | Performance measurement | ⬜ |
| M12 | Integration, E2E, release QA | ⬜ |
| M13 | V1.0 release | ⬜ |

---

## M1 — objective and outcome

**Objective:** the minimal production-quality foundation the rest of SyntaxLab
is built on. No feature logic.

**Outcome:** met. Every M1 task (1.1–1.14) is implemented, with two documented
deviations (§Deviations).

### Verification

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ clean |
| ESLint | `npx eslint .` | ✅ clean |
| Stylelint | `npx stylelint "src/**/*.css"` | ✅ clean |
| Prettier | `npm run format:check` | ✅ clean |
| Unit tests | `npm test` | ✅ **47 passed** (6 files) |
| E2E + a11y | `npm run test:e2e` | ✅ **7 passed** (Chromium, production build) |
| Production build | `npm run build` | ✅ 578 ms |
| Bundle budget | `npm run size` | ✅ within target |
| Dependency audit | `npm audit --audit-level=high` | ✅ **0 vulnerabilities** |

### Bundle measurement — actual, not estimated

| Asset | Raw | Gzipped |
|---|---|---|
| JS | 148.41 KB | **47.05 KB** |
| CSS | 12.79 KB | **3.30 KB** |
| HTML + bootstrap | 5.57 KB | 2.60 KB |
| **Total deployed** | | **53.55 KB** |

Budget: target ≤ 170 KB, hard 200 KB. **Currently 48.30 KB initial JS.**

> ⚠️ **This does not validate the budget.** The M1 build contains no
> CodeMirror, which is expected to be the largest dependency and arrives at
> M4. Roughly 122 KB of target headroom remains against a ~150 KB estimate.
> **The budget-critical measurement is M4.** Recorded in
> `docs/12_PERFORMANCE.md` §10.2 and tracked as risk R-05.

---

## M2 — objective and outcome

**Objective:** the async computation boundary exists and is proven safe before
any parser is written against it.

**Outcome:** met, including the **R-10 risk checkpoint on all three engines**.

### Verification

| Check | Result |
|---|---|
| Typecheck | ✅ clean |
| ESLint / Stylelint / Prettier | ✅ clean |
| Unit tests | ✅ **107 passed** (8 files, +60 from M2) |
| E2E | ✅ **38 passed** across 4 projects |
| Production build | ✅ 722 ms |
| Bundle budget | ✅ 49.52 KB initial JS |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilities |
| Banned-API scan | ✅ none |

### R-10 risk checkpoint — PASSED

An execution worker was pinned by a busy loop — a thread that genuinely cannot
yield or process messages, which is the condition catastrophic backtracking
creates — then timed out, terminated, and respawned.

| Assertion | Chromium | Firefox | WebKit |
|---|---|---|---|
| Terminated at the deadline | ✅ | ✅ | ✅ |
| Replacement serves the next request | ✅ | ✅ | ✅ |
| Settles at the deadline, not after the task | ✅ | ✅ | ✅ |
| Survives three consecutive timeouts | ✅ | ✅ | ✅ |
| **Analysis worker unaffected, still `ready`** | ✅ | ✅ | ✅ |
| **Main thread interactive while pinned** | ✅ | ✅ | ✅ |

**All three browsers ran locally.** No engine is reported as untested.

### Worker measurements (Chromium, dev server)

| Measurement | Value |
|---|---|
| Cold start (construction + module load) | 29 ms |
| Warm round trip (median / max of 20) | < 0.1 ms / 0.2 ms |
| Timeout settle against a 2000 ms deadline | 2011 ms |
| First request after respawn | **7 ms** vs 29 ms cold |

The last row is the evidence for eager respawn: a lazily created replacement
would have cost the user another ~29 ms after already waiting 2 s.

### Architecture built

```
Main thread ── WorkerClient ─┬─ Analysis worker   long-lived,  timeout ≠ terminate
                             └─ Exec worker       disposable,  timeout → terminate + respawn
```

Both clients are the same class with different lifecycle policies, because the
only real difference is what a deadline does.

### Dependencies added at M2

**None.** Built entirely on platform APIs: `Worker`, `postMessage`,
`structuredClone`, `setTimeout`. A worker-RPC library was considered and
rejected — it would abstract away the lifecycle control M2 exists to establish.

### Deviations at M2

| # | Deviation | Reason |
|---|---|---|
| D4 | **A development-only worker harness was added** (`src/app/devWorkerHarness.ts`) | M2 has no product surface that triggers a timeout — the regex tester is M4 — but R-10 had to be proven in real browsers now. Guarded by `import.meta.env.DEV`, dropped by the minifier, and `shell.spec.ts` asserts it is absent from the production bundle. |
| D5 | **Playwright now runs two servers** | Worker specs need the dev-only harness, so they run against the dev server; shell specs stay on the production build, where the CSP and chunking exist. |

### Known limitations at M2

- The analysis worker's operations are **stubs** (`ping`, `echo`). They prove
  the boundary and are labelled as such; real parsing arrives at M3 and M5.
- `exec.spin` is an infrastructure test primitive, never exposed in the UI.
- Workers are **not yet used by the application**. Nothing in the shell calls
  them, so the production build ships the chunks but never fetches them. That
  changes at M4.
- Capability detection checks for `Worker` presence; genuine construction
  failure is handled by `WorkerClient.start()` returning `UNAVAILABLE`. The
  reduced-safety UI indicator is wired at M4, when there is a feature to
  disable.

---

## Dependencies added at M1

**Runtime: 2.** `react` and `react-dom`, both pinned exactly at 18.3.1.

**Dev: 25.** Vite, TypeScript, Vitest + Testing Library + happy-dom, Playwright
+ axe, ESLint + typescript-eslint + react-hooks/react-refresh/jsx-a11y/boundaries,
Stylelint, Prettier, rollup-plugin-visualizer.

Two versions were forced upward by security findings during install:

| Package | Change | Reason |
|---|---|---|
| `eslint-plugin-boundaries` | 5 → 7 | v5 pulled a vulnerable `handlebars` (1 critical, 2 high). Required migrating to the v7 `policies` API. |
| `happy-dom` | 17 → 20 | Critical VM-context-escape advisory. This is the DOM that later milestones run fuzzed input through. |

**Not installed:** no state library, router, UI kit, icon library, animation
library, date library, or validation library — and **no CodeMirror**, which
belongs to M4.

---

## Findings and fixes during M1

### 1. WCAG AA contrast failure in the design tokens *(real defect, fixed)*

`--gray-400` was documented as 4.9:1 against the base. Measured, it was
**4.45:1 on the base and 4.19:1 on surfaces** — both below the 4.5:1 AA
requirement for normal text. Muted text renders on both, so the surface is the
binding constraint.

Caught by the axe gate in the M1 E2E suite. Token corrected `#6b7d74` →
`#7a8d83` (5.20:1 on surfaces, 5.52:1 on base). The contrast table in
`docs/09_DESIGN_SYSTEM.md` §3.4 was replaced with **measured** values.

*The documented figures had been calculated by hand and one was wrong — the
same "estimates are not evidence" principle the performance section insists on
applies to contrast.*

### 2. CodeMirror milestone inconsistency *(doc corrected before installing)*

`16_DEPENDENCIES.md` assigned CodeMirror to M1; `20_IMPLEMENTATION_PLAN.md`
builds the editor at M4 and the M1 shell has no editor. Installing it at M1
would have added a dependency nothing imports and made the M1 bundle number
look good while proving nothing. Moved to M4 in the dependency doc, with the
measurement consequence stated.

### 3. Source maps would have been deployed *(fixed)*

`sourcemap: 'hidden'` still emits `.map` files into `dist/`, and Cloudflare
publishes `dist/` wholesale — so they would have shipped, contrary to
`17_DEPLOYMENT.md` §3.3. Now opt-in via `SOURCEMAP=1` for CI artefact builds.

### 4. Two dependency vulnerabilities *(fixed, see table above)*

---

## Deviations from the approved plan

| # | Deviation | Reason |
|---|---|---|
| D1 | **Self-hosted webfonts not implemented** (task 1.7). The token system ships complete system-font stacks instead. | Subsetting requires the licensed font binaries and a subsetting toolchain; fabricating or downloading unverified font assets would be worse than deferring. System stacks cost zero bytes and zero layout shift. Deferred to a later milestone with the CLS implication noted. |
| D2 | **CI workflow authored but never executed** (task 1.5). | No git remote exists (M0 decision D-07). Every job is runnable locally today and all pass. The workflow runs on first push. |
| D3 | `.gitattributes` added (not in the plan) | Without it a Windows checkout commits CRLF against Linux CI, contradicting `.editorconfig`. Noted at M0. |

---

## Known limitations at M1

- **No analysis of any kind.** The workspace renders the real layout and real
  empty states; parsers arrive M3/M5, the editor M4.
- **No worker infrastructure.** M2.
- **No persistence.** The theme bootstrap *reads* validated stored values, but
  nothing writes them until M8. History is M7.
- **Header actions absent** (history, theme, help). Deliberate: an inert button
  reads as broken, not as pending (`08_UI_UX_SPEC.md` §2.1).
- **Chromium only** in E2E. Firefox and WebKit are added at M12.
- **No PWA/service worker.** M9.

---

## Diagrams and documentation updated at M1

| Document | Change |
|---|---|
| `02_ARCHITECTURE.md` | Added §9.1 "Implemented at M1" (actual directory tree); added a diagram-status note marking the layer diagram as target-state |
| `09_DESIGN_SYSTEM.md` | Contrast table replaced with **measured** values; `--gray-400` corrected |
| `10_COMPONENT_ARCHITECTURE.md` | §2 now shows the shell tree as built, with per-milestone markers |
| `12_PERFORMANCE.md` | §10 populated with the real measurement + §10.2 stating what it does *not* prove |
| `13_TEST_PLAN.md` | Added the implemented-at-M1 suite summary and the defect it caught |
| `16_DEPENDENCIES.md` | CodeMirror moved M1 → M4; added §1.2 actual installed set and the two security upgrades |
| `17_DEPLOYMENT.md` | Node 22 pin (M0) |
| `22_OPEN_QUESTIONS.md` | D-07 (M0 decisions) |

**No Mermaid diagram was invalidated by M1.** The system-context, layer,
worker, user-flow, deployment, and trust-boundary diagrams all describe target
state that M1 did not contradict; the layer diagram now carries an explicit
status note pointing at what exists.

---

## Standing constraints

Violating any of these is a defect, not a shortcut.

- **No cron code during V1.0.** Not even a placeholder file.
- **No share-URL code during V1.0.**
- **No `eval`, `new Function`, or `dangerouslySetInnerHTML`** — enforced by
  ESLint *and* by a CI grep that an inline disable cannot silence.
- **No dependency outside `docs/16_DEPENDENCIES.md` §1.1** without the review.
- **No weakening the CSP to make something work** — escalate instead.
- **No absolute security claims** in code, copy, or docs.
- **Regex execution never on the main thread.** If workers are unavailable the
  tester is disabled, not relocated.
- **Estimates are never evidence.** Sizes and contrast ratios come from
  measurement.

---

## Verification log

| Milestone | Typecheck | Lint | Unit | E2E | Build | Audit | Notes |
|---|---|---|---|---|---|---|---|
| M0 | n/a | n/a | n/a | n/a | n/a | n/a | Node v22.22.0, npm 10.9.4, git 2.51.1 |
| M1 | ✅ | ✅ | ✅ 47 | ✅ 7 | ✅ | ✅ 0 vulns | 48.30 KB JS gz — excludes CodeMirror |
| M2 | ✅ | ✅ | ✅ 107 | ✅ 38 | ✅ | ✅ 0 vulns | R-10 checkpoint passed on Chromium, Firefox, WebKit |
