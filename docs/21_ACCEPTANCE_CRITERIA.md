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
| R-22 | Fuzz corpus completes with zero crashes and zero non-termination | Property — ✅ regex at M3, JSON at M5 |
| — | **JSON validity matches `JSON.parse` on every corpus and fuzz input** | ✅ verified at M5 — 4 000 generated and mutated documents |
| — | **A prototype-pollution payload mutates nothing** | ✅ verified at M5 through parse, plain-value conversion, `Object.assign`, spread and `structuredClone` |
| — | **JSON nesting past the limit yields `LIMIT_EXCEEDED`, never a stack overflow** | ✅ verified at M5 — 200 000 levels, in a unit test and in a real worker |
| — | **Regex execution never runs on the main thread** | ✅ verified at M4: `new RegExp` on user input exists only in `domain/regex/execute.ts`, imported by the execution worker alone; a CI grep asserts it |
| — | **A catastrophic pattern times out with the UI responsive** | ✅ verified at M4 on Chromium, Firefox and a mobile viewport; not reproducible on WebKit for a measured engine reason |
| — | **Bundle within the 170 KB target with CodeMirror present** | ✅ verified at M4: 162.54 KB counted, 148.79 KB entry chunk |
| R-23 | **Differential: validity verdict matches `new RegExp` on every corpus input** | Property — ✅ verified at M3 |

---

## 2. JSON — V1.0

| # | Criterion | Verification |
|---|---|---|
| J-1 | Valid JSON produces a correct tree with types and child counts | Unit + I5 |
| J-2 | **JSONTestSuite: all `y_*` accepted, all `n_*` rejected, `i_*` outcomes documented** | ✅ **PASSED at M6** — 95/95, 188/188, 35 classified in `tests/unit/json/conformance.test.ts`; corpus vendored with a checksum manifest |
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
| H-1 | A successful analysis creates an entry with the correct title and metadata | ✅ **M7** — unit + E2E |
| H-2 | Restoring returns the exact original input | ✅ **M7** — E2E. Exact under the 100 000-char cap; a longer input is stored truncated **and flagged**, and the row says so |
| H-3 | Restoring updates `lastOpenedAt` and `openCount` | ✅ **M7** — unit + E2E |
| H-4 | Search filters by title and input content | ✅ **M7** — E2E |
| H-5 | Filtering by type returns only that type | ✅ **M7** — unit |
| H-6 | Pinned entries sort first and are exempt from pruning | ✅ **M7** — unit + E2E; `selectForPruning` cannot return a pinned entry at any pressure |
| H-7 | Rename persists | ✅ **M7** — unit + E2E, including reindexing for search |
| H-8 | Delete removes the entry and offers a 5-second undo | ✅ **M7** — E2E; the entry is verified still present after a reload |
| H-9 | Clear-all confirms with a count, then wipes | ✅ **M7** — E2E; the dialog names the count |
| H-10 | **Auto-capture is ON by default** | ✅ **M7** — unit |
| H-11 | **The first-run notice appears once, before any entry is saved, and does not block the UI** | ✅ **M7** — E2E |
| H-12 | **"Turn history off" in the notice disables capture immediately** | ✅ **M7** — E2E |
| H-13 | The notice does not reappear after acknowledgement | ✅ **M7** — E2E |
| H-14 | **Pause history writes nothing** | ✅ **M7** — unit + E2E, including a capture already waiting when the user pauses |
| H-15 | The paused state is visible in the header, clickable to resume, and survives reload | ✅ **M7** — E2E |
| H-16 | **History status is mirrored in settings** (state, count, storage used, same actions) | ✅ **M7** — in the history drawer, which is the only settings surface that exists at M7 |
| H-17 | Duplicate analyses within 60 s update rather than duplicate | ✅ **M7** — unit |
| H-18 | Quota exceeded triggers prune → retry → notify → disable auto-capture | ✅ **M7** — unit. Capture suspends with a stated reason and an explicit resume, rather than retrying a failing write after every analysis |
| H-19 | Storage unavailable → memory mode, notice, **app fully functional** | ✅ **M7** — E2E with `indexedDB` removed before any application code runs |
| H-20 | Corrupted records are quarantined; the list still renders | ✅ **M7** — E2E against the real database |
| H-21 | Records with a higher `schemaVersion` are preserved and hidden, never deleted | ✅ **M7** — unit + E2E; the record is read back off disk to prove it survived |
| H-22 | Export produces a valid versioned envelope | ✅ **M7** — unit + E2E |
| H-23 | Import validates fully and reports imported/skipped counts | ✅ **M7** — unit |
| H-24 | Hostile import files are rejected with a specific reason | ✅ **M7** — unit |
| H-25 | Changes propagate to other open tabs | ✅ **M7** — E2E across two real tabs, for both history and the pause setting |
| H-26 | **Regex test strings are not persisted** | ✅ **M7** — unit asserts a subject containing card-like digits never reaches a record |
| H-27 | **Analysis results are not persisted** | ✅ **M7** — `HistoryEntry` has no field for one |
| H-28 | **No UI or copy promises indefinite persistence**; eviction is disclosed | ✅ **M7** — unit asserts the wording, E2E asserts it is shown |

