# 19 — Git Workflow

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

> Calibrated for a solo developer or a very small team. Ceremony that exists to look professional is removed; ceremony that catches real problems is kept. If the team grows past three people, revisit §2.

---

## 1. Branching

**Trunk-based with short-lived feature branches.** No `develop`, no `release/*`, no GitFlow.

```
main ────●────●────●────●────●────●──▶  always deployable, protected
          ╲        ╱      ╲    ╱
           ●──●──●          ●──●
        feat/regex-parser  fix/json-column
```

GitFlow exists to coordinate parallel releases across teams. There is one deploy target, one environment, and continuous deployment. Adding release branches here would be pure overhead.

### Branch naming

| Prefix | Use |
|---|---|
| `feat/` | New functionality |
| `fix/` | Bug fix |
| `refactor/` | No behaviour change |
| `perf/` | Performance |
| `docs/` | Documentation only |
| `test/` | Tests only |
| `chore/` | Tooling, dependencies |
| `security/` | Security fix |

`feat/regex-tokenizer`, `fix/json-column-off-by-one`. Lowercase, hyphenated, descriptive.

### Rules

- Branch from `main`, always
- Keep branches under ~3 days; longer means the work needed splitting
- Rebase onto `main` before opening a PR
- Delete the branch after merge

---

## 2. Commits

Conventional Commits.

```
<type>(<scope>): <subject>

<body — why, not what>

<footer — Closes #12 / BREAKING CHANGE:>
```

**Types:** `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `security`
**Scopes:** `regex` `json` `cron` `history` `theme` `pwa` `storage` `worker` `ui` `a11y` `security` `deps` `docs`

```
feat(cron): add DST anomaly detection for next-run times

Schedules crossing a DST boundary previously showed a time that either
never occurs (spring forward) or occurs twice (fall back), with no
indication. Both are now detected and labelled.

Closes #47
```

### Rules

- Imperative mood ("add", not "added")
- Lowercase subject, no trailing period, ≤ 72 characters
- One logical change per commit
- Never commit broken code to `main`
- Body explains *why* — the diff already shows what
- `BREAKING CHANGE:` for storage/export/share format changes

### Never committed

`.env` files, secrets or tokens of any kind, `node_modules/`, `dist/`, build artefacts, IDE settings beyond a shared `.vscode/extensions.json`, OS files, coverage reports, Playwright reports, or large binaries.

`.gitignore` covers these; a pre-commit hook additionally scans staged content for high-entropy strings and common key patterns. It is a cheap safety net, not a guarantee.

---

## 3. Pull requests

Even solo. The PR is where CI runs and where the diff gets read as a whole rather than as it was written.

### Template

```markdown
## What
One-paragraph summary.

## Why
The problem this solves.

## How
Notable implementation decisions and anything non-obvious.

## Testing
How this was verified. Include new test names.

## Checklist
- [ ] Typecheck, lint, tests pass locally
- [ ] New logic has tests
- [ ] No new dependency, or one justified in 16_DEPENDENCIES.md
- [ ] Security rules (18_CODING_STANDARDS.md §6) followed
- [ ] Accessibility considered
- [ ] Bundle budget still met
- [ ] Relevant docs/ updated

## Screenshots
For UI changes: before/after, default theme.
```

### Size

| Size | Review effort | Verdict |
|---|---|---|
| < 200 lines | 10 min | ✅ Ideal |
| 200–500 | 30 min | ✅ Acceptable |
| 500–1000 | 1 hr+ | ⚠️ Should have been split |
| > 1000 | Poor | ❌ Split it |

Exception: a single vertical slice that genuinely cannot be split (the regex parser landing with its tests). Say so in the PR description.

---

## 4. Review checklist

Full checklist in `18_CODING_STANDARDS.md` §13. Areas that get extra scrutiny in this codebase:

| Change touches | Extra attention |
|---|---|
| A parser | Termination proof, fuzz coverage, differential test, span correctness |
| Storage | Migration path, validation on read, quota handling, forward compatibility |
| Rendering user content | The no-HTML rule, re-read line by line |
| Workers | Message validation both directions, timeout behaviour, termination |
| Dependencies | The full §1 admission check in `16_DEPENDENCIES.md`, plus the lockfile diff |
| CSP or headers | Manual verification on a preview deployment |
| Theme | Value validation before `setProperty`, contrast check |

**Solo-developer discipline:** open the PR, leave it, review it the next morning with fresh eyes. Self-review after a break catches a genuinely surprising proportion of mistakes — and it is the only review available.

---

## 5. Merging

**Squash merge** into `main`. Feature branches accumulate "wip", "fix typo", "actually fix it"; `main` should read as a clean sequence of logical changes.

Requirements: all CI green, self-review complete, no unresolved comments, branch rebased. Merge-commit and rebase merge are disabled to keep one strategy.

### Branch protection on `main`

- Require a PR
- Require all status checks
- Require the branch to be up to date
- No force push
- No deletion
- Include administrators (the rule is worthless if the only developer can bypass it)

---

## 6. Releases

```
1. Ensure main is green and verified on a preview deploy
2. Update CHANGELOG.md (Keep a Changelog format)
3. Bump the version in package.json
4. Commit: chore(release): v1.2.0
5. Tag: git tag -a v1.2.0 -m "Release v1.2.0"
6. Push with --follow-tags
7. Create a GitHub release with the changelog section
8. Cloudflare deploys main
9. Run the post-deploy checklist (17_DEPLOYMENT.md §8)
```

### Versioning

| Bump | Trigger |
|---|---|
| MAJOR | Breaking storage / export / share-URL format change |
| MINOR | New feature |
| PATCH | Fix or internal change |

Pre-1.0: `0.x.y`, where `x` is a milestone from `20_IMPLEMENTATION_PLAN.md`. `1.0.0` when all V1 acceptance criteria in `21_ACCEPTANCE_CRITERIA.md` pass.

### Changelog

```markdown
## [1.2.0] - 2026-09-15

### Added
- Cron DST anomaly detection

### Fixed
- JSON column numbers with tab indentation

### Security
- Tightened share-URL size validation before decode
```

Written for users, not from commit messages. "Fixed JSON column numbers with tab indentation" is useful; "fix(json): off-by-one in scanner" is not.

---

## 7. Hotfixes

```
1. Branch from main: fix/critical-<thing>
2. Minimal fix + regression test
3. PR with [HOTFIX] in the title
4. Full CI (never skipped — a hotfix that breaks something else is not a fix)
5. Merge, tag a patch release, deploy
6. Verify in production
7. If the fix does not hold: roll back per 17_DEPLOYMENT.md §9
```

Rollback is preferred over a rushed forward-fix when the failure is user-visible. Rolling back takes one minute; a bad forward-fix takes an hour and a second incident.

---

## 8. Repository hygiene

```
.github/
  workflows/ci.yml
  PULL_REQUEST_TEMPLATE.md
  ISSUE_TEMPLATE/{bug_report.md,feature_request.md}
  dependabot.yml
docs/                      ← this documentation package
src/  tests/  public/
.gitignore  .nvmrc  .editorconfig
CHANGELOG.md  LICENSE  README.md  SECURITY.md
package.json  package-lock.json
```

`SECURITY.md` states how to report a vulnerability, expected response time, and the honest scope of what this project can promise — which, for a static client-side app with no user accounts, is "we will fix it and ship, quickly" rather than a formal SLA.

### Issue labels

`bug` `feature` `security` `performance` `accessibility` `docs` `parser` `good-first-issue` `wontfix` `needs-info`

Security issues reported privately (per `SECURITY.md`) are handled in a private fork and disclosed after the fix is deployed.
