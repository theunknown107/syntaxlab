import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * M12 — release QA: the complete user journeys.
 *
 * Every other spec proves one feature. This proves the *product*: a user
 * arriving at a cold page and working all the way through, with features
 * crossing each other — analyse, save, theme, reload, restore, go offline,
 * carry on.
 *
 * It runs against **:4183, the production build under the production
 * `vercel.json` headers**, because a gate that validates a policy the app does not
 * ship with is not a release gate. Every journey watches for CSP violations and
 * page errors for its whole duration rather than checking at the end, so a
 * violation is attributed to the step that caused it.
 *
 * Deliberately end-to-end and deliberately slow. The unit suite is where fast
 * feedback lives.
 */

interface Watcher {
  readonly cspViolations: string[];
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
}

/**
 * Records everything that should never happen, for the life of the page.
 *
 * CSP violations surface two ways — a `securitypolicyviolation` event and a
 * console message — and neither alone is reliable across all three engines, so
 * both are collected.
 */
function watch(page: Page): Watcher {
  const cspViolations: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message: ConsoleMessage) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(text)) {
      cspViolations.push(text);
    } else if (message.type() === 'error') {
      consoleErrors.push(text);
    }
  });
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const store = (window.__csp ??= []);
      store.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });

  return { cspViolations, pageErrors, consoleErrors };
}

/** Merges the in-page CSP record with the console-side one. */
async function violations(page: Page, watcher: Watcher): Promise<string[]> {
  const fromPage = await page.evaluate(() => window.__csp ?? []).catch(() => []);
  return [...watcher.cspViolations, ...fromPage];
}

async function assertClean(page: Page, watcher: Watcher, step: string): Promise<void> {
  expect(await violations(page, watcher), `CSP violations after: ${step}`).toEqual([]);
  expect(watcher.pageErrors, `page errors after: ${step}`).toEqual([]);
}

/**
 * Assembled rather than written literally.
 *
 * The payload has to contain a real `javascript:` URL to be worth testing, but
 * `no-script-url` is deliberately on for the whole repository and turning it
 * off for a file would weaken a rule that exists to catch the real thing.
 */
const JS_SCHEME = ['java', 'script', ':'].join('');

async function start(page: Page): Promise<void> {
  await page.goto('/');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
}

/**
 * The quiet period history waits out before recording an analysis.
 *
 * `CAPTURE_DELAY_MS` is 2 s: a successful analysis is not enough on its own,
 * because editing is continuous and a pause is the closest signal to "done".
 * A journey that moves on faster than a user would is testing the wrong thing,
 * so it waits — this is the product working, not a sleep papering over a race.
 */
const CAPTURE_QUIET_MS = 2_500;

/** Types into an editor without the clipboard, which needs different permissions per engine. */
/**
 * Types into an editor without the clipboard, then asks for an analysis.
 *
 * From M15 typing analyses nothing. The test string is the exception: the
 * tester is live and runs against the pattern that has already been analysed.
 */
async function setEditor(page: Page, name: string | RegExp, text: string): Promise<void> {
  const editor = page.getByRole('textbox', { name });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);

  const isTestString = typeof name === 'string' && /test string/i.test(name);
  if (isTestString) return;
  for (const label of ['Analyze pattern', 'Analyze JSON document', 'Analyze cron expression']) {
    const button = page.getByRole('button', { name: label });
    if ((await button.count()) > 0 && (await button.isEnabled())) {
      await button.click();
      return;
    }
  }
}

/* ------------------------------------------------------------------ *
 * The brand icons, on every engine
 * ------------------------------------------------------------------ */

test('the browser fetches a branded icon, on every engine', async ({ page, request }) => {
  const watcher = watch(page);
  const failed: string[] = [];
  page.on('requestfailed', (request) => {
    failed.push(`${request.url()} — ${request.failure()?.errorText ?? 'failed'}`);
  });
  const statuses = new Map<string, number>();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (/favicon|apple-touch-icon|\/icons\//.test(path)) statuses.set(path, response.status());
  });

  await start(page);

  // Requested explicitly rather than waiting to see what this engine chooses
  // on its own: they differ, and a 404 on any of them is the defect. Chromium
  // and Firefox take the SVG, Safari the .ico or the touch icon.
  //
  // Fetched through the test's own HTTP client, not from inside the page. A
  // first version used `fetch()` in the document and every engine failed it —
  // correctly, because the page ships `connect-src 'none'` and blocks exactly
  // that. The icons are `img-src`, which is a different directive; asking the
  // document to fetch them was testing the CSP, not the icons.
  for (const path of ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect((await response.body()).length, path).toBeGreaterThan(100);
  }

  // Nothing the engine chose for itself may have failed either.
  expect([...statuses].filter(([, status]) => status >= 400)).toEqual([]);
  expect(failed.filter((url) => /favicon|apple-touch|icons/.test(url))).toEqual([]);

  await assertClean(page, watcher, 'icon requests');
});

