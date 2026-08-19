import { chromium } from '@playwright/test';

/**
 * Measures what theme customisation actually costs — 12_PERFORMANCE.md §10.9
 *
 *   npm run build && npm run preview &
 *   node scripts/measure-theme.mjs
 *
 * Three questions worth answering, and no more:
 *
 *   1. Does changing the theme feel instant?
 *   2. Does the pre-paint bootstrap delay the first paint?
 *   3. Does a slider drag cost a write per frame?
 *
 * Everything else about a CSS custom property update is a microbenchmark of
 * the browser's style engine, which is not ours to measure or improve.
 */

const URL = process.env.PREVIEW_URL ?? 'http://localhost:4173';

const AMBER = {
  schemaVersion: 1,
  preset: 'amber',
  gradient: { from: '#fbbf24', to: '#78350f', angleDeg: 130, intensity: 30 },
  accent: '#fbbf24',
  glowIntensity: 25,
  contrastMode: 'normal',
  reducedMotion: 'system',
  fontScale: 1,
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function dismissNotice(page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
}

/** Click a preset, wait for the property to change, including style recalc. */
async function switchLatency(page) {
  await page.goto(URL);
  await dismissNotice(page);
  await page.getByRole('button', { name: /^Appearance/ }).click();

  const samples = [];
  const presets = ['Emerald', 'Deep Cyan', 'Amber Console', 'Mono', 'Matrix'];

  for (let round = 0; round < 4; round += 1) {
    for (const name of presets) {
      const took = await page.evaluate((label) => {
        const button = [...document.querySelectorAll('[role="radio"]')].find((element) =>
          (element.textContent ?? '').includes(label),
        );
        const before = getComputedStyle(document.documentElement)
          .getPropertyValue('--gradient-from')
          .trim();

        const start = performance.now();
        button.click();
        // Reading a computed value forces the style recalculation, so the
        // number includes the browser's work rather than just our own.
        let after = before;
        while (after === before) {
          after = getComputedStyle(document.documentElement)
            .getPropertyValue('--gradient-from')
            .trim();
          if (performance.now() - start > 1000) break;
        }
        return performance.now() - start;
      }, name);
      samples.push(took);
    }
  }
  return samples;
}

/** First Contentful Paint, with and without a stored custom theme. */
async function paint(page, theme) {
  await page.goto(URL);
  await page.evaluate((value) => {
    if (value === null) localStorage.removeItem('syntaxlab.theme.v1');
    else localStorage.setItem('syntaxlab.theme.v1', JSON.stringify(value));
  }, theme);

  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    await page.reload();
    const fcp = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const existing = performance
            .getEntriesByType('paint')
            .find((entry) => entry.name === 'first-contentful-paint');
          if (existing) {
            resolve(existing.startTime);
            return;
          }
          new PerformanceObserver((list, observer) => {
            for (const entry of list.getEntries()) {
              if (entry.name === 'first-contentful-paint') {
                observer.disconnect();
                resolve(entry.startTime);
              }
            }
          }).observe({ type: 'paint', buffered: true });
        }),
    );
    samples.push(fcp);
  }
  return samples;
}

/**
 * How many localStorage writes a continuous slider drag produces.
 *
 * Driven through real Playwright input rather than synthetic events: React
 * tracks a controlled input's value itself and ignores a value assigned
 * directly, so a hand-dispatched `input` event measures nothing. The intensity
 * is read back at the end to prove the drag actually happened.
 */
async function dragWrites(page) {
  await page.addInitScript(() => {
    const w = window;
    w.__themeWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function patched(...args) {
      if (String(args[0]).includes('theme')) w.__themeWrites += 1;
      return original.apply(this, args);
    };
  });

  await page.goto(URL);
  await dismissNotice(page);
  await page.getByRole('button', { name: /^Appearance/ }).click();

  const slider = page.getByRole('slider', { name: /Intensity/ });
  for (let value = 0; value <= 100; value += 5) {
    await slider.fill(String(value));
  }
  // Past the debounce, so the trailing write has happened.
  await page.waitForTimeout(600);

  const writes = await page.evaluate(() => window.__themeWrites);
  const intensity = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--gradient-intensity').trim(),
  );
  return { writes, intensity };
}

const browser = await chromium.launch();
const page = await browser.newPage();

const switches = await switchLatency(page);
const defaultPaint = await paint(page, null);
const storedPaint = await paint(page, AMBER);
const drag = await dragWrites(page);

await browser.close();

console.log('\nTheme performance — Chromium, production build\n');
console.log(`  Theme switch, median of ${switches.length}   ${median(switches).toFixed(1)} ms`);
console.log(`  Theme switch, slowest            ${Math.max(...switches).toFixed(1)} ms`);
console.log(`  FCP, default theme (median of 5) ${median(defaultPaint).toFixed(1)} ms`);
console.log(`  FCP, stored theme  (median of 5) ${median(storedPaint).toFixed(1)} ms`);
console.log(
  `  localStorage writes for a 21-step slider drag: ${drag.writes}` +
    `  (intensity ended at ${drag.intensity}, so the drag registered)`,
);
console.log('\nBudget: a theme change must feel instant (<100 ms) and a drag must');
console.log('not write once per frame (12_PERFORMANCE.md §10.9)\n');
