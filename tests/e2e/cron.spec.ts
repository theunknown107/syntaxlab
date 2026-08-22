import { expect, test, type Page } from '@playwright/test';

/**
 * The cron workspace, end to end — M15
 *
 * Drives the real worker, the real parser and the real UI. What the unit
 * suites cannot show is that the whole path holds together: a refusal reaching
 * the screen with its hint intact, five rows surviving a bad field, and the
 * absence of everything M16 has not built yet.
 */

const editor = (page: Page) => page.getByRole('textbox', { name: 'Cron expression' });
const analyzeButton = (page: Page) => page.getByRole('button', { name: 'Analyze cron expression' });
const panel = (page: Page, name: string) => page.getByRole('region', { name }).first();

async function start(page: Page): Promise<void> {
  await page.goto('/');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await page.getByRole('radio', { name: 'Cron' }).click();
  await expect(editor(page)).toBeVisible();
}

async function analyse(page: Page, expression: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  if (expression === '') await page.keyboard.press('Backspace');
  else await page.keyboard.insertText(expression);
  await analyzeButton(page).click();
}

test.beforeEach(async ({ page }) => {
  await start(page);
});

/* ------------------------------------------------------------------ *
 * The core journey
 * ------------------------------------------------------------------ */

test('explains a five-field expression, with its fields and its warnings', async ({ page }) => {
  await analyse(page, '*/15 9-17 * * 1-5');

  await expect(panel(page, 'Explanation')).toContainText('every 15 minutes', { timeout: 15_000 });
  await expect(panel(page, 'Explanation')).toContainText('between 09:00 and 17:59');

  const fields = panel(page, 'Fields');
  await expect(fields.getByRole('row')).toHaveCount(6); // header plus five
  await expect(fields).toContainText('minute');
  await expect(fields).toContainText('day of the week');
});

test('spells out the day-of-month / day-of-week rule, which everyone reads wrong', async ({
  page,
}) => {
  await analyse(page, '0 0 1 * 1');

  // The single most valuable sentence this feature produces.
  await expect(panel(page, 'Explanation')).toContainText('either, not both', { timeout: 15_000 });
  await expect(panel(page, 'Explanation')).toContainText(/EITHER/);
});

test('loads a worked example and explains it without a second press', async ({ page }) => {
  await page.getByRole('button', { name: /Load example: A macro/ }).click();
  // CodeMirror is a contenteditable, not an input, so its content is text.
  await expect(editor(page)).toContainText('@weekly', { timeout: 10_000 });
  await expect(panel(page, 'Explanation')).toContainText('Sunday', { timeout: 15_000 });
});

/* ------------------------------------------------------------------ *
 * Refusals — the point of the dialect lock
 * ------------------------------------------------------------------ */

test('refuses six fields, and says what to try instead', async ({ page }) => {
  await analyse(page, '0 0 12 * * ?');

  await expect(page.getByText('Not analysed').first()).toBeVisible({ timeout: 15_000 });
  await expect(panel(page, 'Fields')).toContainText('6 fields');
  // A refusal that does not convert into a next step is a dead end.
  await expect(panel(page, 'Fields')).toContainText(/seconds/i);
});

test('refuses seven fields', async ({ page }) => {
  await analyse(page, '0 0 12 * * ? 2026');
  await expect(panel(page, 'Fields')).toContainText('7 fields', { timeout: 15_000 });
});

test('names the scheduler an unsupported symbol comes from', async ({ page }) => {
  await analyse(page, '0 0 L * *');
  await expect(panel(page, 'Explanation')).toContainText(/Quartz/, { timeout: 15_000 });

  await analyse(page, 'H/15 * * * *');
  await expect(panel(page, 'Explanation')).toContainText(/Jenkins/, { timeout: 15_000 });
});

test('keeps all five rows when one field is wrong, and says why in words', async ({ page }) => {
  await analyse(page, '99 12 * * *');

  const fields = panel(page, 'Fields');
  await expect(fields.getByRole('row')).toHaveCount(6, { timeout: 15_000 });
  // Not a colour alone.
  await expect(fields).toContainText(/out of range/i);
  // The fields that are fine are still explained.
  await expect(fields).toContainText('12');
});