---

## 5. Theme — V1.0

| # | Criterion | Verification |
|---|---|---|
| T-1 | The default theme matches `09_DESIGN_SYSTEM.md` — **the four specified Matrix colours** | ✅ **M10** — the four values asserted literally in unit tests *and* against the rendered custom properties in E2E, plus visual review of the built interface |
| T-2 | All **six** presets apply correctly, including Crimson Night | ✅ **M10** — E2E; Crimson Night's two colours asserted exactly, and its derived accent asserted to differ from its gradient |
| T-3 | Gradient from/to/angle/intensity apply live | ✅ **M8** — E2E; from, to, direction and intensity each assert the resolved custom property |
| T-4 | Accent, glow, contrast, motion, and font scale apply live | ✅ **M8** — accent, glow, contrast, motion and font scale all applied and unit-tested. Accent is derived from the primary colour rather than separately chosen — `09_DESIGN_SYSTEM.md` §11.5 |
| T-5 | **Preferences persist across reload with no flash of default theme** | ✅ **M8** — E2E reads `--gradient-from` at `readyState === "interactive"`, before React mounts, and finds the stored value |
| T-6 | Reset restores defaults | ✅ **M8** — E2E, and the reset is verified to survive a reload |
| T-7 | The contrast checker reports the correct ratio and warns below 4.5:1 | ✅ **M8** — unit, including both boundaries and the surface constant pinned to `tokens.css` |
| T-8 | High-contrast mode meets AA on every surface | ✅ **M8** — axe over the whole interface and over the drawer in high-contrast mode |
| T-9 | Reduced motion disables all transitions | ✅ **M8** — E2E under `prefers-reduced-motion: reduce`; every transition collapses below 0.01 s |
| T-10 | `prefers-reduced-motion` and `prefers-contrast` are honoured by default | ✅ **M8** — `tokens.css` honours `prefers-contrast: more`; `prefers-reduced-motion` covered by E2E |
| T-11 | **Injection payloads in theme values are rejected; defaults applied** | ✅ **M8** — eighteen payloads planted in `localStorage`, in three engines |
| T-12 | Corrupt theme data in localStorage does not prevent the app loading | ✅ **M8** — unit and E2E; unparseable JSON, arrays, bare strings and an empty value all load the app |
| T-13 | Theme changes propagate to other open tabs | ✅ **M8** — E2E across two real tabs, via the `storage` event |
| T-14 | No component contains a hard-coded colour or spacing value | ✅ **M8** — Stylelint clean; the one inline style is a preset swatch that must not use a token |
| T-15 | The gradient appears in at most four places at default intensity | ⚠️ **M8** — visual review only. The four documented locations are unchanged by M8; there is no automated check that a fifth has not appeared. |

---

## 6. Offline and PWA — V1.0

| # | Criterion | Verification |
|---|---|---|
| O-1 | The service worker registers and precaches all assets | ✅ **M9** — asserted against the real cache: 10 entries, both worker chunks, `theme-bootstrap.js`, manifest and icons |
| O-2 | **After first load, the app loads and runs with the network disabled** | ✅ **M9** — `context.setOffline(true)` then reload, on Chromium, Firefox and mobile. Not verified on WebKit — Playwright cannot navigate it offline at all (`13_TEST_PLAN.md` §16) |
| O-3 | **Both analyses work offline** (worker chunks are precached) | ✅ **M9** — regex analysis, regex *execution* and JSON analysis all run with the network cut |
| O-4 | History reads and writes work offline | ✅ **M9** — read, write and delete, all offline |
| O-5 | Theme customisation works offline | ✅ **M9** — pre-paint theme survives an offline reload, and can be changed offline |
| O-6 | **An update check failing offline produces no error and is not treated as an offline failure** | ✅ **M9** — the hourly check catches and discards its rejection; nothing is shown |
| O-7 | The offline indicator appears when offline and is not alarming | ✅ **M9** — E2E asserts the chip appears offline, disappears online, carries `role="status"`, is not an `alert`, disables nothing, and passes axe |
| O-8 | A new version shows an update banner | ✅ **M9** — driven by replacing the served build, not by stubbing a registration |
| O-9 | **The app never auto-reloads** | ✅ **M9** — asserted by marking the document and confirming it survives; the worker is verified to be *waiting*, not active |
| O-10 | Editor content survives the update reload | ✅ **M9** — the editor contents are read back after the update reload |
| O-11 | Old caches are cleaned up after activation | ✅ **M9** — one precache after an update, and an unrelated cache planted on the origin is verified untouched |
| O-12 | The app is installable | ⚠️ **M9** — manifest, icons, scope, start_url and a registered service worker are all in place and asserted. **Lighthouse was not run**, and installability is not claimed for every browser: Firefox desktop offers no install, and iOS installs via Add to Home Screen rather than the manifest criteria |
| O-13 | Installed PWA launches standalone and works offline | Manual |
| O-14 | SW registration does not delay first paint | Performance |
| O-15 | Precache stays within budget | CI |
| O-16 | **No runtime caching strategy is configured** (nothing to cache) | Code review |

