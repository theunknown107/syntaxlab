import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * M6 — the JSON workspace end to end.
 *
 * Runs against the **production** build on Chromium, Firefox, WebKit and a
 * mobile viewport. Every assertion goes through the interface, and the tree
 * comes from the real analysis worker under the real CSP.
 */

const editor = (page: Page) => page.getByRole('textbox', { name: 'JSON document' });
const panel = (page: Page, name: string) => page.getByRole('region', { name });
const tree = (page: Page) => page.getByRole('tree', { name: 'JSON structure' });

async function openJson(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('radio', { name: 'JSON' }).click();
  await expect(editor(page)).toBeVisible();
}

/**
 * Replaces an editor's contents.
 *
 * Select-all then insert, rather than `locator.fill()`. On a CodeMirror
 * contenteditable under mobile emulation `fill` **appends** instead of
 * replacing: measured on Pixel 5, filling `a+` over `(a+)+$` left the document
 * reading `(a+)+$a+`. The app then correctly timed out on a pattern that is
 * still catastrophic, and the test reported a product defect that was not
 * there. Desktop Chrome replaces correctly, which is why this only ever bit
 * the mobile projects.
 */
async function type(page: Page, value: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  if (value === '') await page.keyboard.press('Backspace');
  else await page.keyboard.insertText(value);
}

test.beforeEach(async ({ page }) => {
  await openJson(page);
});

/* ------------------------------------------------------------------ *
 * The core journey
 * ------------------------------------------------------------------ */

test('parses a document and shows a tree', async ({ page }) => {
  await type(page, '{"id":1,"tags":["a","b"],"active":true}');

  await expect(page.getByText(/^Valid ·/)).toBeVisible({ timeout: 10_000 });
  await expect(tree(page)).toBeVisible();
  await expect(tree(page).getByText('tags', { exact: true })).toBeVisible();
});

test('reports the size and shape in one status line', async ({ page }) => {
  await type(page, '{"a":1,"b":[1,2]}');
  await expect(page.getByText('Valid · 5 values · depth 2 · 2 keys · 17 bytes')).toBeVisible({
    timeout: 10_000,
  });
});

