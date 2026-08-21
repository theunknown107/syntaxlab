# Implementation Status

**Project:** SyntaxLab
**Phase:** 2 — implementation
**Current milestone:** M12 — integration, end-to-end and release QA
**Last updated:** 2026-08-20

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
| M5 | JSON domain | ✅ **Complete** |
| M6 | JSON UI | ✅ **Complete** |
| M7 | History and storage | ✅ **Complete** |
| M8 | Theme customisation | ✅ **Complete** |
| M9 | PWA and offline | ✅ **Complete** |
| M10 | Accessibility and security hardening | ✅ **Complete** |
| M11 | Performance and UX refinement | ✅ **Complete** |
| M12 | Integration, E2E, release QA | 🔨 **Current** |
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

- **The split is not resizable** and **mobile does not use tabs** (`08_UI_UX_SPEC.md` §5, §18). Panels stack instead. Both are queued for M11; neither blocks use at 360 px, which is asserted. *(M11: the split is now resizable; the mobile tab bar was evaluated and deliberately declined — deviation D48.)*
- **Zero-length matches are not highlighted in the editor**, only listed in the match table. A mark decoration needs a non-empty range and tinting one character would claim the match covered something it did not.
- **Capture offsets require the `d` flag**, as the engine does. The flag is never added silently, because that would run a different pattern from the one on screen.
- **No history, theme drawer, help dialog or header actions.** M7, M8, M10.
- **No cancel button** on a running execution (`08_UI_UX_SPEC.md` §15). The 2 s deadline arrives before a progress indicator would.
- **JSON mode is still an empty state.** M6.
- **Screen-reader testing is automated only** — axe plus keyboard. NVDA/VoiceOver/JAWS passes are M10.

---

## M5 — objective and outcome

**Objective:** a complete JSON domain, so M6 can consume a trustworthy
structured result without putting parsing or normalisation into React.

**Outcome:** met. No JSON UI was built. The parser agrees with `JSON.parse` on
every input in the corpus and on 4 000 generated and mutated documents, and
the prototype-pollution defence holds structurally.

### Verification

| Check | Result |
|---|---|
| Typecheck | ✅ clean |
| ESLint / Stylelint / Prettier | ✅ clean (0 errors, 0 warnings) |
| Unit tests | ✅ **1 252 passed** (25 files, +393 from M4) |
| E2E | ✅ **167 passed, 3 skipped** — the M4 regex suite unchanged, +7 JSON |
| Coverage — `src/domain/json` | ✅ **97.5% stmt / 91.0% branch** (gate ≥95%) |
| Production build | ✅ 1.56 s |
| Bundle | ✅ **150.82 KB initial** · 19.56 KB workers · 177.51 KB precache |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilities |
| Banned-API scan | ✅ none |
| Regex product | ✅ unchanged and green |

### Built

```
src/domain/json/          2 214 lines
  tokenizer.ts   single pass, line/column, strict RFC 8259, named near-misses
  parser.ts      iterative with an explicit stack, panic-mode recovery
  ast.ts         CST discriminated union, members as an ordered array
  path.ts        structural paths, dot and bracket, explicit key escaping
  numbers.ts     exact precision-loss detection
  plain.ts       prototype-safe conversion to a plain value
  analyze.ts     the pipeline, and one walk for every finding
  explain.ts     CST → ExplanationNode[]
  validate.ts    runtime shape guard at the worker boundary
```

`analysis.json` runs on the **long-lived** analysis worker. Not the disposable
one: JSON parsing is our own bounded code, and a regex execution timeout must
never destroy an unrelated parse. An E2E test asserts both operations coexist
on that thread.

### The two decisions that carry the most weight

**The parser is iterative, with an explicit stack.** `[[[[…]]]]` costs one byte
per level, so recursion dies at a few thousand levels with a `RangeError` that
is unattributable inside a worker. **200 000 open brackets** now returns a
clean `LIMIT_EXCEEDED` — asserted in a unit test and again through a real
worker.

**Object members are an ordered array of `{key, value}` pairs, never a
`Record`.** A user key therefore never becomes a real object key anywhere in
the product. `toPlainValue` uses `Object.create(null)` and `defineProperty`,
and *drops* `__proto__` rather than merely making it an own property — the
null prototype makes the write safe where it happens, but the value leaves
there, and `Object.assign` onto an ordinary object does use assignment. A test
drives exactly that path.

**This is a strong structural defence, not a proof.** It removes the vectors
this parser creates and says nothing about code elsewhere that builds objects
some other way.

### Policies, stated exactly

| Policy | Behaviour |
|---|---|
| **Dialect** | Strict RFC 8259. Comments, trailing commas, single quotes, unquoted keys, `NaN`/`Infinity`/`undefined` are errors — each with a message naming the rule and a hint, never "unexpected token". |
| **Duplicate keys** | Every occurrence kept with its own span and reported. Never collapsed. `toPlainValue` then applies the platform's last-wins rule, so the plain value and `JSON.parse` agree. |
| **Numbers** | Both representations kept: `raw` as written, `value` as an IEEE-754 double. No claim of arbitrary precision. |
| **Unsafe numbers** | Flagged only when a reader would be misled, by exact comparison: `9007199254740993` → `PRECISION_LOSS`, `1e400` → `OVERFLOW`, `-0` → `NEGATIVE_ZERO`. `0.1` and `1e5` are **not** flagged — they round-trip, and a warning on every document teaches users to ignore it. |
| **Strings** | Lone surrogates preserved, raw control characters rejected, invalid escapes reported rather than repaired. |
| **Paths** | Structural, not a query language. Dot notation only for `[A-Za-z_$][A-Za-z0-9_$]*`; brackets otherwise, with keys escaped character by character. |

### Differential results — and what they prove

| Claim | Established? |
|---|---|
| Validity matches `JSON.parse` | ✅ curated corpus × 2 + **4 000** generated and mutated documents |
| Values match after unescaping and conversion | ✅ same corpus, compared structurally |
| Positions are correct | ❌ the oracle has none — unit and property tests instead |
| Error messages are right | ❌ engine-specific in the platform; we report more, by design |
| Duplicate-key handling matches | ❌ we differ deliberately |

### Property and fuzz results

17 properties, seed `20260819`, 400 runs each. Parser always terminates and
never throws — on arbitrary text, on punctuation soup, on every prefix of a
valid document, and on ten adversarial shapes including 100 000 open brackets.
Spans stay inside the source, a parent contains its children, a key span lies
inside its member span, the reported line matches the newlines before the
offset, a path is the accessor chain to the node carrying it, stats agree with
the tree, limits hold, and nothing in the runtime is mutated whatever the keys
are. **No counterexample found.**

### Performance — measured

| Case | Median |
|---|---|
| Short document | **0.080 ms** |
| Typical API response (1.1 KB) | **0.421 ms** |
| ~10 000 characters | **0.680 ms** |
| 1 MB of records | 61.4 ms |
| **At the 5 MB limit** | **~465 ms** (540 ms worst) |
| Malformed — 50 000 junk characters | 14.6 ms |
| Throughput | ~77 000 analyses/sec |

Effectively linear: 67 KB → 5.1 ms and 687 KB → 61.4 ms is 10.3× size for 12×
time. **The top of the range is stated rather than hidden:** a 5 MB document
takes about half a second, above the 100 ms target — acceptable because
`manualAnalyzeBytes` is 500 KB, so a document that large already needs an
explicit action, and because it runs in a worker with the main thread free.

### The bundle metric was corrected, not relaxed

The combined "Initial JS" figure reached **170.38 KB against a 170 KB
target**, which prompted a look at what it was counting. `check-size.mjs`
summed every `.js` file — conservative at M1 when the worker chunks were 1 KB
stubs, and simply wrong by M5, because it named a load that does not happen.

Split into what the browser actually does: **150.82 KB initial**, 19.56 KB
worker chunks, 177.51 KB total precache. No budget was raised and nothing was
removed; the worker chunks are now budgeted explicitly where before they were
double-counted, and the everything-at-once case was already covered by "Total
precache" at 12% of its target. Recorded in `12_PERFORMANCE.md` §10.6.1.

### Defects found and fixed during M5

| Found by | Defect |
|---|---|
| Golden corpus | The scanner and the parser both reported `{a:1}`, so one mistake produced two errors. Errors are now deduplicated per position — most specific wins — and sorted into source order. |
| Coverage | `isValidJsonAnalysis` had **no tests at all** (3% covered) — on the module standing between a malformed worker result and application state |
| Coverage | `EMPTY_STATS` was exported and imported by nothing |
| Bundle check | The "Initial JS" metric measured a load that does not happen |
| **Human review** | **Eight wording defects**, listed below |

### Explanation review — the part tests cannot do

Thirty documents across every required category were read as a user would read
them. Eight defects, each of which every existing test passed:

| Defect | Fix |
|---|---|
| The Structure section restated the summary verbatim | It now carries what the summary cannot: counts, depth, keys, size |
| "0 levels deep" for a bare scalar | Depth omitted where there is no nesting |
| The array breakdown repeated a homogeneous summary | Shown only for mixed arrays |
| `$` appeared raw in findings | "at the top level" where the path is empty |
| "keep them as strings" followed a negative zero and an overflow | Advice only where it applies |
| "the rest was read as a part that could not be read" | No recovery claimed unless something substantive survived |
| ", and" joining a two-clause summary | Written out; `joinClauses` is right for three |
| "a single string, hello" | A colon reads better before a quoted value |

**68 golden fixtures** now pin the reviewed wording.

### Dependencies added at M5

**None.** The JSON domain is written against the platform alone; `fast-check`
was already installed at M3. No JSON parser library was needed — §6's
escalation path requires a demonstrated correctness problem, and none appeared.

### Deviations at M5

