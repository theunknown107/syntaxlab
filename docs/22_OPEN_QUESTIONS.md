# 22 — Open Questions

**Project:** SyntaxLab
**Status:** Revised in Phase 1.5 — **no question blocks V1.0**
**Last updated:** 2026-08-17

---

## 1. Decisions made in Phase 1.5

The four questions that blocked implementation are resolved. They are recorded here with their rationale so the reasoning is not lost, and so a future reader can tell the difference between a decision and an oversight.

### D-01 — Release strategy *(was Q-01)*

**Decision:**

| Release | Scope |
|---|---|
| **V1.0** | Regex · JSON · local history · theme customisation · PWA/offline · accessibility baseline · security baseline · test infrastructure · performance measurement · responsive UI · documentation |
| **V1.1** | Cron — standard 5-field dialect only |
| V1.2+ | Speculative; not scheduled |

**Rationale.** The source playbook estimated 3–4 days. The documented quality bar — custom parsers, differential and fuzz testing, a full accessibility pass, worker-isolated execution, a threat model — is substantially broader than that estimate assumed. Rather than pretend the two are equivalent, or quietly lower the bar, **the project is staged.** V1.0 is a coherent, complete product for regex and JSON; cron follows as V1.1.

The quality bar is what distinguishes SyntaxLab from the tools it competes with. The feature count is not. So the feature count is what moved.

**Consequence:** V1.0 must not read as a partial product. `08_UI_UX_SPEC.md` §2 specifies exactly how — two modes presented as the set, no disabled cron affordance anywhere, product name matching scope, cron mentioned once in the help dialog.

**Superseded:** the four options in the original Q-01.

---

### D-02 — History auto-capture *(was Q-02)*

**Decision: ON by default, introduced by a one-time first-run notice.**

**Rationale.** The user explicitly asked the product to remember previous analyses. An opt-in default fails that requirement in practice, because most users never enable a feature they must first discover. The privacy cost is paid down by *informing* rather than by *defaulting off*.

**What ships with it:**

| Control | Where |
|---|---|
| First-run notice, non-blocking, with an immediate "Turn history off" action | `08_UI_UX_SPEC.md` §9 |
| Pause/resume in the header **and** mirrored in settings | `08_UI_UX_SPEC.md` §6, §8 |
| Delete one entry, with undo | `08_UI_UX_SPEC.md` §8 |
| Clear all, with confirmation | `08_UI_UX_SPEC.md` §8 |
| History status visible in settings (state, count, storage used) | `08_UI_UX_SPEC.md` §8 |
| **Regex test strings not stored** | `03_DOMAIN_MODEL.md` §6.1 |
| **Analysis results not stored** — inputs only | `03_DOMAIN_MODEL.md` §6.1 |
| No deliberate secret storage; documented inability to detect secrets | `05_SECURITY.md` §9 |
| **Local storage is device storage, not a password vault** — stated plainly | `06_DATA_STORAGE.md` §9.1 |

**Residual risk accepted:** a user pastes a secret and forgets it is in history (RR-08 / R-09). Mitigated by the controls above, disclosed in the README and in-app help.

---

### D-03 — Regex flavour *(was Q-03, partially)*

**Decision: V1.0 executes ECMAScript (JavaScript) regex only, and says so unmissably.**

**Rationale.** The tester runs the browser's `RegExp`. Claiming PCRE/Python/Go/Java/.NET support would be a correctness lie, and a dangerous one — the divergences (lookbehind, possessive quantifiers, atomic groups, `\d` semantics, named-group syntax) are subtle enough to pass casual inspection, so a user could ship a broken pattern with *more* confidence than they started with.

**How it is surfaced** (`01_PRD.md` §7.2): a permanent non-dismissible `ECMAScript (JavaScript)` label on the input pane; a help-dialog section listing the divergences; and targeted errors when foreign syntax is detected — `(?P<name>…)` produces *"that is Python syntax; JavaScript uses `(?<name>…)`"*.

**Explicitly not built now:** any dialect abstraction, strategy interface, or configuration surface for a second flavour. The parser and explainer merely do not *preclude* an explanation-only mode later. Building extensibility for an unscheduled feature is the over-engineering this project exists to avoid.

**Still open:** whether explanation-only support for other flavours ever ships — see Q-03 below.

---

### D-04 — Cron dialect *(was Q-04)*

**Decision: standard 5-field cron only** — minute, hour, day-of-month, month, day-of-week.

**Not supported:** Quartz, Jenkins, Spring, AWS variants, seconds-first 6-field, year-field 7-field, and the `L W # ? H` extensions.

**On a 6- or 7-field expression: refuse, do not guess.**

