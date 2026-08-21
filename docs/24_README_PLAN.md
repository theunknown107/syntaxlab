# 24 — README Plan

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

> This document plans the future `README.md`. The README itself is written at **M12**, once there is a working product to describe honestly.

> **Scope note (Phase 1.5).** The README describes **V1.0: Regex + JSON**. Cron is presented as an upcoming milestone, not as a gap. Share URLs are not mentioned as a feature.

---

## 1. Audience and purpose

Three readers arrive at the README, in roughly this order of frequency:

| Reader | Wants | Time budget |
|---|---|---|
| **A developer who found the tool** | What it does, whether it is safe to paste production data into, a link to try it | 20 seconds |
| **A developer evaluating the code** | Architecture, stack, why the decisions were made | 5 minutes |
| **A potential contributor** | How to run it, how to test it, how to contribute | 15 minutes |

The README must serve the 20-second reader **first**. Everything else goes below the fold, and the deep material lives in `docs/`.

---

## 2. Structure

```markdown
<!-- Hero: logo/wordmark, one-line description, badges, live link -->

# SyntaxLab

**Understand developer syntax instantly.**

Regular expressions and JSON — explained in plain English, tested live, and
processed in your browser. The app doesn't upload what you paste.

[**Try it →**](https://syntaxlab.app) · [Docs](./docs) · [Security](./SECURITY.md)

![CI](badge) ![License: MIT](badge) ![No dependencies on your data](badge)

<!-- ONE screenshot or GIF — the product doing its job -->

---

## What it does
## Why it's different
## Quick start (for users)
## Privacy
## Screenshots
## Development
## Architecture
## Testing
## Security
## Browser support
## Roadmap
## Contributing
## License
## Acknowledgements
```

---

## 3. Section content

### 3.1 Hero

One screenshot, above the fold, showing a real regex being explained with matches highlighted. Not a logo, not a feature grid — the product doing the thing it exists to do.

Badges: CI status, licence, version. **No badge inflation** — three at most. Twelve badges signal insecurity, not quality.

### 3.2 What it does

Two sections, one per mode, each with a **concrete example** rather than a feature list:

> **Regex** — Paste `^(?<year>\d{4})-(?<month>\d{2})$` and get: *"Matches a string containing exactly a four-digit year, a hyphen, and a two-digit month."* Plus a token-by-token breakdown, a syntax tree, and a live tester with capture groups.
>
> **JSON** — Paste a payload that won't parse and get the exact line, column, and reason — *"trailing comma before `}` at line 4, column 12"* — instead of a character offset. Plus a collapsible tree, copyable JSON paths, and duplicate-key detection.

Examples convey capability faster than adjectives.

**A required note, not a footnote:** the regex section states plainly that SyntaxLab runs **ECMAScript (JavaScript)** regex. A reader arriving with a PCRE or Python pattern must learn that here, not after acting on a result.

### 3.3 Why it's different

The four differentiators, stated plainly with no marketing voice:

| | |
|---|---|
| **Stays on your machine** | The app makes no network requests after load. The CSP sets `connect-src 'none'`, which blocks the usual network APIs. Check the Network tab — don't take our word for it. |
| **Works offline** | Install it, unplug, keep working. Only update checks need the network. |
| **Explains, doesn't just validate** | Explanations are generated from a real parse tree, not string matching. |
| **Fast and small** | No ads, no cookie banner, no login. *(Actual bundle size stated from the measured build — never an estimate.)* |

The "check the Network tab" line matters — it invites verification instead of asking for trust, which is the correct posture for a privacy claim.

**Wording rule:** this section says what the app *does* and what the CSP *blocks*. It does not say "nothing can ever leave your browser" — see §7.

### 3.4 Privacy

Its own top-level section, because for a meaningful share of the audience this is the deciding factor.

