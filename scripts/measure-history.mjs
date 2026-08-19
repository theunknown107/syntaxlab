import { chromium } from '@playwright/test';

/**
 * Measures history at realistic sizes — 12_PERFORMANCE.md §9
 *
 * Run against the production preview server:
 *
 *   npm run build && npm run preview &
 *   node scripts/measure-history.mjs
 *
 * Numbers, not guesses. The M7 budget question is whether a full store makes
 * the drawer feel slow, and the only honest way to answer it is to fill a real
 * IndexedDB in a real browser and time the real code path.
 */

const URL = process.env.PREVIEW_URL ?? 'http://localhost:4173';
// 1000 is above the 500-entry cap on purpose: a store can hold more than the
// cap transiently — after an import, before the next save trims it — and that
// is the slowest read the drawer can face.
const SIZES = [0, 100, 500, 1000];

function seedScript(count) {
  return `
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('syntaxlab');
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('history', 'readwrite');
        const store = tx.objectStore('history');
        store.clear();
        for (let i = 0; i < ${count}; i += 1) {
          const title = '/pattern-' + i + '-[a-z]+\\\\d{2,4}/gi';
          const input = 'pattern-' + i + '-[a-z]+\\\\d{2,4}';
          store.put({
            id: 'seed-' + i,
            schemaVersion: 1,
            type: 'regex',
            title,
            isCustomTitle: false,
            input,
            inputTruncated: false,
            metadata: { type: 'regex', flags: 'gi', groupCount: 2, hadErrors: false, nodeCount: 12 },
            createdAt: 1700000000000 + i,
            lastOpenedAt: 1700000000000 + i,
            openCount: 1,
            pinned: false,
            tags: [],
            searchText: (title + '\\n' + input).toLowerCase(),
          });
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  `;
}

async function measure(page, count) {
  await page.goto(URL);
  await page.evaluate(`(async () => { ${seedScript(count)} })()`);
  await page.reload();

  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();

  const openMs = await time(page, async () => {
    await page.getByRole('button', { name: /^History/ }).click();
    await page.getByRole('dialog', { name: 'History' }).waitFor({ state: 'visible' });
    // Waits for the count line to settle, so the read is included rather than
    // just the animation.
    await page.waitForFunction(() => {
      const line = document.querySelector('dialog[open] p');
      return line !== null && /entr|Nothing saved/.test(line.textContent ?? '');
    });
  });

  const search = page.getByRole('searchbox', { name: 'Search history' });
  const searchMs = await time(page, async () => {
    await search.fill('pattern-4');
    await page.waitForFunction(() => {
      const line = document.querySelector('dialog[open] p');
      return line !== null && /entr|No matches/.test(line.textContent ?? '');
    });
  });

  await search.fill('');
  await page.keyboard.press('Escape');
  return { count, openMs, searchMs };
}

async function time(page, action) {
  const start = Date.now();
  await action();
  return Date.now() - start;
}

const browser = await chromium.launch();
const page = await browser.newPage();

const rows = [];
for (const size of SIZES) {
  // Three passes; the median absorbs a stray GC pause.
  const runs = [];
  for (let i = 0; i < 3; i += 1) runs.push(await measure(page, size));
  runs.sort((a, b) => a.openMs - b.openMs);
  rows.push(runs[1]);
}

await browser.close();

console.log('\nHistory performance — median of 3, Chromium, production build\n');
console.log('  entries   open drawer   search');
for (const row of rows) {
  console.log(
    `  ${String(row.count).padStart(7)}   ${`${row.openMs} ms`.padStart(11)}   ${`${row.searchMs} ms`.padStart(6)}`,
  );
}
console.log('\nBudget: drawer open < 200 ms, search < 100 ms (12_PERFORMANCE.md §9)\n');