> "This expression does not match SyntaxLab's supported 5-field cron format. It has 6 fields. Some schedulers (Quartz, Spring) put seconds first; others append a year. SyntaxLab supports the standard 5-field format and does not guess between the alternatives, because they produce different schedules."

**Rationale.** A 6-field expression is genuinely ambiguous. Guessing produces a *plausible, confidently wrong* schedule — the worst failure mode this product has, because the user acts on it. Refusing with an explanation is strictly more useful than a confident wrong answer.

**Timezone scope reduced:** V1.1 supports **browser-local and UTC only**. Named IANA zones are deferred until the correctness and test strategy are defensible (Q-09). The active zone is always displayed, every generated time carries a zone label, no silent conversion occurs, and DST anomalies are detected and labelled. Reduced scope, not reduced rigour.

**No longer blocks V1.0** because cron itself is V1.1. **Implemented at M14 exactly as decided**, including the refusal message quoted above, which ships close to verbatim.

---

### D-05 — Share URLs *(was Q-06)*

**Decision: V1.0 ships clipboard sharing only. URL share state is deferred to V1.1+.**

**Rationale.** The documentation identified share URLs as the largest additional attack surface in the product — an attacker-controlled input path arriving via a click rather than a deliberate paste, requiring a decoder, decompressor, bomb guard, version negotiator, and validation layer over third-party data. It was a "should" priority. Spending the project's largest security budget on a nice-to-have in a first release is a poor trade.

**What V1.0 ships instead:** copy input, copy formatted output, copy explanation, copy JSON path. This covers the real need — "send this to a colleague" — through a channel the user already controls.

**Removed from V1.0:** the share codec, compression path, share dialog, URL read/validate pipeline, and the hostile-share-URL test suite. One trust boundary fewer (`02_ARCHITECTURE.md` §5.2).

**Retained as specification:** `05_SECURITY.md` §11.2, including the corrected fragment/referrer analysis, so the deferred work does not have to be re-derived.

---

### D-06 — Security claim language *(new in Phase 1.5)*

**Decision: no absolute security claims anywhere in the documentation or the product.**

Corrected across the package:

| Was | Now |
|---|---|
| "`connect-src 'none'` makes exfiltration structurally impossible" | "blocks the application's normal network-communication mechanisms and common script-initiated exfiltration channels, significantly reducing the network attack surface. Defence-in-depth, not proof of non-exfiltration." (`05_SECURITY.md` §4.2.1) |
| "XSS is structurally impossible" | "avoids the application's primary analysis-output HTML injection sink by rendering structured data through React's normal escaping model", plus a residual-risk table (`05_SECURITY.md` §2.3) |
| "`Referrer-Policy: no-referrer` guarantees the fragment is never sent" | The fragment is excluded from the HTTP request by fragment handling itself; `Referrer-Policy` is a separate, broader control. Both explained, and the remaining leakage routes listed. (`05_SECURITY.md` §11.3) |
| "Nothing leaves the browser" | "The application transmits nothing; the CSP blocks the standard channels" |

**The CSP itself is unchanged and remains strict.** Only the claims about what it proves were corrected.

---

### D-07 — Toolchain, identity, and repository *(decided at M0, Phase 2)*

Resolved when implementation began. These close Q-07 and Q-16.

| Item | Decision | Note |
|---|---|---|
| **Product name** | **SyntaxLab** | Confirmed. V1.0 titles and metadata read *"SyntaxLab — Regex & JSON Explainer"* per D-01. |
| **Domain** | **`syntaxlab.app` is a PLACEHOLDER** | **Not registered, not verified, not purchased.** It appears in documentation as an illustrative canonical URL only. Nothing may treat it as owned. Registering a domain — or choosing a different one — is an M13 task and a human action. |
| **Repository visibility** | **Public** | Makes the client-only privacy position independently auditable, which `01_PRD.md` §4 treats as material for the privacy-constrained user. |
| **Licence** | **MIT** | Consistent with the no-copyleft dependency rule in `16_DEPENDENCIES.md` §7. `LICENSE` created at M0. |
| **Copyright holder** | **`theunknown107`** | Resolved at the first public push. Was `SyntaxLab contributors`, a deliberate placeholder held open because no name had been supplied and inventing one would have been wrong. |
| **Node** | **22 LTS**, pinned via `.nvmrc` | The docs specified Node 20, which reached end-of-life in April 2026. Building on an unsupported runtime is not defensible, so the pin moved to Node 22. `17_DEPLOYMENT.md` §3.1 updated. |
| **npm** | 10+ | Matches the Node 22 toolchain. |
| **Git remote** | **Created at the first public push** | `github.com/theunknown107/syntaxlab`, public, `main`. Deferred through M0–M12 because creating it is a human action requiring account access; the local history was preserved and pushed intact rather than re-initialised. |

