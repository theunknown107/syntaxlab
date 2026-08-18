# 18 — Coding Standards

**Project:** SyntaxLab
**Status:** Draft for human review
**Last updated:** 2026-08-17

---

## 1. Principles

1. **Boring over clever.** Clever code is what someone decodes at 3 a.m.
2. **Explicit over implicit.** Especially at trust boundaries.
3. **Delete over add.** The smallest change that works is usually right.
4. **Enforced over agreed.** A rule not in the linter is a rule that erodes.
5. **Types as documentation.** If the type says it, the comment does not need to.

---

## 2. TypeScript

### 2.1 Compiler configuration

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,      // arr[0] is T | undefined — it genuinely is
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "target": "ES2022",
    "moduleResolution": "bundler"
  }
}
```

`noUncheckedIndexedAccess` is the one that will cause the most friction and is the most valuable — index access on parser token arrays is exactly where undefined sneaks in.

### 2.2 Rules

| Rule | Detail |
|---|---|
| **No `any`** | Banned in `domain/` and `application/`. Elsewhere requires an inline justification comment. Use `unknown` and narrow. |
| **No non-null assertion (`!`)** | Narrow properly or handle the null case. A `!` is a claim the compiler cannot check. |
| **No type assertions on untrusted data** | `as HistoryEntry` on a storage record is a lie. Validate and construct. |
| **Discriminated unions over optional soup** | `{kind:'ok', value} \| {kind:'err', error}` beats `{value?, error?}` |
| **`readonly` by default** on domain types | Mutation is opt-in |
| **`satisfies` over `as`** for config literals | Keeps inference, adds checking |
| **Exhaustive switches** | Every union switch ends with a `never` check |

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
```

The exhaustiveness check on `explainNode` is load-bearing: adding an AST node type causes a compile error until it is explained. That is a feature, not friction.

---

## 3. Naming

| Kind | Convention | Example |
|---|---|---|
| Files (components) | PascalCase | `RegexAnalysis.tsx` |
| Files (other) | camelCase | `historyRepository.ts` |
| Directories | kebab-case | `src/domain/regex/` |
| Types/interfaces | PascalCase, no `I` prefix | `HistoryEntry` |
| Functions/variables | camelCase | `parseRegex` |
| Constants | SCREAMING_SNAKE | `LIMITS`, `DB_VERSION` |
| Booleans | `is/has/can/should` | `isValid`, `hasErrors` |
| Event handlers | `handleX` (impl) / `onX` (prop) | `handleClick` / `onClick` |
| Hooks | `useX` | `useRegexAnalysis` |
| CSS custom properties | `--kebab-case` | `--color-accent` |
| Test files | `<subject>.test.ts` / `.spec.ts` for E2E | |

Prefer full words. `parseRegularExpression` is not better than `parseRegex`, but `cfg`, `tmp`, `data`, `obj`, and `res` are all worse than the real noun.

---

## 4. File structure

Consistent order within a file:

```ts
// 1. Imports: node → external → internal (@/) → relative → types → styles
// 2. Types and interfaces
// 3. Constants
// 4. The main export
// 5. Helpers (below their first use — read top-down)
```

Guidelines, not laws: soft limits of ~200 lines per component, ~300 per module, ~50 per function, complexity ≤ 10, ≤ 4 parameters (use an options object beyond that), nesting ≤ 3 levels (extract or use early returns).

One exported component per file. Small tightly-coupled subcomponents may share a file when they are not used elsewhere.

---

## 5. React

### 5.1 Rules

```tsx
// ✅ Function components, typed props, named export
interface Props { value: string; onChange: (v: string) => void }
export function ThingEditor({ value, onChange }: Props) { … }
```

- No class components (except error boundaries, which require them)
- No `React.FC` — it adds implicit children and no value
- Props destructured in the signature
- Early return for loading/error/empty states
- Never `useEffect` for derived state — compute it during render
- `useEffect` always returns a cleanup where it registers anything
- Dependency arrays complete; never suppress the lint rule without a written reason
- Keys are stable ids, never indices
- `useCallback`/`useMemo` only when passing to a memoised child or when the computation is measurably expensive

