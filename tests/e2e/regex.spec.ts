import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { pressAnalyze } from './analyze';

/**
 * M4 — the regex workspace end to end.
 *
 * Runs against the **production** build on Chromium, Firefox, WebKit and a
 * mobile viewport. Nothing here uses a development harness or reaches into
 * application state: every assertion goes through the interface, and the
 * results come from the real workers under the real CSP.
 *
 * Engine coverage is not ceremony. Execution runs in the browser's own regex
 * engine and is stopped by terminating a thread, and both of those are
 * engine-level behaviours that cannot be inferred from one browser.
 */

const pattern = (page: Page) => page.getByRole('textbox', { name: 'Regular expression pattern' });
const subject = (page: Page) => page.getByRole('textbox', { name: 'Test string' });

/** Panels are landmarks with an accessible name, so assertions can be scoped
 *  to one rather than searching the whole page. */
const panel = (page: Page, name: string) => page.getByRole('region', { name });

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
/**
 * Puts text in an editor and, for the pattern, asks for it to be analysed.
 *
 * From M15 typing analyses nothing, so a helper that only typed would leave
 * every caller asserting against a panel that was never asked to update. The
 * test string is deliberately excluded: the tester is live and runs against
 * the committed pattern, which is the behaviour under test.
 */
async function type(page: Page, target: 'pattern' | 'subject', value: string): Promise<void> {
  const editor = target === 'pattern' ? pattern(page) : subject(page);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  if (value === '') await page.keyboard.press('Backspace');
  else await page.keyboard.insertText(value);
  if (target === 'pattern') await analyze(page);
}