/* ------------------------------------------------------------------ *
 * Journey A — Regex, end to end
 * ------------------------------------------------------------------ */

test('Journey A — a regex session from cold page to offline', async ({
  page,
  context,
  browserName,
}) => {
  test.slow();
  const watcher = watch(page);
  await start(page);

  // 2–3. Regex mode is the default; enter a pattern with a named group.
  await expect(page.getByRole('radio', { name: 'Regex' })).toHaveAttribute('aria-checked', 'true');
  await setEditor(page, 'Regular expression', String.raw`(?<user>[\w.]+)@(?<host>[\w.]+)`);

  // 4. Explanation.
  const explanation = page.getByRole('region', { name: 'Explanation' }).first();
  await expect(explanation).toContainText(/captured group named/i, { timeout: 15_000 });

  // 5. AST.
  const structure = page.getByRole('tree', { name: 'Pattern structure' });
  await expect(structure.getByRole('treeitem').first()).toBeVisible();
  await assertClean(page, watcher, 'analysis');

  // 6–7. Test string and matches.
  await setEditor(page, 'Test string', 'alice@example.com and bob@test.org');
  const matches = page.getByRole('region', { name: 'Matches' }).first();
  await expect(matches).toContainText(/2 matches/, { timeout: 15_000 });

  // 8. Capture groups are shown, by name.
  await expect(matches).toContainText('user');
  await expect(matches).toContainText('host');

  // 9–10. Flags change the result rather than only the chip.
  await page.getByRole('button', { name: /Ignore case/ }).click();
  await expect(page.getByRole('button', { name: /Ignore case/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(matches).toContainText(/2 matches/);

  // 11. An invalid pattern is reported, not swallowed, and does not crash.
  await setEditor(page, 'Regular expression', '([a-z]+');
  // The wording matters: it names the character and says what to do about it.
  await expect(page.locator('body')).toContainText(/Unmatched `\(`/, { timeout: 15_000 });
  await expect(page.locator('body')).toContainText(/Pattern is not valid/i);
  await assertClean(page, watcher, 'invalid pattern');

  // 12. A warning, for a pattern that is valid but suspicious.
  await setEditor(page, 'Regular expression', String.raw`[a-z.]+`);
  await expect(page.getByRole('region', { name: /Warnings/ }).first()).toBeVisible({
    timeout: 15_000,
  });

  // 13–14. A catastrophic pattern is bounded, and the worker recovers.
  //
  // Two correct outcomes, not one. JavaScriptCore optimises `(a+)+$` and
  // finishes it; V8 and SpiderMonkey backtrack and hit the 2 s deadline, which
  // destroys the worker. Asserting only the timeout would report a WebKit
  // "failure" that is the engine being *better*. What must never happen —
  // and what the lines after this check — is the page becoming unusable.
  await setEditor(page, 'Regular expression', '(a+)+$');
  await setEditor(page, 'Test string', `${'a'.repeat(40)}!`);
  await expect(
    matches.getByText('Timed out', { exact: true }).or(matches.getByText('No matches.')),
  ).toBeVisible({ timeout: 20_000 });

  await setEditor(page, 'Regular expression', String.raw`\d+`);
  await setEditor(page, 'Test string', 'order 42 and 1337');
  await expect(matches).toContainText(/2 matches/, { timeout: 20_000 });
  await assertClean(page, watcher, 'timeout and recovery');

  // 16–17. History captured it, and it restores.
  await page.getByRole('button', { name: /^History/ }).click();
  const drawer = page.getByRole('dialog', { name: 'History' });
  await expect(drawer).toBeVisible();
  const entry = drawer.getByRole('button', { name: /^Open / }).first();
  await expect(entry).toBeVisible({ timeout: 10_000 });
  await entry.click();
  // Restoring over identical content may not prompt; either path is correct.
  const replace = page.getByRole('dialog', { name: 'Replace what is in the editor?' });
  if (await replace.isVisible().catch(() => false)) {
    await replace
      .getByRole('button', { name: /Replace|Open/ })
      .first()
      .click();
  }
  await page.keyboard.press('Escape');

  // 18. Theme change, mid-session, with work on screen.
  await page.getByRole('button', { name: /^Appearance/ }).click();
  const appearance = page.getByRole('dialog', { name: 'Appearance' });
  await appearance.getByRole('radio', { name: 'Crimson Night' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crimson');

  // 19. Reload — theme and history survive, the workspace still works.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crimson');
  await setEditor(page, 'Regular expression', String.raw`\w+`);
  await expect(explanation).toContainText(/word character/i, { timeout: 15_000 });
  await assertClean(page, watcher, 'reload');

  // 20–21. Offline, for real: the context's network is cut.
  //
  // WebKit is excluded from the *navigation* only. Playwright cannot reload a
  // WebKit page while the context is offline — it fails identically with no
  // service worker registered at all, so it is a harness limitation and not a
  // statement about the product. Documented since M9 and skipped the same way
  // in `offline.spec.ts`; everything above this line still runs on WebKit.
  test.skip(
    browserName === 'webkit',
    'Playwright cannot navigate WebKit while offline; fails the same way with no service worker.',
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Regular expression' })).toBeVisible({
    timeout: 20_000,
  });

  await setEditor(page, 'Regular expression', String.raw`(\d{4})-(\d{2})`);
  await expect(explanation).toContainText(/exactly 4/i, { timeout: 20_000 });
  await setEditor(page, 'Test string', '2026-08 and 1999-12');
  await expect(matches).toContainText(/2 matches/, { timeout: 20_000 });

  await assertClean(page, watcher, 'offline regex and execution');
  await context.setOffline(false);
});

/* ------------------------------------------------------------------ *
 * Journey B — JSON, end to end
 * ------------------------------------------------------------------ */

test('Journey B — a JSON session, including hostile documents', async ({
  page,
  context,
  browserName,
}) => {
  test.slow();
  const watcher = watch(page);
  await start(page);

  await page.getByRole('radio', { name: 'JSON' }).click();

  // 2–5. A valid document, its tree, and expand/collapse.
  await setEditor(
    page,
    'JSON document',
    '{"users":[{"name":"alice","age":30,"tags":["a","b"]},{"name":"bob","age":25,"tags":[]}],"total":2}',
  );
  const tree = page.getByRole('tree', { name: 'JSON structure' });
  await expect(tree.getByRole('treeitem').first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(tree.getByRole('treeitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(tree.getByRole('treeitem').first()).toBeVisible();
  await assertClean(page, watcher, 'tree expand/collapse');

  // 6–7. Search and path.
  const search = page.getByRole('searchbox').first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill('alice');
    await expect(page.locator('body')).toContainText(/1 (of|match)|1\/|1 result/i, {
      timeout: 10_000,
    });
    await search.fill('');
  }

  // 8–9. Format and minify are inverses and neither loses the document.
  await page.getByRole('button', { name: 'Minify' }).click();
  await expect(page.locator('.cm-content .cm-line')).toHaveCount(1);
  await page.getByRole('button', { name: 'Format' }).click();
  await expect(page.locator('.cm-content .cm-line').nth(3)).toBeVisible();
  await expect(tree.getByRole('treeitem').first()).toBeVisible();

  // 10. Duplicate keys are reported rather than silently collapsed.
  await setEditor(page, 'JSON document', '{"a":1,"a":2}');
  await expect(page.locator('body')).toContainText(/duplicate/i, { timeout: 15_000 });

  // 11. A number JavaScript cannot hold exactly.
  await setEditor(page, 'JSON document', '{"big":123456789012345678901234567890}');
  await expect(page.locator('body')).toContainText(/precision|unsafe|exact/i, { timeout: 15_000 });

  // 12–13. Malformed input reports a position and keeps the app alive.
  await setEditor(page, 'JSON document', '{"a":1,}');
  await expect(page.locator('body')).toContainText(/unexpected|expected|trailing/i, {
    timeout: 15_000,
  });
  await assertClean(page, watcher, 'malformed JSON');

  // 14. Prototype pollution, through the real UI.
  await setEditor(
    page,
    'JSON document',
    '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"x":1}}}',
  );
  await expect(tree.getByRole('treeitem').first()).toBeVisible({ timeout: 15_000 });
  const polluted = await page.evaluate(() => ({
    onObject: ({} as Record<string, unknown>).polluted ?? null,
    onPrototype: (Object.prototype as unknown as Record<string, unknown>).polluted ?? null,
    x: ({} as Record<string, unknown>).x ?? null,
  }));
  expect(polluted).toEqual({ onObject: null, onPrototype: null, x: null });

  // 15. XSS payloads render as text.
  await setEditor(
    page,
    'JSON document',
    `{"a":"<img src=x onerror=alert(1)>","b":"${JS_SCHEME}alert(2)","c":"<script>alert(3)<\\/script>"}`,
  );
  await expect(tree.getByRole('treeitem').first()).toBeVisible({ timeout: 15_000 });
  const injected = await page.evaluate(() => ({
    images: document.querySelectorAll('main img').length,
    scripts: document.querySelectorAll('main script').length,
    jsHrefs: [...document.querySelectorAll('main a[href]')].filter((a) =>
      (a.getAttribute('href') ?? '').toLowerCase().startsWith('javascript' + ':'),
    ).length,
  }));
  expect(injected).toEqual({ images: 0, scripts: 0, jsHrefs: 0 });
  await assertClean(page, watcher, 'hostile JSON');

  // 16–18. History, restore, reload.
  await setEditor(page, 'JSON document', '{"kept":true}');
  await expect(tree.getByRole('treeitem').first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await page.getByRole('button', { name: /^History/ }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'History' })
      .getByRole('button', { name: /^Open / })
      .first(),
  ).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');

  // 19–20. Offline JSON. WebKit navigation limitation as in Journey A.
  test.skip(
    browserName === 'webkit',
    'Playwright cannot navigate WebKit while offline; fails the same way with no service worker.',
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('radio', { name: 'JSON' }).click();
  await setEditor(page, 'JSON document', '{"offline":[1,2,3]}');
  await expect(tree.getByRole('treeitem').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Format' }).click();
  await expect(page.locator('.cm-content .cm-line').nth(1)).toBeVisible();

  await assertClean(page, watcher, 'offline JSON');
  await context.setOffline(false);
});

/* ------------------------------------------------------------------ *
 * Journey C — History lifecycle
 * ------------------------------------------------------------------ */

test('Journey C — history across both modes, pause, and clear', async ({ page }) => {
  test.slow();
  const watcher = watch(page);
  await start(page);

  // 1–2. One entry of each kind.
  await setEditor(page, 'Regular expression', String.raw`journeyC\d+`);
  await expect(page.getByRole('region', { name: 'Explanation' }).first()).toContainText(/digit/i, {
    timeout: 15_000,
  });
  await page.waitForTimeout(CAPTURE_QUIET_MS);

  await page.getByRole('radio', { name: 'JSON' }).click();
  await setEditor(page, 'JSON document', '{"journeyC":true}');
  await expect(
    page.getByRole('tree', { name: 'JSON structure' }).getByRole('treeitem').first(),
  ).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(CAPTURE_QUIET_MS);

  const open = async () => {
    await page.getByRole('button', { name: /^History/ }).click();
    const drawer = page.getByRole('dialog', { name: 'History' });
    await expect(drawer).toBeVisible();
    return drawer;
  };

  let drawer = await open();
  const entries = drawer.getByRole('button', { name: /^Open / });
  await expect(entries.first()).toBeVisible({ timeout: 10_000 });
  const initial = await entries.count();
  expect(initial).toBeGreaterThanOrEqual(2);

  // 3. Search narrows the list.
  await drawer.getByRole('searchbox', { name: 'Search history' }).fill('journeyC');
  await expect(entries.first()).toBeVisible();
  await drawer.getByRole('searchbox', { name: 'Search history' }).fill('');

  // 5. Pin, where supported.
  const pin = drawer.getByRole('button', { name: /^Pin / }).first();
  if (await pin.isVisible().catch(() => false)) {
    await pin.click();
    await expect(drawer.getByRole('button', { name: /^Unpin / }).first()).toBeVisible();
  }

  // 7. Delete one.
  await drawer
    .getByRole('button', { name: /^Delete/ })
    .first()
    .click();
  await expect(entries).toHaveCount(initial - 1, { timeout: 10_000 });
  await assertClean(page, watcher, 'history delete');
  await page.keyboard.press('Escape');

  // 9–10. Pause, and confirm nothing new is captured.
  await page.getByRole('button', { name: /^Pause/ }).click();
  await page.getByRole('radio', { name: 'Regex' }).click();
  await setEditor(page, 'Regular expression', String.raw`whilePaused\w+`);
  await expect(page.getByRole('region', { name: 'Explanation' }).first()).toContainText(
    /word character/i,
    { timeout: 15_000 },
  );

  await page.waitForTimeout(CAPTURE_QUIET_MS);
  drawer = await open();
  await expect(drawer.getByText(/whilePaused/)).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 11–12. Resume, and confirm capture returns.
  await page.getByRole('button', { name: /^Resume/ }).click();
  await setEditor(page, 'Regular expression', String.raw`afterResume\w+`);
  await expect(page.getByRole('region', { name: 'Explanation' }).first()).toContainText(
    /word character/i,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(CAPTURE_QUIET_MS);
  drawer = await open();
  await expect(drawer.getByRole('button', { name: /afterResume/ }).first()).toBeVisible({
    timeout: 10_000,
  });

  // 13. Survives a reload.
  await page.keyboard.press('Escape');
  await page.reload();
  drawer = await open();
  await expect(drawer.getByRole('button', { name: /afterResume/ }).first()).toBeVisible({
    timeout: 10_000,
  });

  // 8. Clear all, behind a confirmation.
  await drawer.getByRole('button', { name: 'Clear all' }).click();
  await page
    .getByRole('dialog', { name: 'Delete all history?' })
    .getByRole('button', { name: 'Delete everything' })
    .click();
  await expect(drawer.getByRole('button', { name: /^Open / })).toHaveCount(0, { timeout: 10_000 });

  // 14. And the app still works with an empty store.
  await page.keyboard.press('Escape');
  await setEditor(page, 'Regular expression', String.raw`afterClear\d`);
  await expect(page.getByRole('region', { name: 'Explanation' }).first()).toContainText(/digit/i, {
    timeout: 15_000,
  });
  await assertClean(page, watcher, 'history cleared');
});

/* ------------------------------------------------------------------ *
 * Journey D — Every theme, against real work
 * ------------------------------------------------------------------ */

const PRESETS = [
  ['Matrix', 'green'],
  ['Emerald', 'green'],
  ['Deep Cyan', 'cyan'],
  ['Amber Console', 'amber'],
  ['Crimson Night', 'crimson'],
  ['Mono', 'mono'],
] as const;

/** Green as a visible hue; near-neutrals are judged on channel bias instead. */
function isGreen(value: string): boolean {
  const [r = 0, g = 0, b = 0] = value.match(/[0-9.]+/g)?.map(Number) ?? [];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  if (spread === 0) return false;
  const lightness = (max + min) / 2 / 255;
  const saturation = spread / 255 / (1 - Math.abs(2 * lightness - 1) || 1);
  if (saturation < 0.06) return g > r && g > b;
  return isGreenHue(hueOf(r, g, b, spread));
}

function hueOf(r: number, g: number, b: number, spread: number): number {
  const max = Math.max(r, g, b);
  let hue: number;
  if (max === r) hue = (((g - b) / spread) % 6) * 60;
  else if (max === g) hue = ((b - r) / spread + 2) * 60;
  else hue = ((r - g) / spread + 4) * 60;
  return hue < 0 ? hue + 360 : hue;
}

function isGreenHue(hue: number): boolean {
  return hue >= 70 && hue < 170;
}

const DECORATIVE = [
  '--color-bg',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-sunken',
  '--color-text',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-border',
  '--color-border-strong',
  '--color-accent',
  '--color-accent-legible',
  '--color-accent-hover',
  '--color-accent-active',
  '--color-focus',
  '--color-selection',
  '--gradient-from',
  '--gradient-mid-1',
  '--gradient-mid-2',
  '--gradient-to',
];

test('Journey D — every preset, with regex and JSON work on screen', async ({ page }) => {
  test.slow();
  const watcher = watch(page);
  await start(page);

  // Real work, so the themes are judged against a populated interface rather
  // than an empty shell.
  await setEditor(page, 'Regular expression', String.raw`^(?<id>\d+)-(?<tag>[a-z.]+)$`);
  await expect(page.getByRole('region', { name: 'Explanation' }).first()).toBeVisible({
    timeout: 15_000,
  });
  await setEditor(page, 'Test string', '42-alpha');

  for (const [preset, family] of PRESETS) {
    await page.getByRole('button', { name: /^Appearance/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Appearance' });
    await drawer.getByRole('radio', { name: preset }).click();
    await page.keyboard.press('Escape');

    await expect(page.locator('html')).toHaveAttribute('data-theme-family', family);

    // Decorative tokens, at their *used* values — a custom property computes
    // as-specified, so `color-mix()` has to be resolved through a real element.
    const used = await page.evaluate((names) => {
      const probe = document.createElement('span');
      probe.style.display = 'none';
      document.body.append(probe);
      const resolved = Object.fromEntries(
        names.map((name) => {
          probe.style.color = 'transparent';
          probe.style.color = `var(${name})`;
          const value = getComputedStyle(probe).color;
          return [name, value === 'rgba(0, 0, 0, 0)' ? '' : value];
        }),
      );
      probe.remove();
      return resolved;
    }, DECORATIVE);

    const populated = Object.values(used).filter((value) => value !== '');
    expect(populated.length, `${preset}: probe read nothing`).toBeGreaterThan(12);

    if (family !== 'green') {
      const green = Object.entries(used).filter(([, value]) => value !== '' && isGreen(value));
      expect(green, `${preset} has green decorative tokens`).toEqual([]);
    }

    // Editor decorations are theme surface too — this is where the M10
    // correction pass found `|` rendering #3ddc84 inside Crimson Night.
    const decorations = await page.evaluate(() =>
      [...document.querySelectorAll('.cm-content [class*="tok-"]')].map(
        (element) => getComputedStyle(element).color,
      ),
    );
    if (family !== 'green') {
      expect(decorations.filter(isGreen), `${preset} editor decorations`).toEqual([]);
    }

    // Focus stays visible in every theme.
    //
    // Reached with Tab rather than `.focus()`. The ring is drawn by
    // `:focus-visible`, which programmatic focus does not match in Firefox —
    // asserting on a scripted focus would be testing a state no keyboard user
    // is ever in, and would have reported a ring that is not there.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const active = document.activeElement;
      if (active === null) return null;
      const style = getComputedStyle(active);
      return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    expect(ring, `${preset} focus ring`).not.toBeNull();
    expect(ring?.style, `${preset} focus ring style`).not.toBe('none');
    expect(ring?.width, `${preset} focus ring width`).toBeGreaterThan(0);

    await assertClean(page, watcher, `theme ${preset}`);
  }

  // The two palettes that are specified exactly, not derived.
  await page.getByRole('button', { name: /^Appearance/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Appearance' });
  await drawer.getByRole('radio', { name: 'Matrix' }).click();
  const matrix = await page.evaluate(() =>
    ['--gradient-from', '--gradient-mid-1', '--gradient-mid-2', '--gradient-to'].map((name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    ),
  );
  expect(matrix).toEqual(['#00FF41', '#008F11', '#003B00', '#0D0208']);

  await drawer.getByRole('radio', { name: 'Crimson Night' }).click();
  const crimson = await page.evaluate(() =>
    ['--gradient-from', '--gradient-to'].map((name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase(),
    ),
  );
  expect(crimson).toEqual(['#dc143c', '#343434']);

  // A customised theme survives a reload, and JSON still renders under it.
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crimson');
  await page.getByRole('radio', { name: 'JSON' }).click();
  await setEditor(page, 'JSON document', '{"themed":[1,"two",null,true]}');
  await expect(
    page.getByRole('tree', { name: 'JSON structure' }).getByRole('treeitem').first(),
  ).toBeVisible({ timeout: 15_000 });

  const jsonDecorations = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-content [class*="tok-"]')].map(
      (element) => getComputedStyle(element).color,
    ),
  );
  expect(jsonDecorations.filter(isGreen)).toEqual([]);

  await assertClean(page, watcher, 'themed JSON after reload');
});
