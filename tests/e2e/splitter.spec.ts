import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The workspace splitter — 08_UI_UX_SPEC.md §5
 *
 * Specified since M1, built at M11. What matters is not that it moves, but
 * that it cannot be used to lose the interface and that it is operable without
 * a mouse — a divider is one of the easiest controls to ship mouse-only.
 */

const separator = (page: Page) => page.getByRole('separator', { name: /Resize/ });

async function start(page: Page): Promise<void> {
  await page.goto('/');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();
}

/** The grid's resolved first-column width, in pixels. */
async function leftWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const row = document.querySelector('[role="separator"]')?.parentElement;
    if (!row) return 0;
    return Number.parseFloat(getComputedStyle(row).gridTemplateColumns.split(' ')[0] ?? '0');
  });
}

test('drags to resize, and both panels survive it', async ({ page }) => {
  await start(page);
  const before = await leftWidth(page);
  expect(before).toBeGreaterThan(0);

  const box = await separator(page).boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width, height } = box!;

  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.down();
  await page.mouse.move(x + width / 2 + 200, y + height / 2, { steps: 10 });
  await page.mouse.up();

  const after = await leftWidth(page);
  expect(after).toBeGreaterThan(before + 100);

  // Neither panel may be dragged away, whatever the pointer did.
  await expect(page.getByRole('region', { name: 'Pattern' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible();
});

test('cannot be dragged far enough to close either panel', async ({ page }) => {
  await start(page);
  const box = (await separator(page).boundingBox())!;

  // Well past the left edge of the viewport, then well past the right.
  for (const target of [-2_000, 5_000]) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();

    await expect(page.getByRole('region', { name: 'Pattern' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible();
    // 25–75%, enforced in the store rather than only in CSS.
    const value = Number(await separator(page).getAttribute('aria-valuenow'));
    expect(value).toBeGreaterThanOrEqual(25);
    expect(value).toBeLessThanOrEqual(75);
  }
});

test('is operable from the keyboard alone', async ({ page }) => {
  await start(page);
  const handle = separator(page);
  await handle.focus();
  await expect(handle).toBeFocused();

  const start_ = Number(await handle.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBe(start_ + 4);

  await page.keyboard.press('ArrowLeft');
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBe(start_ + 2);

  await page.keyboard.press('Home');
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBe(25);
  await page.keyboard.press('End');
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBe(75);

  // Enter is the keyboard equivalent of the double-click reset.
  await page.keyboard.press('Enter');
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBe(45);
});

test('remembers the position across a reload, and in both modes', async ({ page }) => {
  await start(page);
  await separator(page).focus();
  await page.keyboard.press('End');

  await page.reload();
  expect(Number(await separator(page).getAttribute('aria-valuenow'))).toBe(75);

  await page.getByRole('radio', { name: 'JSON' }).click();
  expect(Number(await separator(page).getAttribute('aria-valuenow'))).toBe(75);
  await expect(
    page
      .getByRole('region', { name: 'Document' })
      .or(page.getByRole('region', { name: /JSON/ }))
      .first(),
  ).toBeVisible();
});

test('is not present when the layout stacks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);

  // Removed from the box tree by CSS, which removes it from the accessibility
  // tree as well: a separator with nothing to separate is noise.
  await expect(separator(page)).toBeHidden();
});

test('a corrupt stored value cannot break the layout', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'syntaxlab.settings.v1',
      JSON.stringify({ historyEnabled: true, splitPercent: 'DROP TABLE' }),
    );
  });
  await start(page);

  expect(Number(await separator(page).getAttribute('aria-valuenow'))).toBe(45);
  await expect(page.getByRole('region', { name: 'Pattern' })).toBeVisible();
});

test('has no accessibility violations', async ({ page }) => {
  await start(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
  ).toEqual([]);
});
