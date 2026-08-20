import { chromium } from '@playwright/test';

/**
 * The M11 baseline — 12_PERFORMANCE.md §11
 *
 *   npm run build && node scripts/serve-production.mjs 4183 &
 *   node scripts/measure-m11.mjs
 *
 * Everything M11 claims to have improved is measured here, before and after,
 * on the production build under production headers. A refinement milestone
 * without a before is just an opinion.
 *
 * Interaction timings are wall-clock from the input event to the assertion
 * that the result is on screen, taken as a median of repeats. That is
 * deliberately end-to-end rather than a CPU profile: it includes the debounce,
 * the worker round trip and the paint, which together are what a user waits
 * for.
 */

const URL = process.env.PREVIEW_URL ?? 'http://localhost:4183';
const REPEATS = Number(process.env.REPEATS ?? 5);

/** Rounds for display; `null` stays visible as `n/a` rather than becoming 0. */
function show(value) {
  return value === null || value === undefined ? 'n/a' : String(Math.round(value));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: median(sorted),
    min: sorted[0],
    max: sorted.at(-1),
  };
}

/**
 * The visible text of a region, used as a settle signal.
 *
 * The workspace store has an `analysisStatus`, but it is not surfaced in the
 * DOM, and adding an attribute purely so a measurement script can read it
 * would be changing the product to suit the harness. Waiting for the rendered
 * text to *change* needs nothing from the app and measures the thing that
 * actually matters — when the answer appeared on screen.
 */
async function regionText(page, name) {
  return page
    .getByRole('region', { name })
    .first()
    .textContent({ timeout: 5_000 })
    .catch(() => '');
}

/** Resolves once `read()` returns something different from `before`. */
async function waitForChange(page, read, before, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const now = await read();
    if (now !== before && now !== '' && now !== null) return now;
    if (Date.now() > deadline) throw new Error('timed out waiting for the view to change');
    await page.waitForTimeout(16);
  }
}

/** Milliseconds for `action` to make `settled` true. */
async function time(page, action, settled) {
  const started = Date.now();
  await action();
  await settled();
  return Date.now() - started;
}

async function repeat(page, label, setup, action, settled, results) {
  const samples = [];
  for (let index = 0; index < REPEATS; index += 1) {
    await setup(index);
    samples.push(await time(page, action, settled));
  }
  results[label] = stats(samples);
  const { median: med, min, max } = results[label];
  console.log(`  ${label.padEnd(38)} ${String(med).padStart(6)} ms   (${min}–${max})`);
}

/* ------------------------------------------------------------------ *
 * Fixtures — generated, so the numbers are reproducible
 * ------------------------------------------------------------------ */

/** A JSON document of roughly `bytes`, shaped like a real API payload. */
function jsonOfSize(bytes) {
  const rows = [];
  let size = 2;
  let index = 0;
  while (size < bytes) {
    const row = {
      id: index,
      name: `record-${index}`,
      email: `user${index}@example.com`,
      active: index % 3 === 0,
      score: index * 1.5,
      tags: ['alpha', 'beta', 'gamma'].slice(0, (index % 3) + 1),
      nested: { level1: { level2: { value: `deep-${index}`, count: index } } },
    };
    const text = JSON.stringify(row);
    rows.push(row);
    size += text.length + 1;
    index += 1;
  }
  return JSON.stringify(rows);
}

const PATTERNS = {
  short: String.raw`\d+`,
  medium: String.raw`^(?<user>[\w.+-]+)@(?<host>[\w-]+\.[a-z]{2,})$`,
  large: Array.from({ length: 40 }, (_, i) => `(group${i}\\d{2,4}[a-z]+)`).join('|'),
  malformed: String.raw`([a-z]+`,
  nested: '('.repeat(20) + 'a' + ')'.repeat(20),
};

/* ------------------------------------------------------------------ *
 * Startup
 * ------------------------------------------------------------------ */

/** FCP and LCP for the load that just happened. */
async function paintMetrics(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        let largest = null;
        // LCP is only exposed through an observer; `getEntriesByType` returns
        // nothing for it. `buffered` replays what happened before this ran.
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) largest = entry.startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch {
          // Not implemented outside Chromium; FCP still reports.
        }
        const read = () => {
          const fcp = performance
            .getEntriesByType('paint')
            .find((entry) => entry.name === 'first-contentful-paint');
          return { fcp: fcp?.startTime ?? null, lcp: largest };
        };
        // LCP is only final once the page settles; one frame plus a short
        // settle is enough for a shell this size and keeps the run quick.
        setTimeout(() => resolve(read()), 600);
      }),
  );
}

