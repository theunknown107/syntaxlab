# Implementation Status

**Project:** SyntaxLab
**Phase:** 2 — implementation
**Current milestone:** M4 complete → M5 next (awaiting approval)
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
| M3 | Regex domain | ✅ **Complete** |
| M4 | Regex UI + safe execution | ✅ **Complete** |
| M5 | JSON domain | ⬜ Next |
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

## M3 — objective and outcome

**Objective:** a complete, correct regex analysis domain — tokenizer, parser,
explanation tree, warnings — with **no UI and no regex execution**.

**Outcome:** met. All M3 tasks are implemented, plus the M2 security-boundary
hardening M3 required as its first task. **The R-01 regex checkpoint passed:**
the hand-written parser agrees with `new RegExp` across the whole corpus and
the seeded fuzz budget, so `regexpp` was **not** adopted.

### Verification

| Check | Result |
|---|---|
| Typecheck | ✅ clean |
| ESLint / Stylelint / Prettier | ✅ clean (0 errors, 0 warnings) |
| Unit tests | ✅ **715 passed** (14 files, +608 from M2) |
| E2E | ✅ **53 passed** across 4 projects, all three engines |
| Coverage — `src/domain/regex` | ✅ **97.70% stmt / 90.85% branch** (gate ≥95%) |
| Production build | ✅ 780 ms |
| Bundle budget | ✅ 59.54 KB counted JS — entry chunk unchanged at 47.05 KB |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilities |
| Banned-API scan | ✅ none |

### First task — M2 security boundary hardening

`parseWorkerResponse` validated the response *envelope*, but a successful
`result` reached application state as an unvalidated `unknown` behind a
TypeScript cast — the type was trusted instead of the value. Added
`RESULT_VALIDATORS` / `RESULT_RECONSTRUCTORS` and `validateResult(op, result)`
in `protocol.ts`, called from `workerClient.ts`; an unrecognised shape now
settles as `PROTOCOL` error rather than propagating. Results are also
reconstructed field-by-field, so unknown wire keys are dropped rather than
carried inward.

### Built

```
src/domain/regex/
  tokenizer.ts   890  single pass over UTF-16 code units, foreign-dialect detection
  parser.ts      613  recursive descent → RegexNode tree
  ast.ts         264  discriminated union + RegexAnalysis
  explain.ts     640  RegexNode → ExplanationNode[] (typed segments, never HTML)
  warnings.ts    208  ReDoS shapes, footguns, portability notes
  analyze.ts     133  the single entry point
  validate.ts    181  runtime shape guard used at the worker boundary
```

**No `new RegExp` on user input anywhere in M3.** It appears only inside the
differential *test* suite, as the conformance oracle.

### R-01 regex checkpoint — PASSED

| Evidence | Result |
|---|---|
| Differential vs `new RegExp`, curated corpus × 2 flag sets | 174 cases, full agreement |
| Differential, generated patterns | 6 000 runs, seeded `20260818` |
| Property — never throws, always terminates, spans well formed | 19 properties |
| Golden corpus, human-reviewed | **164 distinct patterns**, 170 tests |
| `regexpp` adoption required? | **No** — the escalation path was not triggered |

**Residual risk stays 🟡.** Agreement on *validity* is established by an
oracle; explanation *correctness* has no oracle and rests on the reviewed
golden corpus. R-01's JSON half remains open until M5.

### Parser performance — measured, not estimated

| Case | Median |
|---|---|
| Typical short pattern (13 ch) | **0.022 ms** |
| Typical medium pattern (37 ch) | **0.050 ms** |
| At the 10 000-character limit | **2.558 ms** |
| Worst observed — 2 000 unclosed groups | **3.763 ms** |
| Mixed-corpus throughput | ~117 000 analyses/sec |

Scaling is approximately linear across the valid range (1 000 → 0.41 ms,
5 000 → 1.27 ms, 10 000 → 2.56 ms). Full table in `docs/12_PERFORMANCE.md`
§10.4.

### Findings and fixes during M3

**Four ECMAScript conformance bugs, found by differential testing:**

| # | Defect |
|---|---|
| 1 | `\k<name>` with no named groups — we rejected; the engine accepts it as an Annex B identity escape |
| 2 | `[a\-z]` under `/u` — we rejected; `\-` is a valid ClassEscape |
| 3 | `\01` under `/u` — we accepted; the engine rejects legacy octal |
| 4 | Empty group body anchored outside its parent span (`a(`) — found by the span-containment property |

**Three implementation defects:**

| Found by | Defect |
|---|---|
| Parser unit test | `((a)(b))` reported groups `[2,3,1]` — entries are appended at the closing paren, so they needed sorting by number |
| Parser unit test | Group depth captured *after* the descent unwound, so every group reported its parent's depth |
| Lint `switch-exhaustiveness-check` | The `analysis.regex` dispatch case was missing from the worker — it fell through returning `undefined`, surfacing as a bogus TIMEOUT |

**Two explanation-quality defects, found by reading real output as a user
would:**

