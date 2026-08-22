# 23 — Risk Register

**Project:** SyntaxLab
**Status:** Revised in Phase 1.5 for the staged roadmap
**Last updated:** 2026-08-17

**Scoring:** Likelihood × Impact, each 1–5. ≥ 15 = 🔴 critical, 9–14 = 🟠 high, 4–8 = 🟡 medium, ≤ 3 = 🟢 low.
**Release column:** which release the risk is live in. A V1.1 risk is **not** downgraded because it moved — it is scheduled later, which changes *when* it threatens us, not *how much*.

---

## 1. Register

| ID | Risk | Release | L | I | Score | |
|---|---|---|---|---|---|---|
| R-01 | Custom parser correctness | V1.0 | ~~4~~ 3 | 4 | ~~16~~ **12** | 🟠 **regex half passed M3; JSON half open until M5** |
| R-03 | Cron timezone/DST correctness | **V1.1** | 2 | 4 | 8 | 🟡 |
| R-05 | Bundle budget exceeded | V1.0 | ~~4~~ 1 | 3 | ~~12~~ **3** | 🟢 **passed at M4 (162.54 KB); over target M8–M10; back inside at M11 — 166.16 KB** |
| R-04 | Explanation quality is mediocre | V1.0 | 3 | 4 | 12 | 🟠 |
| R-02 | Scope/timeline overrun | V1.0 | 3 | 3 | 9 | 🟠 |
| R-06 | Service-worker bug bricks cached copies | V1.0 | 2 | 5 | 10 | 🟠 |
| R-07 | Supply-chain compromise | V1.0 | 2 | 5 | 10 | 🟠 |
| R-10 | Worker termination unreliable | V1.0 | ~~2~~ 1 | 4 | ~~10~~ **4** | 🟡 **checkpoint passed M2** |
| R-08 | Screen-reader experience unusable in the editor | V1.0 | 3 | 3 | 9 | 🟠 |
| R-09 | Users store secrets in history | V1.0 | 3 | 3 | 9 | 🟠 |
| R-19 | V1.0 perceived as incomplete without cron | V1.0 | 3 | 3 | 9 | 🟠 |
| R-13 | No production observability | V1.0 | 4 | 2 | 8 | 🟡 |
| R-11 | `Intl` insufficient even for local+UTC | V1.1 | 2 | 3 | 6 | 🟡 |
| R-12 | CodeMirror integration friction | V1.0 | 3 | 2 | 6 | 🟡 |
| R-14 | Storage eviction loses users' history | V1.0 | 3 | 2 | 6 | 🟡 |
| R-16 | Solo-developer bus factor | Both | 2 | 3 | 6 | 🟡 |
| R-17 | Nobody uses it | V1.0 | 3 | 2 | 6 | 🟡 |
| R-20 | Cron never ships; V1.0 becomes the whole product | V1.1 | 3 | 2 | 6 | 🟡 |
| R-21 | Users apply ECMAScript results to another engine | V1.0 | 2 | 3 | 6 | 🟡 |
| R-15 | A genuine backend requirement emerges | Both | 1 | 4 | 4 | 🟡 |
| R-18 | Cloudflare free-tier terms change | Both | 1 | 2 | 2 | 🟢 |

**Change from Phase 1:** R-02 dropped from 15 to 9 (V1.0 is genuinely narrower), R-03 from 16 to 12 (**not** because cron moved, but because the timezone scope was reduced to browser-local + UTC, which removes most of the difficulty). Three risks were added: R-19, R-20, R-21 — all created by the staging decision itself.

---

## 2. Critical

### R-01 — Custom parser correctness — ✅ **REGEX CHECKPOINT PASSED at M3**

**Regex half verified 2026-08-18.** The M3 risk checkpoint asked whether the
hand-written parser agrees with the platform. It does, across the corpus and
the seeded fuzz budget, after four genuine conformance bugs were found and
fixed (`04_PARSER_ARCHITECTURE.md` §8.1.1).

| Evidence | Result |
|---|---|
| Differential vs `new RegExp`, curated corpus × 2 flag sets | 174 cases, full agreement |
| Differential, generated patterns | 6 000 runs, seeded, full agreement |
| Property — never throws, always terminates | 1 500 runs × 2 + adversarial set |
| Golden corpus, human-reviewed | 164 distinct patterns |
| Coverage of `domain/regex` | 97.70% stmt / 90.85% branch |
| `regexpp` adoption required? | **No** — the §6 escalation path was not triggered |

**Residual for the regex half: 🟡 8** (L2 × I4). Agreement on *validity* is
established; explanation *correctness* has no oracle and rests on the reviewed
golden corpus, so a wording or semantic error remains possible and would be
caught by review rather than by a test.

**The JSON half of R-01 is still open** and is checkpointed at M5.

---

### R-01 (original) — Custom parser correctness 🔴 16 · V1.0