**Git remote and branch protection are deferred, honestly.** M0's deliverable list includes branch protection per `19_GIT_WORKFLOW.md` §5, which requires a hosted remote. No remote exists and creating one is a human action requiring account access. The repository is initialised **locally** with the documented commit conventions, so no history is lost. Branch protection, CI wiring, and the first push become an explicit task at whichever milestone the remote is created — at the latest M12, since `17_DEPLOYMENT.md` requires CI green before release.

**This does not block M1.** Local development, testing, and building need no remote.

---

## 2. Genuinely open questions

None of these blocks V1.0.

### Q-03 — Explanation-only support for other regex flavours

Should SyntaxLab ever *explain* PCRE/Python/Go patterns without executing them?

**Tension:** genuinely useful, but a user seeing an explanation may assume the tester's results apply to their engine — which would be exactly the harm D-03 avoids.

**If pursued (V1.2+):** it would need an unmistakable mode switch, execution disabled in that mode, and per-construct notes on semantic differences. **Recommendation:** revisit only if users ask for it.

---

### Q-05 — JSON dialect strictness

V1.0 accepts strict RFC 8259 with specific near-miss hints ("trailing commas are not valid JSON; JSON5 allows them"). Real files often contain comments (tsconfig) or trailing commas.

**Options:** (A) strict with hints *(current)*; (B) a tolerant-mode toggle; (C) detect and offer "parse as JSONC".

**Recommendation:** A for V1.0, C for a later release. The specific error message already delivers most of the value, and it teaches rather than papering over.

---

### ~~Q-07 — Product name and domain~~ — **RESOLVED at M0, see D-07**

Name confirmed as SyntaxLab. **The domain remains an unregistered placeholder** and must be treated as such everywhere until someone actually registers one. A wordmark is sufficient; a logo would be a distraction.

---

### Q-09 — Named timezones for cron

V1.1 supports browser-local and UTC only (D-04). Named IANA zones are deferred.

**Revisit when:** `Temporal` reaches baseline availability across our supported browsers, **or** an offset-probing implementation exists with the full zone-type test matrix (ahead, behind, half-hour offset, southern hemisphere, no-DST, and a zone that changed its rules).

**Do not ship named zones without that test matrix.** A wrong schedule in a named zone is worse than no named-zone support, because the user cannot tell it is wrong.

**Status after M16 — closer, but not close enough, and for a specific reason.**
M16 built offset probing and tested it across most of that matrix: `Europe/London`
(both directions), `Australia/Sydney` (southern hemisphere), `Asia/Kolkata`
(half-hour offset and no DST), `America/New_York`, and `Pacific/Kiritimati`.

That does **not** transfer to named zones, because the mechanism does not.
`getTimezoneOffset()` reports the offset of the *ambient* zone — the one the
runtime is in — so probing it can only ever answer questions about the user's
own clock. Resolving a wall-clock reading in an *arbitrary* zone needs a
different mechanism entirely: `Intl.DateTimeFormat` with a `timeZone` option,
formatted to parts and inverted, which has its own edge cases and its own test
burden. M16 makes the DST *reasoning* proven; it does not make named zones a
smaller job than it was.

Still deferred. Q-09 stays open.

---

### Q-11 — Cron history — *raised at M15, still open at v1.1.0*

Regex and JSON analyses are recorded in history. **Cron analyses are not.**

`HistoryEntry` has no cron variant, and adding one is not a small change: the
drawer renders type-specific metadata, an import is validated field by field
against the known variants, and an older build opening a newer export has to
degrade rather than break. A half-built record would put data on disk that a
later version has to migrate or discard.

**Revisit when** the cron entry has a designed shape — what is shown in the
drawer row, what a restore does to the timezone mode, and what an older build
does with an entry type it does not know.

**Until then this is stated plainly in the README** rather than left for a user
to discover by analysing a cron expression and finding no trace of it.

---

### Q-10 — Optional history encryption

Local history is unencrypted. Encryption without a user password is theatre — the key sits next to the data.

**Options:** (A) none, disclosed *(current)*; (B) optional password-derived encryption, which is real protection but means permanent data loss if forgotten; (C) a key in localStorage — **actively misleading; must never be built.**

**Recommendation:** A. B is legitimate later if users ask, but only built properly (a real KDF, unmistakable loss warnings) or not at all.

---

### Q-11 — Extracting the parsers as an npm package