---

## 7. Security — V1.0

| # | Criterion | Verification |
|---|---|---|
| S-1 | **Every XSS payload renders as visible text; the canary never fires** | ✅ **M10** — 8 payload shapes through the regex editor, JSON keys/values, history via the UI and via IndexedDB, and search; no dialog, no injected element |
| S-2 | **No `eval`, `new Function`, or `dangerouslySetInnerHTML` in `src/`** | ✅ **M10** — repository-wide grep: none of `innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function`, `document.write`, `insertAdjacentHTML` appears anywhere |
| S-3 | The CSP is present on production and no violation occurs during a full session | E18 |
| S-4 | **Zero network requests after initial load** (excluding SW update checks) | E17 |
| S-5 | Prototype-pollution payloads leave `Object.prototype` untouched | ✅ **M10** — asserted through the real JSON tree with `__proto__` and `constructor` as keys; `'polluted' in {}` is false |
| S-6 | Every input limit is enforced at all three layers | Security §7.4 |
| S-7 | Oversized inputs are rejected cleanly with no crash or hang | Security §7.4 |
| S-8 | Tampered storage records are quarantined, not executed or crashed on | ✅ **M10** — a record whose title, input and tags are all payloads is planted in IndexedDB; it renders as text and the app survives |
| S-9 | Theme injection is rejected by the hex allowlist | ✅ **M8** — unit and browser-level |
| S-10 | Malicious import files are rejected with a specific reason | Security §7.7 |
| S-11 | Clipboard writes are `text/plain` only, never `text/html` | Code review |
| S-12 | All security headers are present in production | Post-deploy checklist |
| S-13 | `npm audit --audit-level=high` is clean | ✅ **M10** — clean at `--audit-level=low`, which is stricter than the criterion |
| S-14 | No copyleft licences in the dependency tree | CI |
| S-15 | Production errors contain no user content, stack traces, or internals | Code review |
| S-16 | **Every claim in `05_SECURITY.md` §17 maps to a passing test** | Manual review |
| S-17 | **No documentation or UI copy contains an absolute security claim** ("impossible", "guaranteed", "completely safe", "nothing can leave") | Copy review + CI grep |
| S-18 | **No share-URL code path exists in the V1.0 build** | Code review |

---

## 8. Accessibility — V1.0

| # | Criterion | Verification |
|---|---|---|
| A-1 | **Zero critical or serious axe violations on every view** | ✅ **M10** — axe clean on the workspace, both drawers, high-contrast mode and a custom theme |
| A-2 | Every action is reachable and operable by keyboard alone | ✅ **M10** — skip link, mode switching by arrow key, both overlays, and 30 tab stops audited |
| A-3 | Focus is always visible with ≥ 3:1 contrast | ✅ **M10** — asserted on the focused element *and its ancestors*, because CodeMirror sets `outline: none` on itself and the wrapper draws the ring |
| A-4 | Dialogs and drawers trap focus and restore it on close | ✅ **M10** — both drawers trap focus and restore it to their opener; the transient `<body>` step as Chromium wraps the cycle is the cycle working, not a leak |
| A-5 | Analysis results announce a useful summary via a live region | Manual, screen reader |
| A-6 | Announcements are debounced and not spammy while typing | Manual |
| A-7 | Errors announce via `role="alert"` | Manual |
| A-8 | The first-run notice is announced once and is keyboard-dismissible | Manual |
| A-9 | Every default colour pair meets AA | ✅ **M10** — computed for all six presets against tokens read out of `tokens.css`; Crimson Night needed a derived companion and got one |
| A-10 | No status is conveyed by colour alone | Greyscale review |
| A-11 | Syntax colours remain distinguishable under CVD simulation | Manual |
| A-12 | Usable at 200% zoom with no horizontal scrolling | E16 |
| A-13 | Usable at 320 px width | E15 |
| A-14 | `prefers-reduced-motion` disables all animation | ✅ **M10** — every transition and animation collapses below 0.01 s under `prefers-reduced-motion` |
| A-15 | **A full analysis can be completed with a screen reader** | ❌ **NOT RUN** — no screen reader is available in this environment (NVDA/JAWS absent; Narrator cannot be driven or heard from a non-interactive shell). The accessibility *tree* is audited instead. This remains a release gate. |
| A-16 | Semantic landmarks, one `h1`, hierarchical headings | ✅ **M10** — one `main`, one `banner`, exactly one `h1` naming the product |
| A-17 | Every control is labelled; icon buttons have accessible names | ✅ **M10** — every control in all four surfaces checked for an accessible name via `ariaSnapshot` |
| A-18 | Lighthouse accessibility ≥ 95 | ⚠️ **NOT RUN** — Lighthouse was not executed. axe is clean across the views above; the two are not equivalent. |

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
| P-13 | Theme changes repaint in under 50 ms | ✅ **M8** — measured at 1.1 ms median, 2.3 ms slowest (`12_PERFORMANCE.md` §10.9) |
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