/**
 * Time from navigation start to the point the shell is usable: the editor is
 * mounted and accepting input. Closer to "time to interactive" than any single
 * browser metric, and it is the thing a user actually waits for.
 */
async function interactive(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return nav ? nav.domInteractive : null;
  });
}

async function startup(browser, results) {
  console.log('\nStartup');

  // Cold: nothing cached, no service worker.
  const coldContext = await browser.newContext();
  const cold = await coldContext.newPage();
  await cold.goto(URL, { waitUntil: 'load' });
  await cold.locator('.cm-content').first().waitFor();
  const coldPaint = await paintMetrics(cold);
  results.startupCold = { ...coldPaint, domInteractive: await interactive(cold) };
  console.log(
    `  cold          FCP ${show(coldPaint.fcp)} ms   LCP ${show(coldPaint.lcp)} ms   domInteractive ${show(results.startupCold.domInteractive)} ms`,
  );

  // Warm: same context, service worker installed and precache populated.
  //
  // The worker ships with `clientsClaim: false` (M9, deliberate — a running
  // session is never taken over mid-flight), so it does not control the page
  // that registered it. Waiting for `.controller` there would hang forever;
  // what matters is that the registration is active and the precache is
  // populated, which is what the next navigation is served from.
  await cold.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const warm = await coldContext.newPage();
  await warm.goto(URL, { waitUntil: 'load' });
  await warm.locator('.cm-content').first().waitFor();
  const warmPaint = await paintMetrics(warm);
  results.startupWarm = { ...warmPaint, domInteractive: await interactive(warm) };
  console.log(
    `  warm          FCP ${show(warmPaint.fcp)} ms   LCP ${show(warmPaint.lcp)} ms   domInteractive ${show(results.startupWarm.domInteractive)} ms`,
  );

  // Offline: the network is genuinely cut, not simulated with a flag.
  await coldContext.setOffline(true);
  const offline = await coldContext.newPage();
  await offline.goto(URL, { waitUntil: 'load' });
  await offline.locator('.cm-content').first().waitFor();
  const offlinePaint = await paintMetrics(offline);
  results.startupOffline = { ...offlinePaint, domInteractive: await interactive(offline) };
  console.log(
    `  offline       FCP ${show(offlinePaint.fcp)} ms   LCP ${show(offlinePaint.lcp)} ms   domInteractive ${show(results.startupOffline.domInteractive)} ms`,
  );

  await coldContext.close();
}

/* ------------------------------------------------------------------ *
 * Regex
 * ------------------------------------------------------------------ */

async function openApp(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(URL);
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  return { context, page };
}

async function setEditor(page, name, text) {
  const editor = page.getByRole('textbox', { name });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  // `fill` on a CodeMirror surface does not dispatch what the view listens
  // for; typing the whole document is far too slow at 1 MB. Paste is what a
  // user does with a large document anyway.
  await page.evaluate(
    async ([value]) => {
      await navigator.clipboard.writeText(value);
    },
    [text],
  );
  await page.keyboard.press('ControlOrMeta+v');
}

async function regex(page, results) {
  console.log('\nRegex analysis  (input → explanation on screen)');
  await page.getByRole('radio', { name: 'Regex' }).click();

  for (const [name, pattern] of Object.entries(PATTERNS)) {
    let before = '';
    await repeat(
      page,
      `analysis: ${name}`,
      async () => {
        await setEditor(page, 'Regular expression pattern', ' ');
        await page.waitForTimeout(250);
        before = await regionText(page, 'Explanation');
      },
      async () => {
        await setEditor(page, 'Regular expression pattern', pattern);
      },
      async () => {
        // A malformed pattern reports an error where the explanation was;
        // either way the panel's text changes, which is the response being
        // timed. The size-aware debounce is included on purpose — it is part
        // of what the user waits through.
        await waitForChange(page, () => regionText(page, 'Explanation'), before, 15_000);
      },
      results,
    );
  }
}