```markdown
## Privacy

Everything happens in your browser.

**What the app sends:** nothing. It fetches its own files on first load, and
after that the only network activity is an occasional check for a new version.
Your input is never part of any request. The Content Security Policy sets
`connect-src 'none'`, which blocks the standard network APIs (fetch, XHR,
WebSocket, beacons) — a strong control, though not a mathematical proof.

**What's stored locally:**
- Analysis history → IndexedDB (you can pause, search, export, or wipe it)
- Theme and settings → localStorage
- The app itself → Cache Storage, for offline use

**What we don't do:** no accounts, no analytics, no telemetry, no error
reporting, no cookies, no fonts or scripts from third parties.

**History is on by default.** SyntaxLab saves your analyses locally so you can
reopen them. You're told this on your first visit, and you can pause it, delete
individual entries, or clear everything at any time.

**Honest caveats:**
- Local history is stored **unencrypted**. Anyone with access to your browser
  profile can read it. Use the pause toggle for sensitive payloads.
- Browser storage is **not permanent**. Browsers can evict it under disk
  pressure, and Safari may clear it after a period of inactivity. Export if
  you need a backup.
- Browser extensions with page access can read anything on any page,
  including this one. No website can prevent that.
- The CSP reduces the network attack surface substantially. It is
  defence-in-depth, not a guarantee.
```

The caveats are what make the claims believable. A privacy section with no caveats reads as marketing.

### 3.5 Development

```markdown
## Development

**Requirements:** Node 22+, npm 10+

git clone https://github.com/<user>/syntaxlab.git
cd syntaxlab
npm ci
npm run dev

| Command | Description |
|---|---|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build |
| `npm test` | Unit + integration |
| `npm run test:e2e` | Playwright |
| `npm run test:property` | Fuzz/property tests |
| `npm run typecheck` | tsc --noEmit |
| `npm run lint` | ESLint + Stylelint |
| `npm run analyze` | Bundle visualiser |
```

### 3.6 Architecture

A short summary with a Mermaid diagram (GitHub renders it), then links into `docs/`:

```markdown
## Architecture

React + TypeScript + Vite. No backend, no database, no accounts.

**V1.0 scope:** regex and JSON. Cron is V1.1 — see the roadmap.

- **Domain** — hand-written parsers and the explanation engine. Pure
  TypeScript, no React, runs in Web Workers and under Node in tests.
- **Application** — use-cases and stores. Framework-light.
- **Infrastructure** — IndexedDB, workers, service worker, clipboard.
- **Presentation** — React components, feature-sliced.

Parsing and regex execution run in Web Workers, and they are **separate
workers**: a regex execution timeout terminates its worker without touching
parser state. Regex execution gets a 2-second deadline enforced by terminating
that worker — the only reliable way to stop a catastrophically backtracking
pattern in JavaScript.

Full detail: [docs/02_ARCHITECTURE.md](./docs/02_ARCHITECTURE.md)
```

### 3.7 Security

Brief, with the honest framing:

```markdown
## Security

All user input is treated as hostile. Key measures:

- **No HTML rendering path in analysis output.** Explanations are structured
  data rendered as React elements, so the highest-frequency injection sink
  — exercised on every analysis — doesn't exist. Other routes are documented
  rather than dismissed.
- **No `eval`, no `new Function`,** enforced by lint.
- **Strict CSP** with `connect-src 'none'` — removes the ordinary network
  paths a compromised dependency would use to exfiltrate what you paste.
- **Worker isolation with hard timeouts** for regex execution.
- **Size and complexity limits** enforced at three layers.
- **Validation on read** for everything from storage, URLs, and files.

We do not claim the app is "secure" as an absolute. See
[docs/05_SECURITY.md](./docs/05_SECURITY.md) for concrete mitigations,
residual risks, and what we deliberately do not defend against.

Reporting a vulnerability: [SECURITY.md](./SECURITY.md)
```

### 3.8 Roadmap

Honest, and it names what will not be built — which is more informative than the list of what will:

```markdown
## Roadmap

**Now (v1.0):** Regex · JSON · local history · theming · offline PWA

**Next (v1.1):** Cron — standard 5-field expressions, field-by-field
explanation, next run times, and an explicit timezone. Deliberately one dialect
done properly rather than five guessed at.

**Considering:** JSON → TypeScript · JSON → JSON Schema · shareable links ·
ReDoS risk report · light theme · explanation for other regex flavours

**Not planned:** accounts · cloud sync · AI-generated explanations · a backend
of any kind. These would each break something the tool is built around.
```

---

## 4. Screenshots and demo

### 4.1 Required

| # | Shot | Shows |
|---|---|---|
| 1 | **Hero** — regex with explanation, tree, and highlighted matches | The whole value proposition in one image |
| 2 | JSON tree with an error report | The second mode plus error quality |
| 3 | Theme drawer mid-customisation | The customisation story |
| 4 | Offline indicator with a working analysis | The offline claim, demonstrated |