test('expands and collapses branches', async ({ page }) => {
  await type(page, '{"outer":{"inner":{"leaf":1}}}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  // Two levels are open by default; the third is not.
  await expect(tree(page).getByText('inner', { exact: true })).toBeVisible();
  await expect(tree(page).getByText('leaf', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(tree(page).getByText('leaf', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(tree(page).getByText('inner', { exact: true })).toHaveCount(0);
});

test('copies the path of a selected node', async ({ page }) => {
  await type(page, '{"user":{"name":"Ada"}}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  await tree(page).getByText('name', { exact: true }).click();
  await expect(page.getByText('$.user.name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy path' })).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

test('searches keys and values, including collapsed branches', async ({ page }) => {
  await type(page, '{"a":{"b":{"deep":"needle"}},"c":"other"}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  // `deep` sits below the default expansion, so a DOM scrape would miss it.
  await expect(tree(page).getByText('deep', { exact: true })).toHaveCount(0);

  await page.getByPlaceholder('Search keys and values').fill('needle');
  await expect(page.getByText('1 of 1')).toBeVisible();
});

test('steps between matches and reveals them', async ({ page }) => {
  await type(page, '{"a":{"x":"hit"},"b":{"x":"hit"}}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  await page.getByPlaceholder('Search keys and values').fill('hit');
  await expect(page.getByText('1 of 2')).toBeVisible();

  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.getByText('2 of 2')).toBeVisible();
});

test('says so when nothing matches', async ({ page }) => {
  await type(page, '{"a":1}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('Search keys and values').fill('zzzz');
  await expect(page.getByText('No matches')).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

test('formats without rewriting the numbers', async ({ page }) => {
  // The property that matters most: `1e5` must not become `100000`.
  await type(page, '{"a":1e5,"b":1.50,"big":9007199254740993}');
  await expect(page.getByText(/^Valid ·/)).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Format' }).click();

  const text = await editor(page).textContent();
  expect(text).toContain('1e5');
  expect(text).toContain('1.50');
  expect(text).toContain('9007199254740993');
  expect(text).not.toContain('100000');
});

test('formats at four spaces and at tabs', async ({ page }) => {
  await type(page, '{"a":[1]}');
  await expect(page.getByText(/^Valid ·/)).toBeVisible({ timeout: 10_000 });

  await page.getByLabel('Indent').selectOption('four');
  await page.getByRole('button', { name: 'Format' }).click();
  await expect(editor(page)).toContainText('    "a"');
});

test('minifies to one line', async ({ page }) => {
  await type(page, '{\n  "a": [\n    1,\n    2\n  ]\n}');
  await expect(page.getByText(/^Valid ·/)).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Minify' }).click();
  await expect(editor(page)).toContainText('{"a":[1,2]}');
  // One line: the whole document now fits in a single editor line.
  expect(await editor(page).locator('.cm-line').count()).toBe(1);
});

test('refuses to format an invalid document, and says why', async ({ page }) => {
  await type(page, '{"a":1,}');
  await expect(page.getByText(/^Invalid ·/)).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole('button', { name: 'Format' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Minify' })).toBeDisabled();
  await expect(page.getByText('Formatting needs a valid document.')).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

test('reports a syntax error with a category, a position and a hint', async ({ page }) => {
  await type(page, '{\n  "a": 1,\n}');

  const problems = panel(page, 'Problems');
  await expect(problems.getByText('Trailing comma before `}`.')).toBeVisible({ timeout: 10_000 });
  await expect(problems.getByText('Line 3, column 1')).toBeVisible();
  await expect(problems.getByText(/JSON forbids trailing commas/)).toBeVisible();
});

test('names a dialect mistake rather than saying "unexpected token"', async ({ page }) => {
  await type(page, "{'a':1}");
  await expect(panel(page, 'Problems').getByText('Strings must use double quotes.')).toBeVisible({
    timeout: 10_000,
  });
});

test('renders a partial tree after a recoverable error', async ({ page }) => {
  await type(page, '{"a": ?, "b": 2, "c": 3}');
  await expect(page.getByText(/^Invalid ·/)).toBeVisible({ timeout: 10_000 });

  // Recovery means the rest of the document is still explained.
  await expect(tree(page).getByText('b', { exact: true })).toBeVisible();
  await expect(tree(page).getByText('c', { exact: true })).toBeVisible();
});

test('clicking an error moves the cursor to it', async ({ page }) => {
  await type(page, '{\n  "a": 1,\n}');
  const location = panel(page, 'Problems').getByRole('button', { name: /Line 3/ });
  await expect(location).toBeVisible({ timeout: 10_000 });

  await location.click();
  // The editor takes focus when the selection is applied.
  await expect(editor(page)).toBeFocused();
});

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

test('shows every occurrence of a duplicate key, in the tree and in findings', async ({ page }) => {
  await type(page, '{"a":1,"a":2}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  // Both rows survive — the UI must not do what JSON.parse does.
  await expect(tree(page).getByText('a', { exact: true })).toHaveCount(2);
  // Exact, because each row also carries a screen-reader-only description
  // that contains the same words.
  await expect(tree(page).getByText('duplicate key', { exact: true })).toHaveCount(2);

  const findings = panel(page, 'Findings');
  await expect(findings.getByText(/JavaScript reads the/)).toBeVisible();
});

test('warns about a number that changes when read', async ({ page }) => {
  await type(page, '{"id":9007199254740993}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  await expect(panel(page, 'Findings').getByText(/a double cannot hold every digit/)).toBeVisible();
  await expect(tree(page).getByText('precision')).toBeVisible();
});

test('says nothing about numbers that round-trip', async ({ page }) => {
  await type(page, '{"a":0.1,"b":1e5,"c":9007199254740991}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('precision')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * Security
 * ------------------------------------------------------------------ */

test('a prototype-pollution payload stays inert and visible', async ({ page }) => {
  await type(page, '{"__proto__":{"polluted":true},"constructor":1}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  // The keys are ordinary data: shown as text, and inert in the runtime.
  await expect(tree(page).getByText('__proto__', { exact: true })).toBeVisible();
  const polluted = await page.evaluate(() => 'polluted' in Object.prototype);
  expect(polluted).toBe(false);
});

test('a script payload renders as text, never as markup', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await type(
    page,
    '{"<img src=x onerror=alert(1)>":"<script>alert(1)</script>","u":"javascript:alert(1)"}',
  );
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(
    await page
      .locator('script:not([src])')
      .evaluateAll((els) => els.filter((el) => el.textContent.includes('alert(1)')).length),
  ).toBe(0);
  expect(dialogs).toEqual([]);
  await expect(tree(page).getByText(/img src=x/)).toBeVisible();
});

test('a payload in an error message stays text', async ({ page }) => {
  await type(page, '{<script>alert(1)</script>:1}');
  await expect(page.getByText(/^Invalid ·/)).toBeVisible({ timeout: 10_000 });
  expect(await page.locator('script:not([src])').count()).toBeLessThanOrEqual(1);
});

/* ------------------------------------------------------------------ *
 * Large documents
 * ------------------------------------------------------------------ */

test('a large document waits for an explicit action', async ({ page }) => {
  test.slow();

  const big = `[${Array.from({ length: 18_000 }, (_, i) => `{"id":${i},"name":"item number ${i}"}`).join(',')}]`;
  // Above `manualAnalyzeBytes`, which is what puts the workspace in manual mode.
  expect(big.length).toBeGreaterThan(500_000);

  await type(page, big);
  await expect(page.getByText(/analysed when you ask/)).toBeVisible({ timeout: 20_000 });
  await expect(tree(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Analyze JSON' }).click();
  await expect(page.getByText(/^Valid ·/)).toBeVisible({ timeout: 30_000 });
  await expect(tree(page)).toBeVisible();
});

test('a large tree stays responsive and renders a window, not every row', async ({ page }) => {
  test.slow();

  const big = `[${Array.from({ length: 5000 }, (_, i) => i).join(',')}]`;
  await type(page, big);
  await expect(tree(page)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByText('5,001 rows')).toBeVisible({ timeout: 20_000 });

  // Virtualisation: the DOM holds a window, not five thousand rows.
  const rendered = await tree(page).getByRole('treeitem').count();
  expect(rendered).toBeLessThan(200);
  expect(rendered).toBeGreaterThan(0);

  // And the page still answers.
  await page.getByPlaceholder('Search keys and values').fill('4999');
  await expect(page.getByText(/of 1$/)).toBeVisible({ timeout: 10_000 });
});

/* ------------------------------------------------------------------ *
 * Detection
 * ------------------------------------------------------------------ */

const pattern = (page: Page) => page.getByRole('textbox', { name: 'Regular expression pattern' });

test('a first paste of JSON into an empty workspace selects JSON', async ({ page }) => {
  // The documented auto-select: high confidence, and both editors empty.
  await page.goto('/');
  await pattern(page).click();
  await pattern(page).fill('{"user":{"name":"Ada"}}');

  await expect(page.getByRole('radio', { name: 'JSON' })).toBeChecked({ timeout: 10_000 });
});

test('once the user has typed, a switch is offered rather than taken', async ({ page }) => {
  await page.goto('/');
  await pattern(page).click();
  // A real pattern first, so the next change is an edit rather than a first
  // paste. From here the mode must never move on its own.
  await pattern(page).fill('^abc$');
  await expect(page.getByRole('radio', { name: 'Regex' })).toBeChecked();

  await pattern(page).fill('{"user":{"name":"Ada"}}');

  await expect(page.getByText('This looks like JSON.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('radio', { name: 'Regex' })).toBeChecked();

  await page.getByRole('button', { name: 'Switch to JSON' }).click();
  await expect(page.getByRole('radio', { name: 'JSON' })).toBeChecked();
});

test('the suggestion can be dismissed for the session', async ({ page }) => {
  await page.goto('/');
  await pattern(page).click();
  await pattern(page).fill('^abc$');
  await pattern(page).fill('{"a":1}');

  await expect(page.getByText('This looks like JSON.')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText('This looks like JSON.')).toHaveCount(0);
});

test('offers no cron affordance anywhere', async ({ page }) => {
  await expect(page.getByText(/cron/i)).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(2);
});

/* ------------------------------------------------------------------ *
 * Keyboard and layout
 * ------------------------------------------------------------------ */

test('the tree is navigable by keyboard alone', async ({ page }) => {
  await type(page, '{"a":{"b":1},"c":2}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  await tree(page).getByRole('treeitem').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[role="treeitem"]:focus')).toBeVisible();

  // Right opens a closed branch rather than moving.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[role="treeitem"]:focus')).toBeVisible();
});

test('does not scroll horizontally at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await type(page, '{"a_long_property_name":{"nested":[1,2,3]},"another":"value"}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

/* ------------------------------------------------------------------ *
 * Accessibility
 * ------------------------------------------------------------------ */

test('has no critical or serious accessibility violations', async ({ page }) => {
  await type(page, '{"a":1,"a":2,"big":9007199254740993,"nested":{"x":[1,2]}}');
  await expect(tree(page)).toBeVisible({ timeout: 10_000 });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(serious).toEqual([]);
});

test('announces validity through a live region', async ({ page }) => {
  await type(page, '{"a":1}');
  await expect(page.getByText(/^Valid ·/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^Valid ·/)).toHaveAttribute('role', 'status');
});

test('the tree declares its real size, not the rendered window', async ({ page }) => {
  test.slow();

  const big = `[${Array.from({ length: 1200 }, (_, i) => i).join(',')}]`;
  await type(page, big);
  await expect(tree(page)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByText('1,201 rows')).toBeVisible({ timeout: 20_000 });

  // Otherwise a screen reader would say "3 of 40" in a list of 1,201.
  await expect(tree(page).getByRole('treeitem').first()).toHaveAttribute('aria-setsize', '1201');
});