### 5.2 Banned patterns

```tsx
dangerouslySetInnerHTML={{ __html: x }}   // ❌ hard-banned by lint
element.innerHTML = x                      // ❌
useEffect(() => setB(deriveFrom(a)), [a])  // ❌ derive in render
<div onClick={…}>                          // ❌ use <button>
key={index}                                // ❌
style={{ color: '#00ff88' }}               // ❌ use tokens
```

---

## 6. Security rules

Non-negotiable. Each maps to a lint rule and to a test.

| # | Rule |
|---|---|
| S1 | Never `eval`, `new Function`, or string-argument `setTimeout`/`setInterval` |
| S2 | Never `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write`. **No exception is approved in V1.0**; any future use requires written justification and a recorded security review (`05_SECURITY.md` §2.3). |
| S3 | Validate all external data at the boundary: storage, URL, files, worker messages |
| S4 | Never spread untrusted objects — reconstruct field by field |
| S5 | Never build JS objects from user keys without `Object.create(null)` and dangerous-key rejection |
| S6 | Enforce size limits at all three layers |
| S7 | Never log user content in production |
| S8 | Never put user content in a URL at all in V1.0. *(If share URLs ship in V1.1+: fragment only, never the query string.)* |
| S9 | Clipboard writes are `text/plain` only |
| S10 | Never set a CSS custom property from an unvalidated value |
| S11 | Every worker message is shape-validated on receipt, in both directions |
| S12 | No new dependency without the admission review in `16_DEPENDENCIES.md` §1.2, and none outside the classified list in §1.1 |
| S13 | **No absolute security claims in code comments, UI copy, or documentation** — describe what a control does, not what it makes impossible (`05_SECURITY.md` §17) |

```ts
// ❌
const settings = { ...defaults, ...JSON.parse(stored) };

// ✅
const parsed = safeParse(stored);
const settings = {
  historyEnabled: typeof parsed?.historyEnabled === 'boolean' ? parsed.historyEnabled : defaults.historyEnabled,
  defaultMode:    isMode(parsed?.defaultMode) ? parsed.defaultMode : defaults.defaultMode,
  // … every field, explicitly
};
```

The verbose version is the correct version. Brevity at a trust boundary is how prototype pollution gets in.

---

## 7. Error handling

### 7.1 Layer policy

| Layer | Policy |
|---|---|
| Domain | Return `Result<T, DomainError>`. **Never throw for expected failures** — invalid input is the norm, not an exception. |
| Application | Propagate `Result`; translate storage errors into user-facing messages |
| Infrastructure | Catch platform exceptions; convert to typed errors |
| Presentation | Render error states; error boundaries catch the unexpected |

### 7.2 Rules

```ts
// ❌ swallowing
try { risky(); } catch {}

// ❌ leaking internals
catch (e) { setError(String(e)); }

// ✅
const result = await repository.save(entry);
if (!result.ok) {
  logDev('history save failed', result.error);          // dev only
  ui.toast(userMessageFor(result.error.code));          // stable, safe message
  return;
}
```

- Every error has a stable code
- User messages say what failed, where, and what to do next
- Never expose stack traces, internal identifiers, or user content in production errors
- Never catch without either handling or rethrowing
- `console.log` is banned in committed code; use the `logDev` helper, which compiles out in production

---

## 8. CSS

```css
/* ✅ tokens only */
.panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}

/* ❌ literals */
.panel { background: #101613; padding: 16px; }
```

- CSS Modules, one file per component
- BEM-ish local naming; no global selectors outside `global.css`
- No `!important` except in the reduced-motion override, where it is correct
- No IDs as selectors
- Max nesting depth 2
- Logical properties (`padding-inline`, `margin-block`) where they apply
- Every interactive element has `:focus-visible` styling
- Stylelint enforces the no-literal-values rule

---

## 9. Comments

**Comment why, never what.**

