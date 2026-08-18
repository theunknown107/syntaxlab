# 01 — Product Requirements Document

**Project:** SyntaxLab
**Phase:** 1.5 (documentation revision — no implementation)
**Status:** Scope locked, awaiting Phase 2 approval
**Last updated:** 2026-08-17

---

## 1. Problem

Developers constantly encounter dense, non-obvious syntax:

| Syntax | Why it hurts |
|---|---|
| Regular expressions | Write-only. A pattern written six months ago is unreadable today. Errors are silent — a wrong pattern still "works", it just matches the wrong things. |
| JSON | Usually fine until it isn't. When a 4 MB payload fails to parse, the browser says `Unexpected token } in JSON at position 918342` and nothing else. |
| Cron expressions *(V1.1)* | Five opaque fields with per-field semantics, an infamous day-of-month/day-of-week OR-rule, and timezone/DST behaviour that differs per scheduler. |

The existing tooling landscape is fragmented and, in most cases, hostile to the two things developers actually care about at that moment:

1. **Privacy.** Existing regex/JSON tools are almost universally server-round-tripping or ad-funded. Developers routinely paste production payloads, internal API responses, and customer records into them. That is a data-exfiltration event with a nice UI.
2. **Speed.** They are heavy pages with ad slots, cookie banners, and multi-second loads for what is a sub-millisecond computation.

### The specific gap

Validators say **"valid"** or **"invalid"**. That is the least useful bit of information available. The user already suspects something is wrong; what they need is *what it means* and *where it broke*. SyntaxLab's differentiator is the explanation layer, generated from a real parse tree rather than string heuristics.

---

## 2. Product promise

> **Paste confusing developer syntax. Understand it instantly.**

Supporting promises, all of which are testable:

- Your input is processed locally in your browser; the application makes no network requests to send it anywhere.
- It works with the network cable unplugged, after the first load.
- The UI stays responsive no matter what you paste at it.
- It explains, it does not just validate.

---

## 3. Release strategy — LOCKED

This is the central decision of the Phase 1.5 revision, and it supersedes the ambiguity in the original Phase 1 package.

### 3.1 The history of the decision

The source playbook rated this concept at **difficulty 1.5/5, 3–4 days**. The Phase 1 documentation, following the brief's instruction to "architect a stronger, production-quality implementation", specified custom parsers for three languages, fuzz and differential testing, a full WCAG pass, PWA offline support, a threat model, and a worker-isolated execution sandbox.

**Those are not the same project, and no amount of planning reconciles them.** The Phase 1 package surfaced this as an open question (Q-01) rather than picking silently.

**The resolution is to stage the project rather than to pretend the whole scope fits the original estimate, and rather than to lower the quality bar.** The quality bar is what distinguishes SyntaxLab from the tools it competes with; the feature count is not.

### 3.2 The roadmap

| Release | Contents | Rationale |
|---|---|---|
| **V1.0** | Regex · JSON · local history · theme customisation · PWA/offline · accessibility baseline · security baseline · test infrastructure · performance budget · responsive UI · documentation | A coherent, complete, presentable product |
| **V1.1** | Cron: standard 5-field dialect only, field-by-field explanation, human-readable summary, next execution times, builder, explicit timezone display | Highest correctness uncertainty in the project; staged so it cannot delay a shippable release |
| **V1.2+** | Additional cron dialects · regex explanation for non-ECMAScript flavours (explanation only, never execution) · JSONC/JSON5 · share URLs · richer import/export · further syntax analysers | Speculative. **Deliberately excluded from the V1 implementation plan.** |

### 3.3 V1.0 is a complete product, not a fragment

This constraint governs the UX. V1.0 must not read as "two thirds of a bigger app".