/** Presses Analyze when there is something to analyse. */
async function analyze(page: Page): Promise<void> {
  await pressAnalyze(page, 'pattern');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/* ------------------------------------------------------------------ *
 * The core journey
 * ------------------------------------------------------------------ */

test('explains a pattern typed into the editor', async ({ page }) => {
  await type(page, 'pattern', '^[A-Z][a-z]+$');

  const explanation = panel(page, 'Explanation');
  await expect(explanation).toContainText('start of the string', { timeout: 10_000 });
  await expect(explanation).toContainText('any character from A to Z');
  await expect(explanation).toContainText('one or more');
});

test('finds matches in a test string and shows capture groups', async ({ page }) => {
  await type(page, 'pattern', '(\\w+)@(\\w+)');
  await type(page, 'subject', 'ada@example and grace@navy');

  const matches = panel(page, 'Matches');
  await expect(matches.getByText('2 matches')).toBeVisible({ timeout: 10_000 });

  // Group values, not only the whole match.
  await expect(matches.getByText('ada', { exact: true })).toBeVisible();
  await expect(matches.getByText('example', { exact: true })).toBeVisible();
  await expect(matches.getByText('grace', { exact: true })).toBeVisible();
});

test('reports a named group under its name', async ({ page }) => {
  await type(page, 'pattern', '(?<year>\\d{4})');
  await type(page, 'subject', 'shipped in 2026');

  const matches = panel(page, 'Matches');
  await expect(matches.getByText('1 match')).toBeVisible({ timeout: 10_000 });
  await expect(matches.getByText('year', { exact: true })).toBeVisible();

  // Three: the whole match, capture group 1, and the named view of the same
  // group. The engine exposes numbered and named captures separately and so
  // do we, rather than merging them on a guess about which is which.
  await expect(matches.getByText('2026', { exact: true })).toHaveCount(3);
});

test('says so plainly when nothing matches', async ({ page }) => {
  await type(page, 'pattern', 'zzz');
  await type(page, 'subject', 'nothing here');

  await expect(panel(page, 'Matches').getByText('No matches.')).toBeVisible({ timeout: 10_000 });
});

test('searches only for the first match without the g flag', async ({ page }) => {
  await page.getByRole('button', { name: /Global/ }).click();
  await type(page, 'pattern', 'a');
  await type(page, 'subject', 'aaa');

  const matches = panel(page, 'Matches');
  await expect(matches.getByText('1 match')).toBeVisible({ timeout: 10_000 });
  await expect(matches.getByText(/Turn on the/)).toBeVisible();
});

test('reports a zero-length match rather than an empty row', async ({ page }) => {
  await type(page, 'pattern', 'x*');
  await type(page, 'subject', 'ab');

  await expect(panel(page, 'Matches').getByText('empty match').first()).toBeVisible({
    timeout: 10_000,
  });
});

/* ------------------------------------------------------------------ *
 * Flags
 * ------------------------------------------------------------------ */

test('a flag change waits to be analysed, then re-runs the match', async ({ page }) => {
  await type(page, 'pattern', 'abc');
  await type(page, 'subject', 'ABC');
  const matches = panel(page, 'Matches');
  await expect(matches.getByText('No matches.')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: /Ignore case/ }).click();

  // M15: a flag change is an edit. Both panels wait rather than repainting —
  // a match list that updated here would look fresh while describing a flag
  // set the user can no longer see selected.
  await expect(page.getByText('Unanalyzed changes')).toBeVisible();
  await expect(matches.getByText('No matches.')).toBeVisible();

  await pressAnalyze(page, 'pattern');
  await expect(matches.getByText('1 match')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Unanalyzed changes')).toBeHidden();
});

test('u and v are never both active', async ({ page }) => {
  const unicode = page.getByRole('button', { name: /^Unicode:/ });
  const unicodeSets = page.getByRole('button', { name: /Unicode sets/ });

  await unicode.click();
  await expect(unicode).toHaveAttribute('aria-pressed', 'true');

  await unicodeSets.click();
  await expect(unicodeSets).toHaveAttribute('aria-pressed', 'true');
  await expect(unicode).toHaveAttribute('aria-pressed', 'false');
});

/* ------------------------------------------------------------------ *
 * Errors, warnings, dialects
 * ------------------------------------------------------------------ */

test('reports an invalid pattern and pauses the tester', async ({ page }) => {
  await type(page, 'pattern', '(unclosed');
  await type(page, 'subject', 'anything');

  await expect(panel(page, 'Matches').getByText('Pattern is not valid')).toBeVisible({
    timeout: 10_000,
  });
});

test('recognises a foreign dialect and says which one', async ({ page }) => {
  // Python's named-group syntax. The corrective hint is the whole point: a
  // silent parse failure would teach the user nothing (risk R-21).
  await type(page, 'pattern', '(?P<name>\\w+)');

  await expect(page.getByRole('heading', { name: /Warnings/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Python/i).first()).toBeVisible();
});

test('warns about a pattern that may be slow, before it is run', async ({ page }) => {
  await type(page, 'pattern', '(a+)+b');

  await expect(page.getByText('May be slow').first()).toBeVisible({ timeout: 10_000 });
});

/* ------------------------------------------------------------------ *
 * Timeout and recovery — the security-critical path
 * ------------------------------------------------------------------ */

/**
 * A subject that makes `(a+)+$` exceed the two-second budget.
 *
 * 40 rather than 32 because engines differ by a large constant factor:
 * JavaScriptCore backtracks roughly five times faster than V8 per step. The
 * cost doubles per character, and the worker is destroyed at two seconds
 * regardless of how far it got, so the extra length costs nothing.
 */
const CATASTROPHIC_SUBJECT = `${'a'.repeat(40)}!`;

/**
 * **WebKit cannot be made to time out by a pattern**, so the three tests below
 * do not run there.
 *
 * Measured during M4 rather than assumed: in JavaScriptCore, `(a+)+$` takes a
 * flat ~420 ms whether the subject is 28 characters or 40, and `^(a|a?)+$`
 * takes a flat ~1.7 s from 40 characters to 1 000. A flat curve where V8 and
 * SpiderMonkey are exponential means JSC bounds its own backtracking and
 * returns rather than continuing — there is no input that makes it run long
 * enough for our deadline to fire.
 *
 * This is skipped rather than weakened, and it does not leave the invariant
 * untested on WebKit. M2 proved termination there against `exec.spin`, a
 * busy loop that genuinely cannot yield, which is a stronger condition than
 * any regex produces. What cannot be demonstrated on WebKit is this specific
 * *cause*, and `completes rather than hanging` below asserts what WebKit does
 * instead.
 */
const NO_TIMEOUT_ON_WEBKIT =
  'JavaScriptCore bounds its own backtracking, so no pattern reaches the deadline. M2 proves termination on WebKit against a non-yielding busy loop instead.';

test('completes a catastrophic pattern rather than hanging, on any engine', async ({ page }) => {
  test.slow();

  await type(page, 'pattern', '(a+)+$');
  await type(page, 'subject', CATASTROPHIC_SUBJECT);

  // Either outcome is correct and both are bounded: the engine finishes, or
  // the worker is destroyed at the deadline. What must never happen is the
  // page becoming unresponsive, which is what this asserts by continuing to
  // drive it afterwards.
  const matches = panel(page, 'Matches');
  await expect(
    matches.getByText('Timed out', { exact: true }).or(matches.getByText('No matches.')),
  ).toBeVisible({ timeout: 20_000 });

  await type(page, 'pattern', 'a+');
  await expect(matches.getByText('1 match')).toBeVisible({ timeout: 15_000 });
});

test('times out a catastrophic pattern and keeps the page responsive', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', NO_TIMEOUT_ON_WEBKIT);
  test.slow();

  await type(page, 'pattern', '(a+)+$');
  await type(page, 'subject', CATASTROPHIC_SUBJECT);

  await expect(panel(page, 'Matches').getByText('Timed out', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Execution timed out after 2 seconds/)).toBeVisible();

  // Never blames the user's pattern for something it has not proven.
  await expect(page.getByText(/malicious/i)).toHaveCount(0);

  // The main thread kept running throughout: the explanation for the same
  // pattern is on screen, produced by the untouched analysis worker.
  await expect(page.getByRole('heading', { name: 'Explanation' })).toBeVisible();
});

test('recovers after a timeout — the next pattern runs normally', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', NO_TIMEOUT_ON_WEBKIT);
  test.slow();

  await type(page, 'pattern', '(a+)+$');
  await type(page, 'subject', CATASTROPHIC_SUBJECT);
  await expect(panel(page, 'Matches').getByText('Timed out', { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // The worker was destroyed. A replacement must serve this without a reload.
  await type(page, 'pattern', 'a+');
  await expect(panel(page, 'Matches').getByText('1 match')).toBeVisible({ timeout: 15_000 });
});

test('survives two timeouts in a row', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', NO_TIMEOUT_ON_WEBKIT);
  test.slow();

  for (const suffix of ['!', '?']) {
    await type(page, 'pattern', '(a+)+$');
    await type(page, 'subject', `${'a'.repeat(40)}${suffix}`);
    await expect(panel(page, 'Matches').getByText('Timed out', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
  }

  await type(page, 'pattern', 'b');
  await type(page, 'subject', 'b');
  await expect(panel(page, 'Matches').getByText('1 match')).toBeVisible({ timeout: 15_000 });
});

/* ------------------------------------------------------------------ *
 * Security
 * ------------------------------------------------------------------ */

test('renders a script payload in a pattern as text, never as markup', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await type(page, 'pattern', '<img src=x onerror=alert\\(1\\)>');
  await type(page, 'subject', '<img src=x onerror=alert(1)>');

  await expect(panel(page, 'Matches').getByText('1 match')).toBeVisible({ timeout: 10_000 });

  // The payload appears as content and creates no element.
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(dialogs).toEqual([]);
});

test('rejects a paste over the pattern limit instead of truncating it', async ({ page }) => {
  await type(page, 'pattern', 'a'.repeat(200));
  await expect(page.getByText('200 / 10,000 characters')).toBeVisible();

  // The editor refuses the transaction, so the document never grows past the
  // limit — a silently truncated pattern would be one the user did not write.
  await type(page, 'pattern', 'b'.repeat(10_001));
  await expect(page.getByText('200 / 10,000 characters')).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * Interaction and layout
 * ------------------------------------------------------------------ */

test('loads a worked example with a pattern and a test string', async ({ page }) => {
  await page.getByLabel('Example').selectOption('ipv4');

  await expect(page.getByText(/Hosts 192\.168\.0\.14/)).toBeVisible({ timeout: 10_000 });

  // Three, not two: the example deliberately includes 999.1.1.1, which has the
  // shape of an address without being one. That is the lesson the example
  // teaches, and asserting it stops the example quietly drifting.
  await expect(panel(page, 'Matches').getByText('3 matches')).toBeVisible();
});

test('clears the workspace', async ({ page }) => {
  await type(page, 'pattern', 'abc');
  await expect(page.getByText('3 / 10,000 characters')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('0 / 10,000 characters')).toBeVisible();
});

test('the structure tree is navigable by keyboard alone', async ({ page }) => {
  await type(page, 'pattern', '(a)(b)');
  const tree = page.getByRole('tree', { name: 'Pattern structure' });
  await expect(tree).toBeVisible({ timeout: 10_000 });

  await tree.getByRole('treeitem').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[role="treeitem"]:focus')).toBeVisible();
});

test('does not scroll horizontally at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await type(page, 'pattern', '^(?<a>[A-Za-z0-9_.+-]+)@(?<b>[A-Za-z0-9-]+)$');

  await expect(page.getByRole('heading', { name: 'Pattern' })).toBeVisible({ timeout: 10_000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

/* ------------------------------------------------------------------ *
 * Accessibility
 * ------------------------------------------------------------------ */

test('has no critical or serious accessibility violations', async ({ page }) => {
  await type(page, 'pattern', '(?<word>\\w+)\\s(a+)+');
  await type(page, 'subject', 'hello aaa world');

  await expect(page.getByRole('heading', { name: 'Structure' })).toBeVisible({ timeout: 10_000 });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(serious).toEqual([]);
});

test('the pattern editor carries an accessible name and description', async ({ page }) => {
  const editor = pattern(page);
  await expect(editor).toHaveAttribute('aria-label', 'Regular expression pattern');
  await expect(editor).toHaveAttribute('aria-describedby', /.+/);
});

test('every flag toggle is labelled and reports its state', async ({ page }) => {
  const flags = page.getByRole('group', { name: 'Flags' }).getByRole('button');
  await expect(flags).toHaveCount(8);

  for (const flag of await flags.all()) {
    await expect(flag).toHaveAttribute('aria-pressed', /true|false/);
    expect((await flag.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
  }
});

test('renders a large match list progressively rather than all at once', async ({ page }) => {
  await page.goto('/');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();

  await page.getByRole('textbox', { name: 'Regular expression pattern' }).click();
  await page.keyboard.type('a');
  // The tester runs the *committed* pattern, so it has to be analysed first.
  await pressAnalyze(page, 'pattern');

  // ~4 000 matches. `insertText` dispatches one input event rather than 12 000
  // key events, which keeps this test to a second and needs no clipboard
  // permission — those differ across the three engines this spec runs on.
  await page.getByRole('textbox', { name: 'Test string' }).click();
  await page.keyboard.insertText('ab '.repeat(4_000));

  const matches = page.getByRole('region', { name: 'Matches' }).first();
  await expect(matches.getByText(/4,000 matches/)).toBeVisible({ timeout: 15_000 });

  // The count is 4 000; the document holds 200. Rendering all of them cost
  // 130 000 nodes and a second of layout — 12_PERFORMANCE.md §12.3.
  await expect(page.locator('tbody tr')).toHaveCount(200);

  const showMore = page.getByRole('button', { name: /Show 200 more/ });
  await expect(showMore).toBeVisible();
  await showMore.click();
  await expect(page.locator('tbody tr')).toHaveCount(400);

  // Every match stays reachable, and the control says where you are.
  await expect(matches.getByText(/Showing 400 of 4,000/)).toBeVisible();
});

test('resets the match list when the result changes', async ({ page }) => {
  await page.goto('/');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();

  await page.getByRole('textbox', { name: 'Regular expression pattern' }).click();
  await page.keyboard.type('a');
  await pressAnalyze(page, 'pattern');
  await page.getByRole('textbox', { name: 'Test string' }).click();
  await page.keyboard.insertText('ab '.repeat(4_000));

  await expect(page.locator('tbody tr')).toHaveCount(200);
  await page.getByRole('button', { name: /Show 200 more/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(400);

  // A new pattern is a new list — holding position at row 400 of the previous
  // result would be both wrong and slow.
  await page.getByRole('textbox', { name: 'Regular expression pattern' }).click();
  await page.keyboard.type('b');
  await pressAnalyze(page, 'pattern');
  await expect(page.locator('tbody tr')).toHaveCount(200);
});
