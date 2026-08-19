import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * M7 — history end to end.
 *
 * This is the only place real IndexedDB is exercised: happy-dom does not
 * provide it, so the unit tests cover the repository's *rules* against a fake
 * backend and everything below runs against the real database in a real
 * browser, under the real CSP, on the production build.
 */

const CAPTURE_WAIT = 6_000;

const patternField = (page: Page) => page.getByRole('textbox', { name: 'Regular expression' });
// The button carries a count once entries exist, so its accessible name is
// "History" or "History 3" — never the pause control, which leads with a verb.
const historyButton = (page: Page) => page.getByRole('button', { name: /^History/ });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'History' });

async function start(page: Page): Promise<void> {
  await page.goto('/');
  // The first-run notice covers the same ground for every test; acknowledging
  // it once keeps the rest of each test about history itself.
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();
}

async function analysePattern(page: Page, pattern: string): Promise<void> {
  await patternField(page).click();
  await patternField(page).fill(pattern);
  await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({ timeout: 10_000 });
}

async function openDrawer(page: Page): Promise<void> {
  await historyButton(page).click();
  await expect(drawer(page)).toBeVisible();
}

/** The drawer is modal, so the page behind it is unreachable until it closes. */
async function closeDrawer(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
}

async function captureAndOpen(page: Page, pattern: string): Promise<void> {
  await analysePattern(page, pattern);
  await openDrawer(page);
  await expect(drawer(page).getByText(`/${pattern}/g`)).toBeVisible({ timeout: CAPTURE_WAIT });
}

test.beforeEach(async ({ page }) => {
  await start(page);
});

/* ------------------------------------------------------------------ *
 * Capture and restore
 * ------------------------------------------------------------------ */

test('records an analysis and restores it', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');
  await closeDrawer(page);

  await patternField(page).fill('');
  await openDrawer(page);
  // The editor is empty, so opening does not have to ask.
  await drawer(page).getByRole('button', { name: 'Open /ab+c/g' }).click();

  await expect(drawer(page)).toBeHidden();
  // The editor is CodeMirror, so its content is text rather than a value.
  await expect(patternField(page)).toHaveText('ab+c');
});

test('survives a reload — this is real storage, not session state', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');

  await page.reload();
  await openDrawer(page);
  await expect(drawer(page).getByText('/ab+c/g')).toBeVisible();
});

test('does not record while history is paused', async ({ page }) => {
  await page.getByRole('button', { name: /Pause history/ }).click();
  await analysePattern(page, 'paused+pattern');
  await page.waitForTimeout(CAPTURE_WAIT);

  await openDrawer(page);
  await expect(drawer(page).getByText('/paused+pattern/g')).toBeHidden();
  await expect(drawer(page).getByText('Nothing saved yet')).toBeVisible();
});