| Requirement | How it is met |
|---|---|
| The name must not promise cron | "SyntaxLab — Regex & JSON Explainer" in V1.0. The name broadens in V1.1. |
| The mode selector must not have a hole | Two modes, `Regex` and `JSON`, presented as the complete set. A two-segment control looks deliberate; a three-segment control with one greyed out looks broken. |
| Cron must be signposted honestly, not shown as broken | A single line in the help dialog and README: *"Cron support is planned for V1.1."* **No disabled tab, no greyed-out button, no "coming soon" placeholder in the workspace.** |
| The empty state must feel finished | Two example chips (regex, JSON), not three with one missing |

**Rule:** a disabled feature in the primary UI reads as an accident. An honest note in the help dialog reads as a roadmap. We do the second.

---

## 4. Target users

### Primary — "the working developer"

Mid-level to senior engineers, 3–15 years experience, hitting an unfamiliar regex or JSON blob several times a week. Desktop, browser tab next to the editor. Impatient, keyboard-driven, suspicious of tools that ask them to log in.

**They need:** correctness, speed, no friction. They abandon a tool that takes more than ~2 seconds to become useful.

### Secondary — "the learner"

Bootcamp students, junior developers, self-taught programmers learning regex for the first time. They benefit most from the token-by-token breakdown and the syntax tree.

**They need:** explanations that teach, not just describe. Examples they can load and mutate.

### Secondary — "the privacy-constrained engineer"

Developers at companies where pasting a payload into a random website violates policy (finance, health, defence, anything with a compliance officer). For them, "runs in your browser, verifiable in devtools, works offline" is the *only* reason they can use the tool at all.

**They need:** a credible, auditable, documented privacy position — which is why §9 and `05_SECURITY.md` matter commercially, not just ethically.

### Explicit non-user

Not built for: non-technical users, teams needing shared workspaces, or CI/automation consumers (there is no API).

---

## 5. Goals

### Product goals

| ID | Goal | Measure |
|---|---|---|
| G1 | Explain regex and JSON from a real parsed structure | Explanation output derived from an AST/CST walk; zero explanation strings produced by regex-replacing the user's input |
| G2 | Keep user content on the device | No application code initiates a network request after load; verified by an E2E test that fails on any request |
| G3 | Work fully offline | Second visit with network disabled loads and performs both analyses |
| G4 | Keep the UI responsive | Main thread never blocked >50 ms by user input of any kind, including adversarial regex |
| G5 | Remember prior work locally | History persists across reloads and browser restarts, with no account |
| G6 | Feel like a serious developer tool | Restrained black/hacker-green system, strong typography, no dashboard clichés |
| G7 | Be customisable without being a toy | Gradient/theme customisation via tokens; defaults good enough that most users never open the panel |

### Engineering goals

| ID | Goal |
|---|---|
| E1 | Domain layer (parsers + explanation engine) has zero React imports and is testable in isolation under Node |
| E2 | Every dependency individually justified and classified in `16_DEPENDENCIES.md` |
| E3 | TypeScript `strict` with no `any` in domain code |
| E4 | Parsers are fuzz-tested and their termination is asserted, not assumed |
| E5 | No `eval`, no `new Function`, no `dangerouslySetInnerHTML`, enforced by lint rather than by discipline |

---

## 6. Non-goals

Out of scope for the entire roadmap unless a documented requirement forces a change. Listed explicitly so nobody "helpfully" adds them.

| Non-goal | Reason |
|---|---|
| User accounts / authentication | No requirement needs server-side identity. History is local. Accounts would destroy the privacy position and add an entire backend. |
| Any backend service | Every feature is computable in the browser. See `23_RISK_REGISTER.md` R-15 for the one scenario that would change this. |
| Any database (Postgres, Supabase, etc.) | IndexedDB is the correct tier for per-browser, per-user, non-shared structured data. |
| AI / LLM-generated explanations | Non-deterministic, requires network (breaks offline), requires sending user content to a third party (breaks privacy), and is *worse* than a real parser here. A grammar knows exactly what `(?<=\d)` means; a model guesses. |
| Team/shared workspaces | Requires accounts + backend. |
| A public HTTP API | Requires backend, rate limiting, abuse handling. Extracting the parsers as an npm package is the better answer (Q-11). |
| Analytics / telemetry by default | Contradicts the privacy position. Any future proposal goes through `05_SECURITY.md` §12. |
| **Multi-engine regex execution** (PCRE, RE2, .NET, Python) | See §7.1. V1 executes ECMAScript because that is the engine actually running. |
| **Every cron dialect** | V1.1 supports standard 5-field only, and refuses to guess at others. See §8. |
| Large-scale marketing site | The tool is the product. |
| Mobile-first design | Desktop-primary. Mobile must be *usable*, not optimal. |
| Real-time collaboration | Permanently out of scope. |