| # | Deviation | Reason |
|---|---|---|
| D11 | **`JsonAnalysis` gained no field for risky keys** | `__proto__`, `constructor` and `prototype` are surfaced through the *explanation* as a `warning` section instead. That is already where §4.3's other findings reach the user, and a new array would be schema drift for something M6 renders the same way. |
| D12 | **`toPlainValue` returns `{ value, droppedKeys }`** | The domain doc says `__proto__` is skipped. Returning what was skipped means a caller can say so rather than the data vanishing silently. |
| D13 | **The bundle metric was split** | See above. The instrument was measuring a load that does not happen. |

### Known limitations at M5

- **No JSON UI.** Editor, tree, format, minify, path panel and stats line are all M6. Nothing in the shell renders a `JsonAnalysis`.
- **A leading comment cascades into a second error.** `// x\n{"a":1}` reports the comment (correctly, first) and then "more content after the end", because the invalid token became the root. The leading message is the actionable one; suppressing the cascade would need the parser to retry after an unsupported token, which risks differential disagreement for a cosmetic gain.
- **`toPlainValue` recurses.** Safe because the parser has already capped depth at 500 before this ever runs, but it is not independently bounded.
- **Formatting (prettify/minify) is not built.** `04_PARSER_ARCHITECTURE.md` §3.7 specifies it on the CST; it belongs with the toolbar that triggers it, at M6.
- **Path building is O(depth) per node.** Fine for real documents; a pathological deep-and-wide document would pay for it. Measured, bounded by the limits, and not optimised because no measurement asks for it.

---

## M6 — objective and outcome

**Objective:** the complete JSON user experience, and the JSONTestSuite
conformance precheck that M5 had left open.

**Outcome:** met. **J-2 is closed with evidence**, the JSON workspace is built
on the M4 shell, and the regex product is unchanged.

### The precheck — acceptance criterion J-2

The M5 report claimed differential agreement with `JSON.parse` and never
claimed J-2. The criterion was genuinely open: the repository held no
published conformance corpus.

**Result, on the first run, with no parser changes:**

| Category | Files | Result |
|---|---|---|
| `y_*` — must be accepted | 95 | ✅ **95 accepted** |
| `n_*` — must be rejected | 188 | ✅ **188 rejected** |
| `i_*` — implementation-defined | 35 | ✅ **35 classified in the test as data** |
| Verdicts matching `JSON.parse` on the same decoded text | 318 | ✅ **318** |

The corpus is vendored from `nst/JSONTestSuite` under its MIT licence, with
provenance recorded — not fetched, because a gate that depends on a network
call is not a gate. `04_PARSER_ARCHITECTURE.md` §8 already named it as the
intended reference, so it is the approved corpus rather than arbitrary
material.

**The `i_` outcomes, stated rather than left implicit.** Thirty-two accept and
three reject. Numbers beyond a double are accepted *and then reported* as
OVERFLOW or PRECISION_LOSS — rejecting them would contradict RFC 8259 and
saying nothing would be the silent corruption §4.3 exists to prevent. Lone
surrogates are accepted and preserved (J-I5). Invalid UTF-8 is accepted because
`TextDecoder` has already substituted U+FFFD before any JavaScript parser sees
text. The three rejections are UTF-16 documents, which are mojibake when
decoded as UTF-8.

### Verification

| Check | Result |
|---|---|
| Typecheck | ✅ clean |
| ESLint / Stylelint / Prettier | ✅ clean (0 errors, 0 warnings) |
| Unit tests | ✅ **1 947 passed** (27 files, +695 from M5) |
| E2E | ✅ **295 passed, 3 skipped** across 11 projects |
| Production build | ✅ |
| Bundle | ✅ **158.12 KB initial** · 19.56 KB workers · 185.50 KB precache |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilities |
| Banned-API scan | ✅ none |
| **Regex product (M4)** | ✅ **unchanged and green** |

### Built

```
src/domain/json/format.ts        prettify and minify, from the CST
src/domain/shared/detect.ts      mode detection, cheap and unsure of itself
src/application/json/            orchestration, debounce, manual mode, formatting
src/features/json/               workspace, tree, panels, view model, styles
src/app/ModeSuggestion.tsx       the suggestion bar
```

`<JsonPlaceholder>` was deleted. Shared with regex: `CodeEditor`, `Panel`,
`Button`, `Badge`, `CopyButton`, `ErrorBoundary`, the two-column layout, the
store and the worker client.

### The decisions that carry the most weight

**Formatting reads the CST**, never `JSON.stringify(JSON.parse(text))`. That
round trip rewrites `1e5` as `100000`, reorders integer-like keys, and drops
duplicates — the three things this product exists to surface. Strings are
emitted from `raw` for the same reason. Format and Minify are **disabled, not
hidden**, on an invalid document, with the reason beside them.

**Two defences keep a large tree responsive, and the cheaper comes first.**
Collapsed branches are never flattened, so a collapsed 500 000-node document
costs one row. Virtualisation above 500 rows is the second. Measured: a fully
expanded 100 KB document is **7 701 rows with 42 in the DOM**.

**Search reads the model, not the DOM.** A scrape would find only what is
expanded *and* on screen — for a virtualised list, a few dozen rows — so the
answer would depend on the scroll position.

**Duplicate keys stay visible**, every occurrence, each marked and each with
its own jump target. The wording says which one JavaScript reads without
pretending the parser collapsed them.

### Performance — measured

| Measurement | Value |
|---|---|
| One keystroke with 100 KB loaded | **21 ms** |
| Expand all — 7 701 rows | **42 ms** |
| Search across the 100 KB tree | **12 ms** |
| Format / minify (100 KB) | 46 ms / 80 ms |
| 1 MB — paste to manual prompt | **184 ms**, no parse attempted |
| 1 MB — analyse on demand | **427 ms** |
| Rows rendered out of 7 701 | **42** |

The keystroke-to-tree figures (278 ms small, 870 ms at 100 KB) are dominated
by the deliberate debounce; the parse itself is 0.08 ms and 5.1 ms.

### Bundle

| | M5 | M6 | Delta |
|---|---|---|---|
| Initial JS | 150.82 KB | **158.12 KB** | +7.30 KB |
| Worker chunks | 19.56 KB | 19.56 KB | — |
| CSS | 5.17 KB | 5.86 KB | +0.69 KB |
| Total precache | 177.51 KB | 185.50 KB | +7.99 KB |

Within the 170 KB target and 42 KB under the hard budget. No dependency was
added: the tree is virtualised by hand and search is a walk over the CST.

### Defects found and fixed during M6

| Found by | Defect |
|---|---|
| **Conformance suite** | A `prettier --write` run had reformatted the fixtures and *repaired* twelve `n_` cases — `[2.e3]` → `[2e3]`, `["",]` → `[""]`. The file count was unchanged, so the existing count assertion passed while the suite was silently weakened. Corpus restored; a SHA-256 manifest now guards contents, verified by deliberately corrupting a fixture and confirming the failure. |
| E2E | The auto-select rule keyed off the *target* editor being empty, so a mode could switch while the user was mid-edit. It now requires a first paste into an empty editor. |
| Unit | `\bword\b` detected as "unknown". A `\d`, `\w`, `\s` or `\b` is near-conclusive evidence of a pattern. |
| E2E | Two M1-era assertions still expected the placeholder heading "JSON input". |
| **Manual review** | Three wording and marking defects — below. |

### Manual review

Seventeen documents read as a user would read them: small, deep, mixed, long
strings, Unicode, duplicate keys, precision loss, negative zero, overflow,
malformed, partial recovery, prototype-pollution and XSS payloads.

| Defect | Fix |
|---|---|
| The status line read "1 keys" and "1 values" | Singularised |
| Two duplicate occurrences on one line both read "line 1" | Line **and column**, so the jump targets differ |
| A node from error recovery was marked only by colour | It carries the words "could not be read" |

### Security

| Assertion | Evidence |
|---|---|
| No JSON parsing on the main thread | The only parser is in `domain/json/`, reached through `analysis.json`. No local fallback exists. |
| Prototype-pollution payloads stay inert | E2E through the real worker: members survive structured clone as an array, `'polluted' in Object.prototype` is false |
| Hostile keys render as keys | `__proto__` and `constructor` appear as ordinary tree rows |
| XSS payloads render as text | Script, image and `javascript:` payloads through keys, values, errors and search; no element created, no dialog |
| Raw-HTML props | Still banned by lint and by the CI grep |

### Dependencies added at M6

**None.** The one non-code addition is the JSONTestSuite corpus (MIT), as test
fixtures. `@codemirror/lang-json` was **not** installed: the editor needs
decorations at spans our own parser produces, and a second grammar would be a
second opinion about where those are.

### Deviations at M6

| # | Deviation | Reason |
|---|---|---|
| D14 | **`<JsonTree>` is feature-local, not the shared `<TreeView>`** | The regex AST is nested and a few dozen rows; the JSON tree is pre-flattened and can be hundreds of thousands. One component for both would make the regex tree pay for virtualisation or this one re-flatten every render. Every other primitive is shared. |
| D15 | **Search highlights and steps rather than filtering** | Filtering hides the context that makes a match meaningful. Matches are marked in place, counted, and stepped through with ancestors expanded. |
| D16 | **Expand-to-depth is the default view, not a control** | Depth 2 is what orients a reader; a control for it is furniture until someone asks for it. |
| D17 | **`@codemirror/lang-json` not installed** | See above. Error decorations come from our parser's spans. |

### Known limitations at M6

- **No JSON explanation panel.** The domain produces one (`JsonAnalysis.explanation`) and the UI does not render it: the status line, findings and tree already answer what the explanation says, and showing both would be the duplication the M5 review removed from the explanation itself. Queued for reconsideration at M11.
- **No syntax highlighting inside the JSON editor** — only error decorations. Colour lives in the tree, which is the primary object on this screen.
- **The split is still not resizable**, and mobile stacks rather than using tabs. M11, as at M4. *(Resolved at M11: the splitter is built; the tab bar is declined — D48.)*
- **Search is capped at 500 matches.** A query matching more says how many it found up to the cap; there is no "load more".
- **One flaky E2E observed**: `workers-firefox › actually processes the payload` failed once under full parallel load and passed on every isolated and subsequent full run. Not reproduced; recorded rather than dismissed.