test('the pause setting survives a reload', async ({ page }) => {
  await page.getByRole('button', { name: /Pause history/ }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * Managing entries
 * ------------------------------------------------------------------ */

test('renames an entry, and the new name is what search finds', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');

  await drawer(page)
    .getByRole('button', { name: /^Rename/ })
    .click();
  await drawer(page).getByRole('textbox', { name: 'New name for this entry' }).fill('Postcode');
  await drawer(page).getByRole('button', { name: 'Save' }).click();

  await expect(drawer(page).getByText('Postcode')).toBeVisible();

  await drawer(page).getByRole('searchbox', { name: 'Search history' }).fill('postcode');
  await expect(drawer(page).getByText('Postcode')).toBeVisible();
  await expect(drawer(page).getByText('1 entry')).toBeVisible();
});

test('pins an entry and filters to pinned only', async ({ page }) => {
  await captureAndOpen(page, 'first+one');
  await closeDrawer(page);

  await patternField(page).fill('second+one');
  await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible();
  await openDrawer(page);
  await expect(drawer(page).getByText('/second+one/g')).toBeVisible({ timeout: CAPTURE_WAIT });

  await drawer(page).getByRole('button', { name: 'Pin /first+one/g' }).click();
  await expect(drawer(page).getByRole('button', { name: 'Unpin /first+one/g' })).toBeVisible();

  await drawer(page).getByRole('button', { name: 'Pinned' }).click();
  await expect(drawer(page).getByText('/first+one/g')).toBeVisible();
  await expect(drawer(page).getByText('/second+one/g')).toBeHidden();
});

test('deletes an entry and brings it back with undo', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');

  await drawer(page)
    .getByRole('button', { name: /^Delete/ })
    .click();
  // The row, specifically: the undo bar names the deleted entry too.
  await expect(drawer(page).getByRole('button', { name: 'Open /ab+c/g' })).toBeHidden();

  await drawer(page).getByRole('button', { name: 'Undo' }).click();
  await expect(drawer(page).getByRole('button', { name: 'Open /ab+c/g' })).toBeVisible();

  // Really back, not just on screen.
  await page.reload();
  await openDrawer(page);
  await expect(drawer(page).getByText('/ab+c/g')).toBeVisible();
});

test('clear-all needs a confirmation, and actually clears', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');

  await drawer(page).getByRole('button', { name: 'Clear all' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete all history?' });
  await expect(confirm).toBeVisible();

  // Cancelling must leave the data alone.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(drawer(page).getByText('/ab+c/g')).toBeVisible();

  await drawer(page).getByRole('button', { name: 'Clear all' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(drawer(page).getByText('Nothing saved yet')).toBeVisible();

  await page.reload();
  await openDrawer(page);
  await expect(drawer(page).getByText('Nothing saved yet')).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * Hostile data
 * ------------------------------------------------------------------ */

test('renders a stored script tag as text, never as HTML', async ({ page }) => {
  // The pattern is a string that would execute if any part of the pipeline
  // built markup from it. It goes through a real analysis, real IndexedDB,
  // and back out into the list.
  const hostile = '<img src=x onerror=alert(1)>';
  await analysePattern(page, hostile);
  await openDrawer(page);

  const row = drawer(page).getByText(`/${hostile}/g`);
  await expect(row).toBeVisible({ timeout: CAPTURE_WAIT });
  await expect(drawer(page).locator('img')).toHaveCount(0);
});

test('a corrupt record does not break the drawer, and is not deleted', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');
  await closeDrawer(page);

  // Written straight into the database, the way a devtools console would.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('syntaxlab');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('history', 'readwrite');
        tx.objectStore('history').put({ id: 'corrupt-1', title: 42, nonsense: true });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error('failed'));
        };
      };
      open.onerror = () => {
        reject(open.error ?? new Error('failed'));
      };
    });
  });

  await page.reload();
  await openDrawer(page);

  // The good entry still lists, and the bad one is reported rather than hidden.
  await expect(drawer(page).getByText('/ab+c/g')).toBeVisible();
  await expect(drawer(page).getByText(/could not be read/)).toBeVisible();
});

test('a record from a newer version is kept and reported, not destroyed', async ({ page }) => {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('syntaxlab');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('history', 'readwrite');
        tx.objectStore('history').put({
          id: 'from-the-future',
          schemaVersion: 99,
          type: 'cron',
          title: '0 9 * * 1',
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error('failed'));
        };
      };
      open.onerror = () => {
        reject(open.error ?? new Error('failed'));
      };
    });
  });

  await page.reload();
  await openDrawer(page);
  await expect(drawer(page).getByText(/newer version of SyntaxLab/)).toBeVisible();

  // Still on disk: an old tab must not destroy a newer build's data.
  const stillThere = await page.evaluate(async () => {
    return new Promise<boolean>((resolve) => {
      const open = indexedDB.open('syntaxlab');
      open.onsuccess = () => {
        const db = open.result;
        const request = db
          .transaction('history', 'readonly')
          .objectStore('history')
          .get('from-the-future');
        request.onsuccess = () => {
          db.close();
          resolve(request.result !== undefined);
        };
        request.onerror = () => {
          db.close();
          resolve(false);
        };
      };
      open.onerror = () => {
        resolve(false);
      };
    });
  });
  expect(stillThere).toBe(true);
});

/* ------------------------------------------------------------------ *
 * Analysis is never blocked by history
 * ------------------------------------------------------------------ */

test('regex and JSON still work when storage is unavailable', async ({ page }) => {
  // IndexedDB removed before any application code runs, the way a locked-down
  // browser profile presents it.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  });
  await page.goto('/');

  await analysePattern(page, 'ab+c');
  await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible();

  await page.getByRole('radio', { name: 'JSON' }).click();
  await page.getByRole('textbox', { name: 'JSON document' }).fill('{"a":1}');
  await expect(page.getByText(/^Valid ·/)).toBeVisible({ timeout: 10_000 });
});

test('says so when history cannot be saved, rather than pretending', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  });
  await page.goto('/');

  await openDrawer(page);
  await expect(drawer(page).getByText(/not allowing SyntaxLab to save history/)).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

