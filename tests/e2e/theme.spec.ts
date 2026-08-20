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

test('ships the Matrix default, with all four specified colours', async ({ page }) => {
  // These values are given rather than chosen. Asserted against the *rendered*
  // custom properties, so a drift anywhere between the preset table, the
  // stylesheet and the bootstrap shows up here.
  expect((await token(page, '--gradient-from')).toLowerCase()).toBe('#00ff41');
  expect((await token(page, '--gradient-mid-1')).toLowerCase()).toBe('#008f11');
  expect((await token(page, '--gradient-mid-2')).toLowerCase()).toBe('#003b00');
  expect((await token(page, '--gradient-to')).toLowerCase()).toBe('#0d0208');
  expect((await token(page, '--color-accent')).toLowerCase()).toBe('#00ff41');
  expect(await token(page, '--gradient-angle')).toBe('135deg');
  expect(await token(page, '--gradient-intensity')).toMatch(/^0?\.4$/);
});

test('offers Crimson Night, with the two specified colours exactly', async ({ page }) => {
  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Crimson Night' }).click();

  expect((await token(page, '--gradient-from')).toLowerCase()).toBe('#dc143c');
  expect((await token(page, '--gradient-to')).toLowerCase()).toBe('#343434');

  // #DC143C is 3.67:1 against the surface, so it cannot carry text or a focus
  // ring. The split: `--color-accent` stays the requested colour exactly and
  // paints the chrome, and only `--color-accent-legible` moves. Letting the
  // lighter red take over the accent would make the theme pink rather than
  // crimson, which is the opposite of what was asked for.
  expect((await token(page, '--color-accent')).toLowerCase()).toBe('#dc143c');
  expect((await token(page, '--color-accent-legible')).toLowerCase()).not.toBe('#dc143c');
  await expect(drawer(page).getByText(/Passes AA|Low contrast|Fails accessibility/)).toBeVisible();

  await closeDrawer(page);
  await page.reload();
  expect((await token(page, '--gradient-from')).toLowerCase()).toBe('#dc143c');
});

test('Crimson Night leaves the semantic status colours alone', async ({ page }) => {
  const before = await token(page, '--color-error');
  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Crimson Night' }).click();
  await closeDrawer(page);

  // An error must look like an error whatever the theme is. Status colours are
  // deliberately not customisable (09_DESIGN_SYSTEM.md §11.5).
  expect(await token(page, '--color-error')).toBe(before);
  expect(await token(page, '--color-warning')).not.toBe('');
  expect(await token(page, '--color-success')).not.toBe('');
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

  expect((await token(page, '--gradient-from')).toLowerCase()).toBe('#00ff41');
  await expect(drawer(page).getByText('Using the default SyntaxLab theme.')).toBeVisible();
  // Reset is a deliberate act, so it persists at once rather than on a debounce.
  await page.reload();
  expect((await token(page, '--gradient-from')).toLowerCase()).toBe('#00ff41');
});

/* ------------------------------------------------------------------ *
 * Persistence and pre-paint
 * ------------------------------------------------------------------ */

test('survives a reload', async ({ page }) => {
  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Mono' }).click();
  await closeDrawer(page);

  await page.reload();
  // A true grey. Mono was #9aada3 on #1f2a24 until this pass — the old tinted
  // neutrals, which made the "no colour" preset the second-greenest one.
  expect(await token(page, '--gradient-from')).toBe('#a6a6a6');

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
  ['a custom-property escape', '{"gradient":{"from":"#00ff41; --color-bg: red"}}'],
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

  // Tabbed right around the cycle and past it. What must never happen is
  // focus reaching an interactive element *behind* the dialog. Chromium parks
  // focus on <body> for a single step as it wraps past the last focusable,
  // which is the cycle working rather than the trap leaking — measured, and
  // the next Tab returns inside.
  const escapes: string[] = [];
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab');
    const outside = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]');
      const active = document.activeElement;
      if (active === null || dialog === null) return null;
      if (dialog.contains(active)) return null;
      if (active === document.body || active === document.documentElement) return null;
      return `${active.tagName}:${active.getAttribute('aria-label') ?? ''}`;
    });
    if (outside !== null) escapes.push(outside);
  }
  expect(escapes).toEqual([]);

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

test('high contrast mode passes axe on the whole interface', async ({ page }) => {
  // T-8. The mode itself predates M8; what M8 adds is the control that turns
  // it on, so this checks the combination the user can now reach.
  await openDrawer(page);
  await drawer(page).getByText('High', { exact: true }).click();
  await closeDrawer(page);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // And with the drawer open, since that is where the control lives.
  await openDrawer(page);
  const inDrawer = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(inDrawer.violations).toEqual([]);
});

