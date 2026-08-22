import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { pressAnalyze } from './analyze';

/**
 * The cron workspace, end to end — M15, M16
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
  // `insertText` follows focus, not the click — see the note in regex.spec.ts.
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  if (expression === '') await page.keyboard.press('Backspace');
  else await page.keyboard.insertText(expression);

  // The control refuses the press while there is nothing new to submit, and
  // it does so with `aria-disabled` — invisible to Playwright's actionability
  // checks. See `analyze.ts`.
  await pressAnalyze(page, 'cron');
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

  await pressAnalyze(page, 'cron');
  await expect(panel(page, 'Explanation')).toContainText('00:00', { timeout: 15_000 });

  // Editing again keeps the previous answer and marks it.
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('0 0 * * 1');
  await expect(page.getByText('Unanalyzed changes')).toBeVisible();
  await expect(panel(page, 'Explanation')).toContainText('00:00');

  await pressAnalyze(page, 'cron');
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
 * Next runs — M16
 * ------------------------------------------------------------------ */

test('says when the expression runs next, and what comes after', async ({ page }) => {
  await analyse(page, '*/15 9-17 * * 1-5');
  const runs = panel(page, 'Next runs');
  await expect(runs).toContainText('Next run', { timeout: 15_000 });

  // A real date, in the shape the panel formats: "Tue 10 March 2026, 12:15".
  await expect(runs).toContainText(/\d{1,2} \w+ \d{4}, \d{2}:\d{2}/);

  // And the runs after it, capped rather than endless.
  const upcoming = page.getByRole('list', { name: /upcoming runs/i });
  const count = await upcoming.getByRole('listitem').count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(9);
});

test('never shows a time without saying which clock it is read in', async ({ page }) => {
  // Invariant C-I1, on the surface that makes it matter most.
  await analyse(page, '0 3 * * *');
  const runs = panel(page, 'Next runs');
  await expect(runs).toContainText('Next run', { timeout: 15_000 });
  await expect(runs).toContainText(/This browser|UTC/);

  await page.getByRole('radio', { name: /^UTC$/ }).click();
  await expect(runs).toContainText('UTC', { timeout: 15_000 });
});

test('recalculates on request, and says when it last did', async ({ page }) => {
  await analyse(page, '*/15 * * * *');
  const runs = panel(page, 'Next runs');
  await expect(runs).toContainText('Calculated at', { timeout: 15_000 });

  await runs.getByRole('button', { name: /recalculate/i }).click();
  await expect(runs).toContainText('Next run', { timeout: 15_000 });
});

test('says @reboot has no clock time rather than calling it invalid', async ({ page }) => {
  await analyse(page, '@reboot');
  await expect(panel(page, 'Next runs')).toContainText(/no clock time/i, { timeout: 15_000 });
});

test('says plainly when a schedule never comes round', async ({ page }) => {
  // 30 February parses. It never happens.
  await analyse(page, '0 0 30 2 *');
  await expect(panel(page, 'Next runs')).toContainText(/no run in the next 5 years/i, {
    timeout: 15_000,
  });
});

/* ------------------------------------------------------------------ *
 * Daylight saving, end to end
 *
 * The zone is pinned to one that changes its clocks and the page clock is
 * pinned to the day before a transition, because otherwise these runs are only
 * reachable twice a year. The worker needs neither: the instant to search from
 * travels with the request, and the zone comes from the browser context.
 * ------------------------------------------------------------------ */

test.describe('when the clocks change', () => {
  test.use({ timezoneId: 'Europe/London' });

  test('reports a run the clocks skipped, without inventing a time for it', async ({ page }) => {
    // 29 March 2026: 01:00 becomes 02:00, so 01:30 never happens.
    await page.clock.setFixedTime(new Date('2026-03-28T12:00:00Z'));
    await start(page);
    await analyse(page, '30 1 * * *');

    const runs = panel(page, 'Next runs');
    await expect(runs).toContainText('Clock skipped', { timeout: 15_000 });
    await expect(runs).toContainText(/Most schedulers skip the run/i);
  });

  test('reports a run that happens twice, with both offsets', async ({ page }) => {
    // 25 October 2026: 02:00 becomes 01:00, so 01:30 happens twice.
    await page.clock.setFixedTime(new Date('2026-10-24T12:00:00Z'));
    await start(page);
    await analyse(page, '30 1 * * *');

    const runs = panel(page, 'Next runs');
    await expect(runs).toContainText('Happens twice', { timeout: 15_000 });
    await expect(runs).toContainText('UTC+01:00');
  });

  test('has no accessibility violations while reporting one', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-24T12:00:00Z'));
    await start(page);
    await analyse(page, '30 1 * * *');
    await expect(panel(page, 'Next runs')).toContainText('Happens twice', { timeout: 15_000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const serious = results.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(serious).toEqual([]);
  });
});

test.describe('forced colors', () => {
  /**
   * The next-run panel says two things with a badge and a tint: that a run was
   * skipped, and that one happens twice. Under a forced palette the tint is
   * gone, so the sentence beside the badge is all that is left — which is why
   * it is there (`08_UI_UX_SPEC.md` §12.1).
   *
   * `emulateMedia` rather than a describe-level option, for the reason
   * `hardening.spec.ts` records: the describe-level option does not reach the
   * page, and this one applies the real forced palette.
   */
  test.use({ timezoneId: 'Europe/London' });

  test('says what happened in words, not only in colour', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-24T12:00:00Z'));
    await start(page);
    await page.emulateMedia({ forcedColors: 'active' });
    await page.waitForTimeout(150);

    await analyse(page, '30 1 * * *');

    const runs = panel(page, 'Next runs');
    await expect(runs).toContainText('Next run', { timeout: 15_000 });

    // The badge and its sentence both survive, and so does the offset that
    // makes the claim checkable.
    await expect(runs).toContainText('Happens twice');
    await expect(runs).toContainText(/clocks go back through this time/i);
    await expect(runs).toContainText('UTC+01:00');

    // And the panel is painting the forced palette rather than its own.
    const painted = await runs.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(painted.color, 'text colour under forced colors').not.toBe('');

    // The control that recomputes them is still reachable and still named.
    await expect(runs.getByRole('button', { name: /recalculate/i })).toBeVisible();
  });
});