**Risk.** Two hand-written parsers with subtle edge cases (regex Annex B vs `/u`; JSON lone surrogates and number grammar). A wrong explanation is worse than no explanation, because the user acts on it.

**Impact.** Users ship broken regexes based on our output. Reputational damage to a tool whose entire value proposition is correctness.

**Mitigations**
- **Differential testing** against `new RegExp` and `JSON.parse` — disagreement with the platform means we are wrong. The strongest control available.
- JSONTestSuite conformance corpus
- Property tests: terminates within a step budget, never throws, spans valid and nested
- 250+ human-reviewed golden files
- 95% coverage gate on `domain/`
- Every reported bug becomes a permanent regression fixture
- Documented library fallbacks (`16_DEPENDENCIES.md` §6)
- **Staging helps here:** one parser is finished and proven before the next begins, so a systemic mistake is caught once rather than replicated three times

**Detection:** CI differential failures; user reports.
**Contingency:** adopt `regexpp` / `jsonc-parser` for the failing domain, keeping our explanation layer.
**Checkpoints:** M3, M5. **Owner:** developer.

---

## 3. High

### R-03 — Cron timezone/DST correctness 🟡 8 · V1.1 *(reduced at M14)*

**Risk.** Timezone arithmetic is genuinely hard, and different schedulers legitimately resolve DST differently, so even a correct answer may not match the user's system. A skipped or doubled run at a DST boundary is a real production incident.

**Why it is 12 rather than 16.** **Not because it moved to V1.1** — deferring a risk does not reduce it. It is lower because the *scope* was reduced: browser-local and UTC only, no named IANA zones (D-04). That removes the inverse wall-clock-to-instant problem for arbitrary zones, which was the hardest and least testable part.

**Mitigations**
- Two timezone modes only, both fully testable
- Every displayed time carries a zone label (invariant C-I1)
- DST anomalies explicitly detected and labelled (`skipped` / `repeated`) — ✅ *built at M16, per reading, by offset probing*
- We document that schedulers differ and do not claim parity with any
- **Refusal to parse unsupported dialects** removes an entire class of wrong answers
- Bounded 5-year search guarantees termination
- UTC mode is offered as the verification path, since it has no transitions

**M14 checkpoint — passed, and the score drops from 12 to 8.** Likelihood falls from 3 to 2; impact stays at 4, because a wrong schedule is still a production incident.

What actually reduced it:

- The **timezone representation shipped and is provably two-valued.** The mode is a two-member union, re-validated on the wire rather than merely typed, and two tests assert no analysis in either mode can produce a third. Named-zone leakage — the largest part of this risk — is now structurally blocked rather than planned against.
- The **refusal paths are built and tested**, so the class of wrong answers that comes from parsing another dialect's expression is closed, not pending.
- At M14 the **hardest remaining part was unbuilt and therefore unshipped.** Next-run computation and per-schedule DST anomalies were M16, and no wrong time could be displayed because no time was displayed. That is no longer the situation — see the M16 checkpoint below.
- One real correctness defect was found and fixed during M14 — `5/10` expanding to a set no scheduler produces — which is evidence the corpus is doing its job.

What has **not** changed: schedulers still differ on DST, and we still do not claim parity. The contingency below stands.

**M16 checkpoint — passed. The score stays at 8 rather than dropping further.**
Likelihood is unchanged at 2 and impact unchanged at 4: the executor now exists,
so a wrong time *can* be displayed where before none could be. What holds the
likelihood down is the evidence rather than the absence of the feature:

- **The expected answers came from the calendar, not the code.** 48 golden cases
  reasoned by hand, each carrying its reasoning.
- **A differential oracle exists after all.** A minute-by-minute scan is the
  definition of a cron schedule; the fast search is checked against it across
  300 generated schedules, and the scan stops at the search's answer, so
  agreeing also proves nothing was skipped on the way.
- **DST is tested against real zone rules** in four zones, both hemispheres,
  and a zone with no transitions — and one real defect was found that way: the
  first offset probe missed the fall-back overlap entirely.
- **Neither anomaly is resolved on the user's behalf.** A skipped run carries no
  instant; a repeated one carries both. We still do not claim parity with any
  scheduler's DST policy, and the UI says so in words.
- **An audit found and fixed a fabrication path**: an out-of-range start instant
  produced occurrences with a null instant and no `skipped` marker. Refused now
  at the domain and at the payload boundary.

**Detection:** golden-file mismatches; user reports.
**Contingency:** restrict V1.1 to UTC only and document it.
**Checkpoint:** M14 ✅ passed; M16 ✅ passed. **Owner:** developer.

---

### R-05 — ✅ **BUNDLE CHECKPOINT PASSED at M4**

The measurement this risk was waiting for exists. CodeMirror is in the build
and costs **88.03 KB gz**, not the ~150 KB estimated — the entry chunk is
148.79 KB and the counted budget 162.54 KB, inside the 170 KB target and 37 KB
under the hard budget (`12_PERFORMANCE.md` §10.5).

