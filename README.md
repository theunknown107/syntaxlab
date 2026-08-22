# SyntaxLab

**Understand developer syntax instantly.**

Regular expressions, JSON and cron — explained in plain English, tested live,
and processed in your browser. The app doesn't upload what you paste.

**[syntaxlab-jet.vercel.app](https://syntaxlab-jet.vercel.app)**

[Documentation](./docs) · [Changelog](./CHANGELOG.md) · [Security](./SECURITY.md) · [Licence](./LICENSE)

> **Status: v1.1.0, live.** Cron joins regex and JSON: five-field expressions,
> explained field by field, with the next ten run times and honest
> daylight-saving behaviour.

---

## What it does

**Regex.** Paste `^(?<year>\d{4})-(?<month>\d{2})$` and get back _"Matches the
start of the string, a captured group named `year` containing exactly 4 digits,
the character `-`, a captured group named `month` containing exactly 2 digits,
then the end of the string."_ Plus a token-by-token breakdown, a syntax tree, a
capture-group table, warnings about patterns that can backtrack badly, and a
live tester that shows every match with its position and groups.

**SyntaxLab runs ECMAScript (JavaScript) regular expressions.** This is stated
on the pattern pane itself, permanently, and it matters: if you arrive with a
PCRE, Python, Go or Java pattern, some of it will behave differently here and
some of it will not parse at all. Lookbehind, named groups, `\d` and `\w` under
Unicode, and possessive quantifiers are the usual places this bites.

**JSON.** Paste a payload that will not parse and get the line, column and
reason — _"trailing comma before `}`"_ — instead of a character offset. Plus a
collapsible tree, copyable JSON paths, duplicate-key detection, and a warning
when a number cannot survive a round trip through JavaScript's `number`.

**Cron.** Paste `*/15 9-17 * * 1-5` and get back what each of the five fields
selects, in words, plus **when it actually runs next** — the next occurrence and
up to ten after it, each labelled with the clock they are read in.

Three things make this more than a countdown:

- **The day-of-month / day-of-week rule.** `0 0 1 * MON` means "the 1st, **and
  also** every Monday", not "the 1st if it's a Monday". Almost everyone reads
  it the other way, so SyntaxLab warns whenever both fields are restricted and
  spells the reading out.
- **Daylight saving, reported rather than resolved.** A run the clocks jump
  over is shown as skipped, with **no time invented for it**. A run the clocks
  fall back through is shown as happening twice, with both instants and both
  offsets. Schedulers genuinely differ here; this one tells you what the clock
  does and says so.
- **Refusals that teach.** Six- and seven-field expressions, and `L`, `W`, `#`,
  `?` and `H`, are refused by name — "that's Quartz" — rather than guessed at.

**Two timezone modes only:** your browser's zone, or UTC. Named IANA zones are
not offered, because getting them right needs a test matrix this project has
not earned yet — and a timezone picker you cannot trust is worse than none.

## Why it's different

- **It explains, rather than just validating.** Most tools tell you whether
  your input is well-formed. This one tells you what it _means_.
- **Nothing you paste is uploaded.** See [Privacy](#privacy) — including the
  caveats.
- **It keeps working offline.** Install it, and it runs with no network at all.
- **It does three things properly** instead of ten approximately.

## Quick start

Open the app, pick **Regex**, **JSON** or **Cron**, paste, and press
**Analyze**. There is no sign-up, no configuration and no first-run tour.

**Nothing is analysed while you type.** Analysis happens when you ask for it,
which is what makes it unambiguous which text the panels are describing; a
badge tells you when the editor has moved on from the result on screen.

If your browser offers to install it, doing so gives you an app window and
makes it work offline. Nothing else changes.

## Privacy

Everything happens in your browser.

**What the app sends:** nothing. It fetches its own files on first load, and
after that the only network activity is the browser checking whether a new
version of those files exists. Your input is never part of any request. The
Content Security Policy sets `connect-src 'none'`, which blocks the ordinary
network APIs — `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
`sendBeacon` — and none of them appear anywhere in the source. That is a strong
control, not a mathematical proof.

**What is stored locally:**

|                  | Where         | You can                                          |
| ---------------- | ------------- | ------------------------------------------------ |
| Analysis history | IndexedDB     | pause, search, rename, pin, export, delete, wipe |
| Settings         | localStorage  | change or reset at any time                      |
| Theme            | **the URL**   | copy the address to carry the look with it       |
| The app itself   | Cache Storage | clear through your browser                       |

**The theme lives in the address bar**, not in storage — so a link carries it.
Only preferences travel that way: **nothing you type ever enters the URL**, and
neither does anything the app works out from it, including run times.

**History records regex and JSON only.** Cron analyses are not recorded — see
Roadmap.

**What the app does not do:** no accounts, no analytics, no telemetry, no error
reporting, no cookies, and no fonts, scripts or images from anyone else. The
type you are reading in the app is whatever your system already has.

**History is on by default.** You are told so on your first visit, in the app,
and you can turn it off there in one click.

**Honest caveats**, which are the part that makes the rest believable:

- Local history is stored **unencrypted**. Anyone with access to your browser
  profile can read it. Use the pause toggle for sensitive payloads.
- Browser storage is **not permanent**. Browsers evict it under disk pressure,
  and Safari clears it after a period of inactivity. Export if you need a
  backup.
- Browser extensions with page access can read anything on any page, including
  this one. No website can prevent that.
- The CSP substantially reduces the network attack surface. It is
  defence-in-depth, not a guarantee.

## Development

```bash
npm install
npm run dev          # development server
npm run build        # type-check, then production build
npm run preview      # serve the build
npm run serve:prod   # serve the build with the real production headers
```

Node 22+ and npm 10+.

`npm run preview` serves no security headers. `npm run serve:prod` serves
`dist/` with the actual `vercel.json` header rules, which is the only configuration in
which the service worker behaves the way it will in production — a worker takes
its CSP from the headers on its own script, not from the page's.

### Quality gates

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint + stylelint
npm run format:check # prettier
npm test             # vitest
npm run test:e2e     # playwright, full browser matrix
npm run size         # bundle budgets
```

### Measurement and audit scripts

These produce numbers rather than pass/fail, and are run deliberately:

|                                |                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `npm run analyze`              | bundle treemap; `node scripts/analyze-bundle.mjs` prints gzipped bytes per package |
| `npm run audit:hues`           | resolves every `var()` chain in `tokens.css` and classifies its hue                |
| `npm run audit:themes`         | reads every decorative token's _used_ value, per preset, in a real browser         |
| `npm run audit:cvd`            | samples the token palette under four simulated colour-vision deficiencies          |
| `node scripts/measure-m11.mjs` | startup, analysis, execution, JSON, history and theme latency                      |

## Architecture

Four layers, with the direction of dependency enforced by
`eslint-plugin-boundaries` rather than by convention:

```
app          shell, header, workspace
features     regex, json, history, theme, pwa
application  stores, scheduling, capture
domain       parsers, explainers, validators — no DOM, no browser APIs
infrastructure  workers, storage, browser capabilities
```

Two Web Workers, for two different reasons. The **analysis worker** is
long-lived and parses; the **execution worker** is disposable and runs the
user's pattern, because `terminate()` is the only reliable way to stop a
JavaScript regex that has begun backtracking. There is exactly one `new RegExp`
in the codebase and it is in that worker — every main-thread reference to the
module is an `import type` that TypeScript erases, so no main-thread path can
run a user pattern even by accident.

Five runtime dependencies: React, React DOM, and three CodeMirror packages.
**No date or timezone library** — the cron schedule engine does wall-clock
arithmetic on plain integers and detects daylight-saving transitions by probing
`Date`, which is exact for whole-minute schedules in every real zone.

Details, with diagrams, in [docs/02_ARCHITECTURE.md](./docs/02_ARCHITECTURE.md).

## Testing

|            |                                                                     |
| ---------- | ------------------------------------------------------------------- |
| Unit       | 2 585 tests, including 644 JSONTestSuite conformance cases          |
| End-to-end | 845 of 847 across Chromium, Firefox, WebKit and an emulated Pixel 5 |
| Known      | 2 Firefox-only failures, load-bound and root-caused — see below     |

The two are not product defects and are not hidden: on a loaded machine
Firefox occasionally fails to deliver a **worker's answer** inside a test's
timeout — never a wrong answer. Each passes in isolation, and the analysis is
written up in [docs/13_TEST_PLAN.md](./docs/13_TEST_PLAN.md).

The end-to-end suite drives the **production build under production headers**,
not a development server. Four of its specs walk complete user journeys rather
than single features, and watch for CSP violations and page errors throughout.

## Security

All user input is treated as hostile.

- **No HTML rendering path in analysis output.** Explanations are structured
  data rendered as React elements. `innerHTML`, `dangerouslySetInnerHTML`,
  `document.write` and `insertAdjacentHTML` appear nowhere in the source.
- **No `eval`, no `new Function`,** enforced by lint and by the CSP.
- **Strict CSP**, including `connect-src 'none'` on the page, verified against
  the real headers by a test rather than by reading the file.
- **Worker isolation with a hard 2-second deadline** for regex execution, and a
  worker that is destroyed and replaced when it overruns.
- **Size, depth and output limits** enforced at three layers.
- **Validation on read** for everything from storage: records are rebuilt field
  by field, never cast or spread, and anything that fails is set aside rather
  than deleted.

The app is not claimed to be "secure" in the absolute. See
[docs/05_SECURITY.md](./docs/05_SECURITY.md) for the mitigations, the residual
risks, and what is deliberately not defended against, and
[SECURITY.md](./SECURITY.md) for how to report a vulnerability.

## Browser support

Current Chromium, Firefox and Safari, on desktop and mobile. Tested on all
three engines plus an emulated Pixel 5 on every change.

Known differences, all handled rather than hidden:

- **Regex execution is engine-native.** A pattern is run by _your_ browser's
  engine, so a result is the truth about that engine. JavaScriptCore optimises
  some patterns that V8 and SpiderMonkey backtrack on, and the app reports
  whichever bounded outcome it gets.
- **Install support varies.** Chromium-based browsers offer installation
  directly. Safari installs through Share → Add to Home Screen. Firefox on
  desktop does not install web apps; everything still works in the tab.
- **Storage eviction differs**, particularly on iOS. See the caveats under
  Privacy.

## Roadmap

**Now (v1.1)** — Regex · JSON · **Cron with next-run times** · local history ·
URL-backed theming · offline PWA

**Deferred, deliberately** — cron history (the record format is not designed
yet), named IANA timezones, and a visual cron builder. Each is recorded in
[docs/22_OPEN_QUESTIONS.md](./docs/22_OPEN_QUESTIONS.md) with the reason it is
not here.

**Considering** — JSON → TypeScript · JSON → JSON Schema · shareable links ·
a ReDoS risk report · a light theme · explanations for other regex flavours

**Not planned** — accounts · cloud sync · AI-generated explanations · a backend
of any kind. Each would break something the tool is built around.

## Contributing

The architecture package in [`docs/`](./docs) is the source of truth, and
[docs/18_CODING_STANDARDS.md](./docs/18_CODING_STANDARDS.md) and
[docs/19_GIT_WORKFLOW.md](./docs/19_GIT_WORKFLOW.md) describe how changes are
expected to arrive. Every quality gate above runs in CI.

## Licence

MIT. See [LICENSE](./LICENSE).

## Acknowledgements

Built on [CodeMirror 6](https://codemirror.net/), [React](https://react.dev/)
and [Vite](https://vite.dev/). JSON conformance is checked against Nicolas
Seriot's [JSONTestSuite](https://github.com/nst/JSONTestSuite).
