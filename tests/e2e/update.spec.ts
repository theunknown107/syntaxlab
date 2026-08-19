import { copyFile, readFile, writeFile } from 'node:fs/promises';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * M9 — the update lifecycle, against a real version transition.
 *
 * **Isolated onto its own port and its own copy of the build.** These tests
 * have to change the bytes the server is handing out, and `dist/` is shared
 * with every other E2E project — mutating it mid-run would make an update
 * banner appear in the middle of a history or theme test. `.tmp/update-dist`
 * exists so this suite can rewrite a build without touching anyone else's.
 *
 * Chromium only, and serial, for the same reason: "replace the deployed build"
 * is an operation on one origin, and it cannot be run concurrently against
 * itself.
 */

test.describe.configure({ mode: 'serial' });

const ROOT = '.tmp/update-dist';

const patternField = (page: Page) => page.getByRole('textbox', { name: 'Regular expression' });

async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext();
}

async function cacheApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(patternField(page)).toBeVisible();

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration?.active == null) return 0;
          // By name, never by index: a test may plant an unrelated cache on
          // the origin, and browsers do not agree on the order keys come back.
          const key = (await caches.keys()).find((name) => name.includes('workbox-precache'));
          if (key === undefined) return 0;
          return (await (await caches.open(key)).keys()).length;
        }),
      { timeout: 30_000, intervals: [250] },
    )
    .toBeGreaterThanOrEqual(10);

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 20_000,
      intervals: [250],
    })
    .toBe(true);
}

/**
 * Deploys a "new build".
 *
 * A browser decides a service worker is new by comparing the script byte for
 * byte, so changing one byte is a faithful trigger for the whole lifecycle —
 * install, wait, notify, consent, activate. What it does not simulate is asset
 * hashes rotating; the precache-identity test covers that side.
 */
async function publishNewBuild(): Promise<void> {
  const file = `${ROOT}/sw.js`;
  const current = await readFile(file, 'utf8');
  await writeFile(
    file,
    `${current}
// build ${Date.now()}
`,
  );
}

test.beforeAll(async () => {
  // Start each run from a pristine copy of the real build.
  await copyFile('dist/sw.js', `${ROOT}/sw.js`);
});

/**
 * The update lifecycle — 07_PWA_OFFLINE.md §4
 *
 * These drive a *real* version transition: the app is cached, the served build
 * is replaced on disk, and the browser is allowed to notice. Nothing here
 * stubs a registration.
 */
test.describe('updates', () => {
  test('a new version waits, is announced, and never reloads on its own', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    // Prove the page is not reloaded behind the user's back.
    await page.evaluate(() => {
      (window as unknown as { __stayed: boolean }).__stayed = true;
    });

    await publishNewBuild();

    // The app asks the server on its own schedule; nudge it the way an hourly
    // check would, then wait for the worker to install and wait.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });

    await expect(page.getByText(/A new version of SyntaxLab is ready/)).toBeVisible({
      timeout: 30_000,
    });

    // Still the same document: no reload happened.
    expect(await page.evaluate(() => (window as unknown as { __stayed?: boolean }).__stayed)).toBe(
      true,
    );

    // The waiting worker really is waiting, not active.
    const waiting = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.waiting !== null && registration?.waiting !== undefined;
    });
    expect(waiting).toBe(true);

    await context.close();
  });

  test('the banner can be dismissed, and the app keeps working', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);
    await publishNewBuild();
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });

    await expect(page.getByText(/A new version of SyntaxLab is ready/)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Later' }).click();
    await expect(page.getByText(/A new version of SyntaxLab is ready/)).toBeHidden();

    await patternField(page).fill('still-working');
    await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({
      timeout: 15_000,
    });

    await context.close();
  });

  test('accepting the update activates it and keeps the editor contents', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    const gotIt = page.getByRole('button', { name: 'Got it' });
    if (await gotIt.isVisible()) await gotIt.click();
    await patternField(page).fill('survives-the-update');
    await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({
      timeout: 15_000,
    });

    await publishNewBuild();
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect(page.getByText(/A new version of SyntaxLab is ready/)).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: 'Reload' }).click();

    // Wait for the navigation the click causes to settle before asking the
    // page anything: evaluating during it destroys the execution context.
    await expect(patternField(page)).toBeVisible({ timeout: 30_000 });

    // The new worker took over — one coherent version, not a mixture.
    await expect
      .poll(
        () =>
          page
            .evaluate(async () => {
              const registration = await navigator.serviceWorker.getRegistration();
              return registration?.waiting == null && registration?.active != null;
            })
            .catch(() => false),
        { timeout: 30_000, intervals: [250] },
      )
      .toBe(true);

    // §4.1 rule 5: the reload does not cost the user their work.
    await expect(patternField(page)).toHaveText('survives-the-update', { timeout: 20_000 });
    await expect(page.getByText(/A new version of SyntaxLab is ready/)).toBeHidden();

    await context.close();
  });

  test('the old precache is replaced, not accumulated', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);
    await publishNewBuild();
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect(page.getByText(/A new version of SyntaxLab is ready/)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(patternField(page)).toBeVisible({ timeout: 30_000 });

    // One precache, holding the current build. Workbox revisions entries in
    // place rather than creating a cache per version, and stale entries are
    // dropped on activation.
    await expect
      .poll(() => page.evaluate(() => caches.keys()), { timeout: 20_000, intervals: [250] })
      .toEqual([expect.stringContaining('workbox-precache')]);

    await context.close();
  });
});