---

## 7. Regex scope — ECMAScript only, and visibly so

### 7.1 The decision

**V1.0 parses, explains, and executes ECMAScript (JavaScript) regular expressions. Nothing else.**

The tester runs the user's pattern through the browser's own `RegExp` engine. Claiming PCRE, Python, Go, Java, or .NET support while running JavaScript semantics would be a correctness lie — and a dangerous one, because the differences are subtle enough to pass casual inspection:

| Feature | ECMAScript | Common divergence |
|---|---|---|
| Lookbehind | Variable-length supported | Python `re` requires fixed width; Go RE2 has none |
| Possessive quantifiers `a*+` | Not supported | Java, PCRE support them |
| Atomic groups `(?>…)` | Not supported | PCRE, Java support them |
| Named groups | `(?<name>…)` | Python uses `(?P<name>…)` |
| `\d` under `/u` | ASCII digits only | .NET matches Unicode digits by default |
| Recursion `(?R)` | Not supported | PCRE supports it |
| Inline flags `(?i)` | Modifier groups are very recent | Widely supported elsewhere |

A user who assumes their PCRE pattern behaves identically here can ship a broken pattern with more confidence than they started with. That is a worse outcome than not having the tool.

### 7.2 How this is made visible

Not buried in a help page. Three separate, unmissable surfaces:

1. **A permanent label on the regex input pane:** `ECMAScript (JavaScript)` — always visible, never dismissible.
2. **A help-dialog section** listing the divergences in the table above, so the user learns *why* it matters, not just *that* it does.
3. **A targeted hint on syntax we recognise as foreign.** When the parser encounters `(?P<name>…)`, `(?>…)`, `a*+`, or `(?R)`, the error says: *"`(?P<name>…)` is Python syntax. In JavaScript, named groups are written `(?<name>…)`."* This turns the limitation into the most useful error message in the product.

### 7.3 Future flexibility, without building it now

The parser AST and the explanation engine are flavour-agnostic by construction — the tokenizer's dialect-specific rules are isolated, and the explainer walks nodes rather than text. That makes a future *explanation-only* mode for other flavours (V1.2+) a contained addition.

**We do not build any of that now.** No dialect abstraction, no strategy pattern, no configuration surface for a second flavour. Building extensibility for a feature that may never ship is the exact over-engineering this project is meant to avoid. The architecture merely does not *preclude* it.

---

## 8. Cron scope — V1.1, standard 5-field only

Full specification in `04_PARSER_ARCHITECTURE.md` §5 (marked V1.1 throughout). Summary of the locked decisions:

| Decision | Value |
|---|---|
| Release | **V1.1**, not V1.0 |
| Dialect | **Standard 5-field only**: minute, hour, day-of-month, month, day-of-week |
| Not supported | Quartz, Jenkins, Spring, AWS variants, seconds-first (6-field), year fields (7-field) |
| On a 6- or 7-field expression | **Do not guess.** Report: *"This expression does not match SyntaxLab's supported 5-field cron format."* plus a note that other dialects exist and which tools use them. |
| Timezone (V1.1) | **Browser-local and UTC only.** Named IANA zones deferred until the correctness and test strategy are defensible. |
| DST | Anomalies detected and labelled, never silently skipped or duplicated |

Refusing to parse an unsupported dialect is the correct behaviour. A tool that confidently explains a Quartz expression using Vixie semantics produces a plausible, wrong answer — the worst failure mode this product has.

