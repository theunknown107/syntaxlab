import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { awaitAnalysis, pressAnalyze } from './analyze';

/**
 * M9 — offline, against the real service worker.
 *
 * Two things make this suite different from every other one in the project.
 *
 * **It runs against production headers.** `tests/e2e/*` normally hit
 * `vite preview`, which serves no security headers at all. A service worker
 * takes its CSP from the headers on its own script, so a policy that breaks it
 * would be invisible to any test served without headers — the failure would
 * appear only in production, after every check had passed. This project runs
 * on port 4183 via `scripts/serve-production.mjs`.
 *
 * **Offline is real.** `context.setOffline(true)` cuts the browser's network
 * at the context level; nothing here fakes `navigator.onLine` or asserts on a
 * banner. If an asset is missing from the precache, these tests fail the way a
 * user would experience it.
 */

const patternField = (page: Page) => page.getByRole('textbox', { name: 'Regular expression' });

/**
 * WebKit cannot navigate under Playwright's offline mode.
 *
 * Measured on Playwright 1.62.1: with `context.setOffline(true)`, both
 * `page.reload()` and `page.goto()` fail with "WebKit encountered an internal
 * error" — **and they fail identically with no service worker registered at
 * all**. It is the harness, not this application.
 *
 * So the tests that need a navigation while offline are skipped there, and the
 * ones that do not — precache contents, registration scope, cache isolation,
 * the missing-API path — still run on WebKit. Faking offline instead would
 * turn a real assertion into a decorative one.
 */
function skipOfflineNavigation(browserName: string): void {
  test.skip(
    browserName === 'webkit',
    'Playwright cannot navigate WebKit while offline; fails the same way with no service worker.',
  );
}

/**
 * Loads the app and waits until the service worker controls the page.
 *
 * Controlling matters, not merely activated: an activated worker that has not
 * claimed this client will not serve its fetches, so going offline too early
 * tests nothing.
 */
async function cacheApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(patternField(page)).toBeVisible();

  // Polled on an interval rather than with `waitForFunction`, whose default
  // requestAnimationFrame polling can starve in a headless page that is not
  // compositing — which reads as a timeout rather than as a failed condition.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration?.active == null) return 0;
          // Selected by name, never by index: a test may plant an unrelated
          // cache on this origin, and browsers do not agree on the order
          // `caches.keys()` returns.
          const key = (await caches.keys()).find((name) => name.includes('workbox-precache'));
          if (key === undefined) return 0;
          return (await (await caches.open(key)).keys()).length;
        }),
      { timeout: 30_000, intervals: [250] },
    )
    .toBeGreaterThanOrEqual(10);

  // The first load registered the worker but is not controlled by it. One
  // reload puts the page under the worker, which is the state a returning
  // visitor is in — and the only state in which offline means anything.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 20_000,
      intervals: [250],
    })
    .toBe(true);
}

/**
 * Every test gets its own context, so no service worker, cache, IndexedDB or
 * localStorage leaks into the next one. PWA state is exactly the kind that
 * makes one test's success depend on another's leftovers — a cached build from
 * a previous test would make an offline assertion pass for the wrong reason.
 */
async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext();
}