/* ------------------------------------------------------------------ *
 * Explicit submission
 * ------------------------------------------------------------------ */

test('analyses nothing until asked, and says the editor has moved on', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.insertText('0 0 * * *');

  // Typing alone produces nothing.
  await page.waitForTimeout(2_000);
  await expect(panel(page, 'Fields')).toContainText(/press Analyze/i);

  await analyzeButton(page).click();
  await expect(panel(page, 'Explanation')).toContainText('00:00', { timeout: 15_000 });

  // Editing again keeps the previous answer and marks it.
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('0 0 * * 1');
  await expect(page.getByText('Unanalyzed changes')).toBeVisible();
  await expect(panel(page, 'Explanation')).toContainText('00:00');

  await analyzeButton(page).click();
  await expect(page.getByText('Unanalyzed changes')).toBeHidden({ timeout: 15_000 });
});

test('analyses from the keyboard with Ctrl or Cmd and Enter', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.insertText('30 4 * * *');
  await page.keyboard.press('ControlOrMeta+Enter');

  await expect(panel(page, 'Explanation')).toContainText('04:30', { timeout: 15_000 });
});

test('leaves plain Enter to the editor', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.insertText('0 0 * * *');
  await page.keyboard.press('Enter');

  // Enter is an editing key in every mode. Nothing was analysed.
  await page.waitForTimeout(1_500);
  await expect(panel(page, 'Fields')).toContainText(/press Analyze/i);
});

/* ------------------------------------------------------------------ *
 * Timezone
 * ------------------------------------------------------------------ */

test('shows which clock the times are read in, and offers exactly two', async ({ page }) => {
  await analyse(page, '0 3 * * *');
  await expect(panel(page, 'Explanation')).toContainText('03:00', { timeout: 15_000 });

  const radios = page.getByRole('radio', { name: /This browser|UTC/ });
  await expect(radios).toHaveCount(2);

  await page.getByRole('radio', { name: /UTC/ }).click();
  await expect(panel(page, 'Explanation')).toContainText(/UTC/, { timeout: 15_000 });
});

/* ------------------------------------------------------------------ *
 * What M15 must not have built
 * ------------------------------------------------------------------ */

test('computes no run times, and offers no named timezone', async ({ page }) => {
  await analyse(page, '*/15 9-17 * * 1-5');
  await expect(panel(page, 'Explanation')).toContainText('every 15 minutes', { timeout: 15_000 });

  // M16's work, and none of it may have leaked in early.
  await expect(page.getByText(/next run/i)).toHaveCount(0);
  await expect(page.getByRole('table', { name: /next|schedule/i })).toHaveCount(0);

  // No *selector* for a named zone. The resolved zone name is a different
  // thing and must be visible — invariant C-I1 is that a time never appears
  // without the clock it is read in, and "This browser (Asia/Calcutta)" is how
  // the user learns what was assumed on their behalf.
  await expect(page.getByRole('combobox')).toHaveCount(0);
  // Exactly two clock options, and neither is a zone list.
  const clocks = page.getByRole('radio', { name: /This browser|^UTC$/ });
  await expect(clocks).toHaveCount(2);
});

/* ------------------------------------------------------------------ *
 * Accessibility of the new surface
 * ------------------------------------------------------------------ */

test('is operable by keyboard alone, and every control is named', async ({ page }) => {
  await analyse(page, '*/15 9-17 * * 1-5');
  await expect(panel(page, 'Fields')).toContainText('minute', { timeout: 15_000 });

  const unnamed: string[] = [];
  for (const control of await page.getByRole('button').all()) {
    const name = (await control.getAttribute('aria-label')) ?? (await control.textContent()) ?? '';
    // Reported by its class, not its markup: reading HTML out of the page is a
    // sink this project bans even in tests (18_CODING_STANDARDS.md S2).
    if (name.trim() === '') unnamed.push((await control.getAttribute('class')) ?? '(no class)');
  }
  expect(unnamed, unnamed.join('\n')).toEqual([]);
});