| Defect | Fix |
|---|---|
| `[\]]` read as *"Matches any of the escape \]"* | `classEscapePhrase()` — now *"a literal ]"* |
| `(?=.*a)(?=.*b)` ran the assertion body into the following syntax, so its extent was ambiguous | Multi-part assertion bodies are now bracketed |

The last two are the reason the golden corpus is reviewed by hand rather than
snapshot-generated: a snapshot would have frozen both defects as expected
output.

### Dependencies added at M3

**One dev dependency: `fast-check`**, which `16_DEPENDENCIES.md` §3 already
approves. No runtime dependency. **`regexpp` was not installed** — the §6
escalation path requires persistent differential disagreement, which did not
occur.

### Known limitations at M3

- **No UI.** The regex feature components, the editor, and the match tester
  are M4. Nothing in the shell renders an analysis.
- **No regex execution.** `analyze()` never runs the pattern against a subject;
  that is M4 and belongs to the execution worker.
- **Explanations are `ExplanationNode[]`**, never strings. Rendering is M4.
- **Annex B and strict-unicode divergence** is implemented and reported, but
  there is no UI affordance to explain it to the user yet.
- **Deep nesting is capped** and reported as a limit error rather than parsed.

### Deviations at M3

**None.** No task was skipped, deferred, or substituted.

---

## M4 — objective and outcome

**Objective:** the first genuinely useful product — the complete regex
experience, including the first time user regex is actually executed.

**Outcome:** met. **The bundle checkpoint passed**: with CodeMirror in the
build the counted budget is 162.54 KB against a 170 KB target, so no
optimisation was needed and none was performed.

### Verification

| Check | Result |
|---|---|
| Typecheck | ✅ clean |
| ESLint / Stylelint / Prettier | ✅ clean (0 errors, 0 warnings) |
| Unit tests | ✅ **859 passed** (19 files, +18 from M3) |
| E2E | ✅ **146 passed, 3 skipped** across 7 projects |
| Production build | ✅ 1.54 s |
| **Bundle budget** | ✅ **162.54 KB counted · 148.79 KB entry chunk** |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilities |
| Banned-API scan | ✅ none |
| `new RegExp` on user input outside the exec worker's module | ✅ none |

### Bundle checkpoint — the measurement M1 could not make

| Milestone | Entry chunk (gz) | Counted JS | Note |
|---|---|---|---|
| M1 | 47.05 KB | 48.30 KB | No CodeMirror — proved nothing about the budget |
| M2 | 47.05 KB | 49.52 KB | + worker chunks |
| M3 | 47.05 KB | 59.54 KB | + regex domain, in the worker chunk |
| **M4** | **148.79 KB** | **162.54 KB** | **+ CodeMirror + the whole regex UI** |
| Delta M1 → M4 | **+101.74 KB** | | |

**Where the bytes are**, measured by bundling exactly the imports each
dependency contributes rather than by reading an analyser:

| Contributor | Gzipped | Share |
|---|---|---|
| CodeMirror (`state`, `view`, `commands`) | **88.03 KB** | 59% |
| React + React DOM | 44.48 KB | 30% |
| SyntaxLab application code | ~16.3 KB | 11% |

**CodeMirror cost 88 KB, not the ~150 KB estimated.** Three packages were
installed rather than six, and the regex colouring is driven by our own
tokenizer through the shared decoration mechanism — so `@codemirror/language`
and `@lezer/highlight` are not needed at all. `16_DEPENDENCIES.md` §2.2 had
flagged that figure as "the number most likely to be wrong". It was, by 62 KB,
in the direction that helps. **Risk R-05 drops from 🟠 12 to 🟢 3.**

### Startup and first interaction (Chromium, production build)

| Measurement | Value |
|---|---|
| First paint | 32–52 ms |
| First contentful paint | 96–100 ms |
| First analysis — keystroke → explanation on screen | ~247 ms |
| First execution — keystroke → matches on screen | ~266 ms |
| Warm execution | ~217 ms |

The analysis figures are dominated by the **150 ms debounce** deliberately in
the path, plus up to 100 ms of assertion-polling granularity in the harness.
The parser itself takes 0.02–0.06 ms and a warm worker round trip is under
0.1 ms, so the compute is a rounding error inside a delay we chose.

### Execution safety — evidence

| Assertion | Evidence |
|---|---|
| User regex never runs on the main thread | `new RegExp` on user input exists only in `domain/regex/execute.ts`, imported by the execution worker alone. Asserted by a repo scan. |
| No fallback path relocates it | Workers unavailable → the tester is **disabled** with an explanation. Asserted in `regexWorkspace.test.ts` (no request is made) and in the UI copy. |
| A catastrophic pattern times out | E2E on Chromium, Firefox, mobile — `(a+)+$` against 40 characters |
| The worker is terminated and respawned | E2E: the next pattern runs normally without a reload |
| Two timeouts in a row recover | E2E |
| The analysis worker is unaffected | The explanation for the same pattern stays on screen throughout |
| Results are runtime-validated | 13 protocol tests; an offset outside the subject is rejected, not clamped |
| Output cannot exhaust memory | Three independent caps, each named in the UI when it fires |