No optimisation was performed, because none was needed and removing something
on the strength of an estimate is what §2.3 of the performance doc forbids.
The §8.2 recovery ladder — drop `@codemirror/search`, then evaluate Preact —
was not entered.

**Residual at M4: 🟢 low.** The remaining growth in V1.0 was expected to be the
JSON feature, the drawers (M7–M8) and the service worker (M9). Re-check at M11.

### R-05 — current checkpoint, M11

The M4 figures above are kept as the historical checkpoint. **They are no
longer the current state**, and the M4 prediction was partly wrong: the growth
did not stay in lazy chunks, because the build ships a single entry chunk. The
budget was breached against the *target* from M8 to M10.

| Checkpoint | Initial JS | Against the 170 KB target | Against the 200 KB limit |
|---|---|---|---|
| M4 (historical) | 162.54 KB | 7.46 KB under | 37 KB under |
| M8 | 173.04 KB | **3.04 KB over** | 27 KB under |
| M9 | 174.52 KB | **4.52 KB over** | 25 KB under |
| M10 | 175.05 KB | **5.05 KB over** | 25 KB under |
| **M11 (current)** | **166.16 KB** | **3.84 KB under** | **33.8 KB under** |

The §8.2 recovery ladder was never entered as written — `@codemirror/search` is
not a dependency, and Preact was ruled out without evidence to justify it.
What M11 found instead was cheaper than either: `standardKeymap`'s single Enter
binding was the only path to `@codemirror/language` and the Lezer stack, in an
application that configures no language at all. Rebuilding the keymap returned
9.71 KB (`12_PERFORMANCE.md` §12.2).

**Residual: 🟢 low, and lower than at M4.** The budget is inside its target for
the first time since CodeMirror arrived, the trend has reversed, and the
remaining composition is understood — CodeMirror 60%, React 16%, application
code 24%. There is no un-analysed weight left to be surprised by.

---

### R-05 (original) — Bundle budget 🟠 12 · V1.0

**Risk.** The estimated initial bundle consumed essentially the entire 200 KB budget, with CodeMirror dominating.

**Mitigations (revised in Phase 1.5)**
- Hard budget (200 KB) separated from target operating region (≤ 170 KB)
- **First real measurement is an M1 deliverable**, not an M11 discovery
- CI enforcement from M1
- A five-step escalation ladder (`12_PERFORMANCE.md` §2.2) starting with accidental inclusion and reaching framework changes only with evidence
- `@codemirror/search` classified Optional — the first thing dropped
- **No dependency is removed or swapped on the strength of an estimate**

**Detection:** CI size check on every PR.
**Contingency:** the ladder, in order. Preact is the last resort, not the first lever.
**Checkpoints:** M1, M4, M6, M11.

---

### R-04 — Explanation quality 🟠 12 · V1.0

**Risk.** The parsers are correct and the explanations still read like a token dump. This is the product's differentiator, and it is a *writing* problem no test catches.

**Mitigations:** two output registers (prose summary + precise detail); composition rules that join child summaries into sentences; context-sensitive explanation tables; golden files reviewed by a human on every change; **external feedback at M4**, which the staging makes possible earlier than a three-mode build would.

**Detection:** M4 feedback; self-review of golden output.
**Contingency:** a dedicated copy-editing pass over the corpus.

---

### R-02 — Scope/timeline overrun 🟠 9 · V1.0

**Reduced from 15.** V1.0 is genuinely narrower, the plan uses ranges rather than false precision, and the two largest cuts (cron, share URLs) are already made.

**Mitigations:** milestone plan with ranges; a short remaining cut list (`20_IMPLEMENTATION_PLAN.md` §7); a "never cut" list protecting worker isolation, input limits, validation on read, the no-HTML-sink rule, error boundaries, the a11y baseline, the first-run notice, and the ECMAScript label.

**Detection:** slippage of more than one day on a milestone.
**Contingency:** cut in the documented order. **Do not** cut testing or accessibility — those are the quality bar the staging exists to protect.

---

### R-06 — Service-worker bug bricks cached copies 🟠 10 · V1.0

A bad SW persists across reloads; users can be stuck on a broken version.

**Mitigations:** Workbox rather than hand-rolled; new cache per build so a failed update leaves the working version intact; **never `skipWaiting` automatically**; offline verified on a preview deployment before every promotion; in-app **Reset app**; hourly update check bounds exposure.

**Checkpoint:** M9 — stop and escalate if offline does not work end to end.

---

### R-07 — Supply-chain compromise 🟠 10 · V1.0

**Mitigations:** four required runtime dependencies, all well-known; exact pinning with a committed lockfile; `npm audit` gating CI; lockfile diffs read; no auto-merge; **CSP `connect-src 'none'` removes the ordinary network paths a compromised dependency would use to exfiltrate** — reducing, not eliminating, the risk (`05_SECURITY.md` §4.2.1).