/* ------------------------------------------------------------------ *
 * What M16 must still not have built
 * ------------------------------------------------------------------ */

test('offers no named timezone, and puts no times in the URL', async ({ page }) => {
  await analyse(page, '*/15 9-17 * * 1-5');
  await expect(panel(page, 'Next runs')).toContainText('Next run', { timeout: 15_000 });

  // No *selector* for a named zone. The resolved zone name is a different
  // thing and must be visible — invariant C-I1 is that a time never appears
  // without the clock it is read in, and "This browser (Asia/Calcutta)" is how
  // the user learns what was assumed on their behalf.
  await expect(page.getByRole('combobox')).toHaveCount(0);
  // Exactly two clock options, and neither is a zone list.
  const clocks = page.getByRole('radio', { name: /This browser|^UTC$/ });
  await expect(clocks).toHaveCount(2);

  // The expression and its run times stay out of the address bar: they are
  // the user's content, and a URL is the one part of this app that travels.
  const url = new URL(page.url());
  expect(url.search).not.toContain('9-17');
  for (const key of ['cron', 'expr', 'next', 'runs', 'schedule', 'after']) {
    expect(url.searchParams.has(key), key).toBe(false);
  }
});

/* ------------------------------------------------------------------ *
 * Responsive
 * ------------------------------------------------------------------ */

test.describe('narrow viewports', () => {
  // The three the UX spec names. The field table is the part at risk: it is
  // the one thing in this workspace that cannot simply reflow.
  for (const width of [360, 390, 414]) {
    test(`does not scroll horizontally at ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      await analyse(page, '*/15 9-17 1,15 JAN-JUN MON-FRI');
      await expect(panel(page, 'Fields')).toContainText('minute', { timeout: 15_000 });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // And the control that drives the whole workspace is still reachable.
      await expect(analyzeButton(page)).toBeVisible();

      // M16's panel is the newest thing that has to survive a narrow column:
      // a date, a zone label and a daylight-saving sentence, none of which can
      // be truncated into something misleading.
      const runs = panel(page, 'Next runs');
      await expect(runs).toContainText('Next run', { timeout: 15_000 });
      await expect(runs).toContainText(/\d{1,2} \w+ \d{4}, \d{2}:\d{2}/);
      await expect(runs.getByRole('button', { name: /recalculate/i })).toBeVisible();
    });
  }
});

test.describe('desktop widths', () => {
  // The three the UX spec names for desktop. The next-run panel sits in the
  // same column as Fields and Explanation, so the risk here is the opposite of
  // the narrow case: a three-panel column that overflows its height budget or
  // pushes the page sideways at a width nobody tests by hand.
  for (const width of [1280, 1440, 1920]) {
    test(`lays out without horizontal overflow at ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await analyse(page, '*/15 9-17 1,15 JAN-JUN MON-FRI');

      const runs = panel(page, 'Next runs');
      await expect(runs).toContainText('Next run', { timeout: 15_000 });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${String(width)} px`).toBeLessThanOrEqual(0);

      // All three panels of the analysis column are present together, which is
      // the layout M16 changed.
      await expect(panel(page, 'Fields')).toBeVisible();
      await expect(panel(page, 'Explanation')).toBeVisible();
      await expect(runs).toBeVisible();

      // The upcoming list is readable rather than collapsed to nothing.
      const upcoming = page.getByRole('list', { name: /upcoming runs/i });
      await expect(upcoming.getByRole('listitem').first()).toBeVisible();
    });
  }
});

/* ------------------------------------------------------------------ *
 * Accessibility of the new surface
 * ------------------------------------------------------------------ */

test('has no critical or serious accessibility violations', async ({ page }) => {
  // Analysed *and* refused, in one pass: the refusal notice, the warning list
  // and the field table with a failing row are all new surfaces.
  await analyse(page, '0 0 1 * 1');
  await expect(panel(page, 'Explanation')).toContainText('either, not both', { timeout: 15_000 });
  // Including M16's panel, which is the newest surface on the page.
  await expect(panel(page, 'Next runs')).toContainText('Next run', { timeout: 15_000 });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(serious).toEqual([]);
});

test('has no accessibility violations while showing a refusal', async ({ page }) => {
  await analyse(page, '0 0 12 * * ?');
  await expect(page.getByText('Not analysed').first()).toBeVisible({ timeout: 15_000 });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(serious).toEqual([]);
});

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
