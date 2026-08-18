# 21 — Acceptance Criteria

**Project:** SyntaxLab
**Status:** Revised in Phase 1.5 for the staged roadmap
**Last updated:** 2026-08-17

> Each criterion is **binary and verifiable**. "Works well" is not a criterion.
> **§§1–9 are V1.0.** **§11 is V1.1 (cron) and is not required for V1.0.**

---

## 1. Regex — V1.0

| # | Criterion | Verification |
|---|---|---|
| R-1 | A valid pattern produces a plain-English summary generated from the AST | Golden corpus, 150+ cases |
| R-2 | Every token has an entry in the breakdown with its meaning and position | Unit, per node type |
| R-3 | Hovering a token highlights its span in the editor, and vice versa | E2 |
| R-4 | The AST tree renders and each node links to its source span | Unit + E2 |
| R-5 | All seven flags toggle and change explanation and execution correctly | Unit + I3 |
| R-6 | An invalid pattern produces a specific error with an accurate position | Unit, per error code |
| R-7 | Error recovery yields a partial explanation for a single-typo pattern | Golden files |
| R-8 | Test strings produce highlighted matches at correct offsets | I3 |
| R-9 | Capture groups show correct numbers, names, and values | Unit + I3 |
| R-10 | **`(a+)+$` against 40 `a`s + `!` produces a timeout state within ~2.5 s** | I4, E12 |
| R-11 | **The main thread stays responsive during a catastrophic execution** (a click is handled) | E12 — ✅ infrastructure verified at M2 on 3 engines |
| R-12 | After a timeout the worker respawns and the next test succeeds | I4 — ✅ infrastructure verified at M2 on 3 engines |
| R-13 | Match count is capped at 10 000 and truncation is stated | Unit |
| R-14 | Zero-length global matches do not loop infinitely | Unit |
| R-15 | Patterns over 10 000 chars are rejected before parsing | Security §7.4 |
| R-16 | Nested-quantifier warning appears for known ReDoS shapes, **worded as a heuristic** | Unit + copy review |
| R-17 | **The `ECMAScript (JavaScript)` label is permanently visible on the input pane and is not dismissible** | E2 + manual |
| R-18 | **Python syntax `(?P<name>…)` produces the corrective hint naming the JS equivalent** | Unit, per row of the dialect table |
| R-19 | **PCRE syntax (`(?>…)`, `a*+`, `(?R)`, `\A`) produces a specific "not supported in JavaScript" message** | Unit |
| R-20 | Engine-compatibility notes are accurate for lookbehind, `\p{}`, and the `v` flag | Unit |
| R-21 | Examples load a working pattern and a matching test string | E2 |
| R-22 | Fuzz corpus completes with zero crashes and zero non-termination | Property — ✅ domain verified at M3 |
| — | **Regex execution never runs on the main thread** | ✅ verified at M4: `new RegExp` on user input exists only in `domain/regex/execute.ts`, imported by the execution worker alone; a CI grep asserts it |
| — | **A catastrophic pattern times out with the UI responsive** | ✅ verified at M4 on Chromium, Firefox and a mobile viewport; not reproducible on WebKit for a measured engine reason |
| — | **Bundle within the 170 KB target with CodeMirror present** | ✅ verified at M4: 162.54 KB counted, 148.79 KB entry chunk |
| R-23 | **Differential: validity verdict matches `new RegExp` on every corpus input** | Property — ✅ verified at M3 |

---

## 2. JSON — V1.0

