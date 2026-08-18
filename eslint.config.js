import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Banned APIs. These are the security rules from 18_CODING_STANDARDS.md §6
 * expressed as lint errors, because "a rule not in the linter is a rule that
 * erodes" (§1.4). Each maps to a documented control in 05_SECURITY.md.
 */
const bannedProperties = [
  {
    property: 'innerHTML',
    message: 'S2: assigning innerHTML is an HTML injection sink. Render text instead.',
  },
  {
    property: 'outerHTML',
    message: 'S2: assigning outerHTML is an HTML injection sink. Render text instead.',
  },
  {
    property: 'insertAdjacentHTML',
    message: 'S2: insertAdjacentHTML is an HTML injection sink.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'playwright-report',
      'test-results',
      'stats.html',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: {
        // Explicit project list rather than `projectService`. The root
        // tsconfig.json is solution-style (files: [], references only), which
        // the service resolves to a default project without our type roots —
        // producing spurious "could not be resolved" errors in tests.
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
      boundaries,
    },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/*' },
        { type: 'features', pattern: 'src/features/*' },
        { type: 'components', pattern: 'src/components/*' },
        { type: 'application', pattern: 'src/application/*' },
        { type: 'domain', pattern: 'src/domain/*' },
        { type: 'infrastructure', pattern: 'src/infrastructure/*' },
        { type: 'workers', pattern: 'src/workers/*' },
        { type: 'styles', pattern: 'src/styles/*' },
      ],
      'boundaries/include': ['src/**/*'],
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /* ---- Security: banned APIs (18_CODING_STANDARDS.md §6) ---- */
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-restricted-properties': ['error', ...bannedProperties],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            'S2: dangerouslySetInnerHTML is banned. Explanations render as ExplanationNode[] text (ADR-011). Any exception needs a written justification and a recorded security review.',
        },
        {
          selector: 'MemberExpression[object.name="document"][property.name="write"]',
          message: 'S2: document.write is an HTML injection sink.',
        },
      ],
      'no-console': 'error',
      'no-debugger': 'error',
      'no-alert': 'error',

      /* ---- TypeScript discipline (18_CODING_STANDARDS.md §2.2) ---- */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        // A `default` branch is exhaustive handling. Requiring every member to
        // be listed as well produces dead cases in dispatchers that
        // legitimately treat "everything else" uniformly.
        { considerDefaultExhaustiveForUnions: true, allowDefaultCaseForExhaustiveSwitch: true },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      /* ---- Complexity (18_CODING_STANDARDS.md §4) ---- */
      complexity: ['warn', 10],
      'max-depth': ['warn', 3],
      'max-params': ['warn', 4],

      /* ---- Layer boundaries (02_ARCHITECTURE.md §3) ----
         This is what makes the architecture enforceable rather than a drawing.
         Uses the v7 `policies` API with entity selectors. */
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            // Domain is the innermost layer: it may import only itself. It must
            // run in a Worker and under Node, so it cannot reach outward.
            {
              from: [{ element: { type: 'domain' } }],
              allow: [{ to: { element: { type: 'domain' } } }],
            },
            // Application orchestrates domain + infrastructure interfaces.
            {
              from: [{ element: { type: 'application' } }],
              allow: [
                { to: { element: { type: 'application' } } },
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'infrastructure' } } },
              ],
            },
            // Infrastructure adapts browser APIs to domain types.
            {
              from: [{ element: { type: 'infrastructure' } }],
              allow: [
                { to: { element: { type: 'infrastructure' } } },
                { to: { element: { type: 'domain' } } },
              ],
            },
            // Presentation consumes the application layer and shared components.
            {
              from: [{ element: { type: 'features' } }],
              allow: [
                { to: { element: { type: 'features' } } },
                { to: { element: { type: 'components' } } },
                { to: { element: { type: 'application' } } },
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'styles' } } },
              ],
            },
            {
              from: [{ element: { type: 'components' } }],
              allow: [
                { to: { element: { type: 'components' } } },
                { to: { element: { type: 'application' } } },
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'styles' } } },
              ],
            },
            {
              from: [{ element: { type: 'app' } }],
              allow: [
                { to: { element: { type: 'app' } } },
                { to: { element: { type: 'features' } } },
                { to: { element: { type: 'components' } } },
                { to: { element: { type: 'application' } } },
                { to: { element: { type: 'infrastructure' } } },
                { to: { element: { type: 'styles' } } },
              ],
            },
            // Worker entry points are thin dispatchers over the domain.
            {
              from: [{ element: { type: 'workers' } }],
              allow: [
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'infrastructure' } } },
              ],
            },
            {
              from: [{ element: { type: 'styles' } }],
              allow: [{ to: { element: { type: 'styles' } } }],
            },
          ],
        },
      ],
    },
  },

  /* The application and domain layers stay framework-free so they are testable
     under Node and usable from non-React code (02_ARCHITECTURE.md §3). */
  {
    files: ['src/application/**/*.ts', 'src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'The application and domain layers must not import React.' },
            {
              name: 'react-dom',
              message: 'The application and domain layers must not import React DOM.',
            },
          ],
        },
      ],
    },
  },

  /* The domain layer must not touch browser globals: it runs in a Worker
     (no document, no window) and under Node during tests. */
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'Domain code runs in a Worker and under Node — no browser globals.',
        },
        {
          name: 'document',
          message: 'Domain code runs in a Worker and under Node — no browser globals.',
        },
        {
          name: 'localStorage',
          message: 'Domain code must not touch storage. Use the repository interface.',
        },
        {
          name: 'indexedDB',
          message: 'Domain code must not touch storage. Use the repository interface.',
        },
        {
          name: 'fetch',
          message: 'The application makes no network requests (CSP connect-src none).',
        },
      ],
    },
  },

  /* The theme bootstrap is plain browser JS served as a static asset, so it is
     outside the TypeScript program. It is still linted — it validates
     untrusted stored values before they reach CSS — but without type-aware
     rules, which need a program. */
  {
    files: ['public/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.browser,
      parserOptions: { project: null, projectService: false },
    },
  },

  /* Parsing code is a dispatch over a large grammar union. Cyclomatic
     complexity measures branch count, which for a `switch` over token kinds
     rises with the size of the grammar rather than with the difficulty of the
     code. The limits stay in force everywhere else
     (18_CODING_STANDARDS.md §4 calls them guidelines, not laws). */
  {
    files: ['src/domain/regex/**/*.ts'],
    rules: { complexity: 'off', 'max-depth': ['warn', 4] },
  },

  /* Config files and scripts run under Node. */
  {
    files: ['*.config.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off', 'boundaries/dependencies': 'off' },
  },

  /* Tests may use console for diagnostics and are not layer-bound. */
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-console': 'off',
      'boundaries/dependencies': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  /* The ESLint config describes the type-aware setup, so it cannot sit inside
     the program it configures. Linted with syntax and correctness rules only. */
  {
    files: ['eslint.config.js', 'scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: null, projectService: false },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // Build scripts report to the terminal; that is their entire job.
      'no-console': 'off',
      'no-undef': 'off',
      complexity: 'off',
    },
  },
);