---

### R-10 — Worker termination unreliable — ✅ **CHECKPOINT PASSED at M2**

**Original risk:** if `terminate()` does not promptly stop a running regex on some engine, the entire ReDoS defence fails.

**Verified 2026-08-18.** An execution worker was pinned by a busy loop (a thread that genuinely cannot yield or process messages — the same condition catastrophic backtracking produces), timed out at a 2 s deadline, terminated, and respawned. Confirmed on **Chromium, Firefox, and WebKit**:

| Assertion | Result |
|---|---|
| Caller settles at the deadline, not after the task | ✅ 2011 ms against a 2000 ms deadline |
| Worker terminated | ✅ all three engines |
| Replacement serves the next request | ✅ 7 ms (warm) |
| Survives three consecutive timeouts | ✅ all three engines |
| Analysis worker unaffected — still `ready` | ✅ all three engines |
| Main thread interactive while pinned | ✅ a real control was clicked and responded |

**Residual score: 🟡 4** (L1 × I4). The mechanism is proven on all target engines. What remains is that a future browser change could regress it, which the E2E matrix would catch — it runs on every CI pass.

**Still true:** termination is the *only* reliable stop. The static nested-quantifier warning planned for M3 remains a heuristic with false negatives and is never presented as a safety guarantee.

---

### R-08 — Screen-reader usability of the editor 🟠 9 · V1.0

**Mitigations:** CM6 is best-in-class for this; explicit labels and descriptions; errors exposed as text in the analysis pane, not only as visual squiggles; documented escape from the tab trap; real screen-reader testing at M10.
**Contingency:** a plain-`<textarea>` toggle (Q-12) — ~50 lines, because the parser layer is editor-independent.

---

### R-09 — Users store secrets in history 🟠 9 · V1.0

**Raised in prominence by the Phase 1.5 decision** to make auto-capture ON by default (D-02). That decision was made deliberately, with compensating controls rather than a safer default.

**Mitigations:** first-run notice **before anything is saved**, with an immediate "Turn history off"; pause control in the header and settings; results and test strings not stored; per-entry delete with undo; clear-all; plain disclosure that storage is unencrypted device storage, not a vault.

**Residual:** real and accepted (RR-08). We cannot reliably detect secrets, and a false "no secrets found" would be worse than no check.

**Status at M7 — every mitigation is now built, and one is stronger than planned.**

| Mitigation | As built |
|---|---|
| First-run notice before anything is saved | Non-blocking banner in the shell, with `Got it` and `Turn history off`. The capture delay means nothing is written for at least two seconds after a first successful analysis, so the notice genuinely precedes the first write. |
| Immediate opt-out | `Turn history off` pauses capture in the same click and persists it. Covered E2E. |
| Pause in the header and in settings | Header control plus the mirror in the drawer, which is the only settings surface at M7. |
| Test strings and results not stored | **Structurally, not by discipline:** `HistoryEntry` has no field for either, so neither can be added by accident. A unit test analyses a subject containing card-like digits and asserts they never reach a record. |
| Per-entry delete with undo, clear-all | Both built; the delete is real and immediate, so closing the tab during the undo window cannot resurrect it. |
| Plain disclosure | Worded to what the architecture enforces, and **unit-tested for the absence** of "never leave", "100% private", "secure" and "encrypted". |

**One thing the plan did not anticipate.** History captures the regex
*pattern*, which can itself encode a secret — a pattern written to match one
specific token contains that token. Nothing in the design prevents this and
nothing detects it; the mitigation remains the same as for any other content
the user chooses to save: it is visible in the list, individually deletable,
and capture can be paused before pasting. Recorded here rather than left as an
unstated assumption.

---

### R-19 — V1.0 perceived as incomplete 🟠 9 · V1.0 · **NEW**

**Risk created by the staging decision.** A user who arrives expecting "regex, JSON and cron" — because the concept was described that way — finds two modes and concludes the product is unfinished. The damage is to credibility, not function.

**Mitigations**
- `08_UI_UX_SPEC.md` §2 makes completeness a specified UX requirement, not an afterthought
- **No disabled cron affordance anywhere** — a greyed-out tab is the single fastest way to look unfinished
- Product name matches scope: "SyntaxLab — Regex & JSON Explainer"
- Two modes presented as the set; balanced two-chip empty state
- Cron mentioned once, in the help dialog, as a roadmap item
- README positions V1.0 on its merits, with cron under "coming next" rather than as a gap

**Detection:** early feedback at M4/M6; issues or comments describing the app as unfinished.
**Contingency:** if feedback consistently reads V1.0 as partial, move V1.1 forward rather than adding apologetic UI. Recorded as assumption A-11.

---

## 4. Medium and low