---

## 9. Privacy commitments

User-facing promises. They constrain every later decision.

1. **The application makes no network requests after load.** Enforced by CSP `connect-src 'none'` and verified by an E2E test. See §9.1 for what this does and does not mean.
2. **No account, ever, for core functionality.**
3. **No analytics, no beacons, no error-reporting service.**
4. **All user content stays in browser-local storage** (IndexedDB + localStorage), which the user can inspect, export, and wipe.
5. **A visible, one-click "pause history"** for when the user knows their payload is sensitive.
6. **The position is documented and verifiable**, not merely asserted.

### 9.1 What the privacy claim does and does not mean

Stated precisely, because an overstated privacy claim is itself a defect:

**It does mean:** the application contains no code that transmits user content; the CSP blocks the browser's standard network APIs (`fetch`, `XMLHttpRequest`, WebSocket, `sendBeacon`, EventSource) from reaching any origin; and this is verifiable in devtools by anyone.

**It does not mean:** that exfiltration is provably impossible under all conditions. A browser extension with page access can read anything on the page. A compromised dependency operates inside our origin. CSP is a browser-enforced control, not a mathematical proof, and browsers have bugs.

We say *"the application makes no network requests and the CSP blocks the standard channels"*. We do not say *"nothing can ever leave"*. See `05_SECURITY.md` §4.2 and §17.

---

## 10. User stories

Format: `As a <role>, I want <capability>, so that <outcome>.` IDs are referenced by `21_ACCEPTANCE_CRITERIA.md`.

### Regex — V1.0

| ID | Story | Priority |
|---|---|---|
| US-R1 | Paste a regex and read a plain-English explanation, so I can understand code I did not write. | must |
| US-R2 | See a token-by-token breakdown, so I can see which part does what. | must |
| US-R3 | See the structure as a tree, so I understand grouping and alternation precedence. | must |
| US-R4 | Enter test strings and see matches highlighted, so I can confirm behaviour. | must |
| US-R5 | See capture groups with numbers and names, so I can index them correctly. | must |
| US-R6 | Toggle flags (`g i m s u y d`), so I can test behaviour differences. | must |
| US-R7 | Have the app stay responsive when I paste a catastrophic pattern, so I do not lose work. | must |
| US-R8 | Know the tester runs **JavaScript** semantics, so I do not misapply results to another engine. | must |
| US-R9 | Get a helpful message when I paste PCRE/Python syntax, so I learn the JS equivalent. | must |
| US-R10 | Browse common patterns, so I can learn by example. | should |
| US-R11 | See a match table with indices and group values, so I can debug extraction. | should |
| US-R12 | Be warned when a pattern looks ReDoS-prone, so I do not ship it. | V1.2 |

### JSON — V1.0

| ID | Story | Priority |
|---|---|---|
| US-J1 | Get a precise error with line/column and a caret, so I can fix malformed JSON quickly. | must |
| US-J2 | Navigate a collapsible tree with types, so I can explore a large payload. | must |
| US-J3 | Copy the JSON path of any node, so I can use it in code or `jq`. | must |
| US-J4 | Prettify and minify, so I can reformat payloads. | must |
| US-J5 | Be told about duplicate keys, so I catch a bug `JSON.parse` hides. | should |
| US-J6 | Search within the tree, so I can find a key in a large document. | should |
| US-J7 | See number-precision warnings, so I know when a value exceeds `Number.MAX_SAFE_INTEGER`. | should |
| US-J8 | Generate a TypeScript interface. | V1.2 |
| US-J9 | Generate a JSON Schema. | V1.2 |
| US-J10 | Sort keys for diffing. | V1.2 |

### History — V1.0

