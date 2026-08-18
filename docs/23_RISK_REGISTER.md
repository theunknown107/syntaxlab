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
| R-03 | Cron timezone/DST correctness | **V1.1** | 3 | 4 | 12 | 🟠 |
| R-05 | Bundle budget exceeded | V1.0 | ~~4~~ 1 | 3 | ~~12~~ **3** | 🟢 **passed at M4 — 162.54 KB against a 170 KB target** |
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

### R-03 — Cron timezone/DST correctness 🟠 12 · V1.1

**Risk.** Timezone arithmetic is genuinely hard, and different schedulers legitimately resolve DST differently, so even a correct answer may not match the user's system. A skipped or doubled run at a DST boundary is a real production incident.

**Why it is 12 rather than 16.** **Not because it moved to V1.1** — deferring a risk does not reduce it. It is lower because the *scope* was reduced: browser-local and UTC only, no named IANA zones (D-04). That removes the inverse wall-clock-to-instant problem for arbitrary zones, which was the hardest and least testable part.

**Mitigations**
- Two timezone modes only, both fully testable
- Every displayed time carries a zone label (invariant C-I1)
- DST anomalies explicitly detected and labelled (`SKIPPED` / `REPEATED`)
- We document that schedulers differ and do not claim parity with any
- **Refusal to parse unsupported dialects** removes an entire class of wrong answers
- Bounded 5-year search guarantees termination
- UTC mode is offered as the verification path, since it has no transitions

**Detection:** golden-file mismatches at M14; user reports.
**Contingency:** restrict V1.1 to UTC only and document it.
**Checkpoint:** M14. **Owner:** developer.

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

**Residual: 🟢 low.** The remaining growth in V1.0 is the JSON feature plus
`@codemirror/lang-json` (M5–M6), the drawers (M7–M8), and the service worker
(M9), all of which are lazy chunks by design. Re-check at M11.

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