| ID | Risk | Release | Mitigation | Contingency |
|---|---|---|---|---|
| R-13 | No production observability | V1.0 | Comprehensive pre-release testing; clear bug-report template; version and diagnostics in the help dialog | Accepted trade — the alternative needs `connect-src` opened and would receive user content in stack traces |
| R-11 | `Intl` insufficient even for local+UTC | V1.1 | Much reduced by the scope cut; both modes are directly testable | Restrict to UTC only |
| R-12 | CodeMirror friction: CSP styles, a11y, version skew | V1.0 | `unsafe-inline` for styles accepted and documented; pin all CM packages together; a11y work at M4 and M10 | Textarea fallback |
| R-14 | Storage eviction loses history | V1.0 | `persist()` after the third entry; export; **`06_DATA_STORAGE.md` §9.1 states persistence is not guaranteed**, and the first-run notice says so | Users export; nothing more is possible from a web page |
| R-16 | Solo-developer bus factor | Both | This documentation package is the mitigation; boring conventional code; comprehensive tests | Public repo + permissive licence |
| R-17 | Nobody uses it | V1.0 | Genuine differentiators; developer-community sharing; solid SEO basics | Accepted — still a portfolio-quality artefact and a useful personal tool |
| R-20 | **Cron never ships** — V1.0 succeeds, attention moves on, V1.1 is abandoned | V1.1 | Honest framing: V1.0 is presented as complete on its own terms, so an unshipped V1.1 leaves no hole. Cron scope is small and fully specified, so it stays cheap to start. | Accept. A good two-mode tool beats a mediocre three-mode one. Update the README to stop promising it. |
| R-21 | **Users apply ECMAScript results to another engine** | V1.0 | Permanent non-dismissible label; help-dialog divergence table; targeted errors on foreign syntax that teach the JS equivalent | Strengthen the label if reports appear |
| R-15 | A genuine backend requirement emerges | Both | Architecture is deliberately backend-free; any proposal triggers a full threat-model re-review | Document the requirement; do not implement reflexively |
| R-18 | Cloudflare terms change | Both | Static output is portable | Netlify migration is roughly an afternoon |

---

## 5. Risks explicitly not carried

| Not a risk | Why |
|---|---|
| Server compromise | No server |
| Database breach | No database |
| Credential stuffing / account takeover | No accounts |
| API abuse / rate limiting | No API |
| DDoS | Static assets on a CDN; nothing to exhaust |
| Payment fraud | No payments |
| GDPR/CCPA processing obligations | No personal data collected or transmitted (confirm A-8 if distributed by an organisation) |
| Scaling costs | Free tier, static |
| Vendor lock-in | Static output, portable in an afternoon |
| **Hostile share URLs** | **Deferred out of V1.0 (D-05)** — returns as a live risk if the feature ships |
| **Multi-dialect cron misinterpretation** | **Removed by refusing to parse unsupported dialects (D-04)** rather than by guessing carefully |

The last two rows are the direct security return on the Phase 1.5 scope decisions.

---

## 6. Review triggers

| Class | Trigger |
|---|---|
| Parser correctness | Every parser milestone; every bug report |
| Security | Every dependency change, CSP change, or new input surface |
| Performance | Every PR (CI budgets); every milestone (manual) |
| Timeline | Every milestone completion |
| Scope perception (R-19) | First external feedback at M4 and M6 |
| All risks | Milestone boundaries and before each release |

**A new risk is added when:** a new input surface appears, a dependency is added, an assumption in `22_OPEN_QUESTIONS.md` §4 proves wrong, a milestone slips by more than a day, or a bug reveals a class of problem rather than an instance.

---

## 7. Risks found during the Phase 1.5 review

| # | Finding | Action |
|---|---|---|
| DR-10 | Staging cron could make V1.0 look unfinished | **New risk R-19**; UX completeness requirements added (`08_UI_UX_SPEC.md` §2) |
| DR-11 | Deferred features have a habit of never shipping | **New risk R-20**; V1.0 framed as complete on its own terms so an unshipped V1.1 leaves no hole |
| DR-12 | Locking regex to ECMAScript creates a *new* misuse risk — users applying results to another engine | **New risk R-21**; three-surface visibility requirement in `01_PRD.md` §7.2 |
| DR-13 | The Phase 1 bundle plan pre-committed to Preact on an estimate | Withdrawn; measure-first process (R-05) |
| DR-14 | Absolute security claims would have shipped in the README | Corrected across the package; a claims table with a "why the absolute form is wrong" column now governs public wording |
| DR-15 | Auto-capture ON by default raises R-09's prominence | Accepted deliberately, with the first-run notice as the compensating control |
| DR-16 | Detection matching 5–7 cron fields would have suggested a mode the parser refuses | Detection tightened to exactly 5 fields |

---

## M8 — theme customisation