---

## M7 — objective and outcome

**Objective:** history and local storage. The milestone where the privacy model
stops being a document and becomes behaviour.

**Outcome:** met. All 28 acceptance criteria (H-1 – H-28) pass. Regex and JSON
are unchanged, and keep working with storage removed entirely.

### Verification

| Check | Result |
|---|---|
| Typecheck | ✅ clean |
| ESLint / Stylelint / Prettier | ✅ clean (0 errors, 0 warnings) |
| Unit tests | ✅ **2 070 passed** (32 files, +123 from M6) |
| E2E | ✅ **367 passed, 3 skipped** across 14 projects, on the final run · one environment flake recurred once during M7 and is analysed below |
| Production build | ✅ |
| Bundle | ✅ **169.29 KB initial** · 19.56 KB workers · 197.75 KB precache |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilities |
| Raw-HTML / eval scan | ✅ none |
| **Regex and JSON (M4, M6)** | ✅ **unchanged and green** |
| JSONTestSuite corpus | ✅ byte-identical after a repository-wide `prettier --write` |

### Built

```
src/domain/history/              entry (schema + port), validate, title,
                                 query, transfer
src/infrastructure/storage/      db (native IndexedDB), historyRepository
src/application/stores/          settingsStore (localStorage)
src/application/history/         historyStore, capture, restore
src/features/history/            drawer, controls, transfer, view model
src/components/primitives/       Dialog — Drawer and ConfirmDialog
scripts/measure-history.mjs      the performance harness
```

### The decisions that carry the most weight

**`idb` was planned and not installed.** `16_DEPENDENCIES.md` §2.3 argued for
it, and the argument was sound on its own terms: raw IndexedDB has genuinely
error-prone transaction-lifetime semantics. What that assessment could not know
is that the wrapper is thirty lines — promisify a request, a transaction and an
open — and that the hazard is better handled visibly than hidden. This
dependency would have sat on the path of the user's persisted data, which
`05_SECURITY.md` treats as hostile input. The full reversal, including what
would reverse it again, is recorded in that document rather than here.

**Persisted data is reconstructed, never cast.** `readEntry` rebuilds every
field explicitly, so no key an edited database might carry reaches application
state. `searchText` is recomputed rather than trusted — a stored value that
disagreed with the entry would make it permanently unfindable.

**A record from a newer build is kept, hidden and reported.** Not quarantined,
not deleted. This is what stops an old tab destroying a V1.1 user's cron
entries, and it is why an unknown `type` is treated as future data rather than
corruption. An E2E test plants such a record, reloads, and reads it back **off
disk** to prove it survived.

**One implementation of the rules, two backends.** The memory fallback is the
same `HistoryStore` over a different backend, so the path that gets the least
manual testing behaves identically to the one that gets the most.

**Modal surfaces are the platform's.** `<dialog>` with `showModal()` supplies
the focus trap, Escape, page inertness, backdrop and focus restoration. The
E2E suite presses Tab twelve times and asserts focus never leaves.

**Pinned entries are never pruned, at any pressure.** If everything is pinned
and storage is full, the save fails honestly and says why. Capture then
suspends with an explicit resume, rather than retrying a failing write after
every analysis for the rest of the session.

### Performance — measured

`npm run measure:history`, Chromium, production build, median of three.

| Entries | Open the drawer | Search |
|---|---|---|
| 0 | 48 ms | 6 ms |
| 100 | 82 ms | 14 ms |
| 500 *(the cap)* | 98 ms | 27 ms |
| 1 000 | 101 ms | 33 ms |

Budgets are 200 ms and 100 ms. 1 000 is measured although the cap is 500,
because a store can exceed the cap transiently after an import.

Those numbers are also what justifies not debouncing the search box: a 150 ms
debounce would be the only latency in the interaction.

### Bundle

| | M6 | M7 | Delta |
|---|---|---|---|
| Initial JS | 158.12 KB | **169.29 KB** | +11.17 KB |
| Worker chunks | 19.56 KB | 19.56 KB | — |
| CSS | 5.86 KB | 6.95 KB | +1.09 KB |
| Total precache | 185.50 KB | 197.75 KB | +12.25 KB |

Within budget, but **0.71 KB under the 170 KB target** — worth stating plainly
rather than reporting as a pass. M8 has very little incidental headroom left.

### Defects found and fixed during M7

| Found by | Defect |
|---|---|
| Unit | `schemaVersion: 1.5` was classified as data from a newer build — kept and hidden — when it is corruption. The future check now requires an integer. |
| E2E | The history button's accessible name collided with the pause toggle's; the pause label now leads with its verb. |
| E2E | An entry row's accessible name was the whole row read as one sentence. Rows carry explicit labels. |
| **Reading the spec against the build** | Restoring silently replaced whatever was in the editor. It now asks first, and only when something would be lost. |
| **Reading the spec against the build** | An empty list said the same thing whether filtered, paused, or new. |
| **Reading the spec against the build** | The first-run notice omitted that the browser can clear storage — required by §9's own wording rules. |
| **Reading the spec against the build** | An explicit Analyze still waited out the two-second capture delay. |
| **Reading the spec against the build** | Quota exhaustion retried a failing write after every analysis, indefinitely. |
| **Reading the spec against the build** | The corrupt-database path had no recovery. The specified **Reset history database** action now exists. |
| **Reading the spec against the build** | The compound `by-type-created` index was missing; the `meta` store held a caller-specific shape. |

### The E2E flake from M6 — §26 investigation, concluded

M6 recorded one unreproduced failure: `workers-firefox › actually processes the
payload`. The M7 brief asked for a bounded investigation before anything else,
without reaching for retries or larger timeouts.

**Method:** five consecutive full-suite runs on the production build, all
projects in parallel — the condition under which it was first seen.

**Result:** the original test **never failed again** in five runs. Two runs
were entirely clean. Three runs each had exactly one failure, and no two were
the same test:

| Run | Failure |
|---|---|
| 1 | — |
| 2 | `regex-firefox › survives two timeouts in a row` |
| 3 | — |
| 4 | `json-mobile › the suggestion can be dismissed for the session` |
| 5 | `regex-mobile › survives two timeouts in a row` |

**Conclusion: an environment flake, not a product defect.** The evidence is the
*distribution*. A real defect concentrates on one test; these scattered across
three unrelated tests and four browser projects, with one test failing on two
different engines. Every affected test has a wall-clock dependency — two
sequential 2-second worker timeouts, or a debounce — and eleven browser
projects run in parallel on one machine. The shared resource is the machine.

**No retries were added and no timeout was raised.** Both would have hidden a
signal worth keeping: if these ever concentrate on one test, that is a real
defect and it should still be visible.

**It recurred once during the final M7 run**, on
`json-mobile > the suggestion can be dismissed for the session` — one of the
three above. Because M7 adds a banner directly above the element that test
looks at, an M7 regression had to be ruled out before calling it a flake
again. Two pieces of evidence rule it out:

1. **It flaked on a build with no history code in it.** The five investigation
   runs were launched at the start of M7, before the first history file
   existed; run 4's failure was this same test on that build.
2. **Three isolated repeats pass** (`--repeat-each=3`, 9.6 s), with the
   first-run banner present and occupying space on the mobile viewport.

The failing assertion has a 10-second budget on a debounced analysis, running
on an emulated mobile viewport while thirteen other browser projects share the
machine. That is the same wall-clock-under-contention shape as the other two.

**What this does not establish.** The runs were on one machine and one OS. It
is not proof the tests are sound on CI hardware, and it is not a claim that
these tests are well-designed — a 10-second budget on a debounce is thin, and
`12_PERFORMANCE.md` has the measurements that would justify a better one.
What it establishes is that the M6 failure is not reproducible, that the
residue is diffuse rather than pointed, and that none of it is caused by M7.

### Security

| Assertion | Evidence |
|---|---|
| Persisted data cannot reach state unvalidated | `readEntry` rebuilds field by field; unit tests assert unknown keys are dropped |
| Hostile stored content stays text | E2E round-trips `<img src=x onerror=alert(1)>` through real IndexedDB; no element created |
| Prototype pollution via storage or import | Records rebuilt, never assigned; `parseImportText` drops `__proto__` in the reviver |
| Import files are bounded | 20 MB, 10 000 entries, envelope-checked, then per-record validation |
| Test subjects are not stored | No field exists for one; a unit test asserts card-like digits never reach a record |
| Privacy copy is bounded to what we enforce | Unit test asserts the absence of "never leave", "100% private", "secure", "encrypted" |
| Raw-HTML props | Still banned by lint and the CI grep; none in the feature |

### Dependencies added at M7

**None**, and one removed from the plan — see above.

### Deviations at M7

| # | Deviation | Reason |
|---|---|---|
| D18 | **`idb` not installed** | `16_DEPENDENCIES.md` §2.3. |
| D19 | **`by-pinned` index not created** | `pinned` is a boolean and IndexedDB rejects booleans as keys; the index would be created and silently hold nothing. Ordering is done in `queryEntries`. |
| D20 | **The repository reads the whole store and filters in memory** | Cursor paging would be a second implementation of "what the list shows". 98 ms at the cap, 101 ms at twice it. |
| D21 | **Search is not debounced** | Measured at 27 ms for 500 entries; a 150 ms debounce would be the only latency present. |
| D22 | **Delete commits immediately; undo re-adds** | Deferring the write means a tab closed inside the undo window resurrects a deleted entry. |
| D23 | **The settings mirror lives in the drawer** | There is no settings dialog until M8. |
| D24 | **The soft 50 MB budget is not enforced** | It would mean pruning on `storage.estimate()`, a number browsers deliberately fuzz. `QuotaExceededError` is the one signal that is not a guess. |
| D25 | **`preferences.ts` and `migrations.ts` were never created** | `02_ARCHITECTURE.md` §9 records why: settings are application state, and the migration table belongs beside the validator that runs it. |