test('a custom theme still passes axe with the analysis panes populated', async ({ page }) => {
  await page
    .getByRole('textbox', { name: 'Regular expression' })
    .fill(String.raw`(\w+)@(\w+)\.com`);
  await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({ timeout: 10_000 });

  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Amber Console' }).click();
  await closeDrawer(page);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

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

/**
 * The no-green rule, measured in a real browser — 09_DESIGN_SYSTEM.md §13
 *
 * The unit tests read `tokens.css` as authored, which only ever shows the
 * default theme. This selects each preset and reads what the user is actually
 * looking at, which is the only way the Crimson Night leak was ever going to be
 * caught: the offending token was a `color-mix()` over an inherited ramp, green
 * in no single declaration anywhere.
 */

const DECORATIVE = [
  '--color-bg',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-sunken',
  '--color-text',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-border',
  '--color-border-strong',
  '--color-accent',
  '--color-accent-legible',
  '--color-accent-hover',
  '--color-accent-active',
  '--color-focus',
  '--color-selection',
  '--gradient-from',
  '--gradient-mid-1',
  '--gradient-mid-2',
  '--gradient-to',
];

function hueOf(r: number, g: number, b: number, spread: number): number {
  const max = Math.max(r, g, b);
  let hue: number;
  if (max === r) hue = (((g - b) / spread) % 6) * 60;
  else if (max === g) hue = ((b - r) / spread + 2) * 60;
  else hue = ((r - g) / spread + 4) * 60;
  return hue < 0 ? hue + 360 : hue;
}

function channelsOf(value: string): [number, number, number] {
  const [r = 0, g = 0, b = 0] = value.match(/[0-9.]+/g)?.map(Number) ?? [];
  return [r, g, b];
}

/** Green as a visible hue; near-neutrals are judged on channel bias instead. */
function isGreen(value: string): boolean {
  const [r, g, b] = channelsOf(value);
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread === 0) return false;

  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);

  const lightness = (max + min) / 2 / 255;
  const saturation = spread / 255 / (1 - Math.abs(2 * lightness - 1) || 1);
  // A saturated colour is judged on hue alone: a yellow has more green than
  // red by construction and is not a green.
  if (saturation < 0.06) return g > r && g > b;

  const hue = hueOf(r, g, b, spread);
  return hue >= 70 && hue < 170;
}

/**
 * Custom properties compute *as specified*, so reading one off `:root` hands
 * back the literal text `color-mix(in oklab, …)`. Assigning it to `color` on a
 * throwaway element forces the browser to do the mixing, which is the number
 * that reaches a screen.
 */
async function usedColours(page: Page, names: string[]): Promise<Record<string, string>> {
  return page.evaluate((properties) => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.append(probe);
    const resolved = Object.fromEntries(
      properties.map((property) => {
        probe.style.color = 'transparent';
        probe.style.color = `var(${property})`;
        const used = getComputedStyle(probe).color;
        return [property, used === 'rgba(0, 0, 0, 0)' ? '' : used];
      }),
    );
    probe.remove();
    return resolved;
  }, names);
}

for (const [preset, family] of [
  ['Deep Cyan', 'cyan'],
  ['Amber Console', 'amber'],
  ['Crimson Night', 'crimson'],
  ['Mono', 'mono'],
] as const) {
  test(`${preset} contains no green in any decorative token`, async ({ page }) => {
    await start(page);
    await openDrawer(page);
    await drawer(page).getByRole('radio', { name: preset }).click();

    await expect(page.locator('html')).toHaveAttribute('data-theme-family', family);

    const values = await usedColours(page, DECORATIVE);
    const green = Object.entries(values).filter(([, value]) => value !== '' && isGreen(value));
    expect(green).toEqual([]);

    // Guards the probe: an empty read would make the assertion above vacuous.
    expect(Object.values(values).filter((value) => value !== '').length).toBeGreaterThan(12);
  });
}

test('Matrix keeps its four specified colours and stays in the green family', async ({ page }) => {
  await start(page);
  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Matrix' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'green');
  expect([
    await token(page, '--gradient-from'),
    await token(page, '--gradient-mid-1'),
    await token(page, '--gradient-mid-2'),
    await token(page, '--gradient-to'),
  ]).toEqual(['#00FF41', '#008F11', '#003B00', '#0D0208']);
});

test('the editor decorations carry no green inside a non-green theme', async ({ page }) => {
  await start(page);
  await openDrawer(page);
  await drawer(page).getByRole('radio', { name: 'Crimson Night' }).click();
  await closeDrawer(page);

  await page.locator('.cm-content').first().click();
  await page.keyboard.type('^(a|b)+' + String.raw`\d` + '[x-z]$');

  // Highlighting arrives from the analysis worker, so the decorations are not
  // in the DOM on the same tick as the keystrokes.
  const decorated = page.locator('.cm-content [class*="tok-"]');
  await expect(decorated.first()).toBeVisible();
  await expect.poll(async () => decorated.count()).toBeGreaterThan(3);

  // `|` rendered #3ddc84 here before this pass — green, in the theme whose
  // whole brief is black and crimson. Decoration colours are theme surface too.
  const decorations = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-content [class*="tok-"]')].map(
      (element) => getComputedStyle(element).color,
    ),
  );
  expect(decorations.length).toBeGreaterThan(3);
  expect(decorations.filter(isGreen)).toEqual([]);
});