**No new risk, and one existing one reduced.** Theme customisation adds a
persisted-data-to-CSS boundary, which is the shape of R-04 (untrusted input
reaching a sink). It is handled the same way as every other such boundary in
this codebase: a positive-match allowlist rather than a filter, applied at a
single choke point, verified in three real browsers.

What is worth recording is the class of risk this feature *could* have added
and does not:

| Not a risk, because | |
|---|---|
| No dependency was added | A colour picker, a theming library or a colour-maths package would each have put third-party code on the path between persisted data and `setProperty`. |
| Semantic status colours are not customisable | Letting a user make an error message low-contrast would turn an accessibility guarantee into a preference. |
| The focus ring cannot be made invisible | A focus ring the user can hide is a keyboard trap they cannot see. Until the M10 correction pass the ring was *fixed* green, which honoured that at the cost of a green ring in Mono. It is now `--color-accent-legible`, which is `lightenToPass(accent)` — derived from the theme but **guaranteed by construction** to clear 4.5:1 against the surface. Themed and safe, rather than safe by being frozen; see `09_DESIGN_SYSTEM.md` §13.3. |
| Theme state never enters a history record | Verified by an E2E test that reads the IndexedDB records back and asserts no theme vocabulary appears in them. |

---

## M9 — R-06, the service-worker risk

R-06 names the service worker as the highest-consequence bug class in this
application, because a broken one persists across reloads and can lock a user
out of their own copy. M9 is where that risk becomes real.

**What reduces it**

| Mitigation | As built |
|---|---|
| The worker is generated, not authored | Workbox via `vite-plugin-pwa`. The hand-written part is registration, which cannot brick a client. |
| Never `skipWaiting()` on its own | `skipWaiting: false`, `clientsClaim: false`. The new worker waits; only a user action activates it. |
| No mixed-version state | The new cache is populated during `install`, before activation. A failed install leaves the previous version whole and serving. |
| Cleanup is scoped | Workbox drops stale entries from its own named cache. Nothing enumerates Cache Storage and deletes what it finds — asserted by a test that plants a foreign cache and checks it survives. |
| Failure is not fatal | Registration failing, or the API being absent, leaves a working online app. Verified by a test that removes `navigator.serviceWorker` entirely. |

**What M9 found, which is the reason the risk is rated where it is**

The site-wide `connect-src 'none'` silently prevented the worker from
activating or caching anything — in production only, with no error in the page
console, and invisible to a test suite served without headers. It was found by
A/B-ing the real headers against none. `scripts/serve-production.mjs` now
exists so that class of defect is reachable from a test.

**Residual, accepted**

- Offline on real Safari is unverified by automation (harness limitation, documented).
- The preview-deployment verification in the M9 definition of done is outstanding and remains a release gate.

---

## M10 — what the audit changed

**No new risk.** The audit enumerated every sink in the repository rather than
sampling, and found no execution sink at all: `innerHTML`,
`dangerouslySetInnerHTML`, `eval`, `new Function`, `document.write` and
`insertAdjacentHTML` appear nowhere. The only sinks are React text children,
nine `setProperty` calls that all pass through `readTheme`, two `dataset`
writes, one `createObjectURL` for export, and two `location.reload` calls
behind user actions.

**One risk is now better evidenced than argued.** The regex-execution
invariant — user patterns never run on the main thread — is enforced by the
module graph: there is exactly one `new RegExp` in the codebase, and every
main-thread reference to that module is an `import type`, erased at compile
time. Previously this was a convention backed by review.

### Residual, and honestly rated

| Item | State |
|---|---|
| Screen-reader verification | **Not performed.** No screen reader in this environment. The tree is audited; how it *sounds* is unverified. Release gate. |
| Lighthouse accessibility ≥ 95 (A-18) | Not run. axe is clean; the two are not equivalent. |
| CSP verification on a preview deployment | Still open from M9. |
| CVD simulation (A-11) | Visual review only. |
| `regex-mobile › survives two timeouts` | Open, pre-existing, classified — a 15 s in-test budget on an emulated device, not a product defect. The architecture is green on 18 worker-lifecycle tests across three engines. |
| ReDoS | Not prevented and never claimed to be. Bounded and killed, off the main thread. |

---

## M11 — one risk reduced, two accepted

**No new risk category.** M11 removed code and rendered less of it; the surface
it touched was already covered by the worker, CSP and storage boundaries, none
of which changed.

| Reduced | |
|---|---|
| **R-04, bundle budget** | Initial JS 175.05 → 166.16 KB, **inside the 170 KB target for the first time since CodeMirror arrived at M4**, and 33.8 KB under the hard limit. The headroom that had been shrinking every milestone since M8 is restored. |

