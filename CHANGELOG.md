# Changelog

All notable changes to SyntaxLab are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
as described in [docs/19_GIT_WORKFLOW.md](./docs/19_GIT_WORKFLOW.md).

## [1.1.0] — 2026-08-22

Cron. One dialect, done properly.

### Added

- **Cron workspace** — standard five-field expressions, explained field by
  field in plain English, alongside Regex and JSON as a third mode.
- **Next-run calculation** — when an expression runs next, plus up to ten
  upcoming occurrences, each labelled with the clock it is read in.
- **Two timezone modes** — the browser's own zone, or UTC. The resolved zone
  name is always shown, so a time never appears without the clock it belongs
  to.
- **Daylight-saving handling** — a run the clocks jump over is reported as
  skipped, with no time invented for it; a run the clocks fall back through is
  reported as happening twice, with both instants and both offsets. Schedulers
  genuinely differ here, so SyntaxLab reports what the clock does rather than
  picking a behaviour on your behalf.
- **A bounded search** — five years, with a step tripwire beneath it. An
  expression that can never run, such as `0 0 30 2 *`, says so instead of
  spinning.
- **Educational refusals** — six- and seven-field expressions, and `L`, `W`,
  `#`, `?` and `H`, are refused with the name of the scheduler they belong to
  rather than being guessed at.
- **URL-backed theme preferences** — a theme now travels in the address bar, so
  a link carries the look with it. Nothing you type ever enters the URL.
- **Explicit Analyze** — typing no longer analyses. Every mode holds a draft
  and a committed input, and a visible badge says when the two differ.

### Changed

- Analysis in every mode is now submitted rather than debounced, which makes
  what the panels describe unambiguous.
- Theme preferences moved from `localStorage` to the URL. The old key is read
  once, migrated, and removed.

### Fixed

- Cron macros (`@weekly` and the rest) failed worker-result validation, which
  surfaced as "something went wrong in the analysis engine". Their fields are
  now anchored to the macro rather than to its expansion.
- A step on a bare value (`5/10`) resolved to a set no scheduler produces.
- The daylight-saving warning claimed that zones without transitions observe
  them.
- Focus was lost when Analyze became unavailable after a successful analysis.

### Security

- The schedule operation validates its request and rebuilds its result field by
  field at the worker boundary, and refuses a start instant outside the range a
  clock can represent — which could otherwise produce a run that does not
  exist.

### Not in this release

Cron history, named IANA timezones, a Cron builder, six- or seven-field cron,
seconds or year fields, and anything requiring a server. Each is recorded in
[docs/22_OPEN_QUESTIONS.md](./docs/22_OPEN_QUESTIONS.md) with the reason.

## [1.0.0] — 2026-08-20

Initial public release: Regex and JSON.

Released and deployed, but never tagged — this entry records it for
completeness, and `1.1.0` is the first tagged release.

### Added

- **Regex** — plain-English explanation, token breakdown, syntax tree, capture
  group table, backtracking warnings, and a live tester that runs the pattern
  in a disposable worker with a two-second deadline.
- **JSON** — parse errors with a line, column and reason, a collapsible tree,
  copyable paths, duplicate-key detection, and unsafe-number warnings.
- **Local history** — searchable, pinnable, renameable, exportable, and
  pausable, in IndexedDB, on by default and disclosed on first visit.
- **Theming** — presets and a customisable palette, with contrast and
  colour-vision audits.
- **Offline PWA** — installable, and fully functional with no network.
- **Accessibility** — keyboard operation throughout, forced-colors support,
  reduced-motion support, and an axe pass on every surface.

[1.1.0]: https://github.com/theunknown107/syntaxlab/releases/tag/v1.1.0
[1.0.0]: https://github.com/theunknown107/syntaxlab