The parsers and explanation engine are reusable, and this is the better answer to "can I have an API?" than building one.

**Recommendation:** keep internal through V1.1; revisit once the interfaces have stabilised. The layering already makes extraction straightforward.

---

### Q-12 — CodeMirror accessibility fallback

Code editors are hard to use with screen readers. CM6 is better than most, but "better than most" may still be unusable.

**Decision point: M10.** If a screen-reader user cannot complete an analysis, ship a plain-`<textarea>` toggle — roughly 50 lines, because the parser layer is editor-independent.

**Still undecided at the end of M12, and it cannot be decided here.** The
decision needs a screen reader, and none is available in this environment —
NVDA and JAWS are not installed, and Narrator cannot be driven or heard from a
non-interactive shell. What has been done instead is to assert the
accessibility *tree*: every control named, landmarks present, state exposed,
live regions announcing. That is the data a screen reader consumes, and it is
not the same as the experience of using one.

The question therefore travels with the screen-reader gate in
[`25_RELEASE_READINESS.md`](25_RELEASE_READINESS.md) §7: one pass through
Journeys A–D by someone who uses a screen reader answers both at once.

---

### Q-13 — Hand-written validators vs `zod`

We validate ~6 shapes with hand-written validators (0 bytes) rather than `zod` (~13 KB). Classified **"avoid unless justified"** in `16_DEPENDENCIES.md` §1.1.

**Revisit if:** the number of validated shapes roughly doubles, **or** a validation bug reaches production. Hand-written validators at a security boundary are exactly where a subtle omission is costly, which argues for the library despite the bytes. **A genuinely close call; a reviewer may reasonably overrule it.**

---

### Q-14 — Light theme

Currently unscheduled. Some developers work in bright environments, and dark-only is a real barrier for some users with astigmatism.

**Options:** (A) unscheduled *(current)*; (B) a full light theme, needing its own contrast audit and syntax palette; (C) a high-contrast light mode as an accessibility feature rather than an aesthetic one.

**Recommendation:** A, but **reconsider C if the M10 accessibility review identifies it as a barrier** rather than a preference.

---

### Q-15 — Analytics, ever?

Currently none, and `connect-src 'none'` blocks the usual mechanisms.

**Any future proposal requires:** a documented privacy review, a self-hosted vs third-party decision, a CSP change (which invalidates part of the threat model), an opt-in mechanism, and an update to every public privacy claim.

**Recommendation: no analytics.** The privacy position is why the privacy-constrained user persona can use the tool at all. Trading it for usage counts is a bad deal.

---

### ~~Q-16 — Repository visibility and licence~~ — **RESOLVED at M0, see D-07**

Public + MIT, confirmed by the maintainer. The copyright holder line remains a placeholder pending a real name.

---

### Q-17 — JSONC / JSON5 support *(new)*

Related to Q-05 but distinct: whether to add these as explicit input *modes* rather than as tolerant parsing of the JSON mode.

**Consideration:** a separate mode is honest but adds a fourth mode to a UI deliberately kept at two. Tolerant parsing within JSON mode is less honest but simpler. Undecided; not needed before V1.2.

---

## 3. Documented deviations from the original brief

| # | Brief says | Documentation says | Why |
|---|---|---|---|
| D-1 | Doc 11 covers "server/cache/local state boundaries" | Ephemeral / session / derived / persistent | There is no server. Inventing one to fill a section would be worse than substituting the boundaries that exist. (`11_STATE_MANAGEMENT.md` §1) |
| D-2 | "Fully offline PWA" | Offline for all core functionality; update checks excluded and stated as such | Update checks are inherently networked. Claiming otherwise would be false. (`07_PWA_OFFLINE.md` §1.1) |
| D-3 | Suggested folder structure with `features/<x>/` | Adopted, but all logic lives in `domain/` | Otherwise the "domain runs in a worker and under Node" rule is unenforceable |
| D-4 | "Design a strong CSP" | Strong, with a documented `style-src 'unsafe-inline'` exception | Forced by CodeMirror's runtime style injection. Recorded as RR-02, not hidden. |
| D-5 | Estimated 3–4 days | V1.0 at 17–23 days, staged | See D-01 |
| D-6 | Regex, JSON, **and Cron** in the product | Cron is V1.1 | See D-01. The product is coherent without it. |
| D-7 | "Consider shareable state URLs" | Deferred to V1.1+ | Largest attack surface, "should" priority. See D-05. |
| D-8 | Input detection across three types | Two types in V1.0 | Follows the scope decision |
| D-9 | History "possible fields" include analysis metadata | Metadata yes, **results no** | Results are recomputable; storing them duplicates sensitive content |
| D-10 | 24 documents at the repository root | Placed in `docs/` | Keeps the root navigable when source lands. Filenames unchanged. |