| # | Criterion | Verification |
|---|---|---|
| J-1 | Valid JSON produces a correct tree with types and child counts | Unit + I5 |
| J-2 | **JSONTestSuite: all `y_*` accepted, all `n_*` rejected, `i_*` outcomes documented** | Conformance suite |
| J-3 | **Differential: validity verdict matches `JSON.parse` on every corpus input** | Property |
| J-4 | Errors give exact line, column, caret excerpt, and an actionable hint | Unit + I6 |
| J-5 | Clicking an error jumps the cursor to that position | I6 |
| J-6 | Error recovery yields a usable partial tree for a single-typo document | Unit |
| J-7 | Prettify at 2/4/tab and minify preserve content exactly | I7 |
| J-8 | Formatting preserves raw number text (`1e5` stays `1e5`) | Unit |
| J-9 | JSON paths are correct in dot and bracket notation and copy correctly | Unit + E3 |
| J-10 | Duplicate keys are detected and reported with all occurrence positions | Unit |
| J-11 | Unsafe numbers (precision loss) are detected and reported | Unit |
| J-12 | Nesting beyond 500 yields `LIMIT_EXCEEDED`, **not a stack overflow** | Security §7.4 |
| J-13 | Documents over 5 MB are rejected before parsing, with the size shown | Security §7.4 |
| J-14 | A 5 MB document parses without blocking the main thread | I5 + performance |
| J-15 | Trees over 500 rows virtualise and scroll smoothly | Manual + performance |
| J-16 | Tree search filters, highlights, and navigates matches | E3 |
| J-17 | **`{"__proto__":{"polluted":true}}` does not pollute `Object.prototype`** | Security §7.2 |
| J-18 | HTML in keys and values renders as visible text, never as markup | Security §7.1 |
| J-19 | Key order is preserved, including integer-like keys | Unit |
| J-20 | Near-miss syntax (trailing comma, single quotes, comments) produces a specific dialect-aware hint | Unit |
| J-21 | Fuzz corpus completes with zero crashes | Property |

---

## 3. Detection and modes — V1.0

| # | Criterion | Verification |
|---|---|---|
| M-1 | Pasted JSON is detected and suggested | I21 |
| M-2 | A regex-shaped pattern is detected and suggested | I21 |
| M-3 | Detection **suggests**; it never switches a mode the user has chosen | I21 |
| M-4 | Confidence below 0.6 produces "Unknown — select a mode", not a guess | Unit |
| M-5 | Auto-selection occurs only on first paste into an empty editor at ≥ 0.85 confidence | Unit |
| M-6 | The suggestion chip is dismissible and the dismissal persists for the session | E1 |
| M-7 | **The mode selector shows exactly two modes, with no disabled third** | Manual + visual review |
| M-8 | **No "coming soon" cron affordance appears anywhere in the workspace** | Manual review |
| M-9 | Detection never suggests a mode that does not exist in this release | Unit |

---

## 4. History — V1.0

| # | Criterion | Verification |
|---|---|---|
| H-1 | A successful analysis creates an entry with the correct title and metadata | I10 |
| H-2 | Restoring returns the exact original input | I11, E5 |
| H-3 | Restoring updates `lastOpenedAt` and `openCount` | I11 |
| H-4 | Search filters by title and input content | E5 |
| H-5 | Filtering by type returns only that type | Unit |
| H-6 | Pinned entries sort first and are exempt from pruning | Unit |
| H-7 | Rename persists | Unit |
| H-8 | Delete removes the entry and offers a 5-second undo | E5 |
| H-9 | Clear-all confirms with a count, then wipes | E5 |
| H-10 | **Auto-capture is ON by default** | Unit |
| H-11 | **The first-run notice appears once, before any entry is saved, and does not block the UI** | E5 + manual |
| H-12 | **"Turn history off" in the notice disables capture immediately** | I12 |
| H-13 | The notice does not reappear after acknowledgement | Unit |
| H-14 | **Pause history writes nothing** | I12 |
| H-15 | The paused state is visible in the header, clickable to resume, and survives reload | Manual |
| H-16 | **History status is mirrored in settings** (state, count, storage used, same actions) | Manual |
| H-17 | Duplicate analyses within 60 s update rather than duplicate | Unit |
| H-18 | Quota exceeded triggers prune → retry → notify → disable auto-capture | I15 |
| H-19 | Storage unavailable → memory mode, notice, **app fully functional** | I16 |
| H-20 | Corrupted records are quarantined; the list still renders | I17 |
| H-21 | Records with a higher `schemaVersion` are preserved and hidden, never deleted | Unit |
| H-22 | Export produces a valid versioned envelope | I14 |
| H-23 | Import validates fully and reports imported/skipped counts | I14 |
| H-24 | Hostile import files are rejected with a specific reason | Security §7.7 |
| H-25 | Changes propagate to other open tabs | I22 |
| H-26 | **Regex test strings are not persisted** | Code review + unit |
| H-27 | **Analysis results are not persisted** | Code review + unit |
| H-28 | **No UI or copy promises indefinite persistence**; eviction is disclosed | Copy review |

