import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * M8 — theme customisation end to end.
 *
 * Two things can only be proved in a real browser, and both are here: that the
 * pre-paint bootstrap applies a stored theme *before the first paint*, and
 * that a hostile localStorage value cannot become a CSS declaration. The unit
 * tests cover the validator; this covers the validator wired to a real
 * `style.setProperty` under the real CSP.
 */

const themeButton = (page: Page) => page.getByRole('button', { name: /^Appearance/ });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Appearance' });

/** The resolved value of a custom property on `<html>`. */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
}

async function start(page: Page): Promise<void> {
  await page.goto('/');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();
}

async function openDrawer(page: Page): Promise<void> {
  await themeButton(page).click();
  await expect(drawer(page)).toBeVisible();
}

async function closeDrawer(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
}

/** Writes a raw string into the theme key, the way a console or an XSS would. */
async function plantTheme(page: Page, raw: string): Promise<void> {
  await page.evaluate((value) => {
    localStorage.setItem('syntaxlab.theme.v1', value);
  }, raw);
}

test.beforeEach(async ({ page }) => {
  await start(page);
});

/* ------------------------------------------------------------------ *
 * The default identity
 * ------------------------------------------------------------------ */

test('ships the hacker-green default', async ({ page }) => {
  // The product's identity. A drift here is a silent rebrand.
  expect(await token(page, '--gradient-from')).toBe('#00ff88');
  expect(await token(page, '--gradient-to')).toBe('#003d1f');
  expect(await token(page, '--gradient-angle')).toBe('135deg');
  expect(await token(page, '--gradient-intensity')).toBe('0.4');
});

/* ------------------------------------------------------------------ *
 * The controls
 * ------------------------------------------------------------------ */

test('changes preset, and the change is visible immediately', async ({ page }) => {
  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Amber Console' }).click();

  expect(await token(page, '--gradient-from')).toBe('#fbbf24');
  expect(await token(page, '--color-accent')).toBe('#fbbf24');
  // No save button was pressed and no reload happened.
  await expect(drawer(page)).toBeVisible();
});

test('changes the primary and secondary colours', async ({ page }) => {
  await openDrawer(page);

  await drawer(page).getByLabel('Primary colour').fill('#ff0000');
  expect(await token(page, '--gradient-from')).toBe('#ff0000');

  await drawer(page).getByLabel('Secondary colour').fill('#000088');
  expect(await token(page, '--gradient-to')).toBe('#000088');

  await expect(drawer(page).getByText('Custom colours in use')).toBeVisible();
});

test('changes the gradient direction through the named options', async ({ page }) => {
  await openDrawer(page);

  // Clicking the chip, which is what a user clicks: the radio itself is
  // visually hidden and the label is its hit area.
  await drawer(page).getByText('Left to right', { exact: true }).click();
  expect(await token(page, '--gradient-angle')).toBe('90deg');

  await drawer(page).getByText('Top to bottom', { exact: true }).click();
  expect(await token(page, '--gradient-angle')).toBe('180deg');
});

test('changes the gradient intensity', async ({ page }) => {
  await openDrawer(page);

  await drawer(page)
    .getByRole('slider', { name: /Intensity/ })
    .fill('0');
  expect(await token(page, '--gradient-intensity')).toBe('0');

  await drawer(page)
    .getByRole('slider', { name: /Intensity/ })
    .fill('100');
  expect(await token(page, '--gradient-intensity')).toBe('1');
});

test('resets to the default without a reload', async ({ page }) => {
  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Deep Cyan' }).click();
  await drawer(page).getByLabel('Primary colour').fill('#ff0000');
  expect(await token(page, '--gradient-from')).toBe('#ff0000');

  await drawer(page).getByRole('button', { name: 'Reset to default' }).click();

  expect(await token(page, '--gradient-from')).toBe('#00ff88');
  await expect(drawer(page).getByText('Using the default SyntaxLab theme.')).toBeVisible();
  // Reset is a deliberate act, so it persists at once rather than on a debounce.
  await page.reload();
  expect(await token(page, '--gradient-from')).toBe('#00ff88');
});

