import { defineConfig, devices } from '@playwright/test';

/**
 * Two server targets, deliberately:
 *
 *   shell.spec   → the PRODUCTION build (:4173). The CSP, minification, and
 *                  chunking we assert on only exist there.
 *   workers.spec → the DEV server (:5174). Driving real workers needs the
 *                  development-only harness, which is compiled out of
 *                  production. `shell.spec` asserts that removal.
 *
 * regex.spec  → the PRODUCTION build (:4173), on all three engines. The regex
 *                feature needs no development harness — it drives real workers
 *                through the real UI — so it runs against the build that
 *                actually ships, CSP included.
 *
 * Worker specs run on all three engines: M2's risk checkpoint (R-10) is that
 * `terminate()` reliably stops a runaway thread, and that is an engine-level
 * behaviour that cannot be assumed from one browser.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Spread rather than `: undefined` — `exactOptionalPropertyTypes` treats a
  // key holding undefined as different from an absent one, and absent is what
  // gets Playwright's own default.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { trace: 'on-first-retry' },

  projects: [
    {
      name: 'shell-chromium',
      testMatch: /shell\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
    {
      /*
       * M12 release QA — the complete user journeys, against the production
       * build under the *production* `_headers` on :4183. A release gate that
       * validates a policy the app does not ship with is not a release gate.
       */
      name: 'release-chromium',
      testMatch: /release-qa\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4183' },
    },
    {
      /* Deployment-shaped gates: served headers, installability, storage at
         the documented limit. One engine — these are properties of the
         artefact, not of a rendering engine. */
      name: 'gates-chromium',
      testMatch: /release-gates\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4183' },
    },
    {
      name: 'release-firefox',
      testMatch: /release-qa\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:4183' },
    },
    {
      name: 'release-webkit',
      testMatch: /release-qa\.spec\.ts/,
      use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:4183' },
    },
    {
      name: 'release-mobile',
      testMatch: /release-qa\.spec\.ts/,
      use: { ...devices['Pixel 5'], baseURL: 'http://localhost:4183' },
    },
    {
      // The editor keymap is rebuilt locally rather than imported; these pin
      // the bindings that change would be most likely to break silently.
      name: 'editor-chromium',
      testMatch: /editor-keys\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'editor-firefox',
      testMatch: /editor-keys\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'splitter-chromium',
      testMatch: /splitter\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'splitter-firefox',
      testMatch: /splitter\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'json-chromium',
      testMatch: /json\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'json-firefox',
      testMatch: /json\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'json-webkit',
      testMatch: /json\.spec\.ts/,
      use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'json-mobile',
      testMatch: /json\.spec\.ts/,
      use: { ...devices['Pixel 5'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'regex-chromium',
      testMatch: /regex\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'regex-firefox',
      testMatch: /regex\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'regex-webkit',
      testMatch: /regex\.spec\.ts/,
      use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'regex-mobile',
      testMatch: /regex\.spec\.ts/,
      use: { ...devices['Pixel 5'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'history-chromium',
      testMatch: /history\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'history-firefox',
      testMatch: /history\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'history-webkit',
      testMatch: /history\.spec\.ts/,
      use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'theme-chromium',
      testMatch: /theme\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'theme-firefox',
      testMatch: /theme\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'theme-webkit',
      testMatch: /theme\.spec\.ts/,
      use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:4173' },
    },
    {
      // The accessibility tree is a Chromium/CDP capability, so this project
      // is Chromium-only by construction rather than by choice.
      name: 'a11y-chromium',
      testMatch: /a11y-tree\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'hardening-chromium',
      testMatch: /hardening\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'hardening-firefox',
      testMatch: /hardening\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'hardening-mobile',
      testMatch: /hardening\.spec\.ts/,
      use: { ...devices['Pixel 5'], baseURL: 'http://localhost:4173' },
    },
    {
      /*
       * Offline runs against port 4183, which serves dist/ with the *real*
       * production headers. `vite preview` sends none, and a service worker
       * takes its CSP from the headers on its own script — so a policy that
       * breaks the worker would pass every other suite and fail only in
       * production. Measured: it did.
       */
      name: 'offline-chromium',
      testMatch: /offline\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4183' },
    },
    {
      name: 'offline-firefox',
      testMatch: /offline\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:4183' },
    },
    {
      name: 'offline-webkit',
      testMatch: /offline\.spec\.ts/,
      use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:4183' },
    },
    {
      name: 'offline-mobile',
      testMatch: /offline\.spec\.ts/,
      use: { ...devices['Pixel 5'], baseURL: 'http://localhost:4183' },
    },
    {
      // Chromium only, and on its own origin — see the file header.
      name: 'update-chromium',
      testMatch: /update\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4184' },
    },
    {
      name: 'workers-chromium',
      testMatch: /workers\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5174' },
    },
    {
      name: 'workers-firefox',
      testMatch: /workers\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:5174' },
    },
    {
      name: 'workers-webkit',
      testMatch: /workers\.spec\.ts/,
      use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:5174' },
    },
  ],

  webServer: [
    {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npm run build && node scripts/serve-production.mjs 4183',
      url: 'http://localhost:4183',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'node scripts/serve-production.mjs 4184 .tmp/update-dist',
      url: 'http://localhost:4184',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npm run dev -- --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