---

## 5. Theme — V1.0

| # | Criterion | Verification |
|---|---|---|
| T-1 | The default theme matches `09_DESIGN_SYSTEM.md` | Visual review |
| T-2 | All five presets apply correctly | E6 |
| T-3 | Gradient from/to/angle/intensity apply live | E6 |
| T-4 | Accent, glow, contrast, motion, and font scale apply live | E6 |
| T-5 | **Preferences persist across reload with no flash of default theme** | E6 |
| T-6 | Reset restores defaults | E6 |
| T-7 | The contrast checker reports the correct ratio and warns below 4.5:1 | Unit |
| T-8 | High-contrast mode meets AA on every surface | Manual + axe |
| T-9 | Reduced motion disables all transitions | E20 |
| T-10 | `prefers-reduced-motion` and `prefers-contrast` are honoured by default | Manual |
| T-11 | **Injection payloads in theme values are rejected; defaults applied** | Security §7.6 |
| T-12 | Corrupt theme data in localStorage does not prevent the app loading | Unit |
| T-13 | Theme changes propagate to other open tabs | Manual |
| T-14 | No component contains a hard-coded colour or spacing value | Stylelint |
| T-15 | The gradient appears in at most four places at default intensity | Visual review |

---

## 6. Offline and PWA — V1.0

| # | Criterion | Verification |
|---|---|---|
| O-1 | The service worker registers and precaches all assets | E8 |
| O-2 | **After first load, the app loads and runs with the network disabled** | E7 |
| O-3 | **Both analyses work offline** (worker chunks are precached) | E7 |
| O-4 | History reads and writes work offline | E7 |
| O-5 | Theme customisation works offline | E7 |
| O-6 | **An update check failing offline produces no error and is not treated as an offline failure** | E7 |
| O-7 | The offline indicator appears when offline and is not alarming | Manual |
| O-8 | A new version shows an update banner | E9 |
| O-9 | **The app never auto-reloads** | E9 |
| O-10 | Editor content survives the update reload | E9 |
| O-11 | Old caches are cleaned up after activation | E8 |
| O-12 | The app is installable | Lighthouse |
| O-13 | Installed PWA launches standalone and works offline | Manual |
| O-14 | SW registration does not delay first paint | Performance |
| O-15 | Precache stays within budget | CI |
| O-16 | **No runtime caching strategy is configured** (nothing to cache) | Code review |

---

## 7. Security — V1.0

| # | Criterion | Verification |
|---|---|---|
| S-1 | **Every XSS payload renders as visible text; the canary never fires** | Security §7.1 |
| S-2 | **No `eval`, `new Function`, or `dangerouslySetInnerHTML` in `src/`** | ESLint + CI grep |
| S-3 | The CSP is present on production and no violation occurs during a full session | E18 |
| S-4 | **Zero network requests after initial load** (excluding SW update checks) | E17 |
| S-5 | Prototype-pollution payloads leave `Object.prototype` untouched | Security §7.2 |
| S-6 | Every input limit is enforced at all three layers | Security §7.4 |
| S-7 | Oversized inputs are rejected cleanly with no crash or hang | Security §7.4 |
| S-8 | Tampered storage records are quarantined, not executed or crashed on | Security §7.5 |
| S-9 | Theme injection is rejected by the hex allowlist | Security §7.6 |
| S-10 | Malicious import files are rejected with a specific reason | Security §7.7 |
| S-11 | Clipboard writes are `text/plain` only, never `text/html` | Code review |
| S-12 | All security headers are present in production | Post-deploy checklist |
| S-13 | `npm audit --audit-level=high` is clean | CI |
| S-14 | No copyleft licences in the dependency tree | CI |
| S-15 | Production errors contain no user content, stack traces, or internals | Code review |
| S-16 | **Every claim in `05_SECURITY.md` §17 maps to a passing test** | Manual review |
| S-17 | **No documentation or UI copy contains an absolute security claim** ("impossible", "guaranteed", "completely safe", "nothing can leave") | Copy review + CI grep |
| S-18 | **No share-URL code path exists in the V1.0 build** | Code review |

---

## 8. Accessibility — V1.0

