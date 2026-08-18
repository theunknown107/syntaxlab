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
 * Worker specs run on all three engines: M2's risk checkpoint (R-10) is that
 * `terminate()` reliably stops a runaway thread, and that is an engine-level
 * behaviour that cannot be assumed from one browser.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { trace: 'on-first-retry' },

  projects: [
    {
      name: 'shell-chromium',
      testMatch: /shell\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
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
      command: 'npm run dev -- --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