| Accepted, with reasoning | |
|---|---|
| **The keymap is maintained locally** | `src/components/editor/standardBindings.ts` is a copy of upstream's `standardKeymap` with one binding changed. If CodeMirror adds or fixes a binding, this file will not get it. Accepted because the array has been stable for years, every entry still points at upstream's own command function, and the file says in its own header what to do if a language mode is ever added: delete it and go back to `standardKeymap`. |
| **The splitter reaches for `parentElement`** | A component writing to its own parent's style is unusual coupling. Accepted because the alternative — a value prop and a change handler threaded through two workspaces — reconciles both panels on every pointer move, and the coupling is one documented line. |

| Not a risk, because | |
|---|---|
| No dependency was added | A splitter package, a virtualiser and Lighthouse were each considered and each declined. `16_DEPENDENCIES.md` records why. |
| The CSP, workers and storage boundaries are untouched | Verified by diff across every M11 commit, plus a fresh execution-sink scan: no `innerHTML`, no `dangerouslySetInnerHTML`, no `eval`, no `new Function`, and **no dynamic `import()`** — the last being the one an optimisation milestone is most likely to introduce. |
| The progressive match list cannot hide a result | The count is still the true count, the control states how many of how many are shown, and every returned match is reachable. The list is not filtered, only deferred. |
| The splitter cannot be used to lose the interface | Clamped 25–75 in the store, with a `minmax(14rem, …)` floor in the grid as a second guard. Asserted by dragging far past both viewport edges. |

### Known issues carried forward

| | |
|---|---|
| `regex-mobile › survives two timeouts` | **Resolved at M12, root cause found.** Not a budget and not device speed: `locator.fill()` appends rather than replaces on a CodeMirror contenteditable under mobile emulation, so the app was handed a pattern that was still catastrophic and correctly timed out. The M10 diagnosis and the M11 explanation were both wrong. Fixed in the test helpers. |
| Scattered E2E flake under parallel load | **Resolved at M12.** Carried since M7 as an environment artefact. Every instance had a real cause — an appending `fill()`, three buttons sharing an accessible name, an IndexedDB open that settles no event on WebKit, and an assertion reading a single instant mid-hydration. All four fixed; the full matrix is clean twice consecutively. |
| Real-device testing | **Not run at M11** — no physical device. Emulated viewports are not the same thing and are not claimed to be. Carried to M12. |

---

## M12 — the release gate

**No new risk category.** M12 added tests, two documents and one small
accessibility fix; the product's boundaries are unchanged and were re-verified
rather than assumed.

| Reduced | |
|---|---|
| **Test-suite trust** | The "scattered environment flake" carried since M7 was four distinct causes, not one, and none was environmental — an appending `fill()`, three buttons sharing an accessible name, an IndexedDB open that settles no event on WebKit, and an assertion read mid-hydration. All four found and fixed; the full matrix ran clean twice consecutively. A suite that fails at random teaches you to ignore it, which is the actual risk. **One genuine contention flake remains**, confined to the three projects that drive the Vite dev server, which is not the shipped artefact; it is documented rather than retried. |
| **R-06, service-worker bug bricks cached copies** | The update lifecycle is exercised end to end against the real headers: a new version waits, is announced, never self-reloads, keeps the editor's contents when accepted, and replaces the old precache rather than accumulating. |

| Accepted, with reasoning | |
|---|---|
| **Colour-vision separation** | Measured for the first time at M12. Under achromatopsia two token colours sit at ΔE 1.9; under deuteranopia the closest pair is 6.4. A fix was attempted and measured — it moved the crowding into another pair rather than removing it, because six colours all holding 7:1 against a dark surface leave too little luminance range. Accepted because colour is never the only signal: every construct is also named in words in the Explanation panel, the Structure tree and the Tokens table. **Closes with** a V1.1 palette redesign against luminance. |
| **Lighthouse Performance 78** | FCP 3.8 s under Lighthouse's simulated mid-tier phone at 4× CPU throttle, dominated by CodeMirror at 60% of the bundle. Unthrottled the same build paints in 124 ms. **Closes with** code-splitting the editor, which is an architectural change and not a QA patch. |
| **Lighthouse SEO 91** | One audit: `robots-txt` fails with `CSP violation`. The file is valid and served; Lighthouse's own fetch is blocked by the site's policy. The policy was not widened for a scanner. |

| Not a risk, because | |
|---|---|
| The security boundaries were re-verified, not assumed | Zero execution sinks, zero network APIs in `src/`, zero dynamic imports, zero third-party origins, CSP compared directive by directive, and zero CSP violations across every journey. *(The comparison was against `public/_headers`, which the live host ignored — see R-22.)* |
| Storage failure does not break the product | Malformed, future-schema, unavailable and over-capacity all exercised. The app reports and keeps working; nothing is deleted. |
| A full history stays usable | 1 000 entries — twice the documented cap — listed and searched. |

### Open at the end of M12

| | State |
|---|---|
| Real Cloudflare preview deployment | **NOT RUN** — no credentials in this environment. M13's by definition. |
| Screen-reader pass | **NOT RUN** — environment limitation, unchanged since M10. |
| CVD separation | **ACCEPTED RISK**, above. |


