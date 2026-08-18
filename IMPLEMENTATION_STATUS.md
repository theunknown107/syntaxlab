# Implementation Status

**Project:** SyntaxLab
**Phase:** 2 — implementation
**Current milestone:** M0 complete → M1 next
**Last updated:** 2026-08-18

> Living document. Updated at the end of every milestone. The architecture
> package in [`docs/`](docs/) remains the source of truth; this file records
> what has actually been built and what was decided along the way.

---

## Release scope (locked, `docs/22_OPEN_QUESTIONS.md` D-01)

| Release | Scope | Status |
|---|---|---|
| **V1.0** | Regex · JSON · history · theme · PWA · a11y · security · tests · perf | **In progress** |
| V1.1 | Cron — standard 5-field only | Not started, **must not enter V1.0** |
| V1.2+ | Share URLs, JSONC/JSON5, other flavours | Deferred, unscheduled |

---

## Milestone progress

| # | Milestone | Status |
|---|---|---|
| M0 | Bootstrap planning | ✅ **Complete** |
| M1 | Tooling, design tokens, shell | ⬜ Next |
| M2 | Worker infrastructure | ⬜ |
| M3 | Regex domain | ⬜ |
| M4 | Regex UI | ⬜ |
| M5 | JSON domain | ⬜ |
| M6 | JSON UI | ⬜ |
| M7 | History and storage | ⬜ |
| M8 | Theme customisation | ⬜ |
| M9 | PWA and offline | ⬜ |
| M10 | Accessibility and security hardening | ⬜ |
| M11 | Performance measurement | ⬜ |
| M12 | Integration, E2E, release QA | ⬜ |
| M13 | V1.0 release | ⬜ |

---

## M0 — decisions

Recorded in full as **D-07** in [`docs/22_OPEN_QUESTIONS.md`](docs/22_OPEN_QUESTIONS.md) §1.

| Item | Decision |
|---|---|
| Product name | **SyntaxLab**. V1.0 metadata reads *"SyntaxLab — Regex & JSON Explainer"*. |
| Domain | **`syntaxlab.app` is a PLACEHOLDER — not registered, not purchased.** Illustrative only. |
| Repository visibility | **Public** (confirmed by maintainer) |
| Licence | **MIT** (confirmed by maintainer) |
| Copyright holder | `SyntaxLab contributors` — placeholder; no real name supplied |
| Node | **22 LTS**, pinned in `.nvmrc` |
| npm | 10+ |
| Git remote | **None yet** — see Deferred below |

### Node 20 → 22 (documentation change)

The approved docs specified Node 20 LTS. **Node 20 reached end-of-life in April
2026**, so pinning to it would mean building on a runtime that no longer
receives security patches. Pinned to Node 22 LTS instead (also the installed
version, v22.22.0).

Handled per the Phase 2 protocol: stopped, explained, updated
`17_DEPLOYMENT.md` §3.1 and `24_README_PLAN.md`, recorded as D-07, then
continued. No Mermaid diagram referenced a Node version, so none changed.

---

## Deferred, with reasons

| Item | Why | When |
|---|---|---|
| **Git remote + branch protection** | `docs/19_GIT_WORKFLOW.md` §5 branch protection requires a hosted remote. Creating one needs account access — a human action. The repository is initialised **locally** with the documented commit conventions, so no history is lost. | Whenever the remote is created; at the latest M12, since CI must be green before release |
| **CI pipeline execution** | GitHub Actions needs the remote. The workflow file is authored at M1 and will run on first push. | With the remote |
| **Domain registration** | Nobody has purchased one. Treated as a placeholder throughout. | M13 |
| **Real copyright holder** | No name supplied; inventing one would be wrong. | Before first public release |

**None of these block M1.** Local development, testing, and building need no remote.

---

## Files created at M0

```
.editorconfig      LF, 2-space, 100 cols
.gitattributes     LF normalisation (Windows checkout → Linux CI)
.gitignore         node_modules, dist, coverage, reports, .env
.nvmrc             22
LICENSE            MIT
SECURITY.md        Reporting policy, scope, and what we do not claim
IMPLEMENTATION_STATUS.md
```

No source code, no `package.json`, and no dependencies yet — those are M1.

---

## Standing constraints

Carried from the approved package. Violating any of these is a defect, not a shortcut.

- **No cron code during V1.0.** Not even a placeholder file.
- **No share-URL code during V1.0.**
- **No `eval`, `new Function`, or `dangerouslySetInnerHTML`.** Lint-enforced from M1.
- **No dependency outside `docs/16_DEPENDENCIES.md` §1.1** without the admission review.
- **No weakening the CSP to make something work** — escalate instead.
- **No absolute security claims** in code, copy, or docs.
- **Regex execution never on the main thread.** If workers are unavailable the
  tester is disabled, not relocated.
- **Estimates are never evidence.** Bundle sizes come from measured production
  builds, recorded in `docs/12_PERFORMANCE.md` §10.

---

## Verification log

| Milestone | Typecheck | Lint | Tests | Build | Notes |
|---|---|---|---|---|---|
| M0 | n/a | n/a | n/a | n/a | No code yet. Toolchain verified: Node v22.22.0, npm 10.9.4, git 2.51.1. |