### Known limitations at M7

- **A regex pattern can itself contain a secret** — a pattern written to match one specific token contains that token. Nothing detects this; the mitigations are the general ones (visible, deletable, pausable). Recorded against R-09 rather than left unstated.
- **`dbSchemaVersion`, `lastPrunedAt` and `entryCount` are not written.** All three exist to avoid a full scan, and the repository does a full read by design.
- **No help-dialog link** on the first-run notice; the dialog arrives at M10.
- **No tag UI.** `tags` is in the schema, validated and bounded, with nothing that writes it. It is there so adding tags later is not a migration.
- **Import merges only.** `importAll` supports `replace`, and the drawer offers only merge — replace is destructive and wants its own confirmation flow, and merge already covers restoring a backup.
- **Two-tab conflict resolution is last-write-wins by `lastOpenedAt`.** Sufficient for one person with two tabs; it is not a sync algorithm.

---

## M8 — objective and outcome

**Objective:** turn the existing token architecture into a theme system a user
can customise, without a dependency, a backend, or a way to make the interface
unreadable.

**Outcome:** met, with one qualification and one accepted overage. All theme
acceptance criteria T-1 – T-14 pass; T-15 is verified by visual review only,
as the criterion itself specifies. The initial-JS **target** is exceeded by
3.04 KB; the hard budget is met with 27 KB to spare.

**This milestone was interrupted twice** — once by the session limit and once
by a network outage — and resumed from the repository both times. Nothing was
rebuilt from scratch and no commit was rewritten.

### Verification

| Check | Result |
|---|---|
| Typecheck | ✅ clean |
| ESLint / Stylelint / Prettier | ✅ clean (0 errors, 0 warnings) |
| Unit tests | ✅ **2 134 passed** (34 files, +64 from M7) |
| E2E | ✅ **487 passed, 3 skipped** across 20 projects — the full matrix, zero failures |
| Production build | ✅ |
| Bundle | ⚠️ **173.04 KB initial** (target 170, hard 200) · 19.56 KB workers · 7.56 KB CSS |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilities |
| Raw-HTML / eval scan | ✅ none |
| Dependencies added | ✅ **none** |
| **Regex, JSON, History** | ✅ **unchanged and green** |

### Built

```
src/domain/theme/preferences.ts      model · 5 presets · validator ·
                                     WCAG contrast · lighten-to-pass
src/application/theme/themeStore.ts  store · applyTheme · debounced persist
src/features/theme/ThemeDrawer.tsx   presets · colours · direction ·
                                     intensity · glow · contrast · motion ·
                                     text size · contrast guard · reset
src/features/theme/ThemeControls.tsx the Appearance button and the wiring
public/theme-bootstrap.js            hardened (rewritten, not replaced)
scripts/measure-theme.mjs            the performance harness
```

### The decisions that carry the most weight

**Validation happens at one choke point, not by convention.** `setTheme` runs
everything through `readTheme` — including values from our own controls. An
`input[type="color"]` is guaranteed by specification to yield `#rrggbb`, but
that guarantee lives in a specification and not in this repository, and
`applyTheme` is a `setProperty` sink. This was found by auditing the sinks
rather than by a failing test.

**Reject, never clamp.** `angleDeg: 100000` becomes 135, not 359. Clamping
invents a value the user never chose. The bootstrap follows the same rule,
because a bootstrap that clamped where the domain resets would paint one theme
and replace it a moment later.

**A theme from a newer build is discarded**, which is the opposite of the
history rule and deliberately so: a theme is a preference resettable in four
clicks, and showing someone an interface they cannot fix from inside the app
is worse than showing them the default.

**Semantic colours and the focus ring are not customisable.** Letting a user
make an error message or a focus ring low-contrast would turn an accessibility
guarantee into a preference. The visible cost is a green focus ring in the
Mono theme; that trade is taken knowingly.

**The accent follows the primary colour** rather than being a separate
control, so the gradient and the focus ring are always the same hue family.

### Performance — measured

`npm run measure:theme`, Chromium, production build.

| Measurement | Value |
|---|---|
| Theme switch, median of 20 | **1.1 ms** |
| Theme switch, slowest | 2.3 ms |
| FCP, default theme | 36 ms |
| FCP, stored custom theme | 40 ms |
| `localStorage` writes for a 21-step drag | **1** |

1.1 ms because nothing re-renders: the only React subscriber to `themeStore`
is the drawer itself.

### Bundle

| | M7 | M8 | Delta |
|---|---|---|---|
| Initial JS | 169.29 KB | **173.04 KB** | **+3.75 KB** |
| CSS | 6.95 KB | 7.56 KB | +0.61 KB |
| Total precache | 197.75 KB | 202.10 KB | +4.35 KB |

**Over the 170 KB target by 3.04 KB.** Two things were tried first:
`React.lazy` on the drawer, which made the bundle *larger* by 1.11 KiB (it
deferred 1.59 KiB while the entry chunk shrank by 0.46 KiB); and removing a
dead `description` field from the preset table, which was kept.

A **17.04 KB** saving was measured and deliberately not taken: three imports
from `@codemirror/commands` pull in `@codemirror/language` and lezer for a
product that installs no language mode. They provide undo/redo and the
standard editing keymap, so removing them without a replacement is a serious
editor regression. Recorded for M11 with the number and the trade-off in
`12_PERFORMANCE.md` §10.9.

### A note on the two flakes seen mid-milestone

Partway through, one full-matrix run showed two failures in
`workers-chromium` — a worker-termination test and a regex-dialect assertion.
Both passed in isolation immediately afterwards, and the final full run was
clean at 487 passed. Same signature as the environment flakiness characterised
at M7: wall-clock-dependent tests, now sharing one machine across twenty
browser projects rather than fourteen. No retry was added and no timeout was
raised.

### Defects found and fixed during M8

| Found by | Defect |
|---|---|
| Unit | `matchesPreset` looked up the preset the theme *claimed* to be, so after one custom edit a theme could never name a preset again — editing back to exactly Amber left no preset marked while displaying Amber. |
| Unit | Two store tests spied on `Storage.prototype`, which happy-dom does not route these writes through. The debounce test measured nothing and the storage-refusal test never entered the catch it existed to exercise. |
| **Sink audit** | `setTheme` trusted its callers. |
| **Sink audit** | `SURFACE_HEX` was `#0d1117`; `--color-surface` is `#101613`. The contrast guard reported confident ratios against a background the accent is never shown on. A test now reads the value out of `tokens.css`. |
| Spec review | The contrast guard was silent on a passing colour, where §4.5 specifies "✓ Passes AA". |
| **Visual review** | "Amber Console" was ellipsised to "Amber Consol…" — a chip whose whole job is to name a theme had stopped naming it. |
| Bootstrap review | The bootstrap clamped where the domain rejects, accepted any `fontScale` in a range rather than the four steps, and did not check `schemaVersion` at all — three ways to paint one theme and replace it. |

### Security

| Assertion | Evidence |
|---|---|
| No arbitrary CSS reaches `setProperty` | Every call takes a value rebuilt by `readTheme`; enforced at `setTheme`, not by comment |
| Hostile `localStorage` cannot inject | 18 payloads planted and reloaded in 3 engines |
| No script executes | Asserted: no dialog, no page error, no `img[src]`, no inline `<script>` |
| One corrupt field does not cost the theme | Asserted in unit and E2E |
| Validation is an allowlist | `/^#[0-9a-fA-F]{6}$/` positive match; nothing is stripped or escaped |
| Theme never enters a history record | E2E reads the IndexedDB records back and asserts no theme vocabulary |

Not claimed: that the theme system is unbreakable. Claimed: values reaching
`setProperty` have matched an explicit pattern, the check is a positive match
rather than a filter, and it is tested in three engines.

### Accessibility

axe clean (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) over the drawer, the
whole interface in high-contrast mode, the drawer in high-contrast mode, and a
custom theme with the analysis panes populated. Keyboard operation of every
control, focus trapping, Escape, and focus restoration all covered.

**One honest limitation** *(superseded at M10 — see the M10 section).* This
was recorded as "Playwright flips the media query without applying a real
forced palette". That was wrong: the browser does apply one. The unreliable
part is axe's `color-contrast` rule, which reads authored rather than computed
colours. M10 validates forced colors properly, against computed values.

### Dependencies added at M8

**None.** A colour picker, a theming library, a colour-maths package and an
icon set were each considered and rejected — `16_DEPENDENCIES.md`.

### Deviations at M8

| # | Deviation | Reason |
|---|---|---|
| D26 | **Direction is four named options, not a 0–359 slider** | The stored value is still a bounded `angleDeg`, so schema and bootstrap are unchanged. |
| D27 | **Accent is derived from the primary colour** | Coherence, and one fewer way to build an unreadable interface. |
| D28 | **Presets are named Deep Cyan and Amber Console** | Display names only; ids and values are exactly §4.3. |
| D29 | **`backgroundDarkness` is in the model but unimplemented** | Nothing reads it and no token exists for it. A control for a value with no effect would be theatre. |
| D30 | **Self-hosted `woff2` fonts (§5) are still not present** | Unchanged from M1. The files are not in the repository and M8 did not add them: sourcing typefaces and settling their licensing was out of scope. `tokens.css` says so where the stacks are defined. |
| D31 | **The drawer is imported eagerly** | `React.lazy` was measured and made the bundle larger. |

### Known limitations at M8

- **Initial JS is 3.04 KB over target.** Accepted, with the 17.04 KB M11 lead measured and recorded.
- **Forced colors is not truly validated** — see above.
- **T-15 has no automated check.** That the gradient appears in at most four places is a visual review, as the criterion specifies.
- **No light theme.** Deferred at V1.2+ by §8.3, untouched.
- **The syntax palette does not follow the accent.** Deliberate: it is an editor palette, and tying it to a user accent would make token colours collide.

---

## M9 — objective and outcome

**Objective:** make SyntaxLab genuinely offline-capable — not "has a manifest",
but "the network is cut and every analysis still runs".

