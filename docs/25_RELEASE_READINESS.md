# 25 — Release Readiness

**Project:** SyntaxLab
**Gate:** M17 — the v1.1.0 release (M12's V1.0 gate is kept below, unchanged)
**Status:** Complete
**Last updated:** 2026-08-22

> **Verdict: ready to release, with three gates open and named.** None of the
> three blocks a release; each is recorded here rather than absorbed, and each
> says what would close it.
>
> Every row below is one of **PASS**, **FAIL**, **NOT RUN**, **ACCEPTED RISK**
> or **ENVIRONMENT LIMITATION**. Nothing that was not actually executed is
> marked green.

---

## 1. Build and code quality

| Check | State | Evidence |
|---|---|---|
| Clean-tree production build | **PASS** | `rm -rf dist && npm run build`, 3.4 s, reproducible |
| TypeScript | **PASS** | `tsc --noEmit`, no errors |
| ESLint | **PASS** | 0 errors, 0 warnings across `src`, `tests`, `scripts`, configs |
| Stylelint | **PASS** | 0 errors |
| Prettier | **PASS** | every matched file formatted |
| `npm audit --audit-level=low` | **PASS** | 0 vulnerabilities |
| Dependencies intentional | **PASS** | 5 runtime, 28 dev, exact-pinned, unchanged since M9 |
| No secrets in the tree | **PASS** | scanned; the one hit is a test fixture asserting internals *do not* leak |
| No build artefacts committed | **PASS** | `dist`, `coverage`, `test-results`, `stats.html`, `.tmp` all ignored |
| Working tree clean | **PASS** | |

## 2. Budgets

| Measure | Result | Target | Hard | State |
|---|---|---|---|---|
| **Initial JS** | **166.22 KB** | 170 KB | 200 KB | **PASS** |
| Worker chunks | 19.56 KB | 80 KB | 120 KB | **PASS** |
| Service worker | 5.93 KB | 15 KB | 30 KB | **PASS** |
| CSS | 8.18 KB | 15 KB | 20 KB | **PASS** |
| Icons + manifest | 15.81 KB | 40 KB | 60 KB | **PASS** |
| Total precache | 218.15 KB | 1.5 MB | 2 MB | **PASS** |

Inside the *target*, not merely the hard limit — the first time since
CodeMirror arrived at M4.

## 3. Tests

| Suite | Result | State |
|---|---|---|
| Unit | **2 167 passed**, 36 files | **PASS** |
| JSONTestSuite conformance | **644 cases**, corpus checksums intact | **PASS** |
| End-to-end, full matrix | **674 passed, 0 failed, 11 skipped** | **PASS** |
| Full matrix repeatability | two consecutive clean runs; a third run hit the dev-server contention flake described below | **PASS** |

### The 11 skips, in full

All WebKit, all engine or harness limitations, each skipped in code with its
reason rather than silently absent.

| Count | Tests | Why |
|---|---|---|
| 6 | `offline-webkit` — all six offline tests | Playwright cannot navigate a WebKit page while the context is offline. Fails identically with no service worker registered. |
| 3 | `regex-webkit` — the three timeout tests | JavaScriptCore optimises the catastrophic patterns and cannot be made to time out by one. |
| 2 | `release-webkit` — Journeys A and B | The offline *portion* only; everything before it runs on WebKit. |

### Flakes: four fixed, one remaining and understood

M12 set out to classify the scattered flakes the project had carried since M7.
**Four had product- or test-logic causes, and all four are fixed.** No test is
retried, quarantined or loosened.

**One remains**, and it is a different category from the four below:

| | |
|---|---|
| `workers-*` — occasional timeout in `ready()` | The three `workers` projects are the only ones that run against the **Vite development server**, because driving the real worker harness needs a global that production compiles out. Under an eight-way parallel matrix that single dev server is a shared bottleneck: it transforms modules on demand, and the wait for the harness global occasionally exceeds the test timeout. |

Evidence that it is contention and not a defect: the same test passes **3 runs
out of 3 in isolation** and the whole project passes **22 out of 22** on its
own. It has appeared as a different test in the project each time — the
signature of load, not of logic.

**Re-measured before the pre-M15 push**, after the header configuration moved
to `vercel.json`, because a change to CSP and service-worker headers is exactly
the kind of thing that could have turned a flake into a fault:

| Run | Result |
|---|---|
| Full matrix, 8-way parallel | 678 passed, 11 skipped, **4 failed** — two `offline-firefox`, two `workers-firefox` |
| `offline-firefox` alone | **13 / 13 pass**, including both tests that had failed and every service-worker and offline test |
| `workers-firefox` alone, run 1 | **22 / 22 pass** |
| `workers-firefox` alone, run 2 | 21 passed, 1 failed — **a different test again** |
| The single failing test, alone | **3 / 3 pass** |

`offline-firefox` is the project that runs against the **production headers**
on :4183, so its clean isolated run is the one that clears the new
configuration. `workers-*` remains the dev-server surface, which is not the
shipped artefact.

Two notes on method, both mistakes made and corrected here:

- **Read Playwright's exit code, not the pipeline's.** `npx playwright test |
  tail` reports `tail`'s status, which is always 0. Three earlier runs in this
  project were recorded as "exit code 0" on that basis. Use `PIPESTATUS[0]`, or
  do not pipe.
- **Read the whole summary.** The failure count is printed *above* the pass
  count, so a `tail -5` shows "678 passed" and hides "4 failed".

**It cannot affect the shipped artefact**, because the dev server is not the
shipped artefact. Not fixed by raising a timeout or adding a retry, both of
which would hide it. What would close it: warming the dev server's module graph
before the matrix starts, or running the `workers` projects serially.

**The four that were fixed**, each carried for milestones as "environmental"
and each turning out to have a specific, findable cause:

| Long-standing failure | Real cause, found at M12 |
|---|---|
| `regex-mobile › survives two timeouts in a row`, open since M8 | `locator.fill()` **appends** rather than replaces on a CodeMirror contenteditable under mobile emulation. Filling `a+` over `(a+)+$` left `(a+)+$a+`, so the app correctly timed out on a pattern that was still catastrophic. M10 had diagnosed a hard-coded test budget; that was wrong. |
| `json-mobile › the suggestion can be dismissed`, intermittent since M7 | Three different buttons were named exactly "Dismiss". When the service worker finished installing mid-test a second one appeared and the locator became ambiguous. The ambiguity was the product's, and is fixed in the product. |
| `history-webkit › a record from a newer version is kept` | The test opened IndexedDB while the app's own open was still in flight; on WebKit that settles **no** event at all. |
| `theme-webkit › a valid field survives beside a corrupt one` | The test read `--color-accent` at a single instant during the pre-paint → hydration handover. Both engines settle on the same value; WebKit takes ~50 ms. |

## 4. User journeys

Driven against the production build under production headers, on Chromium,
Firefox, WebKit and an emulated Pixel 5.

| Journey | Covers | State |
|---|---|---|
| **A — Regex** | pattern, explanation, AST, test string, matches, capture groups, flags, invalid pattern, warning, catastrophic pattern, worker recovery, history capture and restore, theme change, reload, then all of it offline | **PASS** |
| **B — JSON** | tree, expand/collapse, search, format/minify round trip, duplicate keys, unsafe number, malformed input, prototype pollution, XSS payloads, history, reload, offline | **PASS** |
| **C — History** | capture in both modes, search, pin, delete, pause and prove nothing is captured, resume and prove it is, reload, clear all, and the app working against an empty store | **PASS** |
| **D — Theme** | all six presets against a populated interface, family attribute, every decorative token at its used value, editor decorations, keyboard focus ring, Matrix's exact four stops, Crimson's exact pair, themed reload | **PASS** |

## 5. Security

| Check | State | Evidence |
|---|---|---|
| Execution sinks | **PASS** | `innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function`, `document.write`, `insertAdjacentHTML`: **none** in `src/`, `public/`, `scripts/`, `tests/` |
| Dynamic imports / script injection | **PASS** | none — the one thing an optimisation milestone is most likely to introduce |
| Network APIs in `src/` | **PASS** | no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` anywhere |
| Third-party origins | **PASS** | no external fonts, scripts, images or analytics; system font stack |
| Page CSP served correctly | **PASS** | compared directive by directive against `vercel.json` by a test that reads the deployed configuration |
| Service-worker CSP | **PASS** | its own narrower policy; no style/img/font directive, no `unsafe-*` |
| `unsafe-eval` | **PASS** | absent, asserted |
| Eight non-CSP security headers | **PASS** | asserted individually |
| Zero CSP violations in use | **PASS** | watched for the life of every journey — regex, JSON, history, theme, offline |
| Prototype pollution | **PASS** | payload driven through the UI; real prototype chain checked afterwards |
| XSS payloads | **PASS** | no injected element, no `javascript:` href |
| Regex never on the main thread | **PASS** | one `new RegExp`, in the execution worker; every main-thread reference is an erased `import type` |
| Storage validate-on-read | **PASS** | proved twice over by M12's own seeding attempts being quarantined |

## 6. PWA, offline and update

| Check | State |
|---|---|
| Service worker registers, scoped to the origin root | **PASS** |
| Precaches every runtime asset, including both worker chunks | **PASS** |
| Caches only application assets — no user data | **PASS** |
| Real offline: regex, execution, JSON, formatting, history, theme, mode switch | **PASS** (network genuinely cut, not `navigator.onLine`) |
| Update detected, announced, never self-reloading | **PASS** |
| Accepting an update activates it and keeps the editor contents | **PASS** |
| Old precache replaced, not accumulated | **PASS** |
| App still works where service workers are unavailable | **PASS** |
| Manifest valid, correct content type | **PASS** |
| Icons exist at the sizes they declare | **PASS** — dimensions read from each PNG's IHDR, not trusted |
| Maskable icon present | **PASS** |
| Start URL and both shortcuts resolve, inside scope | **PASS** |
| Installability across browsers | **ENVIRONMENT LIMITATION** — the manifest, icons, scope and service worker all meet the documented requirements and are asserted, but an actual install prompt cannot be triggered headlessly. Browser-specific behaviour is documented in the README rather than claimed as universal. |

## 7. Accessibility

| Check | State |
|---|---|
| axe — workspace, both modes, both drawers, high contrast, custom theme | **PASS**, no critical or serious violations |
| Lighthouse accessibility | **PASS** — 100 |
| Keyboard only: every control reachable, focus always visible | **PASS** |
| Focus trapped in drawers, restored on close | **PASS** |
| Accessibility tree: landmarks, names, state, live regions | **PASS** |
| Heading order | **PASS** — fixed at M11 |
| Distinct accessible names | **PASS** — fixed at M12; three "Dismiss" buttons now say what they dismiss |
| Reduced motion | **PASS** |
| Forced colors | **PASS** — on computed values, two engines with opposite polarities |
| **Colour-vision deficiency** | **ACCEPTED RISK** — measured at M12 for the first time; see below |
| **Screen reader** | **NOT RUN** — environment limitation; see below |

### CVD — measured, and accepted

`npm run audit:cvd` renders the token palette under Chromium's own vision-
deficiency emulation and samples real pixels. Smallest distance between any two
token colours:

| | ΔE | Closest pair |
|---|---|---|
| normal | 28.9 | escape / group |
| protanopia | 12.3 | escape / quantifier |
| deuteranopia | 6.4 | anchor / escape |
| tritanopia | 13.2 | escape / group |
| achromatopsia | 1.9 | anchor / quantifier |

A fix was attempted and measured rather than assumed: lightening the anchor
improved its separation from the quantifier and pushed it into the group's
band instead. Six colours all holding 7:1 against a dark surface leave roughly
0.38–0.89 of luminance to divide six ways; the crowding moves, it does not go
away.

**Accepted because colour is never the only signal.** Every construct is also
named in words — in the Explanation panel, the Structure tree and the Tokens
table — which is what WCAG 1.4.1 requires. **What would close it:** redesigning
the syntax palette against luminance rather than hue, which is a design change
for V1.1, not a release-gate patch.

### Screen reader — not run

**NOT RUN — environment limitation.** NVDA and JAWS are not installed; Narrator
exists but cannot be driven or heard from a non-interactive shell. What is
tested instead is the accessibility *tree* — every control checked for a name,
plus landmarks, exposed state and live regions — which is the data a screen
reader consumes, not the experience of using one.

**What would close it:** one pass through Journeys A–D with NVDA or VoiceOver
by a person who uses one.

## 8. Performance

Re-measured at M12 against the M11 baseline; nothing regressed.

| | M11 | M12 |
|---|---|---|
| Startup cold / warm / offline (FCP) | 119 / 120 / 117 ms | 124 / 118 / 110 ms |
| Regex analysis, five shapes | 215–264 ms | 204–250 ms |
| Regex execution, 64 KB subject | 917 ms | 908 ms |
| JSON 98 KB / 488 KB / 977 KB | 76 / 127 / 150 ms | 60 / 107 / 123 ms |
| Tree expand-all · format | 88 · 76 ms | 65 · 57 ms |
| History open · theme switch | 37 · 51 ms | 26 · 40 ms |
| Memory, 20 drawer cycles | listeners 268 → 268 | unchanged |

### Lighthouse

Production build, production headers, Lighthouse 13.4.1 via `npx` — not a
dependency. Its defaults simulate a mid-tier phone at 4× CPU slowdown on
~1.6 Mbps, which is why its paint figures are seconds where direct measurement
is milliseconds. Both are true, of different machines.

| | Score | State |
|---|---|---|
| Performance | 78 | **ACCEPTED RISK** |
| Accessibility | **100** | **PASS** |
| Best Practices | **100** | **PASS** |
| SEO | 91 | **ACCEPTED RISK** |

**Performance 78** is FCP/LCP at 3.8 s under that simulated phone, dominated by
CodeMirror — 60% of the bundle and the reason the product exists. Closing it
means code-splitting the editor, which is an architectural change, not a QA
patch. Unthrottled, the same build paints in 124 ms.

**SEO 91** is a single audit: `robots-txt` fails with `CSP violation`. The file
is valid and served; Lighthouse's own fetch is blocked by the site's own
Content-Security-Policy. **The policy was not widened for a scanner.**

`valid-source-maps` also reports, and is not a defect: the production build
deliberately ships no source maps.

## 9. Storage and recovery

| Check | State |
|---|---|
| Empty history | **PASS** |
| Normal history, both modes | **PASS** |
| 1 000 entries — twice the documented cap — seeded, listed, searched | **PASS** |
| Malformed record | **PASS** — set aside and reported, never deleted |
| Record from a newer schema | **PASS** — kept intact for the build that understands it |
| Storage entirely unavailable | **PASS** — regex and JSON still work; the app says so rather than pretending |
| Quota / write failure | **PASS** — reported, app keeps working |
| Clear all, behind a confirmation | **PASS** |
| Corrupt theme in localStorage | **PASS** — per-field fallback, hostile values never applied |

## 10. Visual QA

Captured and inspected at 1280 / 1440 / 1920 and 360 / 390 / 414, across all
six themes, both modes, both drawers, and the error, warning and empty states.

| Check | State |
|---|---|
| Horizontal overflow | **PASS** — 0 px at every size measured |
| Theme leakage | **PASS** — no green in any non-green theme, chrome or editor |
| Matrix palette exact | **PASS** — `#00FF41 #008F11 #003B00 #0D0208` |
| Crimson Night sources exact | **PASS** — `#DC143C`, `#343434` |
| Focus visibility in every theme | **PASS** |
| Mobile header | **PASS** — two rows, 113 px |
| Empty Findings panel | **FIXED at M12** — a valid JSON document rendered a titled, empty box |

## 11. Deployment

| Check | State |
|---|---|
| Production headers served from the real configuration | **PASS — resolved before M15.** Previously PASS *as authored*, FAIL *as served*: the gate compared `serve:prod` against `public/_headers`, a Cloudflare file Vercel never read, so `frame-ancestors`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and the Cross-Origin trio were **not sent** by the live deployment. The policy now lives in `vercel.json`; the edge, the local production server and the gate all read that one file. Verified against `syntaxlab-jet.vercel.app` with `curl`. See `17_DEPLOYMENT.md` §4 and `05_SECURITY.md` §19. |
| One directive localised | **PASS, documented** — `upgrade-insecure-requests` is dropped on the HTTP localhost origin because WebKit would rewrite every subresource to `https://localhost`. A no-op on the HTTPS production origin. Nothing else is altered. |
| Hashed assets immutable, entry points revalidated | **PASS** |
| **Real Cloudflare Pages preview deployment** | **SUPERSEDED — hosting moved to Vercel.** The project deploys from `main` to `syntaxlab-jet.vercel.app`, which is public and serving the application, verified by unauthenticated request. Cloudflare was never used. |
| **Production security headers on the live deployment** | **PASS — closed before M15.** Ported to `vercel.json`, with the service-worker CSP preserved as a separate, mutually exclusive rule. Verified as served, not as authored. |

---

## The three open gates

| | State | What closes it |
|---|---|---|
| **Live security headers** | PASS — ported to `vercel.json` before M15. The material loss had been clickjacking protection: `frame-ancestors` and `X-Frame-Options` are both header-only, so neither was in force | Closed. The gate and the local production server now read the deployed configuration, so a policy that is not served can no longer pass a test |
| **Screen-reader pass** | NOT RUN — environment limitation | One pass through Journeys A–D with NVDA or VoiceOver, by someone who uses one |
| **CVD separation** | ACCEPTED RISK — measured, mitigated by text redundancy | A V1.1 palette redesign against luminance |

**None of the three blocks release.** The first is by definition M13's work.
The second is a verification gap, not a known defect, and the data a screen
reader consumes is asserted. The third is measured, understood, and mitigated
by the interface naming every construct in words.


---

# v1.1.0 release gate — M17

Everything below was executed on the release tree
(`feat/m16-cron-schedule`, merged to `main` as v1.1.0) rather than carried
forward from M12. Exit codes were captured directly, never through a pipe.

## 1. Build and code quality

| Check | State | Evidence |
|---|---|---|
| `npm ci` from the lockfile | **PASS** | exit 0, 0 vulnerabilities reported by the installer |
| `npm run typecheck` | **PASS** | exit 0 |
| Typecheck *actually checks source* | **PASS** | deliberate error planted in `CronSchedule.tsx` → **exit 2**, error located at 281:14; removed → **exit 0**; tree clean |
| `npm run lint` | **PASS** | exit 0 |
| `npm run format:check` | **PASS** | exit 0 |
| `npm test` | **PASS** | exit 0, **2 585 passed**, 47 files |
| `npm run build` | **PASS** | exit 0 |
| `npm audit --audit-level=low` | **PASS** | exit 0, 0 vulnerabilities |
| Banned sinks absent | **PASS** | no `eval`, `new Function`, `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML`, `dangerouslySetInnerHTML` in `src/` |
| Secret scan | **PASS** | no token, key or credential patterns in tracked files; no `.env` ever committed |
| Release history clean | **PASS** | 0 co-author trailers, 0 personal email, single identity `theunknown107@users.noreply.github.com` |
| Working tree clean | **PASS** | |

## 2. Budgets — measured on the release build

| Measure | Result | Target | Hard | State |
|---|---|---|---|---|
| **Initial JS** | **174.69 KB** | 170 KB | 200 KB | **ACCEPTED RISK** — over target, 12.7% under the hard limit |
| Worker chunks | 27.24 KB | 80 KB | 120 KB | **PASS** |
| Service worker | 6.02 KB | 15 KB | 30 KB | **PASS** |
| CSS | 8.95 KB | 15 KB | 20 KB | **PASS** |
| Icons + manifest | 20.36 KB | 40 KB | 60 KB | **PASS** |
| Total precache | 239.06 KB | 1 536 KB | 2 048 KB | **PASS** |

The 4.69 KB over target buys the entire cron schedule engine, its boundary
validator and its UI panel. Code-splitting cron has been measured as *worse*
twice, and nothing was going to be removed from accessibility, security or
functionality to recover it.

## 3. Latency — release tree, idle machine

| | Median | Range |
|---|---|---|
| Startup FCP, cold | **122 ms** | |
| Startup FCP, warm | 127 ms | |
| Startup FCP, offline | **114 ms** | |
| Regex analysis | 109–125 ms | includes the Analyze round trip |
| Regex execution, 64 KB subject | 909 ms | |
| JSON analysis, 977 KB | 117 ms | 91 ms at 98 KB |
| JSON expand-all, 500 KB | 51 ms | |
| Format | 41 ms | |
| History drawer open | 23 ms | |
| Theme switch | 31 ms | |
| **Cron search, worst p99** | **0.209 ms** | 326 steps of 100 000 allowed |
| Cron browser-local, DST-adjacent | 0.024–0.026 ms p99 | a transition costs nothing extra |
| Cron worker round trip | 0.008 ms search · 0.026 ms clone · 0.003 ms validate | 1 138 bytes |

Regex analysis is not directly comparable with the M11 figure: it now measures
a submitted analysis rather than a debounced one.

## 4. End-to-end

| | |
|---|---|
| Command | `npx playwright test`, exit code captured directly |
| Result | **845 passed, 2 failed** of 847 · **exit 1** |
| Failures | Both Firefox: one regex match list, one analysis arrival |
| In isolation | **6/6 across three repeats · exit 0** |
| Two Firefox projects together | 49/1 — and a *different* test fails |

**ACCEPTED RISK, characterised.** Every failure of this family asserts that a
worker's answer *arrived*, never that it was *correct*; none has produced a
wrong time, match or tree. The rate tracks host load, not the product. Root
cause and the concurrency correction are in `13_TEST_PLAN.md`.

## 5. Deferred, and still deferred

Cron history, named IANA timezones, a cron builder, six/seven-field cron,
seconds and year fields. Recorded in `22_OPEN_QUESTIONS.md`.