/* ------------------------------------------------------------------ *
 * Persistence and pre-paint
 * ------------------------------------------------------------------ */

test('survives a reload', async ({ page }) => {
  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Mono' }).click();
  await closeDrawer(page);

  await page.reload();
  expect(await token(page, '--gradient-from')).toBe('#9aada3');

  await openDrawer(page);
  await expect(drawer(page).getByRole('radio', { name: 'Mono' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('applies a stored theme before the first paint', async ({ page }) => {
  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Amber Console' }).click();
  await closeDrawer(page);

  // Read during document parsing, before React has mounted. If the bootstrap
  // did not run first, this is the default green and the user sees a flash.
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') {
        (window as unknown as { __earlyGradient?: string }).__earlyGradient = getComputedStyle(
          document.documentElement,
        )
          .getPropertyValue('--gradient-from')
          .trim();
      }
    });
  });

  await page.reload();
  const early = await page.evaluate(
    () => (window as unknown as { __earlyGradient?: string }).__earlyGradient,
  );
  expect(early).toBe('#fbbf24');
});

/* ------------------------------------------------------------------ *
 * Security — hostile localStorage
 * ------------------------------------------------------------------ */

const PAYLOADS: readonly (readonly [string, string])[] = [
  [
    'a CSS injection through the colour',
    '{"gradient":{"from":"red; background:url(https://attacker.example/x)"}}',
  ],
  ['a url() value', '{"gradient":{"from":"url(https://attacker.example/x)","to":"url(x)"}}'],
  ['an expression()', '{"gradient":{"from":"expression(alert(1))"}}'],
  ['an HTML fragment', '{"accent":"<style>body{display:none}</style>"}'],
  ['a style-tag escape', '{"gradient":{"from":"</style><script>alert(1)</script>"}}'],
  ['an oversized hex', '{"gradient":{"from":"#123456789"}}'],
  ['a custom-property escape', '{"gradient":{"from":"#00ff88; --color-bg: red"}}'],
  ['NaN and Infinity', '{"gradient":{"angleDeg":null,"intensity":null},"glowIntensity":null}'],
  ['an out-of-range intensity', '{"gradient":{"intensity":100000,"angleDeg":-9999}}'],
  ['an unknown direction', '{"gradient":{"angleDeg":"90deg; --color-bg: red"}}'],
  ['an unknown preset', '{"preset":"neon-gamer"}'],
  ['an unknown contrast mode', '{"contrastMode":"high\\"] * { display:none } [x=\\""}'],
  ['a schema version from the future', '{"schemaVersion":99,"gradient":{"from":"#ff0000"}}'],
  ['a malformed schema version', '{"schemaVersion":"one","gradient":{"from":"#ff0000"}}'],
  ['an array', '[]'],
  ['a bare string', '"not a theme"'],
  ['unparseable JSON', '{not json at all'],
  ['an empty string', ''],
];