| ID | Story | Priority |
|---|---|---|
| US-H1 | See my previous analyses listed, so I can pick up where I left off. | must |
| US-H2 | Reopen an entry and get the exact input back, so I need not re-paste. | must |
| US-H3 | Search and filter history, so I can find an old analysis. | must |
| US-H4 | Pin important entries, so they survive automatic pruning. | must |
| US-H5 | Delete one entry or clear everything, so I control my own data. | must |
| US-H6 | **Be told on first visit that analyses are saved locally, and how to stop that**, so I am never surprised. | must |
| US-H7 | Pause history, so I can analyse a secret-bearing payload without persisting it. | must |
| US-H8 | Rename an entry, so I can find it by meaning rather than content. | should |
| US-H9 | Export and import history, so I can move browsers or keep a backup. | should |
| US-H10 | Be told when storage is full or unavailable, so I am not silently losing data. | must |

### Theme — V1.0

| ID | Story | Priority |
|---|---|---|
| US-T1 | Get a polished black/hacker-green default, so I need configure nothing. | must |
| US-T2 | Change gradient colours, direction, and intensity. | must |
| US-T3 | Pick a gradient preset in one click. | must |
| US-T4 | Reset to defaults, so I can undo experimentation. | must |
| US-T5 | Have animation suppressed when I prefer reduced motion. | must |
| US-T6 | Have my theme persist and apply before first paint, so I get no flash. | must |
| US-T7 | Use a high-contrast option, so the green theme stays readable. | should |

### Cross-cutting — V1.0

| ID | Story | Priority |
|---|---|---|
| US-X1 | Have the app detect whether I pasted regex or JSON, so I need not pick a mode. | must |
| US-X2 | Override detection, so I am never trapped in the wrong mode. | must |
| US-X3 | Use the app with no network, so I can work on a plane. | must |
| US-X4 | Use keyboard shortcuts, so I never touch the mouse. | must |
| US-X5 | Have analysis announced meaningfully to a screen reader. | must |
| US-X6 | Be told when a new version is available, so I refresh deliberately rather than being interrupted. | must |
| US-X7 | **Copy my input and my explanation to the clipboard**, so I can share them by whatever channel I choose. | must |
| US-X8 | Share an analysis by URL. | **V1.1+** — see §12 |

### Cron — V1.1

| ID | Story |
|---|---|
| US-C1 | Read a plain-English reading of a 5-field cron expression. |
| US-C2 | See a field-by-field breakdown, so I can see which field is wrong. |
| US-C3 | See the next N execution times with an explicit timezone label. |
| US-C4 | Choose between browser-local and UTC, and see which is active. |
| US-C5 | Be warned about the day-of-month/day-of-week OR rule. |
| US-C6 | Be told clearly when my expression is a dialect SyntaxLab does not support. |
| US-C7 | Start from a preset. |
| US-C8 | Build an expression with controls. |
| US-C9 | Be warned when a schedule crosses a DST boundary ambiguously. |

---

## 11. V1.0 feature list

**Shell**
- Single-page workspace, no router
- Mode selector: **Regex / JSON** (two modes, presented as complete)
- Input-type detection with a non-blocking suggestion chip
- History drawer · Theme drawer · Help dialog
- Offline and update status indication
- Global and per-panel error boundaries
- First-run history notice

**Regex**
- CodeMirror 6 editor with regex-aware highlighting
- Permanent `ECMAScript (JavaScript)` label
- Flag toggles: `g i m s u y d`
- Custom tokenizer + recursive-descent parser → AST
- Plain-English summary from the AST
- Token-by-token list, bidirectionally hover-linked to source positions
- Collapsible AST tree
- Test-string editor, executed in a terminable worker
- Live match highlighting; match table with groups
- Timeout state with honest messaging
- Foreign-dialect detection with corrective hints
- Curated example patterns

**JSON**
- CodeMirror 6 editor with JSON highlighting and error markers
- Custom recursive-descent CST parser with source positions
- Error report: message, line, column, caret excerpt, plain-English hint
- Collapsible tree with type badges and child counts, virtualised
- JSON path display + copy (dot and bracket notation)
- Prettify (2/4/tab) and minify, operating on the CST
- Duplicate-key detection
- Unsafe-number detection
- Tree text search
- Sample documents