**Outcome:** met for the offline guarantee. O-1 to O-11 pass against a real
service worker with the network genuinely disabled. Two items are qualified
rather than claimed: installability (O-12) is partial, and the "verified on a
preview deployment" half of the M9 definition of done is **outstanding**.

### Verification

| Check | Result |
|---|---|
| Typecheck | ✅ clean |
| ESLint / Stylelint / Prettier | ✅ clean (0 errors, 0 warnings) |
| Unit tests | ✅ **2 134 passed** (34 files, unchanged — M9 adds no domain logic) |
| E2E, PWA projects | ✅ **50 passed, 6 skipped** across Chromium, Firefox, WebKit, mobile |
| E2E, full matrix | **534 passed, 9 skipped, 3 failed** — see below |
| Production build | ✅ |
| Bundle | ⚠️ **174.52 KB initial** (target 170, hard 200) · 5.93 KB service worker · 226.00 KB total precache |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilities |
| Dependencies added | 1, build-time: `vite-plugin-pwa` |
| **Regex, JSON, History, Theme** | ✅ **unchanged** |

**The failures are not M9's, and fall into two known groups.**

*Scattered environment flakes.* Across the M9 full runs the failing set changed
every time — `json-chromium › suggestion can be dismissed`, then
`regex-firefox › clears the workspace`, then others — never the same test
twice, and each passes in isolation. That is the distribution characterised at
M7 and M8: wall-clock-dependent tests sharing one machine, now across 25
browser projects rather than 14. No retry was added and no timeout raised.

*One consistent, pre-existing failure.* The `regex-mobile` execution-timeout
tests fail repeatably in isolation. They were verified to fail **identically at
the M8 commit `a13910e`, and with the PWA plugin disabled**, while passing on
`regex-chromium`. Device-emulation specific, predates M9, and is recorded in
`13_TEST_PLAN.md` §16 as an open issue against the M4 tests rather than quietly
carried.

### Built

```
vite.config.ts                       VitePWA generateSW · prompt · no runtime caching
assets/icon.svg                      the authored mark
scripts/make-icons.mjs               renders the three PNGs via Playwright's Chromium
scripts/serve-production.mjs         dist/ with the REAL production headers
scripts/measure-pwa.mjs              the measurement harness
public/_headers                      + /sw.js and /workbox-*.js policy blocks
src/infrastructure/pwa/              registerServiceWorker.ts
src/application/pwa/                 pwaStore.ts, startup.ts
src/features/pwa/                    PwaStatus.tsx — chip, toast, banner
tests/e2e/offline.spec.ts            13 tests × 4 projects
tests/e2e/update.spec.ts             4 tests, isolated origin
```

### The decision that mattered most

**The service worker needed its own CSP, and finding that out required a new
kind of test.**

A worker takes its CSP from the headers on its own script; it does not inherit
the page's. Our site-wide `connect-src 'none'` is exactly right for the page —
it issues no requests — and fatal for Workbox, which precaches by calling
`fetch()` during install. Measured A/B on the real build: **under production
headers the worker never activated and cached nothing, silently, with no
console error in the page.**

The fix is a *narrower* policy for a different execution context — `/sw.js` and
`/workbox-*.js` get `default-src 'none'; script-src 'self'; connect-src 'self'`
— and the page's policy is byte-for-byte unchanged.

What makes this worth recording is that **the existing test suite could never
have caught it**: every E2E project runs against `vite preview`, which serves
no headers at all. It would have passed every check and failed only in
production, in the bug class `23_RISK_REGISTER.md` R-06 rates as the most
expensive this application can ship. `scripts/serve-production.mjs` exists so
that class is reachable from a test.

### The other decisions

**Registration is the platform API, not the plugin's helper.**
`injectRegister: null`. `virtual:pwa-register` pulls `workbox-window` into the
bundle, and the lifecycle we want is narrower than what it offers. Result: the
whole PWA layer cost **1.48 KB** of initial JS. Workbox still generates the
worker, because precaching and fetch handling are where a hand-rolled bug
persists across reloads.

**Nothing reloads the page except the user.** `skipWaiting: false`,
`clientsClaim: false`. A new version installs, waits, and is announced in a
dismissible banner. Asserted by marking the document and confirming it survives
while a new worker sits in `waiting`.

**Precache completeness was verified, not assumed.** Ten entries, checked
against the real cache: both worker chunks, `theme-bootstrap.js`, the manifest,
the icons. A missing worker chunk turns every offline analysis into a silent
failure and works perfectly in development.

### Performance — measured

`npm run measure:pwa`, Chromium, production build, production headers.

| Measurement | Value |
|---|---|
| First visit, cold FCP | 115.0 ms |
| Warm FCP, served by the worker | **26.5 ms** |
| Offline FCP, network cut | **24.1 ms** |
| Time until offline-capable | 208 ms |
| First analysis after an offline reload | 6 ms |
| Precache | 10 entries, 663.97 KB on disk |

### Bundle

| | M8 | M9 | Delta |
|---|---|---|---|
| Initial JS | 173.04 KB | **174.52 KB** | +1.48 KB |
| Service worker | — | 5.93 KB | new |
| CSS | 7.56 KB | 7.73 KB | +0.17 KB |
| Icons + manifest | — | 15.81 KB | new |
| Total precache (gzipped) | 197.75 KB | 226.00 KB | +28.25 KB |

Still over the 170 KB target, by 4.52 KB, and 25.5 KB under the hard budget.
The 17.04 KB CodeMirror lead measured at M8 is untouched and still the
available move when it is worth the editor risk.

`sw.js` and `workbox-*.js` are budgeted separately — counting them as initial
page JS inflated the figure by 7.37 KB while the entry chunk did not grow. The
same correction, for the same reason, as the worker-chunk split at M5.

### Defects found and fixed during M9

| Found by | Defect |
|---|---|
| **A/B under production headers** | The service worker could not precache at all under the site CSP. Silent, production-only. |
| The missing-API test | `'serviceWorker' in navigator` is true when the property exists and is `undefined` — how a locked-down profile presents it. Reading through that guard threw **before first render**, blanking the app over a feature it does not need. |
| Firefox | The test helper selected the precache by `keys()[0]`; browsers do not agree on that order, and a planted foreign cache made it pick the wrong one. |
| WebKit, online | `upgrade-insecure-requests` in the production CSP makes WebKit rewrite every subresource to `https://localhost`, which the local header server cannot serve. Chromium and Firefox exempt localhost. Dropped for local serving only, with every worker-relevant directive left exactly as production sends it. |

### Security

| Assertion | Evidence |
|---|---|
| The page CSP is unchanged | `public/_headers` diff: the `/*` block is untouched |
| The worker's policy is narrower, not weaker | `default-src 'none'; script-src 'self'; connect-src 'self'` — no style, image, font or frame permission at all |
| No user data in Cache Storage | A distinctive string is typed, allowed to reach history, and every text response in Cache Storage is read back and asserted not to contain it |
| Cleanup touches only our cache | A foreign cache is planted on the origin and verified to survive |
| One registration, root scope | Asserted |
| No blob or inline worker URLs | Registration is a literal `/sw.js`; `worker-src 'self'` unchanged |
| The app survives without a worker | Verified with `navigator.serviceWorker` removed before any app code runs |

### Dependencies added at M9

**One, build-time:** `vite-plugin-pwa` 1.3.0 (documented as `^0.20`, which
predates Vite 7). devDependency. Its runtime helper is deliberately unused.
0 vulnerabilities.

### Deviations at M9

| # | Deviation | Reason |
|---|---|---|
| D32 | **`vite-plugin-pwa` 1.3.0, not `^0.20`** | `^0.20` does not support Vite 7. |
| D33 | **Registration is hand-written against the platform API** | The plugin's helper adds `workbox-window` to the bundle for a lifecycle wider than the one we want. Kept the layer to 1.48 KB. |
| D34 | **No `share_target`, `file_handlers`, `protocol_handlers`** | As `07_PWA_OFFLINE.md` §6 already specifies. |
| D35 | **No cron shortcut in the manifest** | The mode does not exist in V1.0; promising it in metadata is the defect a disabled tab would be. |
| D36 | **`upgrade-insecure-requests` is dropped by the local header server** | Test-harness only; production sends it. Every directive governing the worker is served as production serves it. |
| D37 | **The update suite is Chromium-only, on its own origin** | It must rewrite the bytes being served, which cannot be run concurrently against itself or against a shared `dist/`. |

### Known limitations at M9

- **Offline on real Safari is unverified by automation.** Playwright 1.62.1 cannot navigate WebKit under `setOffline` — and fails identically with no service worker registered, so it is the harness. Six tests skip there; seven run and pass. A manual pre-release check.
- **The preview-deployment verification is outstanding**, and is the one half of the M9 definition of done not met. Deploying is outside this milestone's remit; it stays a release gate, and the new header block is exactly what must be confirmed there.
- **Installability is asserted structurally, not by Lighthouse.** Manifest, icons, scope, `start_url` and a registered worker are all verified; Lighthouse was not run, and Firefox desktop offers no install prompt regardless.
- **The update flow is tested on Chromium only.**
- **`regex-mobile › survives two timeouts in a row` fails in isolation** — pre-existing, verified at the M8 commit and with the PWA disabled. An open issue against the M4 execution-timeout tests.
- **No runtime caching**, deliberately. The app makes no requests that were unknown at build time, and `connect-src 'none'` blocks the APIs that would make them.

---

## M10 — objective and outcome

**Objective:** the hardening milestone — accessibility, security audit, and the
theme decision the product owner added to it. No new features.

**Outcome:** the theme change is done exactly as specified and pinned by tests.
The audit and the accessibility work are done. **Three things are not, and are
named rather than absorbed:** the screen-reader pass, the Lighthouse
accessibility score, and CSP verification on a preview deployment.

### Verification

