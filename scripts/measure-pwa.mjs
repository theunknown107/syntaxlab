import { chromium } from '@playwright/test';

/**
 * Measures what the PWA layer costs and what it buys — 12_PERFORMANCE.md §10.10
 *
 *   npm run build && node scripts/serve-production.mjs 4183 &
 *   node scripts/measure-pwa.mjs
 *
 * Four questions:
 *
 *   1. What does a cold first visit cost, before anything is cached?
 *   2. What does a warm visit cost, served by the service worker?
 *   3. What does it cost with the network cut entirely?
 *   4. How long until a first-time visitor is actually offline-capable?
 *
 * Everything is measured against the production build under production
 * headers, because that is the only configuration in which the service worker
 * behaves the way it will for a user.
 */

const URL = process.env.PREVIEW_URL ?? 'http://localhost:4183';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** First Contentful Paint for the current page load. */
async function paint(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const seen = performance
          .getEntriesByType('paint')
          .find((entry) => entry.name === 'first-contentful-paint');
        if (seen) {
          resolve(seen.startTime);
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
}

async function precacheSize(page) {
  return page.evaluate(async () => {
    const key = (await caches.keys()).find((name) => name.includes('workbox-precache'));
    if (key === undefined) return { entries: 0, bytes: 0 };
    const cache = await caches.open(key);
    const requests = await cache.keys();
    let bytes = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) bytes += (await response.clone().blob()).size;
    }
    return { entries: requests.length, bytes };
  });
}

/** Waits until the worker controls the page, i.e. the app is offline-capable. */
async function becomeOfflineReady(page) {
  const start = Date.now();
  await page.goto(URL);
  for (;;) {
    const ready = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.active == null) return false;
      const key = (await caches.keys()).find((name) => name.includes('workbox-precache'));
      if (key === undefined) return false;
      return (await (await caches.open(key)).keys()).length >= 10;
    });
    if (ready) break;
    if (Date.now() - start > 30_000) throw new Error('never became offline-ready');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return Date.now() - start;
}

const browser = await chromium.launch();

// 1. Cold: no service worker, nothing cached.
const cold = [];
for (let index = 0; index < 5; index += 1) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(URL);
  cold.push(await paint(page));
  await context.close();
}

// 2 & 3 & 4. One context that becomes offline-capable, then is measured warm
// and offline.
const context = await browser.newContext();
const page = await context.newPage();
const readyMs = await becomeOfflineReady(page);
const size = await precacheSize(page);

await page.reload(); // now controlled by the worker

const warm = [];
for (let index = 0; index < 5; index += 1) {
  await page.reload();
  warm.push(await paint(page));
}

await context.setOffline(true);
const offline = [];
for (let index = 0; index < 5; index += 1) {
  await page.reload();
  offline.push(await paint(page));
}

// The whole point, measured rather than asserted: an analysis still runs.
await page.getByRole('textbox', { name: 'Regular expression' }).fill('^(a|b)+@\\w+$');
const analysisStart = Date.now();
await page.getByRole('region', { name: 'Explanation' }).waitFor({ timeout: 20_000 });
const offlineAnalysisMs = Date.now() - analysisStart;

await context.close();
await browser.close();

const kb = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;

console.log('\nPWA performance — Chromium, production build, production headers\n');
console.log(`  First visit, cold FCP (median of 5)     ${median(cold).toFixed(1)} ms`);
console.log(`  Warm FCP, served by the worker (of 5)   ${median(warm).toFixed(1)} ms`);
console.log(`  Offline FCP, network cut (median of 5)  ${median(offline).toFixed(1)} ms`);
console.log(`  Time to become offline-capable          ${readyMs} ms`);
console.log(`  First offline analysis (worker boot)    ${offlineAnalysisMs} ms`);
console.log('');
console.log(`  Precache entries                        ${size.entries}`);
console.log(`  Precache footprint on disk (uncompressed) ${kb(size.bytes)}`);
console.log('\nBudget: precache ≤ 2 MB (07_PWA_OFFLINE.md §2.3)\n');