*(A cron screenshot is added with V1.1. Until then there is none — no mock-ups of unshipped features.)*

### 4.2 Demo GIF

One, 10–15 seconds, ≤ 3 MB, no sound, no captions:

```
paste a regex → explanation appears → type a test string → matches highlight
→ switch to JSON → paste → tree appears → open history → restore
```

Shows speed and breadth without narration. **Recorded from a real build**, not mocked — a faked demo of a tool that claims honesty would be a poor start.

### 4.3 Standards

Default theme only; realistic content (never `lorem ipsum` — use a real-looking regex and a real-looking payload); no personal or sensitive data in any screenshot; consistent viewport (1440×900); dark background matching the app; PNG for stills, optimised; stored in `docs/images/`; regenerated whenever the UI changes materially.

---

## 5. Supporting documents

| File | Contents |
|---|---|
| `README.md` | As above |
| `SECURITY.md` | Reporting process, response expectations, honest scope |
| `CONTRIBUTING.md` | Setup, standards, PR process, what gets rejected |
| `CHANGELOG.md` | Keep a Changelog format, user-facing wording |
| `LICENSE` | MIT (pending Q-16) |
| `docs/` | This 24-document package |
| `.github/ISSUE_TEMPLATE/` | Bug report (browser, version, steps), feature request |

---

## 6. Tone

Matches the product: direct, technical, no marketing voice.

| ❌ Not this | ✅ This |
|---|---|
| "🚀 The ULTIMATE regex tool!" | "Regex and JSON, explained." |
| "Blazingly fast ⚡" | "<measured size>. No ads, no login." |
| "Enterprise-grade security" | "The app makes no network requests after load. Check the Network tab." |
| "100% private and secure" | "Your input stays in your browser. Here's what that does and doesn't cover." |
| "Powered by cutting-edge AI" | "Explanations come from a real parser, not a language model." |
| "Supports all regex flavours" | "Runs ECMAScript (JavaScript) regex." |

No emoji in headings. No hyperbole. No claims that are not tested.

---

## 7. What the README must NOT do

- Claim security properties not verified by a test
- Use absolute language: "impossible", "guaranteed", "completely private", "nothing can ever leave"
- Show screenshots or mock-ups of features that do not exist — including cron before V1.1
- Promise cron in the title, tagline, or feature list before it ships
- Quote a bundle size that is an estimate rather than a measurement
- Include a "Star this repo ⭐" plea
- Contain a wall of badges
- Bury the live link
- Explain the architecture before saying what the tool does
- Use "revolutionary", "game-changing", or "seamless"
- Omit the privacy caveats — they are what make the claims credible

---

## 8. Maintenance

| Trigger | Update |
|---|---|
| New feature | What it does, roadmap, screenshots |
| UI change | Screenshots and GIF |
| Dependency change | Architecture section if it is user-visible |
| Security change | Security section and `SECURITY.md` |
| Every release | Changelog and version badge |

**Rule:** if the README describes behaviour that no longer exists, that is a bug with the same priority as a code bug. A README that lies is worse than no README, and it is the first thing a new reader tests the project's honesty against.

---

## M12 — the README, as written

`README.md` now exists. It follows §2's structure and §3's content, and honours
§7's prohibitions. Three deliberate departures, all because the alternative
would have been a promise rather than a fact:

| Planned | Shipped | Why |
|---|---|---|
| A hero screenshot above the fold | Not included | Committing a binary that goes stale on every visual change, for a repository with no remote to render it, buys less than it costs. Added at M13 alongside the deployment it would depict. |
| `[**Try it →**](https://syntaxlab.app)` | A status note saying it is not deployed yet | §7 forbids showing what does not exist. There is no address behind that link. |
| CI / licence / version badges | None | There is no git remote, so a CI badge would point at nothing. The licence is linked in text. |

Everything §7 rules out is absent: no absolute security language, no cron in
the feature list, no estimated bundle figure, no badge wall, no star plea. The
numbers it quotes — 2 167 unit tests, 644 conformance cases, 674 end-to-end,
five runtime dependencies — are measured, and each was re-checked against the
build while writing it.

The ECMAScript limitation is stated in the second paragraph of **What it does**,
not in a footnote, and names the constructs that actually differ.

**Maintenance trigger added:** the status note and the missing link are M13's
first job, not something to be discovered later.