---

## 4. Assumptions

| # | Assumption | If wrong |
|---|---|---|
| A-1 | Desktop browsers are the primary environment | Mobile layout needs more investment |
| A-2 | Users are developers comfortable with technical language | Explanation copy needs simplifying |
| A-3 | English only is acceptable for V1 | i18n adds ~2 days |
| A-4 | 500 history entries is generous enough | Storage and search strategy need revisiting past a few thousand |
| A-5 | 5 MB is a sufficient JSON limit | Streaming/chunked parsing would be needed |
| A-6 | Cloudflare Pages free tier suffices | Costs appear |
| A-7 | A solo developer or very small team | The Git workflow needs more formality |
| A-8 | No legal/compliance obligations | No personal data is collected or transmitted, so this should hold — confirm if distributed by an organisation |
| A-9 | Free, no monetisation | Monetisation would change the architecture |
| A-10 | Last-2-versions evergreen + Safari 16.4+ | Wider support needs polyfills and budget |
| A-11 | **Users accept a two-mode V1.0 as a complete product** | If early feedback reads it as unfinished, the V1.1 cron work moves up rather than the UI apologising for the gap |

---

## 5. Documentation review log

### 5.1 Phase 1 cross-check

| # | Inconsistency | Resolution |
|---|---|---|
| X-1 | Regex exec timeout stated as both 2 s and 5 s | Standardised on 2 000 ms in `LIMITS` |
| X-2 | Share-URL size stated as both 8 KB and 2 KB | Standardised on 8 192 encoded characters |
| X-3 | History entry cap given as 1 000 and 500 | Standardised on 500 |
| X-4 | Theme persistence described as IndexedDB in one place | Corrected to localStorage (ADR-007) |
| X-5 | Workers planned after the regex parser | Moved before it |
| X-6 | Test plan referenced a light theme the design system defers | Removed |
| X-7 | Performance doc contained speculative measured numbers | Replaced with budgets and an empty measured table |
| X-8 | Detection described as both auto-switching and suggestion-only | Reconciled |
| X-9 | Dependency estimate consumed 99% of the budget | Flagged as R-05 |
| X-10 | Gradient placement count differed across three documents | Standardised on four |
| X-11 | PWA manifest shortcuts contradicted the no-router ADR | Documented as an enum-validated exception |

### 5.2 Phase 1.5 cross-check

| # | Issue found | Resolution |
|---|---|---|
| Y-1 | Absolute claims ("structurally impossible", "nothing can leave") across four documents | Rewritten; language policy added to `05_SECURITY.md`; claims table rebuilt with a "why the absolute form is wrong" column |
| Y-2 | `Referrer-Policy` incorrectly described as the mechanism preventing fragment transmission | Corrected; the two controls are now distinguished, and the remaining leakage routes (history, sync, screen sharing, link previews, the recipient) are listed |
| Y-3 | Cron appeared as a V1 feature in nine documents | Marked V1.1 throughout, with scope notes at the top of each affected document |
| Y-4 | Share URLs referenced as a V1 feature across security, UX, architecture, and test plans | Deferred consistently; the specification is retained but explicitly labelled V1.1+ |
| Y-5 | Trust-boundary count included the URL path | Reduced from six to five for V1.0 |
| Y-6 | Bundle estimate treated as headroom | Replaced with hard budget vs target region, and a measure-first process |
| Y-7 | "Switch to Preact if over budget" was stated as a plan | Withdrawn; replaced with a five-step escalation ladder ending at framework changes only with evidence |
| Y-8 | UI would have shown three modes with one unavailable | `08_UI_UX_SPEC.md` §2 added: two modes presented as the complete set, no disabled affordances |
| Y-9 | Storage described without an eviction caveat | `06_DATA_STORAGE.md` §9.1 added: persistence is explicitly not guaranteed |
| Y-10 | Test plan asserted parser behaviour in terms implying exhaustiveness | Reframed around evidence — conformance, golden, differential, fuzz, regression — with documented unsupported behaviour as a tested category |
| Y-11 | `CronTerm` retained Quartz variants contradicting the dialect lock | Removed from the model; the parser recognises them only to produce a specific error |
| Y-12 | Detection would have matched 5–7 cron fields while the parser refuses 6–7 | Detection tightened to exactly 5 fields, so detection never suggests a mode that will refuse the input |
| Y-13 | Offline guarantee and update checks were conflated | Separated in `07_PWA_OFFLINE.md` §1.1, with update-check failure explicitly not an offline failure |
