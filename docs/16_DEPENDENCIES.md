# 16 — Dependencies

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

> Sizes below are **estimates from published package data**, not measurements of our build. They are recorded as budget inputs and must be re-measured after Milestone 1 — see §8.

---

## 1. Classification

**No dependency is added during Phase 1.5.** This section classifies what is proposed, so Phase 2 starts with an explicit list rather than an accumulating one.

| Class | Meaning | Rule |
|---|---|---|
| **Required** | V1.0 cannot be built to spec without it | Adopted at the milestone that needs it |
| **Optional** | Genuinely useful, but the feature works without it | Adopted only if measurement or experience justifies it |
| **Deferred** | Needed for V1.1+, not V1.0 | Not installed during V1.0 |
| **Avoid unless justified** | A plausible-looking choice we have decided against | Requires a written exception in the PR to introduce |

### 1.1 The V1.0 dependency list

| Package | Class | Purpose | Milestone |
|---|---|---|---|
| `react`, `react-dom` | **Required** | UI rendering + automatic text escaping | M1 |
| `@codemirror/state`, `/view`, `/commands`, `/language` | **Required** | Editor core | M1 |
| `@codemirror/lang-json` | **Required** | JSON highlighting (lazy chunk) | M5 |
| `@lezer/highlight` | **Required** | Syntax highlighting primitives | M1 |
| `idb` | **Required** | IndexedDB promise wrapper | M7 |
| `vite-plugin-pwa` | **Required** | Service worker generation | M9 |
| `@codemirror/search` | **Optional** | Editor find UI. We already build a CST we can search. **Adopt only if the hand-rolled path proves worse**, and it is the first thing dropped if the bundle is over target. | M6 |
| `@js-temporal/polyfill` | **Deferred** | Only if V1.1 named-timezone support is approved (Q-09). V1.1 as specified needs `Intl` only. | — |
| `zod` | **Avoid unless justified** | Hand-written validators cover ~6 shapes. Revisit if the count roughly doubles or a validation bug reaches production (Q-13). | — |

**Total required runtime dependencies for V1.0: 4 packages** (React pair, CodeMirror set, `idb`, `vite-plugin-pwa`).

### 1.2 Installed at M1 — actual

Measured from `package.json` after M1. **2 runtime dependencies, 25 dev.**

| Runtime | Version | Why |
|---|---|---|
| `react` | 18.3.1 (exact) | UI rendering + automatic text escaping |
| `react-dom` | 18.3.1 (exact) | |