| Check | Result |
|---|---|
| Typecheck | ✅ clean |
| ESLint / Stylelint / Prettier | ✅ clean (0 errors, 0 warnings) |
| Unit tests | ✅ **2 155 passed** (35 files, +21 from M9) |
| E2E, full matrix | **601 passed, 9 skipped, 1 failed** across 26 projects |
| Production build | ✅ |
| Bundle | ⚠️ **174.81 KB initial** (target 170, hard 200) · +0.29 KB from M9 |
| `npm audit` | ✅ 0 vulnerabilities at `--audit-level=low` |
| JSONTestSuite | ✅ **644 conformance tests**, corpus byte-identical |
| Execution-sink scan | ✅ none exist anywhere in the repository |
| Runtime dependencies | 5, unchanged, all exact-pinned |

The single E2E failure was `json › suggestion can be dismissed`, which passes
in isolation — the scattered environment flake characterised at M7, a different
test each run.

### The theme decision

**Matrix is now the four specified colours, exactly**, as a real four-stop
ramp: `#00FF41 → #008F11 → #003B00 → #0D0208`. A two-stop approximation of a
four-colour ramp is a different palette, so the gradient model gained two
middle stops. They are written down in exactly one place — the `--matrix-*`
primitives — and everything else references them. The old `#00ff88` / `#003d1f`
are gone from the repository.

**Crimson Night uses `#DC143C` and `#343434`, exactly.** `#DC143C` measures
**3.67:1** against the interface surface, below AA. The rule is to move the
derived token and never the colour that was asked for, so the accent — which
carries the focus ring — is `lightenToPass('#DC143C')` = **`#e34363` at
4.58:1**. The gradient still shows `#DC143C`.

Schema 1 → 2, with migration: a version-1 record keeps its two colours and has
its middle stops interpolated, reproducing exactly what it was already
painting.

Measured contrast for all six presets is recorded in `09_DESIGN_SYSTEM.md`
§12.3 and asserted by a test that reads the fixed tokens **out of `tokens.css`**
rather than restating them.

### Forced colors — a correction, and what it enabled

M8 and M9 both recorded that the harness could not really exercise forced
colors: "flips the media query without applying a real forced palette". **That
was wrong.** Measured at M10: the browser does apply one — `body` computes to
the system foreground on the system background and background *images* are
dropped. What is unreliable is **axe's `color-contrast` rule**, which reads
authored rather than computed colours. The 29 nodes M9 dismissed were axe
misreading, not the emulation failing.

Both documents are corrected in place rather than left standing.

Because of the correction, forced colors is now genuinely validated, on
computed values, on two engines with opposite polarities (Chromium light,
Firefox dark). **It immediately found a defect:** with the palette forced,
every mode-selector segment lost its surface and an *unselected* tab rendered
as bare text with no border — it stopped reading as a control. Fixed.

Two further measurements worth keeping: `test.use({ forcedColors })` inside a
`describe` does not reach the page at all, and `page.emulateMedia()` does.

### The security audit

Every sink in the repository was enumerated, not sampled.

| Finding | |
|---|---|
| Execution sinks | **None.** `innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function`, `document.write`, `insertAdjacentHTML` appear nowhere in `src/`, `public/`, `scripts/` or `tests/`. |
| CSS sinks | 9 `setProperty` calls, all theme, all behind `readTheme` at the `setTheme` choke point |
| URL sinks | One `createObjectURL` (export, revoked immediately), two `location.reload` behind user actions, one `new URL(location.href)` for the `?mode=` enum check |
| Worker boundary | Validated both ways; unchanged since M2/M4 |
| Prototype pollution | Structural — the JSON CST is an array of pairs, `toPlainValue` uses `Object.create(null)` + `defineProperty`, and the import reviver drops `__proto__` |
| CSP | Reviewed, unchanged. No `unsafe-eval`, no new origins. The service-worker block from M9 is a *narrower* policy for a second context; the page's is byte-for-byte unchanged. |
| Supply chain | 5 runtime dependencies, exact-pinned; 0 vulnerabilities at `--audit-level=low` |

**The regex invariant is now proved by the module graph**, not by review: one
`new RegExp` in the codebase, and every main-thread reference to that module is
an `import type` that TypeScript erases. No main-thread path can run a user
pattern even by mistake.

Hostile payloads — 8 shapes — were driven through the regex editor, JSON keys
and values, history via the UI, history planted directly in IndexedDB, and
history search. No dialog, no injected element, no inline script, no
`javascript:` href.

### Defects found and fixed during M10

| Found by | Defect |
|---|---|
| **Forced-colors validation** | An unselected mode tab had no border and stopped reading as a control. |
| Wiring the palette | A temporal-dead-zone crash: `DEFAULT_THEME` is built at module load and now calls `lightenToPass`, which read `SURFACE_HEX` declared later. The whole theme module threw on import. |
| Writing the contrast audit | The first draft restated `--gray-300` as `#c3d2c9`; the real token is `#9aada3`. It now reads `tokens.css`. |
| Auditing the M9 docs | The forced-colors claim in two documents was wrong in mechanism. |
| Test review | The focus-trap assertion checked the wrong property, and the focus-visibility assertion checked only the focused node — CodeMirror sets `outline: none` on itself and the wrapper draws the ring. |

### Known issues, classified

**`regex-mobile › survives two timeouts in a row`** — still failing, 3 runs out
of 3 in isolation. Not M10's: it fails identically at the M8 commit `a13910e`
and with the PWA plugin disabled. It is a hard-coded **15 s assertion budget
inside the test** on an emulated Pixel 5 after two deliberate 2 s timeouts;
raising `--timeout` changes nothing. The architecture is green — 18 worker
timeout/terminate/respawn tests pass across three engines, and
`regex-chromium` passes this same test. Open against the M4 tests, not
concealed with a retry.

### Not done, and why

| Item | State |
|---|---|
| **Screen-reader pass (A-15, 10.2)** | **NOT RUN.** NVDA and JAWS are not installed; Narrator exists but cannot be driven or heard from a non-interactive shell. The accessibility *tree* is audited instead — every control checked for a name, plus landmarks, exposed state and live regions — which is the data a screen reader consumes, not the experience of using one. Release gate. |
| **CodeMirror screen-reader decision (Q-12, 10.7)** | Cannot be decided without the above. |
| **Lighthouse ≥ 95 (A-18)** | Not run. axe is clean across the workspace, both drawers, high-contrast mode and a custom theme; the two are not equivalent. |
| **CSP on a preview deployment (10.9)** | Still open from M9. Deploying is outside the milestone's remit. |
| **CVD simulation (A-11)** | Visual review only. |

### Dependencies at M10

**None added, none changed, none removed.** 5 runtime, 28 dev.

### Deviations at M10

| # | Deviation | Reason |
|---|---|---|
| D38 | **The gradient carries four stops, not two** | The specified Matrix palette is a four-colour ramp; two stops would be a different palette. Schema 1 → 2 with migration. |
| D39 | **Crimson Night's accent is not its primary colour** | `#DC143C` is 3.67:1. The derived token moves; the specified colour does not. |
| D40 | **`--green-500` now resolves to `--matrix-bright`** | So there is one canonical Matrix value rather than a near-duplicate green for success and selection. |
| D41 | **Forced colors is asserted on computed values, not via axe** | axe reads authored colours in that mode. Measured. |
| D42 | **The a11y-tree suite is Chromium-only** | It reads `ariaSnapshot`, and one engine's accessible-name computation is enough to catch a *missing* name, which is what it is for. |

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
- **Chromium only** in E2E. Firefox and WebKit are added at M12. *(Superseded: they arrived at M2, and by M12 all four targets run the full journey set.)*
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
| M6 | ✅ | ✅ | ✅ 1 947 | ✅ 295 (3 skipped) | ✅ | ✅ 0 vulns | **J-2 passed** — JSONTestSuite 95/188/35; JSON UI; bundle 158.12 KB |
| M5 | ✅ | ✅ | ✅ 1 252 | ✅ 167 (3 skipped) | ✅ | ✅ 0 vulns | JSON domain; 4 000-document differential; coverage 97.5%; bundle metric corrected |
| M4 | ✅ | ✅ | ✅ 859 | ✅ 146 (3 skipped) | ✅ | ✅ 0 vulns | **Bundle checkpoint passed — 162.54 KB vs 170 KB target.** CodeMirror measured at 88 KB, not the ~150 KB estimated |

---

## M10 theme correction pass — objective and outcome

**Objective:** Crimson Night shipped with the two specified colours exactly
right and still looked green. Find every source of that and fix it at the
architectural level, not per component.

**Outcome:** found by measurement, fixed at one choke point, and pinned by two
audits plus twelve unit tests and six E2E tests.

### What was actually green

Not the gradient — the chrome, which is why changing two stops would not have
fixed it.

| Source | Detail |
|---|---|
| The shared neutral ramp | `--gray-900` was `#101613`, six units greener than red. Surfaces, borders and the sunken panel all resolved to it, in **every** theme. |
| Six accent-adjacent tokens | `--color-accent-hover/active/text`, `--color-focus`, `--color-selection`, `--color-match-a` were hard-wired to `--green-*` regardless of theme. |
| `--color-surface-sunken` | `#070a09`, a green literal the ramp change alone would have missed. Caught by the static audit. |
| Mono's own colours | `#9aada3` on `#1f2a24` — the old tinted greys, making the "no colour" preset the second-greenest one. Caught by the runtime audit. |
| Editor decorations | `--syntax-rx-meta` was `--green-500`; `\|` measured **`#3ddc84`** with Crimson Night selected. |

None of these contain the word "green". They were found by resolving every
`var()` chain to a literal and classifying its hue, then by reading *used*
values out of a real browser with each preset selected.

### The fix

One architectural change: a **theme family** attribute on `<html>`. The neutral
ramp is the default and the green tint is the exception, so a preset that
forgets to declare a family gets neutral greys — wrong-looking, never green.
The accent-adjacent tokens are now derived from `--color-accent` via
`color-mix()` rather than from a fixed hue. Six tokens changed; no component
did. Full detail in `09_DESIGN_SYSTEM.md` §13.