---

## Pre-M15 — the deployment reconciliation

Two risks materialised between M14 and M15, both about the difference between
what a repository *says* and what a deployment *does*. Neither was found by a
test, because in both cases a test was passing.

### R-22 — A gate that verified the wrong artefact 🟠 → ✅ **closed**

**What happened.** The release gate asserted served security headers against
`public/_headers`. The site is hosted on Vercel, which does not read that
format. Both halves of the assertion were correct; the assertion was
meaningless. The live deployment served **no CSP header, no
`X-Frame-Options`, no `frame-ancestors`, no `Referrer-Policy`, no
`Permissions-Policy` and no Cross-Origin headers** for the whole life of the
public deployment.

**Materially, what was lost.** Clickjacking protection. Both mechanisms that
prevent framing are header-only, so neither was in force: the page could be
embedded by any origin. The privacy-carrying part of the policy —
`connect-src 'none'` — was enforced throughout by the `<meta http-equiv>` tag
in `index.html`, so that claim never became false. It was resting on one
mechanism where the documentation said two.

**Closed by** moving the policy to `vercel.json` and pointing the edge, the
local production server and the gate at that one file. A configuration nobody
deploys can no longer pass a test.

**The general lesson**, which is the part worth keeping: *a test that reads a
file proves only that the file and the server agree.* It says nothing about
whether anyone reads the file. The question a deployment gate has to answer is
"what does the origin send", and the only way to answer it is to ask the
origin.

| | |
|---|---|
| **Detection** | `curl` against the live origin, prompted by a review of the host change. Not by the suite. |
| **Contingency if it recurs** | Verify as served, against the production origin, as a post-deploy step rather than a pre-deploy one. |
| **Checkpoint** | Pre-M15 ✅ |

### R-23 — Authorship metadata published by default 🟡 → ✅ **closed**

**What happened.** 102 published commits carried a `Co-Authored-By` trailer for
an AI assistant, and two of them carried a personal Gmail address as author and
committer, against the project's stated public-identity policy. GitHub never
listed a second contributor — the trailer address maps to no account — but the
trailers and the address were readable in the public history.

**Closed by** a single history rewrite before the M14 push, converting every
reachable commit to the account's GitHub noreply identity and removing the
trailers, with commit order, contents and ancestry preserved.

**Standing mitigation:** the repository's own `user.email` now matches the
public identity, so the next commit cannot reintroduce the address by default.
No further rewrite is planned; the public history is now stable by policy.


---

## M15 — what the two UX changes introduced

### R-24 — a shared link carries something private 🟡 → mitigated by scope

**Risk.** Preferences in the URL make links shareable, and a feature that
shares links invites the assumption that it shares *work*. One careless
extension — "and the pattern too" — turns a preference into a data-exfiltration
path through chat logs, browser sync and proxy logs.

**Mitigation, structural rather than procedural:** the codec has a closed
parameter namespace and no access to editor state at all. `urlPreferences.ts`
imports nothing from the workspace store; it could not encode a pattern if
asked. The feature is named *URL-backed preferences* in every document, and the
deferred share-URL work (D-02) keeps its own threat modelling.

**Accepted:** a shared link reveals the sender's theme. That is the feature.

### R-25 — a hostile link reaches a CSS sink 🟠 → closed by the existing validator

**Risk.** A URL is attacker-*authored*: sending someone a link is trivial where
writing to their localStorage requires already running code on the origin. The
values end up in `setProperty`.

**Closed by not adding a second validator.** The codec decodes into a plain
candidate object and hands it to `readTheme`, the total allowlist every
persisted theme has passed through since M8. A parallel validator would have
been a second thing to keep in agreement with the first — which is exactly the
failure mode the pre-paint bootstrap already carries, and the reason that file
now has a test reading it as text.

### R-26 — the analyse change trains people to distrust the button 🟡 accepted

**Risk.** Explicit submission is a real behaviour change for anyone who used
the app before. Someone who types and waits will see nothing happen.

**Mitigations:** the empty panel says what to do rather than staying blank; the
button is the most prominent control in the input panel; the stale badge
appears the moment the editor diverges from the result; and `Ctrl/⌘ + Enter`
works from anywhere in the workspace.

**Accepted, with the trade named:** deterministic results and no work nobody
asked for, in exchange for one keystroke. The previous behaviour replaced
correct explanations with errors about half-typed input, which is the failure
this removes.

### R-27 — the bundle is over its target 🟡 accepted, measured

172.26 KB against a 170 KB target, inside the 200 KB hard limit. Code-splitting
the cron workspace was tried and measured at **173.88 KB** — worse, for the
same reason the theme drawer experiment was worse. The remaining lever is the
editor at 60% of the bundle, which is architectural work rather than a
milestone patch. `12_PERFORMANCE.md` §14.3.