for (const [name, payload] of PAYLOADS) {
  test(`survives ${name} in storage`, async ({ page }) => {
    await plantTheme(page, payload);
    await page.reload();

    // 1. Nothing hostile reached CSS.
    for (const property of ['--gradient-from', '--gradient-to', '--color-accent']) {
      expect(await token(page, property), property).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(await token(page, '--gradient-angle')).toMatch(/^\d{1,3}deg$/);
    // `.4` and `0.4` are both valid CSS and WebKit reports the shorter form.
    expect(await token(page, '--gradient-intensity')).toMatch(/^\d*\.?\d+$/);

    // 2. No element was injected and nothing was hidden by a smuggled rule.
    expect(await page.locator('style:not([data-vite-dev-id])').count()).toBeLessThan(50);
    await expect(page.getByRole('banner')).toBeVisible();

    // 3. The application still works — history is an enhancement, and so is
    //    the theme. Neither may take the product down.
    await expect(page.getByRole('textbox', { name: 'Regular expression' })).toBeVisible();
    await openDrawer(page);
    await expect(drawer(page)).toBeVisible();
  });
}

test('a hostile theme does not execute script', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await plantTheme(
    page,
    JSON.stringify({
      // eslint-disable-next-line no-script-url -- payload under test
      gradient: { from: 'javascript:alert(1)', to: '"><img src=x onerror=alert(1)>' },
      accent: '</style><script>alert(1)</script>',
    }),
  );
  await page.reload();
  await page.waitForTimeout(500);

  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
  // Not `img` count: CodeMirror renders two aria-hidden `cm-widgetBuffer`
  // images of its own on every load. An injected one would carry a `src`.
  expect(await page.locator('img[src]').count()).toBe(0);
  // An injected script would be inline. Every script this app loads has a src,
  // because the CSP is `script-src 'self'` with no inline allowance.
  expect(await page.locator('script:not([src])').count()).toBe(0);
  expect(await token(page, '--gradient-from')).toMatch(/^#[0-9a-fA-F]{6}$/);
});

test('a valid field survives beside a corrupt one', async ({ page }) => {
  // One bad value costs the user that value, not their whole theme.
  await plantTheme(
    page,
    JSON.stringify({
      schemaVersion: 1,
      preset: 'custom',
      gradient: { from: '#22d3ee', to: 'url(evil)', angleDeg: 90, intensity: 35 },
      // eslint-disable-next-line no-script-url -- payload under test
      accent: 'javascript:alert(1)',
    }),
  );
  await page.reload();

  expect(await token(page, '--gradient-from')).toBe('#22d3ee');
  expect(await token(page, '--gradient-angle')).toBe('90deg');
  expect(await token(page, '--gradient-to')).toMatch(/^#[0-9a-fA-F]{6}$/);
  expect(await token(page, '--color-accent')).toBe('#22d3ee');
});

/* ------------------------------------------------------------------ *
 * Accessibility
 * ------------------------------------------------------------------ */

test('the drawer traps focus, closes on Escape, and restores focus', async ({ page }) => {
  // Opened from the keyboard on purpose. WebKit on macOS does not focus a
  // button when it is clicked, so a mouse-opened dialog has no opener to
  // return to on that engine — and a keyboard user is who this matters for.
  await themeButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(drawer(page)).toBeVisible();

  for (let index = 0; index < 15; index += 1) await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return dialog?.contains(document.activeElement) ?? false;
  });
  expect(inside).toBe(true);

  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();

  // Focus returns to the control that opened it, which is what a native
  // <dialog> gives us.
  await expect(themeButton(page)).toBeFocused();
});

test('every control is reachable and operable by keyboard alone', async ({ page }) => {
  await themeButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(drawer(page)).toBeVisible();

  // Arrow keys move within a native radio group, which is what a keyboard user
  // expects from a set of mutually exclusive options.
  await drawer(page)
    .getByRole('radio', { name: /^Diagonal/ })
    .focus();
  await page.keyboard.press('ArrowRight');
  expect(await token(page, '--gradient-angle')).toBe('45deg');

  await drawer(page)
    .getByRole('slider', { name: /Intensity/ })
    .focus();
  const before = await token(page, '--gradient-intensity');
  await page.keyboard.press('ArrowLeft');
  expect(await token(page, '--gradient-intensity')).not.toBe(before);
});

test('has no detectable accessibility violations', async ({ page }) => {
  await openDrawer(page);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});

test('a custom theme does not destroy focus visibility', async ({ page }) => {
  await openDrawer(page);
  // A colour that fails contrast against the surface — the worst case the
  // guard warns about but does not block.
  await drawer(page).getByLabel('Primary colour').fill('#111111');
  await expect(drawer(page).getByText(/Fails accessibility|Low contrast/)).toBeVisible();

  await closeDrawer(page);
  await themeButton(page).focus();

  // The focus ring is its own token and does not follow the accent, so it
  // survives a hostile accent choice.
  const outline = await page.evaluate(() => {
    const active = document.activeElement;
    return active === null ? '' : getComputedStyle(active).outlineWidth;
  });
  expect(outline).not.toBe('0px');
});