**`--color-accent` is now the specified colour exactly** and only
`--color-accent-legible` is lightened. Previously the lightened companion *was*
the accent, which made Crimson Night drift toward pink.

### Verification

| Check | Result |
|---|---|
| Typecheck / ESLint / Stylelint / Prettier | ✅ clean |
| Unit tests | ✅ **2 167 passed** (36 files, +12) |
| `theme` E2E — Chromium, Firefox, WebKit | ✅ **48 passed** per engine |
| `a11y` + `hardening` E2E | ✅ **121 passed** |
| `npm run audit:hues` | ✅ no green outside the green family |
| `npm run audit:themes` | ✅ **"No green in the decorative tokens of any non-green theme"** — all six presets |
| Bundle | ⚠️ **175.05 KB initial** (+0.24 KB; target 170, hard 200) |
| Dependencies | **None added.** `color-mix()` is a browser feature. |

Three existing tests failed on the corrected behaviour and were updated, not
suppressed: the Crimson accent assertion (now inverted by design), Mono's
persisted grey, and the recorded Mono contrast ratio (7.75 → **7.53**, the true
figure for `#a6a6a6`).

### Deviations

| # | Deviation | Reason |
|---|---|---|
| D43 | **Themes carry a `family` attribute** | The only way to give one family a tinted ramp without every token knowing about themes. Schema gains `family` and `accentLegible`, both repaired on read. |
| D44 | **The focus ring is theme-derived, not fixed** | It was fixed green to guarantee visibility, which meant a green ring in Mono. It is now `lightenToPass(accent)` — themed, and guaranteed ≥ 4.5:1 by construction rather than by being frozen. `23_RISK_REGISTER.md` corrected. |
| D45 | **The syntax palette lost its greens** | Editor decorations are theme surface. Replaced with yellow and blue; this also removes the green/red pair and *improves* CVD distinguishability (A-11). |

### The claim, precisely

**Non-green themes contain no green as a decorative/theme hue.** Not "no green
pixels anywhere" — `--color-success` is `#00FF41` in every theme including
Crimson Night, because green *means* success in this design system and breaking
that to satisfy a visual rule would trade a real signal for a cosmetic one.

---

## M11 — objective and outcome

**Objective:** the refinement milestone. Make what exists faster, smoother and
more coherent — by measuring first, not by rewriting.

**Outcome:** one real bottleneck found and fixed, one long-outstanding feature
built, three areas measured and deliberately left alone, and the initial bundle
back **inside its 170 KB target for the first time since CodeMirror arrived at
M4**. No dependency added.

### The method

Every change below started as a number. Two measurement tools were written
first — `scripts/measure-m11.mjs` for interaction latency and
`scripts/analyze-bundle.mjs` for bundle composition — and the full baseline is
in `12_PERFORMANCE.md` §12.1.

### What the baseline said

Everything was under 300 ms except one thing:

| | |
|---|---|
| Startup, cold / warm / offline (FCP) | 117 / 134 / 117 ms |
| Regex analysis, five pattern shapes | 216–272 ms |
| JSON, 98 KB / 488 KB / 977 KB | 75 / 129 / 194 ms |
| Tree expand-all, format, history, theme | 87 / 76 / 31 / 43 ms |
| **Regex execution, 64 KB subject** | **1110 ms** |

### The two changes that mattered

**1. One keybinding was importing the Lezer stack.** `standardKeymap` binds
Enter to `insertNewlineAndIndent`, which reads the syntax tree — the only thing
in SyntaxLab reaching `@codemirror/language`, `@lezer/highlight` and
`@lezer/common`. The app configures no language at all, so that code could
never do anything. The keymap is rebuilt binding for binding from the
individual command exports, with Enter on the language-free
`insertNewlineKeepIndent`.

**Initial JS 175.05 → 165.34 KB.** The ceiling was measured at 160.56 KB by
dropping the keymap entirely; the difference is the movement commands, which
are kept because bidi, word boundaries and grapheme clusters are the last
things worth reimplementing.

**2. Ten thousand match rows were being rendered at once.** 130 002 DOM nodes,
349 ms of layout, 162 ms of style, 36 MB of heap. `table-layout: fixed` and
`content-visibility: auto` were both measured first and both did nothing — the
cost is creating the nodes. The table now renders 200 with a "Show 200 more"
control.

| 200 KB subject, 12 800 matches | before | after |
|---|---|---|
| wall | 1629 ms | **755 ms** |
| DOM nodes | 130 002 | **2 684** |
| heap | +36 MB | **+10 MB** |

600 ms of the remaining 755 is the input debounce, which was verified as
appropriate and deliberately left alone (`12_PERFORMANCE.md` §12.4).

### The split, finally

`08_UI_UX_SPEC.md` §5 has specified a draggable divider since M1 and
IMPLEMENTATION_STATUS has carried it as "queued for M11" since M4. Built, in
both workspaces, with no library: clamped 25–75 so it cannot hide a panel,
fully keyboard-operable, persisted, and removed from the accessibility tree
when the layout stacks. The drag writes a CSS custom property rather than React
state, so it does not reconcile a 200-row table on every pointermove.

### Measured and left alone

Recorded so a later milestone does not repeat the work.

| Area | Finding |
|---|---|
| **Large JSON** | Keystroke latency 5–9 ms from 98 KB to 977 KB, and **42 tree rows in the DOM regardless of document size** — the windowing works. Search 19 ms at 1 MB, collapse-all 114 ms, minify 79 ms. No change warranted. |
| **React rendering** | Commit counts on the production build: ~1 per keystroke, 2 per mode switch, **1 for a theme change**. No `memo`, `useMemo` or `useCallback` was added anywhere. |
| **Visual cost** | Zero `backdrop-filter`, zero blur filters, zero `@keyframes`, one `box-shadow`, five transitions all on cheap properties. The design system already forbade what a visual audit looks for. |
| **Desktop layout** | Reviewed at 1280/1440/1920. Nothing cramped, no change made. |

### Verification

| Check | Result |
|---|---|
| Typecheck / ESLint / Stylelint / Prettier | ✅ clean |
| Unit tests | ✅ **2 167 passed** (36 files) |
| E2E, full matrix | **649 passed, 9 skipped, 1 failed** across 31 projects |
| Production build | ✅ 3.2 s (7.6 s with `tsc`) |
| **Initial JS** | ✅ **166.16 KB** — under the 170 KB target, 33.8 KB under the hard limit |
| Lighthouse | Performance 73 → **78**, Accessibility 98 → **100**, Best Practices 100, SEO 91 |
| `npm audit` | ✅ 0 vulnerabilities at `--audit-level=low` |
| Execution-sink scan | ✅ none anywhere; no dynamic imports; CSP untouched |
| Runtime dependencies | 5, unchanged, all exact-pinned |

The single failure is classified, not concealed: **`json-mobile › the
suggestion can be dismissed`** passes in isolation. It is the scattered
contention flake characterised at M7 — a different test each full-matrix run
under eight workers, always passing alone.