async function regexExecution(page, results) {
  console.log('\nRegex execution  (test string → matches on screen)');

  const subject = 'user@example.com alice@test.org '.repeat(2_000);
  await setEditor(page, 'Regular expression pattern', String.raw`[\w.]+@[\w.]+`);
  await page.waitForTimeout(400);

  await repeat(
    page,
    'execution: 64 KB subject',
    async () => {
      await setEditor(page, 'Test string', ' ');
      await page.waitForTimeout(250);
    },
    async () => {
      await setEditor(page, 'Test string', subject);
    },
    async () => {
      await page
        .getByText(/\d+ matches?/)
        .first()
        .waitFor({ timeout: 15_000 });
    },
    results,
  );
}

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

async function json(page, results) {
  console.log('\nJSON  (paste → tree on screen)');
  await page.getByRole('radio', { name: 'JSON' }).click();

  const tree = page.getByRole('tree', { name: 'JSON structure' });

  for (const bytes of [100_000, 500_000, 1_000_000]) {
    const document_ = jsonOfSize(bytes);
    const label = `analysis: ${Math.round(document_.length / 1024)} KB`;
    await repeat(
      page,
      label,
      async () => {
        await setEditor(page, 'JSON document', '{}');
        await page.waitForTimeout(300);
      },
      async () => {
        await setEditor(page, 'JSON document', document_);
        // Past the manual threshold the UI asks rather than analysing on a
        // debounce, so the button press is part of the measured work.
        const analyze = page.getByRole('button', { name: 'Analyze JSON' });
        if (await analyze.isVisible().catch(() => false)) await analyze.click();
      },
      async () => {
        await tree.getByRole('treeitem').first().waitFor({ timeout: 30_000 });
      },
      results,
    );
  }

  // Tree interactions, on the largest document that is still analysed.
  await setEditor(page, 'JSON document', jsonOfSize(500_000));
  const analyze = page.getByRole('button', { name: 'Analyze JSON' });
  if (await analyze.isVisible().catch(() => false)) await analyze.click();
  await tree.getByRole('treeitem').first().waitFor({ timeout: 30_000 });

  console.log('\nJSON tree  (500 KB document)');

  await repeat(
    page,
    'expand all',
    async () => {
      await page.getByRole('button', { name: 'Collapse all' }).click();
      await page.waitForTimeout(120);
    },
    async () => {
      await page.getByRole('button', { name: 'Expand all' }).click();
    },
    async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('[role="treeitem"]').length > 40,
        null,
        { timeout: 30_000 },
      );
    },
    results,
  );

  await repeat(
    page,
    'format',
    async () => {
      await page.getByRole('button', { name: 'Minify' }).click();
      await page.waitForTimeout(200);
    },
    async () => {
      await page.getByRole('button', { name: 'Format' }).click();
    },
    async () => {
      // `.cm-content` is a stack of line divs, so its `textContent` contains no
      // newlines at all — counting rendered lines is the honest signal.
      await page.waitForFunction(
        () => document.querySelectorAll('.cm-content .cm-line').length > 1,
        null,
        { timeout: 30_000 },
      );
    },
    results,
  );
}

/* ------------------------------------------------------------------ *
 * History and theme
 * ------------------------------------------------------------------ */

async function historyAndTheme(page, results) {
  console.log('\nHistory and theme');

  await repeat(
    page,
    'history drawer open',
    async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
    },
    async () => {
      await page.getByRole('button', { name: /^History/ }).click();
    },
    async () => {
      await page.getByRole('dialog', { name: 'History' }).waitFor({ timeout: 10_000 });
    },
    results,
  );

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Appearance/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Appearance' });
  await drawer.waitFor();

  const presets = ['Deep Cyan', 'Crimson Night', 'Amber Console', 'Mono', 'Matrix'];
  let index = 0;
  await repeat(
    page,
    'theme switch',
    async () => {
      await page.waitForTimeout(80);
    },
    async () => {
      await drawer.getByRole('radio', { name: presets[index % presets.length] }).click();
      index += 1;
    },
    async () => {
      await page.waitForFunction(
        () => getComputedStyle(document.documentElement).getPropertyValue('--gradient-from') !== '',
        null,
        { timeout: 5_000 },
      );
    },
    results,
  );
  await page.keyboard.press('Escape');
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const browser = await chromium.launch();
const results = {};

console.log(`\nSyntaxLab M11 measurements — ${URL}, median of ${REPEATS}\n${'='.repeat(64)}`);

await startup(browser, results);

const { context, page } = await openApp(browser);
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
await regex(page, results);
await regexExecution(page, results);
await json(page, results);
await historyAndTheme(page, results);
await context.close();

await browser.close();

console.log(`\n${'='.repeat(64)}`);
console.log(JSON.stringify(results, null, 2));