| # | Criterion | Verification |
|---|---|---|
| A-1 | **Zero critical or serious axe violations on every view** | axe CI |
| A-2 | Every action is reachable and operable by keyboard alone | E11 |
| A-3 | Focus is always visible with ≥ 3:1 contrast | Manual + axe |
| A-4 | Dialogs and drawers trap focus and restore it on close | Unit + manual |
| A-5 | Analysis results announce a useful summary via a live region | Manual, screen reader |
| A-6 | Announcements are debounced and not spammy while typing | Manual |
| A-7 | Errors announce via `role="alert"` | Manual |
| A-8 | The first-run notice is announced once and is keyboard-dismissible | Manual |
| A-9 | Every default colour pair meets AA | Automated contrast check |
| A-10 | No status is conveyed by colour alone | Greyscale review |
| A-11 | Syntax colours remain distinguishable under CVD simulation | Manual |
| A-12 | Usable at 200% zoom with no horizontal scrolling | E16 |
| A-13 | Usable at 320 px width | E15 |
| A-14 | `prefers-reduced-motion` disables all animation | E20 |
| A-15 | **A full analysis can be completed with a screen reader** | Manual, NVDA + VoiceOver |
| A-16 | Semantic landmarks, one `h1`, hierarchical headings | axe + manual |
| A-17 | Every control is labelled; icon buttons have accessible names | axe |
| A-18 | Lighthouse accessibility ≥ 95 | Lighthouse CI |

---

## 9. Performance — V1.0

| # | Criterion | Verification |
|---|---|---|
| P-1 | **Initial JS is within the hard budget, measured on a production build** | CI budget |
| P-2 | Every per-chunk budget met | CI budget |
| P-3 | Total precache within budget | CI budget |
| P-4 | Lighthouse Performance ≥ 95 | Lighthouse CI |
| P-5 | FCP < 1.5 s cold on throttled Fast 3G | Lighthouse |
| P-6 | TTI < 2.5 s cold | Lighthouse |
| P-7 | Warm load interactive < 300 ms | Manual |
| P-8 | CLS < 0.05 | Lighthouse |
| P-9 | **No main-thread task exceeds 50 ms during a scripted session** | Long-task audit |
| P-10 | Typing does not re-render the analysis pane | Render-count test |
| P-11 | A 1 MB JSON document analyses in under 500 ms in the worker | Benchmark |
| P-12 | The 500-entry history list renders in under 50 ms | Benchmark |
| P-13 | Theme changes repaint in under 50 ms | Manual |
| P-14 | No memory growth after 20 open/close cycles of each drawer | Heap snapshot |
| P-15 | **Measured numbers are recorded in `12_PERFORMANCE.md` §10** — an estimate never satisfies a criterion | Manual |
| P-16 | **A first measurement exists from Milestone 1**, not only at release | Manual |

---

## 10. Deployment — V1.0

| # | Criterion | Verification |
|---|---|---|
| D-1 | Production is live over HTTPS on the chosen domain | Manual |
| D-2 | All security headers present | securityheaders.com / curl |
| D-3 | HSTS active | Manual |
| D-4 | Asset caching immutable; `index.html` and `sw.js` not cached | curl |
| D-5 | Preview deployments are noindexed | Manual |
| D-6 | Cloudflare HTML-modifying features are disabled | Dashboard review |
| D-7 | Rollback verified to work | Manual, once, deliberately |
| D-8 | The full post-deploy checklist passes | `17_DEPLOYMENT.md` §8 |
| D-9 | README, SECURITY.md, and CHANGELOG are present and accurate | Review |
| D-10 | Source maps are **not** deployed | Manual |
| D-11 | **The product name matches the shipped scope** ("Regex & JSON Explainer") | Review |

---

## 11. Cron — **V1.1 only, NOT required for V1.0**

> None of these criteria gates the V1.0 release. They gate V1.1.