### The M10 mobile timeout failure appears to have been fixed as a side effect
*(Superseded at M12 — the real cause was `locator.fill()` appending on mobile
emulation, not this milestone's speed. See the M12 section.)*

`regex-mobile › survives two timeouts in a row` has been failing since M8. M10
characterised it precisely: not a product defect, but a hard-coded **15 s
in-test assertion budget** on an emulated Pixel 5 after two deliberate 2 s
timeouts.

After M11 it **passes — three runs out of three in isolation, and in the full
matrix.** Nothing was done to the test or to the worker architecture. The most
likely explanation is the obvious one: this milestone removed enough work from
the path that the run now fits inside the budget it was overrunning.

Stated as it is rather than as a fix: it is a **marginal test that now passes**,
not a proven repair. If it fails again on slower hardware, the fix is the one
M10 named — the budget belongs in the test, not in the product.

### Defects found and fixed during M11

| Found by | Defect |
|---|---|
| **Lighthouse `heading-order`** | `Panel` titles were `h3` under the page's single `h1` — a level-2 gap a screen-reader user navigating by heading would hit. Now `h2`. Accessibility 98 → 100. |
| **Layout-shift observer** | The editor's minimum height existed only inside CodeMirror's theme, which applies after mount, so the column jumped on every load. Second-visit CLS 0.0257 → **0.0022**. |
| **Mobile screenshot review** | Below 560 px the header was a stretch column, so the lone Appearance button ran full width and read as a text field, in a three-row *sticky* header. 145 → 113 px at 360 and 390. |
| **Writing the match-list test** | The first draft of the indent assertion counted a line that does not exist. The behaviour was right; the expectation was wrong. |

### Not done, and why

| Item | State |
|---|---|
| **Screen-reader pass** | **NOT RUN.** Unchanged from M10 — NVDA and JAWS are not installed and Narrator cannot be driven from a non-interactive shell. The splitter's accessibility is asserted through roles, values and keyboard operation, which is the data a screen reader consumes, not the experience of using one. Release gate. |
| **CVD simulation** | **NOT RUN.** No simulator available. Unchanged from M10, where removing green from the syntax palette improved the position on paper. Release gate. |
| **Lighthouse ≥ 95** | Baseline recorded (78). An M12 gate, deliberately not pursued as an M11 requirement. |
| **CSP on a preview deployment** | Still open from M9. Deploying is outside this milestone. |
| **Low-powered device latency** | **NOT MEASURED.** Lighthouse's 4× CPU throttle is a simulation, not a phone. Named rather than absorbed. |

### Dependencies at M11

**None added, none changed, none removed.** 5 runtime, 28 dev. Lighthouse was
run through `npx` and is not in `package.json`; `rollup-plugin-visualizer` was
already a dev dependency.

### Deviations at M11

| # | Deviation | Reason |
|---|---|---|
| D46 | **`standardKeymap` is rebuilt locally rather than imported** | One binding reached the whole Lezer stack for 9.71 KB, in an app with no language configured. All other bindings are still upstream's functions. Costs the bracket-explode on Enter, which needs bracket auto-closing the editor does not have. |
| D47 | **The match table renders progressively rather than being virtualised** | `12_PERFORMANCE.md` §3.3 specified windowing. Match rows are not a uniform height — a value runs to 2 000 characters — so fixed-row windowing does not transfer. Same outcome, different means. |
| D48 | **Mobile keeps the stacked layout rather than adopting tabs** | `08_UI_UX_SPEC.md` §18 specifies tabs. Tabs put the input and its result on opposite sides of a mode switch, which is the loop the user is iterating on. Evaluated at 360/390/414 px with zero overflow and green a11y suites. |
| D49 | **`jsx-a11y`'s separator rules are configured, not obeyed** | ARIA 1.2 defines a focusable separator as the window-splitter widget. The role allowlist is used where the rule offers one, and the sibling rule is silenced at the single element rather than by narrowing its handler list globally. |

---

## M12 — objective and outcome

**Objective:** the release gate. Try to break SyntaxLab before a user does.

**Outcome:** **ready to release, with three gates open and named.** The full
browser matrix is clean for the first time in the project's history — and it is
clean because every flake the project had been carrying turned out to have a
real cause, and all of them were found and fixed rather than classified again.

The full checklist, with every row marked PASS, FAIL, NOT RUN, ACCEPTED RISK or
ENVIRONMENT LIMITATION, is [`docs/25_RELEASE_READINESS.md`](docs/25_RELEASE_READINESS.md).

### The headline: the flakes were never flakes

M7 characterised a "scattered environment flake — a different test each run".
M10 investigated the mobile timeout failure and concluded it was a hard-coded
in-test budget. M11 saw it start passing and recorded that as a probable side
effect of the milestone. **All of that was wrong**, and M12 found each actual
cause:

| Carried since | Real cause |
|---|---|
| M8 — `regex-mobile › survives two timeouts in a row` | `locator.fill()` **appends** rather than replaces on a CodeMirror contenteditable under mobile emulation. Measured on both targets: filling `a+` over `(a+)+$` leaves `(a+)+$a+` on Pixel 5 and `a+` on desktop. The app correctly timed out on a pattern that was still catastrophic. |
| M7 — `json-mobile › the suggestion can be dismissed` | Three different buttons were named exactly "Dismiss". When the service worker finished installing mid-test, a second one appeared and the locator became ambiguous. |
| — `history-webkit › a record from a newer version is kept` | The test opened IndexedDB while the app's own open was in flight; on WebKit that settles **no** event — not success, not error, not blocked. |
| — `theme-webkit › a valid field survives beside a corrupt one` | Read `--color-accent` at one instant during the pre-paint → hydration handover. Both engines settle identically; WebKit takes ~50 ms. |

One of those four was a product defect and is fixed in the product: three
buttons sharing a bare accessible name is an ambiguity for a screen-reader user
too, not just for a locator. The other three were tests reaching around the
application.

**Full matrix now: 674 passed, 0 failed, 11 skipped — twice in a row.**

**One flake remains, and it is a different animal.** The three `workers`
projects are the only ones driving the Vite **development** server, because the
real worker harness needs a global that production compiles out. Under the
eight-way parallel matrix that single dev server is a shared bottleneck and the
wait for the harness global occasionally overruns; the same test passes 3/3
alone and its project passes 22/22. It cannot reach the shipped artefact, and
it is documented rather than papered over with a retry or a longer timeout.

### What was built

| | |
|---|---|
| `tests/e2e/release-qa.spec.ts` | The four user journeys, end to end, on four targets, against the production build under production headers, watching for CSP violations and page errors throughout |
| `tests/e2e/release-gates.spec.ts` | Served headers compared against `public/_headers` directive by directive, installability including PNG dimensions read from each IHDR, and 1 000 history entries |
| `scripts/audit-cvd.mjs` | Colour-vision-deficiency measurement, closing a gate open since M10 |
| `README.md` | Written at M12 as `24_README_PLAN.md` always said it would be |
| `docs/25_RELEASE_READINESS.md` | The gate itself |

### Defects found and fixed

| Found by | Defect |
|---|---|
| **The flake investigation** | Three buttons named "Dismiss" with nothing to tell them apart. Each now says what it dismisses; the visible text is unchanged and the accessible name still begins with it. |
| **Visual QA at 390 px** | A valid JSON document rendered a titled, empty "Findings" panel. The panel now asks the same question its contents do. |
| **Writing the journeys** | Four test assertions that were wrong before the product was — the invalid-pattern wording, the history capture delay, `:focus-visible` versus programmatic focus, and assuming `(a+)+$` times out on every engine when JavaScriptCore optimises it. |

### The three open gates

None blocks a release. Each says what would close it.

| | State |
|---|---|
| **Real Cloudflare preview deployment** | **NOT RUN — no credentials.** No API token, no `wrangler.toml`, no linked project in this environment. The most production-faithful local server available was used instead, serving real `dist/` with the real `_headers`, asserted by test. M13's work by definition. |
| **Screen-reader pass** | **NOT RUN — environment limitation.** Unchanged since M10. The accessibility *tree* is asserted instead, which is the data a screen reader consumes. |
| **CVD separation** | **ACCEPTED RISK — measured for the first time at M12.** Under achromatopsia two token colours sit at ΔE 1.9. A fix was attempted and measured: it moved the crowding rather than removing it. Accepted because every construct is also named in words. |

### Verification

| Check | Result |
|---|---|
| Typecheck / ESLint / Stylelint / Prettier | ✅ clean |
| Unit tests | ✅ **2 167 passed** (36 files), incl. 644 JSONTestSuite cases |
| E2E, full matrix | ✅ **674 passed, 0 failed, 11 skipped**, twice consecutively |
| Production build, clean tree | ✅ reproducible |
| **Initial JS** | ✅ **166.22 KB** — inside the 170 KB target |
| Lighthouse | Performance 78 · **Accessibility 100** · Best Practices 100 · SEO 91 |
| `npm audit` | ✅ 0 vulnerabilities at `--audit-level=low` |
| Execution / network sink scan | ✅ none anywhere in the repository |
| Performance regression | ✅ every metric at or better than M11 |

All 11 skips are WebKit engine or harness limitations, listed individually in
the readiness document.

### Dependencies at M12

**None added, none changed, none removed.** 5 runtime, 28 dev. Lighthouse and
`wrangler` were both invoked through `npx` and neither is in `package.json`.

### Deviations at M12

| # | Deviation | Reason |
|---|---|---|
| D50 | **The local production server drops one CSP directive** | `upgrade-insecure-requests` on an HTTP localhost origin makes WebKit rewrite every subresource to `https://localhost`, where nothing listens. A no-op on the HTTPS production origin. Asserted as the only difference, by a test that reads `_headers`. |
| D51 | **The README ships without a live link or badges** | There is no deployment and no git remote yet, so both would be promises rather than facts. Added at M13, when there is an address behind them. |
| D52 | **CVD is reported, not gated** | The measurement exists and is recorded; a threshold that fails the build would either be set below what the palette achieves, which is theatre, or block a release over a rare deficiency the interface already mitigates with text. |

---

## Post-M12 — the brand mark

**Not a milestone.** A branding fix applied after the first public push: the
live site was showing the browser's blank-document glyph in the tab, because
`index.html` declared no `rel="icon"` at all and the fallback request for
`/favicon.ico` found nothing.

**The mark** is an angular **S** framed by the two slashes of a regex literal —
`/S/`. Full write-up, with the asset-flow diagram, in
[`09_DESIGN_SYSTEM.md` §16](docs/09_DESIGN_SYSTEM.md).

Two things worth recording here:

**The existing icon was stale and nobody had noticed.** `assets/icon.svg` still
used `#00ff88` and `#1fbf6b` — the pre-M10 green, retired when the M10
correction pass adopted the specified Matrix palette. It now uses `#0D0208`,
`#00FF41` and `#008F11`, so the icon and the product finally agree.

**The design was fixed by looking at it at 16 px, not at 512.** The first
attempt had a 54 px stroke with the bars 84 apart — a 30 px counter inside a
54 px stroke — and below about 32 px the letter filled in and read as a blob
with two notches. The second attempt fixed the counters but kept the delimiters
at every size, and at 16 px they took the width the S needed. The shipped
version drops them below 48 px and crops the viewBox to the letter.

| Asset | Sizes | Bytes |
|---|---|---|
| `public/favicon.svg` | scalable | 456 |
| `public/favicon.ico` | 16 · 32 · 48 | 986 |
| `public/apple-touch-icon.png` | 180 | 2 207 |
| `public/icons/*.png` | 192 · 512 · maskable 512 | 12 458 |

**16.1 KB total, none of it in the JavaScript bundle.** No dependency was
added: the rasters come from the Chromium that Playwright already installs, and
the `.ico` container is thirty lines against the documented format.

### Verification

| Check | Result |
|---|---|
| Typecheck / ESLint / Stylelint / Prettier | ✅ clean |
| Unit tests | ✅ 2 167 passed |
| Full E2E matrix | ✅ **681 passed**, 11 skipped, of 682. The one failure is a different `workers-firefox` test on each run — the Vite dev-server contention flake documented in `25_RELEASE_READINESS.md` §3, which passes 3/3 in isolation and has nothing to do with icons |
| Icon assets resolve on all four targets | ✅ Chromium, Firefox, WebKit, Pixel 5 |
| `favicon.ico` structure | ✅ parsed: 3 PNG entries, dimensions read from each IHDR |
| Precache | ✅ all six icons, after adding `ico` to `globPatterns` |
| Initial JS | ✅ unchanged — icons are static assets |
| CSP | ✅ unchanged; `img-src 'self'` already covered them |

**One test caught a real thing about the product.** The first version of the
cross-engine check called `fetch()` from inside the page and failed on every
engine — correctly, because the app ships `connect-src 'none'`. Icons are
`img-src`, a different directive; asking the document to fetch them was testing
the CSP rather than the icons. The check now uses the test's own HTTP client.