test('confirms a passing colour rather than staying silent', async ({ page }) => {
  await openDrawer(page);
  // The default green passes comfortably.
  await expect(drawer(page).getByText(/Passes AA/)).toBeVisible();

  await drawer(page).getByLabel('Primary colour').fill('#0a2a1a');
  await expect(drawer(page).getByText(/Passes AA/)).toBeHidden();
  await expect(drawer(page).getByText(/Fails accessibility/)).toBeVisible();
});

test('offers a one-click fix for a failing colour', async ({ page }) => {
  await openDrawer(page);
  await drawer(page).getByLabel('Primary colour').fill('#0a2a1a');
  await drawer(page).getByRole('button', { name: 'Lighten it' }).click();

  await expect(drawer(page).getByText(/Fails accessibility/)).toBeHidden();
  await expect(drawer(page).getByText(/Passes AA/)).toBeVisible();
  expect(await token(page, '--gradient-from')).toMatch(/^#[0-9a-fA-F]{6}$/);
});

/* ------------------------------------------------------------------ *
 * Motion and forced colors
 * ------------------------------------------------------------------ */

test('respects a reduced-motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();

  const durations = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .slice(0, 200)
      .map((element) => getComputedStyle(element).transitionDuration)
      .filter((value) => value !== '' && value !== '0s'),
  );
  // The global override collapses every transition to an imperceptible value.
  for (const duration of durations) {
    expect(Number.parseFloat(duration)).toBeLessThan(0.01);
  }
});

test('remains usable in forced-colors mode', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.reload();
  await openDrawer(page);

  // The preset names carry the meaning; the swatches are decoration and are
  // hidden, because in forced colors they would all render identically.
  await expect(drawer(page).getByRole('radio', { name: 'Amber Console' })).toBeVisible();
  await expect(drawer(page).getByRole('button', { name: 'Reset to default' })).toBeVisible();

  // `color-contrast` is excluded, and the reason matters. Playwright's
  // `forcedColors: 'active'` flips the media query but does not apply a real
  // forced palette, so axe measures our own colours against a mode the browser
  // has not actually entered. Measured: the plain application reports 29
  // color-contrast nodes under this emulation with no theme UI on screen at
  // all, so the rule is reporting the emulation, not the page. Real
  // forced-colors validation needs an OS high-contrast mode and is recorded as
  // a manual check in 13_TEST_PLAN.md.
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules(['color-contrast'])
    .analyze();
  expect(results.violations).toEqual([]);
});

/* ------------------------------------------------------------------ *
 * Isolation
 * ------------------------------------------------------------------ */

test('theme changes do not touch history records', async ({ page }) => {
  // 19: theme is a global preference; a history entry is independent of it.
  await page.getByRole('textbox', { name: 'Regular expression' }).fill('ab+c');
  await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(4_000);

  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Deep Cyan' }).click();
  await closeDrawer(page);

  const records = await page.evaluate(async () => {
    return new Promise<string>((resolve) => {
      const request = indexedDB.open('syntaxlab');
      request.onsuccess = () => {
        const db = request.result;
        const all = db.transaction('history', 'readonly').objectStore('history').getAll();
        all.onsuccess = () => {
          db.close();
          resolve(JSON.stringify(all.result));
        };
        all.onerror = () => {
          db.close();
          resolve('[]');
        };
      };
      request.onerror = () => {
        resolve('[]');
      };
    });
  });

  expect(records).toContain('ab+c');
  for (const word of ['gradient', 'preset', 'accent', '#22d3ee', 'theme']) {
    expect(records.toLowerCase()).not.toContain(word.toLowerCase());
  }
});

test('two tabs stay in step', async ({ page, context }) => {
  const second = await context.newPage();
  await second.goto('/');

  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Emerald' }).click();
  await closeDrawer(page);

  // localStorage broadcasts its own changes; the other tab re-reads.
  await expect
    .poll(async () => token(second, '--gradient-from'), { timeout: 5_000 })
    .toBe('#10b981');

  await second.close();
});