Dev tooling installed: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/*`,
`vitest`, `@vitest/coverage-v8`, `happy-dom`, `@testing-library/{react,jest-dom,user-event}`,
`@playwright/test`, `@axe-core/playwright`, `eslint` + `typescript-eslint` +
`eslint-plugin-{react-hooks,react-refresh,jsx-a11y,boundaries}`, `globals`,
`stylelint` + `stylelint-config-standard`, `prettier`, `rollup-plugin-visualizer`.

**Two security-driven version decisions made during M1:**

| Package | Change | Reason |
|---|---|---|
| `eslint-plugin-boundaries` | 5 → **7** | v5 pulled a vulnerable `handlebars` transitively (1 critical, 2 high). v7 drops it. Required migrating to the `policies` API. |
| `happy-dom` | 17 → **20** | v17 carried a critical VM-context-escape advisory. This is the DOM that later milestones run fuzzed and hostile input through, so it is not a theoretical concern. |

`npm audit` reports **0 vulnerabilities** at M1.

**M4 added three runtime dependencies: `@codemirror/state`, `/view` and
`/commands`** — three of the six §1.1 anticipated. `@codemirror/language` and
`@lezer/highlight` were **not** installed: the regex colouring is driven by our
own tokenizer through the shared decoration mechanism, so a CM6 language mode
buys nothing and would let two grammars disagree about spans the explanation
already refers to. `@codemirror/lang-json` remains scheduled for M5 and
`@codemirror/search` remains unadopted.

**The size estimate in §2.2 was wrong, in the helpful direction.** Estimated
~150 KB gz; **measured 88.03 KB** for exactly the imports the editor uses
(`12_PERFORMANCE.md` §10.5). The entry chunk is 148.79 KB gz and the counted
budget 162.54 KB, inside the 170 KB target. §2.2 flagged that figure as "the
number most likely to be wrong"; it was, by 62 KB.

`npm audit` reports **0 vulnerabilities** with CodeMirror installed.

**M6 added no dependencies.** The tree is virtualised by hand — a fixed row
height and a slice by scroll offset, which is the arithmetic §3.2 of
`10_COMPONENT_ARCHITECTURE.md` describes and the reason a windowing library was
never needed. Search is a walk over the CST. `@codemirror/lang-json` was
**not** installed: the JSON editor needs error decorations at spans our own
parser produces, and a second grammar would be a second opinion about where
those spans are.

The one non-code addition is the **JSONTestSuite corpus** (MIT), vendored as
test fixtures under `tests/fixtures/jsontestsuite/` with its licence and
provenance. It is data rather than a dependency — nothing imports it at
runtime — and §4 of `04_PARSER_ARCHITECTURE.md` names it as the intended
conformance reference.

**M5 added no dependencies.** The JSON domain is written against the
platform alone, and `fast-check` — already installed at M3 — drives its
property suite. No JSON parser library was considered necessary: §6's
escalation path requires a demonstrated correctness problem first, and the
custom parser agrees with `JSON.parse` across the corpus and 4 000 generated
and mutated documents. `@codemirror/lang-json` remains scheduled for M6, where
there is an editor to highlight.

**M3 added one dev dependency: `fast-check`**, which §3 already approves as
"the highest-value test dependency in the project". It drives the property and
differential suites. No runtime dependency was added, and **`regexpp` was not
adopted**: the escalation path in §6 requires persistent differential
disagreement first, and the custom parser now agrees with `new RegExp` across
the whole corpus and fuzz budget (see `04_PARSER_ARCHITECTURE.md` §8.1.1 for
the four disagreements found and fixed).

**M2 added no dependencies.** The worker boundary is built entirely on
platform APIs — `Worker`, `postMessage`, `structuredClone`, and `setTimeout`.
A worker-RPC library (comlink and similar) was considered and rejected: it
would abstract away exactly the lifecycle control M2 exists to establish, and
terminate-and-respawn is not something a general-purpose RPC layer models.

**Not installed, deliberately:** no state library, no router, no UI kit, no icon
library, no animation library, no date library, no validation library, and
**no CodeMirror** — that arrives at M4 with the editor.

### 1.3 Admission criteria

Every runtime dependency must pass all six:

1. **Necessity** — a browser API or ~50 lines of our own code cannot do the job well
2. **Size** — its measured gzipped cost fits the target region in `12_PERFORMANCE.md` §2.3
3. **Maintenance** — released within ~12 months, issues being answered, more than one maintainer where possible
4. **Licence** — MIT / ISC / BSD / Apache-2.0. No copyleft, no ambiguity.
5. **Security history** — no unpatched advisories; a track record of responsive fixes
6. **Transitive weight** — a shallow tree; every transitive dependency is also read

A dependency failing any criterion needs a written exception in the PR, not a shrug.

---

## 2. Runtime dependencies

### 2.1 React + React DOM

| | |
|---|---|
| **Class** | **Required** |
| **Version** | ^18.3 |
| **Size** | ~45 KB gz combined *(estimate — to be measured at M1)* |
| **Licence** | MIT |
| **Purpose** | UI rendering |
| **Browser support** | All target browsers; no polyfills needed at our baseline |
| **Security** | Large, actively maintained, fast advisory response. Its text-escaping behaviour is load-bearing for `05_SECURITY.md` §2.1. |
| **Why not native APIs** | We would need a component model, reconciliation, and escaping discipline. Hand-rolling those is more code and more risk than the dependency, and the escaping would become our bug surface rather than a well-tested library's. |

**Why:** we need a component model, and React's automatic escaping of text children is a load-bearing part of the XSS defence (`05_SECURITY.md` §2.1). Ubiquitous, well-understood, and specified by the brief.

**Alternatives considered:** Preact (~4 KB — genuinely tempting and would free ~40 KB of budget; rejected because CodeMirror's React ecosystem and the testing tooling are React-first, and the compat shim reintroduces risk for a saving that is small relative to CodeMirror's 150 KB); Solid/Svelte (better performance, smaller, but the brief specifies React and the team knowledge is React); vanilla (would work, but the component/state discipline would have to be hand-built).

**Note:** React 19 is stable, but 18.3 is chosen for CodeMirror-ecosystem compatibility. Revisit after Milestone 3.

---

### 2.2 CodeMirror 6

| | |
|---|---|
| **Class** | **Required** (except `@codemirror/search`, which is Optional) |
| **Packages** | `@codemirror/state`, `/view`, `/commands`, `/language`, `/lang-json`, `@lezer/highlight` — plus `/search` only if adopted |
| **Size** | ~150 KB gz core + view + one language *(estimate — to be measured at M1; this is the number most likely to be wrong)* |
| **Licence** | MIT |
| **Purpose** | All editor surfaces |
| **Browser support** | Modern evergreen; matches our baseline. Requires no legacy shims. |
| **Security** | Builds DOM via `textContent`, not HTML strings — verified as part of adoption, and material to §2.2 of the security doc. Injects styles at runtime, which forces `style-src 'unsafe-inline'` (RR-02). |
| **Why not native APIs** | A `<textarea>` provides no syntax highlighting, no inline error markers, no decoration ranges for match highlighting, and no large-document virtualisation. All four are core to the product, and building them would be a larger and more bug-prone project than the rest of the app. |

**Why:** this is the product's primary interaction surface. A `<textarea>` cannot do syntax highlighting, inline error markers, decoration ranges for match highlighting, or large-document performance. CM6 does all four, is modular (we import only what we use), and has genuinely good accessibility for an editor.

**Cost:** the single largest dependency, roughly 75% of the initial JS budget. This is accepted and it is *why* everything else in this list is tiny.

**Alternatives:** Monaco (~2 MB — absurd here); Ace (older architecture, larger, weaker tree-shaking); Prism/highlight.js + textarea (highlighting only, no interaction, no error markers, no decorations — a genuine option if the budget ever fails, at a real capability cost); plain textarea (loses the core experience).

**Risks:** modular package set means version-skew bugs between `@codemirror/*` packages — pin them all to compatible versions and upgrade together. Runtime style injection forces `style-src 'unsafe-inline'` (`05_SECURITY.md` §4.3).

---

### 2.3 `idb`

| | |
|---|---|
| **Class** | **Required** |
| **Version** | ^8 |
| **Size** | ~1.2 KB gz *(estimate)* |
| **Licence** | ISC |
| **Purpose** | Promise wrapper over IndexedDB |
| **Browser support** | Wraps a universally available API; adds no requirements |
| **Security** | Tiny, single well-known maintainer, no transitive dependencies — a small and readable supply-chain surface |
| **Why not native APIs** | IndexedDB is native, but its event/callback API has genuinely error-prone transaction-lifetime semantics: a transaction auto-closes if you await a non-IDB promise inside it, which fails silently and intermittently. A hand-rolled wrapper would be about the same size and less tested. **This is the one case where the dependency is both smaller and safer than doing it ourselves.** |

**Why:** raw IndexedDB is an event/callback API with genuinely tricky transaction-lifetime semantics (a transaction auto-closes if you `await` a non-IDB promise inside it — a bug that is silent and intermittent). A hand-rolled wrapper would be roughly the same size and less battle-tested. This is the one case where the dependency is smaller *and* safer than doing it ourselves.

**Alternatives:** raw IDB (more code, more bugs); Dexie (~25 KB — a full query layer we do not need); localForage (~9 KB, abstracts away the indices we rely on); `idb-keyval` (too simple — no indices, and indices are what make the history list fast).

---

### 2.4 `vite-plugin-pwa` *(build-time, but ships a runtime helper)*

| | |
|---|---|
| **Class** | **Required** |
| **Version** | ^0.20 |
| **Size** | ~2 KB gz runtime registration helper; the generated SW is separate *(estimate)* |
| **Licence** | MIT |
| **Purpose** | Service worker generation and update handling |
| **Browser support** | Degrades cleanly where service workers are unavailable |
| **Security** | Generates the SW at build time from our own config; no runtime code fetching. SW bugs are the highest-consequence class in this app (R-06), which is the argument for well-tested tooling over hand-rolled. |
| **Why not native APIs** | The Service Worker API is native, but correct precache manifest generation with content hashes, cache versioning, and old-cache cleanup is exactly the tedious, high-consequence logic worth not rewriting. |

**Why:** hand-writing a service worker is possible but SW bugs are the worst class of bug in this app — they persist across reloads and can brick a user's cached copy. Workbox's precache and cleanup logic is well-tested. The plugin also generates the precache manifest with content hashes, which is exactly the tedious part.

**Alternatives:** hand-written SW (more control, more risk); Workbox directly (same thing, more config); no PWA (violates a core requirement).

---

## 3. Development dependencies

| Package | Purpose | Notes |
|---|---|---|
| `vite` | Build tool | Specified by the brief; fast, good defaults |
| `typescript` | Types | Strict mode, per `18_CODING_STANDARDS.md` |
| `@vitejs/plugin-react` | JSX + fast refresh | |
| `vitest` | Unit/integration tests | Shares Vite config — no second build pipeline |
| `@testing-library/react`, `/user-event`, `/jest-dom` | Component testing | Role-based queries |
| `fast-check` | Property/fuzz testing | The highest-value test dependency in the project |
| `@playwright/test` | E2E | Real browsers, offline emulation, SW support |
| `@axe-core/playwright`, `jest-axe` | Accessibility | |
| `eslint` + `@typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-jsx-a11y` + `eslint-plugin-boundaries` | Linting | `boundaries` enforces the layer rules from `02_ARCHITECTURE.md` §3 — the architecture is only real if it is enforced |
| `stylelint` + `stylelint-config-standard` | CSS linting | Enforces the token rule from `09_DESIGN_SYSTEM.md` §9 |
| `prettier` | Formatting | Zero debate |
| `rollup-plugin-visualizer` | Bundle analysis | Budget enforcement |
| `@lhci/cli` | Lighthouse CI | Performance/a11y gates |
| `happy-dom` | Test DOM | Faster than jsdom |

---

## 4. What we deliberately do NOT depend on

This section is the most important one in the document. Each row is a decision that keeps the budget viable.

| Not used | Instead | Saved |
|---|---|---|
| A state library (Redux/Zustand/Jotai) | ~40 lines over `useSyncExternalStore` | 1–13 KB |
| A router | Single page, mode as state | ~10 KB |
| A CSS framework (Tailwind/UnoCSS) | CSS custom properties — **required** for runtime theming | Build complexity |
| CSS-in-JS (styled-components/emotion) | Plain CSS + tokens | 12–15 KB + runtime cost |
| A UI kit (MUI/Chakra/Radix) | ~15 hand-built primitives on native elements | 50–300 KB |
| An icon library (lucide/heroicons) | ~20 inline SVGs | 5–50 KB |
| An animation library (framer-motion) | CSS transitions | ~35 KB |
| A date library (date-fns/dayjs/luxon) | `Intl.DateTimeFormat`; V1.1 needs only browser-local and UTC | 7–70 KB |
| A cron library (cron-parser/cronstrue) *(V1.1)* | Custom parser — needed anyway for field-by-field explanation with positions, and we support one dialect where libraries support many | ~15 KB |
| A regex parser (regexpp/regjsparser) | Custom parser — needed for positions + explanation-shaped AST | ~30 KB |
| A JSON parser (jsonc-parser) | Custom CST parser — needed for positions, duplicates, and raw number text | ~12 KB |
| A sanitiser (DOMPurify) | **No HTML is rendered at all** | ~20 KB |
| A schema validator (zod/yup) | Hand-written validators for ~6 shapes | 12–60 KB |
| A virtualiser (react-window) | ~60 lines for one fixed-height list | ~7 KB |
| A clipboard library | `navigator.clipboard` | ~2 KB |
| A UUID library | `crypto.randomUUID` | ~1 KB |
| A compression library (pako) | Not needed — share URLs are deferred; `CompressionStream` is native if they ship | ~45 KB |
| A fuzzy-search library (fuse.js) | `String.includes` over a precomputed field, at 500 entries | ~12 KB |
| An i18n library | English only in V1 | ~15 KB |
| An analytics SDK | None, by design | ~30 KB + the entire privacy promise |
| An error-reporting SDK (Sentry) | Local diagnostics only | ~25 KB + would need `connect-src` |

**Total avoided: roughly 300–700 KB gzipped.** That is the difference between a 200 KB tool and a typical SPA, and it is achieved almost entirely by asking "does the platform already do this?" rather than by clever optimisation.

### On `zod` specifically

The strongest candidate on that list. It would give clean, composable validation at every trust boundary, which is exactly where correctness matters most. Rejected because we validate ~6 shapes (history entry, export envelope, share payload, theme, settings, worker message) and hand-written validators for six shapes are ~200 lines with zero bytes shipped and no schema-inference edge cases. **If the number of validated shapes doubles, revisit — this is a genuinely close call and reasonable engineers disagree.** Recorded as **Q-13**.

---

## 5. Dependency management

| Practice | Detail |
|---|---|
| Lockfile | `package-lock.json` committed; `npm ci` in CI |
| Pinning | Exact versions for runtime deps; carets acceptable for dev tooling |
| Updates | Renovate/Dependabot weekly, grouped by ecosystem, **never auto-merged** |
| Audit | `npm audit --audit-level=high` fails CI |
| Review | Every lockfile change is read, including transitive additions |
| Install scripts | `--ignore-scripts` where feasible; any package requiring a postinstall gets scrutiny |
| Provenance | Prefer packages publishing npm provenance |
| Removal | Reviewed quarterly — unused dependencies are deleted, not left "in case" |

---

## 6. Fallback plans

Documented in advance so a failure is a decision, not a crisis.

| If | Then |
|---|---|
| The custom regex parser proves unreliable in fuzz testing | Adopt `regexpp` (~30 KB) for parsing; keep our own explanation layer on top. Budget absorbs it by dropping the search chunk. |
| The custom JSON parser proves unreliable | Adopt `jsonc-parser` (~12 KB); keep our own error messages and tree. |
| The custom cron engine proves unreliable | Adopt `cron-parser` (~15 KB) for schedule computation; keep our own field parser for the explanation and positions. |
| CodeMirror is **measured** over budget and the §8.2 ladder does not recover it | In order: drop `@codemirror/search`; then evaluate Preact with a measurement; only then consider a `<textarea>` + lightweight highlighter, which is a significant capability loss and a genuine last resort. |
| *(V1.1+)* `CompressionStream` proves too patchy | Share URLs, if they ship, go uncompressed with a smaller payload limit, stated in the dialog. |
| *(V1.1)* `Intl` proves insufficient even for browser-local and UTC | Unlikely at this reduced scope. If named zones are later approved (Q-09), adopt `@js-temporal/polyfill` (~50 KB) in the lazy cron chunk only — never in the initial bundle. |

Each fallback is a **contained** change because the domain layer is isolated behind interfaces. That containment is the real value of the layering.

---

## 7. Licence summary

| Licence | Packages | Compatible with a permissive release |
|---|---|---|
| MIT | React, CodeMirror, vite-plugin-pwa, most dev tooling | ✅ |
| ISC | idb | ✅ |
| Apache-2.0 | Some transitive tooling | ✅ |
| BSD-3 | Some transitive tooling | ✅ |

No copyleft (GPL/AGPL/LGPL) anywhere in the tree. A licence check runs in CI (`license-checker` in the quality job) so a transitive copyleft addition fails the build rather than being discovered at release time.

---

## 8. Measurement obligation

The sizes in this document are **estimates from published package data**. They are planning inputs, not evidence.

**Nothing is optimised, swapped, or removed on the strength of an estimate.** The Phase 1 draft stated that exceeding the budget would trigger a switch to Preact; that is withdrawn as a plan. The process is the one in `12_PERFORMANCE.md` §2.2:

```
build  ->  measure  ->  analyse  ->  optimise (smallest justified change first)  ->  measure again
```

### 8.1 The measurement table

Filled in at **Milestone 1**, from `rollup-plugin-visualizer` on a production build, and updated at every subsequent milestone. Until it has real numbers, no size claim anywhere in the documentation is authoritative.

| Package / chunk | Estimated (gz) | **Measured (gz)** | Δ | Measured at |
|---|---|---|---|---|
| react + react-dom | ~45 KB | — | — | — |
| @codemirror/* (core + view + lang) | ~150 KB | — | — | — |
| idb | ~1.2 KB | — | — | — |
| vite-plugin-pwa runtime | ~2 KB | — | — | — |
| **Initial bundle total** | **~198 KB** | — | — | — |

### 8.2 If the measurement is over target

Follow the escalation ladder in `12_PERFORMANCE.md` §2.2, which starts with accidental inclusion (barrel imports, eager imports, duplicate transitive versions) and ends — only with evidence — at a framework change. The likely first findings, based on where this kind of bundle usually leaks:

1. A `@codemirror/*` barrel import pulling more than the modules we use
2. A language mode loaded eagerly instead of in its lazy chunk
3. Two versions of a shared `@lezer/*` transitive dependency
4. `@codemirror/search` included when the CST search would do

Each of those is a small, local fix. **Preact is the last resort, not the first lever**, and adopting it would require a measurement showing it is both necessary and sufficient.

This is tracked as **R-05** in `23_RISK_REGISTER.md`, and its first measurement is an **M1 deliverable** rather than a late discovery — finding out at M13 that the budget never fitted would be the expensive version of this problem.