test.describe('offline', () => {
  test('loads and analyses regex with the network cut', async ({ browser, browserName }) => {
    skipOfflineNavigation(browserName);

    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    await context.setOffline(true);
    await page.reload();

    // The application itself came from the cache.
    await expect(patternField(page)).toBeVisible();

    // And the analysis worker did too — this is the assertion that catches a
    // worker chunk missing from the precache, which works perfectly online.
    await patternField(page).fill('^(a|b)+c$');
    // M15 made analysis explicit: filling the editor analyses nothing.
    await pressAnalyze(page, 'pattern');
    await awaitAnalysis(page);
    await expect(page.getByText(/Capture group/).first()).toBeVisible();

    await context.close();
  });

  test('executes a regex against a subject offline', async ({ browser, browserName }) => {
    skipOfflineNavigation(browserName);

    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);
    await context.setOffline(true);
    await page.reload();

    await patternField(page).fill(String.raw`\d+`);
    await pressAnalyze(page, 'pattern');
    await awaitAnalysis(page);

    // The execution worker is a *separate* chunk, spawned per run.
    await page.getByRole('textbox', { name: 'Test string' }).fill('a1 b22 c333');
    await expect(page.getByText(/3 matches/)).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  test('analyses JSON offline, and formats it', async ({ browser, browserName }) => {
    skipOfflineNavigation(browserName);

    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);
    await context.setOffline(true);
    await page.reload();

    await page.getByRole('radio', { name: 'JSON' }).click();
    await page.getByRole('textbox', { name: 'JSON document' }).fill('{"b":[1,2],"a":{"c":true}}');
    await pressAnalyze(page, 'json');
    await expect(page.getByText(/^Valid ·/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tree', { name: 'JSON structure' })).toBeVisible();

    await page.getByRole('button', { name: 'Format' }).click();
    await expect(page.getByRole('textbox', { name: 'JSON document' })).toContainText('"b"');

    await context.close();
  });

  test('history reads and writes offline', async ({ browser, browserName }) => {
    skipOfflineNavigation(browserName);

    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    // Create one entry online.
    const gotIt = page.getByRole('button', { name: 'Got it' });
    if (await gotIt.isVisible()) await gotIt.click();
    await patternField(page).fill('online-pattern');
    // History records completed analyses, so one has to be asked for.
    await pressAnalyze(page, 'pattern');
    await awaitAnalysis(page);
    await page.waitForTimeout(4000);

    await context.setOffline(true);
    await page.reload();

    // The entry from before is still there — IndexedDB never involved the
    // network, and the service worker is not in its path.
    await page.getByRole('button', { name: /^History/ }).click();
    const drawer = page.getByRole('dialog', { name: 'History' });
    await expect(drawer.getByText('/online-pattern/g')).toBeVisible();

    // And a new one can be written while offline.
    await page.keyboard.press('Escape');
    await patternField(page).fill('offline-pattern');
    await pressAnalyze(page, 'pattern');
    await awaitAnalysis(page);
    await page.waitForTimeout(4000);

    await page.getByRole('button', { name: /^History/ }).click();
    await expect(drawer.getByText('/offline-pattern/g')).toBeVisible();

    // Deleting works offline too.
    await drawer.getByRole('button', { name: 'Delete /offline-pattern/g' }).click();
    await expect(drawer.getByRole('button', { name: 'Open /offline-pattern/g' })).toBeHidden();

    await context.close();
  });

  test('theme applies pre-paint offline, and can be changed offline', async ({
    browser,
    browserName,
  }) => {
    skipOfflineNavigation(browserName);

    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    const gotIt = page.getByRole('button', { name: 'Got it' });
    if (await gotIt.isVisible()) await gotIt.click();
    await page.getByRole('button', { name: /^Appearance/ }).click();
    await page.getByRole('radio', { name: 'Amber Console' }).click();
    await page.keyboard.press('Escape');

    await context.setOffline(true);
    await page.reload();

    const token = async (name: string) =>
      page.evaluate(
        (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
        name,
      );
    expect(await token('--gradient-from')).toBe('#fbbf24');

    // From M15 the theme is in the URL, so what survived the offline reload is
    // the address itself. `?theme=amber` is not a route — no request is made
    // for it, and the service worker's navigateFallback serves the cached
    // shell for any query string.
    expect(new URL(page.url()).searchParams.get('theme')).toBe('amber');

    // Changing it offline works: theme-bootstrap.js is precached, the URL is
    // read rather than fetched, and nothing here touched the network.
    await page.getByRole('button', { name: /^Appearance/ }).click();
    await page.getByRole('radio', { name: 'Mono' }).click();
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await token('--gradient-from')).toBe('#a6a6a6');
    expect(new URL(page.url()).searchParams.get('theme')).toBe('mono');

    await context.close();
  });

  test('a shared link applies its theme offline, on a cold load', async ({
    browser,
    browserName,
  }) => {
    skipOfflineNavigation(browserName);

    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    await context.setOffline(true);
    // A URL this document has never been to, with no network. The shell comes
    // from the precache and the theme comes from the address bar.
    await page.goto('/?theme=crimsonNight&font=1.25');

    const token = async (name: string) =>
      page.evaluate(
        (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
        name,
      );
    expect(await token('--gradient-from')).toBe('#DC143C');
    expect(await token('--font-scale')).toBe('1.25');
    await expect(page.getByRole('radio', { name: 'Regex' })).toBeVisible();

    await context.close();
  });

  test('switches modes offline', async ({ browser, browserName }) => {
    skipOfflineNavigation(browserName);

    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);
    await context.setOffline(true);
    await page.reload();

    await page.getByRole('radio', { name: 'JSON' }).click();
    await expect(page.getByRole('textbox', { name: 'JSON document' })).toBeVisible();
    await page.getByRole('radio', { name: 'Regex' }).click();
    await expect(patternField(page)).toBeVisible();

    await context.close();
  });

  test('shows a calm offline chip, and removes it when the network returns', async ({
    browser,
  }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    await expect(page.getByText('Offline', { exact: true })).toBeHidden();

    await context.setOffline(true);
    await expect(page.getByText('Offline', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Not an interstitial, and nothing is disabled: the app is still usable.
    await expect(patternField(page)).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);

    await context.setOffline(false);
    await expect(page.getByText('Offline', { exact: true })).toBeHidden({ timeout: 10_000 });

    await context.close();
  });

  test('the offline chip is announced politely and does not steal focus', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    await patternField(page).click();
    await context.setOffline(true);
    await expect(page.getByText('Offline', { exact: true })).toBeVisible({ timeout: 10_000 });

    // A network change must never move the caret out of the editor.
    const stillInEditor = await page.evaluate(
      () => document.activeElement?.closest('[role="textbox"]') !== null,
    );
    expect(stillInEditor).toBe(true);

    const chip = page.getByText('Offline', { exact: true });
    await expect(chip).toHaveRole('status');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);

    await context.close();
  });
});

test.describe('service worker', () => {
  test('precaches every runtime asset', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    const cached = await page.evaluate(async () => {
      const key = (await caches.keys()).find((name) => name.includes('workbox-precache'));
      const entries = await (await caches.open(key ?? '')).keys();
      return entries.map((request) => new URL(request.url).pathname);
    });

    // The two worker chunks are the ones that fail silently if missed.
    expect(cached.filter((url) => url.includes('.worker-')).length).toBe(2);
    expect(cached.some((url) => url === '/index.html')).toBe(true);
    expect(cached.some((url) => url === '/theme-bootstrap.js')).toBe(true);
    expect(cached.some((url) => url === '/manifest.webmanifest')).toBe(true);
    expect(cached.some((url) => url.endsWith('.css'))).toBe(true);
    expect(cached.filter((url) => url.startsWith('/icons/')).length).toBe(3);

    await context.close();
  });

  test('caches only application assets — no user data', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    const gotIt = page.getByRole('button', { name: 'Got it' });
    if (await gotIt.isVisible()) await gotIt.click();
    await patternField(page).fill('secret-token-abc123');
    await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(4000);

    // Cache Storage holds the build, and nothing the user typed. History lives
    // in IndexedDB and theme in localStorage; those boundaries stay separate.
    const bodies = await page.evaluate(async () => {
      const keys = await caches.keys();
      const texts: string[] = [];
      for (const key of keys) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          const type = response?.headers.get('content-type') ?? '';
          if (/text|javascript|json/.test(type))
            texts.push((await response!.text()).slice(0, 200000));
        }
      }
      return texts.join('\n');
    });

    expect(bodies).not.toContain('secret-token-abc123');
    await context.close();
  });

  test('uses one registration, scoped to the origin root', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    await cacheApp(page);

    const info = await page.evaluate(async () => {
      const all = await navigator.serviceWorker.getRegistrations();
      return { count: all.length, scope: all[0]?.scope ?? null };
    });
    expect(info.count).toBe(1);
    expect(info.scope).toMatch(/\/$/);

    await context.close();
  });

  test('names its cache after itself and leaves other caches alone', async ({ browser }) => {
    const context = await freshContext(browser);

    // Planted from a separate page in the same context. Navigating one page
    // twice in quick succession leaves WebKit's registration in a state where
    // the precache never fills, and that is a harness artefact rather than
    // anything this test is about.
    const planter = await context.newPage();
    await planter.goto('/');
    await planter.evaluate(async () => {
      const other = await caches.open('some-other-app-v1');
      await other.put('/index.html', new Response('not ours'));
    });
    await planter.close();

    const page = await context.newPage();
    await cacheApp(page);

    const keys = await page.evaluate(() => caches.keys());
    // Workbox namespaces its precache; ours is identifiable, and the unrelated
    // cache is untouched. Cleanup must never be "delete everything".
    expect(keys.some((key) => key.includes('workbox-precache'))).toBe(true);
    expect(keys).toContain('some-other-app-v1');

    await context.close();
  });

  test('the app still works when service workers are unavailable', async ({ browser }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();

    // Removed before any application code runs, the way a locked-down profile
    // or a private window presents it.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'serviceWorker', {
        get: () => undefined,
        configurable: true,
      });
    });
    await page.goto('/');

    await patternField(page).fill('ab+c');
    await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({
      timeout: 15_000,
    });

    await context.close();
  });
});