**WebKit is the honest exception.** No pattern can make it time out:
JavaScriptCore bounds its own backtracking, measured as a flat ~420 ms for
`(a+)+$` from 28 to 40 characters and a flat ~1.7 s for `^(a|a?)+$` from 40
characters to 1 000, where V8 and SpiderMonkey are exponential across the same
range. The three pattern-driven timeout tests are **skipped there with that
measurement as the reason**. Termination on WebKit was proven at M2 against a
busy loop that genuinely cannot yield — a stronger condition than any regex
produces — and a new test asserts what WebKit does instead.

### Human explanation review — the part tests cannot do

Forty-five patterns across every grammar area were read as a user would read
them. **Four defects, all of which every existing test passed:**

| Defect | Fix |
|---|---|
| `\x41` read "the character `\x41`" — restating the input teaches nothing | "the character A (U+0041)". Unprintable results are named by code point, because an invisible character in a sentence cannot be read. |
| A multi-member character class ran into the surrounding prose with no boundary — in the email pattern the reader could not tell where the class ended | Bracketed, the same fix M3 applied to assertion bodies |
| "Matches any of a literal ]" is not a sentence | A single-member class reads as its member — except a lone range, where "Matches a to z" would read as literal text |
| `.` and `-` are both literal inside a class and were described two different ways in the same list | Both read "a literal X" |

**Fifteen fixtures** now pin the corrected wordings, each naming the defect it
guards against, bringing the golden corpus to **188 tests**.

### Other defects found and fixed during M4

| Found by | Defect |
|---|---|
| axe (E2E) | A collapsible `<Panel>` rendered its title as a bare button, dropping the section from the document outline |
| axe (E2E) | Hint text inside a warning row measured **3.88:1** on the amber tint — below AA. It used the muted token, which is only measured against the panel surface. |
| Protocol unit test | `parseWorkerRequest` rebuilt the envelope field by field but passed the payload through **by reference**, so unknown wire keys did reach the worker. Its comment claimed otherwise. |
| Component unit test | The explanation carried **no** positioned reference nodes, so the documented explanation-to-source link had nothing to attach to and `spanRef` was dead code naming a consumer that did not exist |

### Dependencies added at M4

**Three runtime: `@codemirror/state`, `@codemirror/view`,
`@codemirror/commands`** — pinned exactly, all MIT, `npm audit` clean.

**Not installed, against the plan:** `@codemirror/language` and
`@lezer/highlight`. The regex colouring comes from our own token list through
the shared decoration mechanism, so a CM6 language mode buys nothing and would
let two grammars disagree about spans the explanation already refers to.
`@codemirror/search` remains unadopted; `@codemirror/lang-json` is M5.

### Deviations at M4

| # | Deviation | Reason |
|---|---|---|
| D6 | **Three CodeMirror packages, not six** | See above. Fewer bytes, one grammar. |
| D7 | **`ErrorBoundary` moved from `app/` to `components/`** | The regex feature wraps its own two columns, and the layer rules correctly stop a feature importing from `app/`. The boundary is a shared component by nature, so moving it was the honest fix rather than relaxing the rule. |
| D8 | **Eight flag toggles, not the seven in the UX spec** | The spec's list predates the `v` flag. The domain has supported all eight since M3, and omitting one from the UI would make it unreachable. |
| D9 | **Named and numbered captures reported separately** | The engine offers no mapping between `match[n]` and `match.groups.name`. Reuniting them by comparing values is ambiguous whenever two groups capture the same text, so both views are reported as the engine gives them. |
| D10 | **Three output caps, not the single "truncated at 10 000" in the UX spec** | Match count alone does not bound memory: 10 000 matches of 2 000 characters is 20 MB. |

### Known limitations at M4

- **The split is not resizable** and **mobile does not use tabs** (`08_UI_UX_SPEC.md` §5, §18). Panels stack instead. Both are queued for M11; neither blocks use at 360 px, which is asserted.
- **Zero-length matches are not highlighted in the editor**, only listed in the match table. A mark decoration needs a non-empty range and tinting one character would claim the match covered something it did not.
- **Capture offsets require the `d` flag**, as the engine does. The flag is never added silently, because that would run a different pattern from the one on screen.
- **No history, theme drawer, help dialog or header actions.** M7, M8, M10.
- **No cancel button** on a running execution (`08_UI_UX_SPEC.md` §15). The 2 s deadline arrives before a progress indicator would.
- **JSON mode is still an empty state.** M6.
- **Screen-reader testing is automated only** — axe plus keyboard. NVDA/VoiceOver/JAWS passes are M10.

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
| M3 | ✅ | ✅ | ✅ 715 | ✅ 53 | ✅ | ✅ 0 vulns | R-01 regex checkpoint passed; `regexpp` not needed; domain coverage 97.70% |
| M4 | ✅ | ✅ | ✅ 859 | ✅ 146 (3 skipped) | ✅ | ✅ 0 vulns | **Bundle checkpoint passed — 162.54 KB vs 170 KB target.** CodeMirror measured at 88 KB, not the ~150 KB estimated |