```ts
// ❌
// increment the counter
count++;

// ✅
// Zero-length matches don't advance lastIndex, so /(?:)/g would loop forever.
if (match[0] === '') re.lastIndex++;
```

Required comments:
- Non-obvious algorithms (offset probing for timezone conversion)
- Security-relevant decisions (`// array, not object: prevents __proto__ pollution`)
- Spec references (`// per ECMAScript Annex B 21.2.1`)
- Deliberate deviations from the obvious approach
- `ponytail:` markers for accepted shortcuts, naming the ceiling and the upgrade path

JSDoc on: every exported domain function, every public repository method, and every non-obvious type.

Banned: commented-out code (git remembers), `// TODO` without an issue link, changelog comments, decorative separators.

---

## 10. Testing conventions

```ts
describe('parseRegex', () => {
  describe('quantifiers', () => {
    it('parses a bounded quantifier with min and max', () => {
      const result = parseRegex('a{2,4}');
      expect(result.ok).toBe(true);
      expect(getFirstQuantifier(result)).toMatchObject({ min: 2, max: 4, lazy: false });
    });

    it('rejects an inverted range', () => {
      expect(parseRegex('a{4,2}')).toMatchObject({ ok: false, error: { code: 'SYNTAX' } });
    });
  });
});
```

- Test names state behaviour, not implementation
- Arrange/Act/Assert, visually separated
- One logical assertion per test
- No shared mutable state between tests
- Query by role and accessible name, never by test id or class
- Fixtures in `tests/fixtures/`, never inline for anything over ~5 lines
- Every bug fix adds a regression test

---

## 11. Git

Conventional Commits; details in `19_GIT_WORKFLOW.md`.

```
feat(regex): add named capture group support
fix(json): correct column number for tab-indented lines
docs(security): document CSP style-src concession
```

Rules: imperative mood, lowercase subject, no trailing period, ≤ 72 characters, body explains *why*.

---

## 12. Enforcement

| Tool | Enforces |
|---|---|
| `tsc --noEmit` | Types |
| ESLint | Code rules, hooks, a11y, security bans, layer boundaries |
| Stylelint | CSS token discipline |
| Prettier | Formatting — no discussion, no bikeshedding |
| Vitest | Behaviour + coverage gate |
| Playwright + axe | Journeys + accessibility |
| CI | All of the above, blocking merge |

Key ESLint configuration:

```js
{
  rules: {
    'react/no-danger': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-restricted-properties': ['error',
      { object: 'window', property: 'eval' },
      { property: 'innerHTML' },
      { property: 'outerHTML' },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    'no-console': ['error', { allow: [] }],
  },
  settings: {
    'boundaries/elements': [
      { type: 'domain',         pattern: 'src/domain/*' },
      { type: 'application',    pattern: 'src/application/*' },
      { type: 'infrastructure', pattern: 'src/infrastructure/*' },
      { type: 'features',       pattern: 'src/features/*' },
      { type: 'components',     pattern: 'src/components/*' },
    ],
    // domain may import only domain; application may not import react; etc.
  },
}
```

The `boundaries` configuration is what makes the architecture in `02_ARCHITECTURE.md` §3 real rather than aspirational. An architecture diagram that the linter does not know about is a drawing.

---

## 13. Code review checklist

```
Correctness
[ ] Does what the PR says
[ ] Edge cases: empty, huge, malformed, unicode
[ ] Errors handled, not swallowed

Security
[ ] No banned APIs
[ ] Untrusted input validated at the boundary
[ ] Limits enforced
[ ] No user content in logs or URLs

Architecture
[ ] Layer boundaries respected
[ ] Domain stays framework-free
[ ] No speculative abstraction

Performance
[ ] No new blocking work
[ ] Expensive work in a worker
[ ] Bundle budget still met

Accessibility
[ ] Keyboard reachable, focus visible
[ ] Labels and roles correct
[ ] Status not conveyed by colour alone

Tests
[ ] New logic has tests
[ ] Bug fixes have regression tests
[ ] Tests would fail without the change

Docs
[ ] Relevant doc in docs/ updated
[ ] Comments explain why
```