| # | Criterion | Verification |
|---|---|---|
| C-1 | A valid 5-field expression produces a correct plain-English summary | Golden corpus, 100+ |
| C-2 | The field table shows raw value, resolved values, and meaning per field | Unit |
| C-3 | The next 10 execution times are correct in the selected mode | Unit |
| C-4 | **Every displayed time carries a timezone label** (invariant C-I1) | E4 + code review |
| C-5 | Switching between browser-local and UTC recomputes all times | I9 |
| C-6 | **The active timezone is always visible, and browser-local shows the resolved zone name** | Manual |
| C-7 | **A 6-field expression is refused with the educational message and is never parsed** | Unit + E4 |
| C-8 | **A 7-field expression is refused with the educational message** | Unit |
| C-9 | **Quartz syntax (`L`, `W`, `#`, `?`) is refused with a message naming Quartz** | Unit |
| C-10 | **Jenkins `H` is refused with a message naming Jenkins** | Unit |
| C-11 | Field counts other than 5 produce "expected 5 fields, got N" | Unit |
| C-12 | **The DOM/DOW OR-rule warning appears whenever both fields are restricted** | Unit + E4 |
| C-13 | Spring-forward skipped times are detected and labelled | Unit |
| C-14 | Fall-back repeated times are detected and both instants shown | Unit |
| C-15 | Unsatisfiable schedules report "will never run" with the reason | Unit |
| C-16 | Next-run search terminates within the 5-year bound for every input | Property |
| C-17 | Both `0` and `7` mean Sunday, and the explanation says which was applied | Unit |
| C-18 | Macros are expanded and explained; `@reboot` is explained as non-schedulable | Unit |
| C-19 | Presets load valid expressions | E4 |
| C-20 | The builder and the expression stay synchronised in both directions | E4 |
| C-21 | Leap years are handled correctly across 4/100/400 boundaries | Unit |
| C-22 | Invalid field values give a specific message with the valid range | Unit |
| C-23 | **A standing note states that times will not match a scheduler in a different timezone** | Copy review |
| C-24 | Fuzz corpus completes with zero crashes and zero non-termination | Property |
| C-25 | The mode selector shows three modes and the product name has broadened | Manual |

---

## 12. Definition of Done — V1.0

```
[ ] Every criterion in §§1–10 passes
[ ] Every V1.0 "must" user story in 01_PRD.md §10 is implemented
[ ] CI fully green: typecheck, lint, unit, property, security, e2e, a11y, lighthouse
[ ] Coverage gates met: domain ≥ 95%, overall ≥ 85%
[ ] Fuzz corpus completes with zero crashes for both parsers
[ ] Manual test checklist complete (13_TEST_PLAN.md §12)
[ ] Manual security review complete, no unaddressed findings
[ ] Manual accessibility review complete with a real screen reader
[ ] Measured performance numbers recorded in 12_PERFORMANCE.md §10
[ ] Documentation matches shipped behaviour
[ ] No open question in 22_OPEN_QUESTIONS.md §2 blocks release
[ ] V1.0 reads as a complete product — no disabled affordances, name matches scope
```

### Explicitly not required for V1.0

Cron (V1.1) · share URLs · JSON→TypeScript · JSON→JSON Schema · light theme · i18n · diff mode · JSONC/JSON5 · ReDoS static risk report · non-ECMAScript regex explanation.

**Their absence is not a defect.** Anything on this list appearing as a disabled control in the UI *is* a defect (M-7, M-8).

---

## 13. Definition of Done — V1.1

```
[ ] Every criterion in §11 passes
[ ] All V1.0 criteria still pass (no regression)
[ ] Cron included in offline, security, and a11y test suites
[ ] Bundle re-measured with the cron chunk, still within budget
[ ] Product name and README updated to include cron
```

---

## 14. Quality bar — subjective, reviewed by a human

Not automatable. Failing these blocks release even with every checkbox ticked.

| # | Criterion |
|---|---|
| Q-1 | The interface does not look like a generic AI-generated dashboard |
| Q-2 | No giant cards, fake statistics, or meaningless sidebars |
| Q-3 | The gradient appears in at most four places at default intensity |
| Q-4 | Typography and spacing are consistent and deliberate |
| Q-5 | Empty states teach rather than apologise |
| Q-6 | Error messages are specific and actionable |
| Q-7 | Explanations read as written by a person who understands the syntax |
| Q-8 | The app feels instant in normal use |
| Q-9 | Nothing is animated without a reason |
| Q-10 | A developer would keep this tab open |
| Q-11 | **V1.0 feels like a finished tool, not two-thirds of one** |
