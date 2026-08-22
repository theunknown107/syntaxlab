import { expect, test, type Page } from '@playwright/test';

import { awaitAnalysis, pressAnalyze } from './analyze';

/**
 * M10 — the accessibility tree.
 *
 * **This is not a screen-reader pass, and it is not offered as one.** No
 * screen reader is available in this environment (NVDA and JAWS are not
 * installed; Narrator exists but cannot be driven or heard from a
 * non-interactive shell), so §7's manual pass is recorded as NOT RUN.
 *
 * What this *is*: an audit of the data a screen reader reads. Every assertion
 * below is about the computed accessibility tree — the roles, names and
 * relationships the platform hands to assistive technology. It cannot tell us
 * how NVDA phrases something. It can tell us that a control has no name at
 * all, which is the defect class that actually ships.
 */

async function start(page: Page): Promise<void> {
  await page.goto('/');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();
}

/**
 * Roles that must always carry a name to be usable without sight.
 *
 * A control the tree exposes as a bare `button` is one an assistive-technology
 * user is told exists and cannot identify.
 */
const MUST_BE_NAMED = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'combobox',
  'slider',
  'textbox',
  'searchbox',
  'switch',
  'tab',
  'menuitem',
]);

/**
 * Every control in the accessibility tree that has no accessible name.
 *
 * Read from `ariaSnapshot()`, which is Playwright's current view of the
 * computed tree — `page.accessibility` was removed in 1.62. Lines look like
 * `- button "History"`, or `- 'button "Name: with a colon"'` when the name
 * forces the whole token to be quoted; an unnamed control is a bare `- button`.
 */
async function unnamedControls(page: Page): Promise<string[]> {
  const snapshot = await page.locator('body').ariaSnapshot();
  const unnamed: string[] = [];

  for (const line of snapshot.split('\n')) {
    const match = /^\s*-\s+'?([a-z]+)(.*)$/.exec(line);
    if (match === null) continue;
    const [, role = '', rest = ''] = match;
    if (!MUST_BE_NAMED.has(role)) continue;
    if (!rest.includes('"')) unnamed.push(line.trim());
  }
  return unnamed;
}

/** Every `role "name"` pair in the tree, for the assertions that need names. */
async function named(page: Page, role: string): Promise<string[]> {
  const snapshot = await page.locator('body').ariaSnapshot();
  return [...snapshot.matchAll(new RegExp(`${role} "([^"]*)"`, 'g'))].map(
    (match) => match[1] ?? '',
  );
}

test('every control in the regex workspace has an accessible name', async ({ page }) => {
  await start(page);
  await page.getByRole('textbox', { name: 'Regular expression' }).fill('^(a|b)+@\\w+$');
  await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('textbox', { name: 'Test string' }).fill('a@example');
  await expect(page.getByRole('region', { name: 'Matches' })).toBeVisible();

  expect(await unnamedControls(page)).toEqual([]);
});

test('every control in the JSON workspace has an accessible name', async ({ page }) => {
  await start(page);
  await page.getByRole('radio', { name: 'JSON' }).click();
  await page.getByRole('textbox', { name: 'JSON document' }).fill('{"a":{"b":[1,2]},"c":true}');
  // M15 made analysis explicit: filling the editor analyses nothing.
  await pressAnalyze(page, 'json');
  await expect(page.getByRole('tree', { name: 'JSON structure' })).toBeVisible({ timeout: 15_000 });

  expect(await unnamedControls(page)).toEqual([]);
});

test('the history drawer and its rows are all named', async ({ page }) => {
  await start(page);
  await page.getByRole('textbox', { name: 'Regular expression' }).fill('named-entry');
  await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(4000);

  await page.getByRole('button', { name: /^History/ }).click();
  await expect(page.getByRole('dialog', { name: 'History' })).toBeVisible();

  expect(await unnamedControls(page)).toEqual([]);
});

test('the appearance drawer is fully named, including the sliders', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: /^Appearance/ }).click();
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible();

  expect(await unnamedControls(page)).toEqual([]);

  // Sliders in particular: a range input with no label is a number nobody can
  // interpret. Both are checked by name because they are easy to miss.
  const names = await named(page, 'slider');
  expect(names.some((name) => /Intensity/i.test(name))).toBe(true);
  expect(names.some((name) => /Glow/i.test(name))).toBe(true);
});

test('the document has one main landmark and a first-level heading', async ({ page }) => {
  await start(page);

  // A screen-reader user navigates by landmark and heading before anything
  // else. Exactly one main, and a heading that says what this page is.
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('banner')).toHaveCount(1);

  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveCount(1);
  await expect(heading).toContainText('SyntaxLab');
});

test('the mode selector exposes its state, not just its styling', async ({ page }) => {
  await start(page);

  const regex = page.getByRole('radio', { name: 'Regex' });
  const json = page.getByRole('radio', { name: 'JSON' });
  await expect(regex).toHaveAttribute('aria-checked', 'true');
  await expect(json).toHaveAttribute('aria-checked', 'false');

  await json.click();
  await expect(json).toHaveAttribute('aria-checked', 'true');
  await expect(regex).toHaveAttribute('aria-checked', 'false');
});

test('status changes are announced politely, and errors are not silent', async ({ page }) => {
  await start(page);

  // The analysis result is a status region: it updates without stealing focus.
  await page.getByRole('textbox', { name: 'Regular expression' }).fill('(unclosed');
  const live = page.locator('[role="status"], [role="alert"], [aria-live]');
  await expect(live.first()).toBeAttached({ timeout: 15_000 });

  // And the error itself is readable text rather than a colour.
  await expect(page.getByText(/unclosed|missing|expected/i).first()).toBeVisible({
    timeout: 15_000,
  });
});

test('the explanation and the syntax tree are reachable as structures', async ({ page }) => {
  await start(page);
  await page.getByRole('textbox', { name: 'Regular expression' }).fill('^a(b|c)+$');
  await pressAnalyze(page, 'pattern');
  await awaitAnalysis(page);

  // Regions are how a screen-reader user jumps between the panes.
  const regions = await named(page, 'region');
  expect(regions.filter((name) => name.trim() !== '').length).toBeGreaterThanOrEqual(2);

  // The structure pane is a real tree, not a list of divs.
  await expect(page.getByRole('tree').first()).toBeAttached();
});
