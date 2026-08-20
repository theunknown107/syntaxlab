import { expect, test, type Page } from '@playwright/test';

/**
 * The editor keymap — 12_PERFORMANCE.md §12.2
 *
 * SyntaxLab rebuilds CodeMirror's `standardKeymap` locally rather than
 * importing it, because the single `Enter` binding in the upstream array
 * reaches `@codemirror/language` and the Lezer stack — 9.71 KB gzipped for one
 * keybinding, in an application that configures no language at all.
 *
 * That trade is only defensible if the bindings still behave, so this pins the
 * ones a developer would notice losing. It is deliberately about *behaviour*
 * rather than about which module the binding came from.
 */

async function typeInJson(page: Page, text: string): Promise<void> {
  await page.goto('/');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();
  await page.getByRole('radio', { name: 'JSON' }).click();
  await page.locator('.cm-content').first().click();
  await page.keyboard.type(text);
}

/** The document as CodeMirror holds it, newlines included. */
async function docText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll('.cm-content .cm-line')];
    // CodeMirror pads an empty line with a zero-width space so it keeps height.
    return lines.map((line) => line.textContent.replace(/\u200b/g, '')).join('\n');
  });
}

test('Enter keeps the current line’s indentation', async ({ page }) => {
  await typeInJson(page, '{');
  await page.keyboard.press('Enter');
  await page.keyboard.type('    "a": 1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('"b": 2');

  // The replacement for `insertNewlineAndIndent`. Without it the third line
  // would start at column 0 and editing nested JSON by hand would be painful.
  expect(await docText(page)).toBe('{\n    "a": 1\n    "b": 2');
});

test('Backspace, arrows and Home/End still move and delete', async ({ page }) => {
  await typeInJson(page, '[1, 2]');

  await page.keyboard.press('Backspace');
  expect(await docText(page)).toBe('[1, 2');

  await page.keyboard.press('Home');
  await page.keyboard.type('X');
  expect(await docText(page)).toBe('X[1, 2');

  await page.keyboard.press('End');
  await page.keyboard.type('Y');
  expect(await docText(page)).toBe('X[1, 2Y');

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('Z');
  expect(await docText(page)).toBe('X[1, Z2Y');
});

test('Mod-a selects all, and undo/redo still work', async ({ page }) => {
  await typeInJson(page, '{"a":1}');

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('!');
  expect(await docText(page)).toBe('!');

  // `history` and `historyKeymap` are still imported from @codemirror/commands
  // — only the Enter binding changed — but undo is the behaviour most likely to
  // be quietly lost by a keymap edit, so it is asserted rather than assumed.
  await page.keyboard.press('ControlOrMeta+z');
  expect(await docText(page)).toBe('{"a":1}');
  await page.keyboard.press('ControlOrMeta+y');
  expect(await docText(page)).toBe('!');
});

test('Tab still leaves the editor rather than indenting', async ({ page }) => {
  await typeInJson(page, '{}');
  await page.keyboard.press('Tab');

  // Deliberate omission, not an oversight — binding Tab would be a keyboard
  // trap (08_UI_UX_SPEC.md §12.3). The local keymap must not have added one.
  expect(await docText(page)).toBe('{}');
  await expect(page.locator('.cm-content').first()).not.toBeFocused();
});