**History**
- IndexedDB behind a repository interface
- **Auto-capture ON by default**, with a first-run notice
- List, search, filter, pin, rename, delete, clear-all
- Restore into the workspace
- Pause/resume, visible in the header and in settings
- Quota handling with user-visible degradation
- Export / import with strict validation

**Theme**
- CSS custom-property token system
- Gradient customisation: two colours, angle, intensity
- Preset gradients · reset to default
- Persisted in localStorage, applied pre-paint
- Reduced-motion and high-contrast support

**Platform**
- PWA: installable, offline after first load
- Precache service worker with user-consented updates
- **Clipboard sharing** (copy input, copy explanation, copy path/result)

**Not in V1.0:** cron, share URLs, JSON→TS, JSON→Schema, light theme, i18n, diff mode, JSONC/JSON5.

---

## 12. Share URLs — deferred to V1.1+

**Decision: V1.0 ships clipboard-based sharing only.** No URL state encoding.

**Reasoning.** The Phase 1 documentation identified share URLs as the single largest additional attack surface in the product: an attacker-controlled input path that arrives via a click rather than via a deliberate paste. It requires a decoder, a decompressor, a size guard against decompression bombs, a version negotiator, and a validation layer — all on data supplied by a third party.

It was also only a "should" priority. Spending the largest security budget in the project on a nice-to-have is a poor trade in a first release.

**What V1.0 ships instead:** copy input, copy formatted output, copy explanation, copy JSON path. These cover the real need — "send this to a colleague" — through a channel the user already controls, at essentially zero risk.

**What this removes from V1.0:** the share codec, the compression path, the share dialog, the URL read/validate pipeline, and the entire hostile-share-URL test suite.

Revisit in V1.1+ with the controls already designed in `05_SECURITY.md` §11, which remains as a specification for the deferred feature.

---

## 13. Acceptance summary

Full criteria in `21_ACCEPTANCE_CRITERIA.md`. Headline bar for V1.0:

- All `must` stories in §10 (Regex, JSON, History, Theme, Cross-cutting) implemented and covered by automated tests
- Adversarial regex (`(a+)+$` against 40 `a`s + `!`) produces a timeout state within ~2.5 s with the UI interactive throughout
- A 5 MB JSON document parses, or is rejected with a clear over-limit message, without freezing
- With network disabled after first load, both analyses work and history persists
- Lighthouse: Performance ≥ 95, Accessibility ≥ 95, Best Practices ≥ 95, PWA installable, on a production build
- Initial JS payload measured and within the budget in `12_PERFORMANCE.md`
- axe-core reports zero critical or serious violations on every primary view
- No `eval`, `new Function`, or `dangerouslySetInnerHTML` in `src/`, enforced by ESLint
- Every security test in `13_TEST_PLAN.md` §7 passes

---

## 14. Effort

Ranges, not false precision. See `20_IMPLEMENTATION_PLAN.md` for milestone-level detail.

| Release | Range |
|---|---|
| **V1.0** | **13–18 focused days** |
| V1.1 (cron) | 4–6 focused days |

The staging is what makes this tractable: V1.0 is a coherent release, and V1.1 can slip without anything being unfinished.

---

## 15. Success metrics

No analytics, so these are evaluative and measured manually before release:

| Metric | Target | Method |
|---|---|---|
| Time to first useful interaction (cold, throttled) | < 1.5 s | Lighthouse TTI, production build |
| Warm load | < 300 ms | Manual + Playwright timing |
| Explanation correctness | 100% on the curated corpus | Golden files: 150+ regex, 100+ JSON |
| Crash rate under fuzz | 0 uncaught exceptions across the CI fuzz budget | `fast-check` in CI |
| Main-thread block | No task > 50 ms during typical interaction | Long-task audit |
| Bundle size | Within budget, **measured on a production build** | `rollup-plugin-visualizer` + CI check |