test('exports a file containing the saved entries', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    drawer(page).getByRole('button', { name: 'Export' }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^syntaxlab-history-\d{4}-\d{2}-\d{2}\.json$/);
});

/* ------------------------------------------------------------------ *
 * Accessibility
 * ------------------------------------------------------------------ */

test('the drawer traps focus and closes on Escape', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');

  // A native <dialog> opened modally holds focus; tabbing cannot reach the
  // page behind it.
  for (let index = 0; index < 12; index += 1) await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return dialog?.contains(document.activeElement) ?? false;
  });
  expect(inside).toBe(true);

  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
});

test('has no detectable accessibility violations', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});

test('the first-run notice can turn history off outright', async ({ page }) => {
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();

  await page.getByRole('button', { name: 'Turn history off' }).click();
  await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible();
  // Gone for good, not shown again on the next visit.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Turn history off' })).toBeHidden();
});

/* ------------------------------------------------------------------ *
 * Multiple tabs
 * ------------------------------------------------------------------ */

test('a save in one tab reaches the other', async ({ page, context }) => {
  const second = await context.newPage();
  await second.goto('/');

  await analysePattern(page, 'shared+pattern');
  await page.waitForTimeout(CAPTURE_WAIT);

  // The second tab never analysed anything; it learns through the channel.
  await historyButton(second).click();
  await expect(drawer(second)).toBeVisible();
  await expect(drawer(second).getByText('/shared+pattern/g')).toBeVisible();

  await second.close();
});

test('pausing in one tab pauses the other', async ({ page, context }) => {
  const second = await context.newPage();
  await second.goto('/');

  await page.getByRole('button', { name: /Pause history/ }).click();

  // localStorage broadcasts its own changes; the other tab re-reads.
  await expect(second.getByRole('button', { name: /Resume history/ })).toBeVisible();
  await second.close();
});

/* ------------------------------------------------------------------ *
 * The settings mirror
 * ------------------------------------------------------------------ */

test('the drawer states what history is doing, how much it holds, and how to stop it', async ({
  page,
}) => {
  await captureAndOpen(page, 'ab+c');

  await expect(drawer(page).getByText(/Saving is/)).toBeVisible();
  await expect(drawer(page).getByText(/1 saved/)).toBeVisible();
  await expect(drawer(page).getByText(/in use by this site|does not report/)).toBeVisible();

  await drawer(page).getByRole('button', { name: 'Pause saving' }).click();
  await expect(drawer(page).getByRole('button', { name: 'Resume saving' })).toBeVisible();
  // The header agrees with the drawer.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Resume history/ })).toBeVisible();
});

test('clear-all names how much is about to go', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');

  await drawer(page).getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByText(/This deletes all 1 saved entry/)).toBeVisible();
});

test('the storage note discloses eviction rather than promising permanence', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');

  const note = drawer(page).getByText(/not sent to any server/);
  await expect(note).toBeVisible();
  await expect(note).toContainText('Browsers can clear site storage on their own');
});

test('asks before an entry replaces different text in the editor', async ({ page }) => {
  await captureAndOpen(page, 'ab+c');
  await closeDrawer(page);

  await patternField(page).fill('something+else');
  await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible();
  await openDrawer(page);
  await drawer(page).getByRole('button', { name: 'Open /ab+c/g' }).click();

  const confirm = page.getByRole('dialog', { name: 'Replace what is in the editor?' });
  await expect(confirm).toBeVisible();

  // Cancelling leaves the editor exactly as it was.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await closeDrawer(page);
  await expect(patternField(page)).toHaveText('something+else');

  await openDrawer(page);
  await drawer(page).getByRole('button', { name: 'Open /ab+c/g' }).click();
  await page.getByRole('button', { name: 'Open this entry' }).click();
  await expect(patternField(page)).toHaveText('ab+c');
});

test('an empty list says why it is empty', async ({ page }) => {
  await openDrawer(page);
  await expect(drawer(page).getByText(/saved here automatically/)).toBeVisible();

  await drawer(page)
    .getByRole('searchbox', { name: 'Search history' })
    .fill('nothing matches this');
  await expect(drawer(page).getByText(/No entries match/)).toBeVisible();
  await drawer(page).getByRole('searchbox', { name: 'Search history' }).fill('');

  await drawer(page).getByRole('button', { name: 'Pause saving' }).click();
  await expect(drawer(page).getByText(/History is paused/)).toBeVisible();
});
