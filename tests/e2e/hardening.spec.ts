import { expect, test, type Page } from '@playwright/test';

import { awaitAnalysis, pressAnalyze } from './analyze';

/**
 * M10 — accessibility and security hardening.
 *
 * Two things distinguish this suite from the ones that came before it.
 *
 * **Forced colors is asserted on computed values.** M8 and M9 recorded that
 * Playwright's `forcedColors: 'active'` only flips the media query. That was
 * wrong, and this suite is where it was corrected: Chromium genuinely applies
 * a forced palette — `body` computes to `CanvasText` on `Canvas`, and
 * background *images* are dropped. What is unreliable is **axe's**
 * `color-contrast` rule, which reads authored colours rather than forced ones
 * and therefore reports our dark palette against a white forced background.
 * So the checks here read `getComputedStyle` instead of asking axe.
 *
 * **Hostile input goes through the real application.** Every payload is typed
 * into a real editor or planted in real storage, and the assertions are about
 * what the DOM actually contains.
 */

const patternField = (page: Page) => page.getByRole('textbox', { name: 'Regular expression' });

async function start(page: Page): Promise<void> {
  await page.goto('/');
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();
}

/**
 * Turns on a media condition for this page.
 *
 * `page.emulateMedia` rather than `test.use({ forcedColors })` in a describe
 * block: measured, the describe-level option does not reach the page at all —
 * both media queries read false. `emulateMedia` does, and it applies the real
 * forced palette rather than only flipping the query, which is what makes the
 * assertions below worth making.
 */
async function startWithMedia(
  page: Page,
  media: Parameters<Page['emulateMedia']>[0],
): Promise<void> {
  await start(page);
  await page.emulateMedia(media);
  await page.waitForTimeout(150);
}

/* ------------------------------------------------------------------ *
 * Forced colors — computed, not emulated-and-hoped
 * ------------------------------------------------------------------ */

test.describe('forced colors', () => {
  test('the browser really does take over the palette', async ({ page }) => {
    await startWithMedia(page, { forcedColors: 'active' });

    const shell = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const parse = (value: string): [number, number, number] => {
        const [r = 0, g = 0, b = 0] = value.match(/\d+/g)?.map(Number) ?? [];
        return [r, g, b];
      };
      const channel = (value: number): number => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const luminance = ([r, g, b]: [number, number, number]): number =>
        0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

      const fg = luminance(parse(body.color));
      const bg = luminance(parse(body.backgroundColor));
      return {
        background: body.backgroundColor,
        ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
      };
    });

    // Engine-neutral on purpose: Chromium's forced palette is light and
    // Firefox's is dark, so asserting a specific colour would only ever be
    // true on one of them. What matters is that our authored background is
    // *gone* and what replaced it carries the contrast the OS guarantees.
    //
    // If this ever stops holding, every other assertion in this block is
    // measuring nothing, so it is checked first.
    expect(shell.background).not.toBe('rgb(10, 14, 12)');
    expect(shell.ratio).toBeGreaterThan(7);
  });

  test('decorative gradients are dropped rather than fighting the palette', async ({ page }) => {
    await startWithMedia(page, { forcedColors: 'active' });

    // A background *image* survives forcing in some engines and would put our
    // colours behind forced text. Chromium drops it; asserted so a regression
    // in either direction is visible.
    const images = await page.evaluate(() =>
      [...document.querySelectorAll('button, aside, header')]
        .map((element) => getComputedStyle(element).backgroundImage)
        .filter((value) => value !== 'none'),
    );
    expect(images).toEqual([]);
  });

  test('every control keeps a visible boundary', async ({ page }) => {
    await startWithMedia(page, { forcedColors: 'active' });

    // In forced colors a control cannot be distinguished by its surface, so a
    // border is the only thing separating a button from a run of text. An
    // unselected mode tab had none until this was measured.
    const borderless = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((element) => element.checkVisibility())
        .filter((element) => {
          const style = getComputedStyle(element);
          const hasBorder =
            style.borderTopStyle !== 'none' && Number.parseFloat(style.borderTopWidth) > 0;
          const hasOutline = Number.parseFloat(style.outlineWidth) > 0;
          const isHighlighted = style.backgroundColor !== 'rgba(0, 0, 0, 0)';
          return !hasBorder && !hasOutline && !isHighlighted;
        })
        .map((element) => (element.getAttribute('aria-label') ?? '').slice(0, 40)),
    );
    expect(borderless).toEqual([]);
  });

  test('focus stays visible', async ({ page }) => {
    await startWithMedia(page, { forcedColors: 'active' });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const focus = await page.evaluate(() => {
      const active = document.activeElement;
      if (active === null) return null;
      const style = getComputedStyle(active);
      return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    expect(focus).not.toBeNull();
    expect(focus?.width).toBeGreaterThan(0);
    expect(focus?.style).not.toBe('none');
  });

  test('errors and warnings still say what they are, in words', async ({ page }) => {
    await startWithMedia(page, { forcedColors: 'active' });
    // An invalid pattern: the message must survive losing its colour.
    await patternField(page).fill('(unclosed');
    await expect(page.getByText(/unclosed|missing|expected/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('the analysis panes remain usable', async ({ page }) => {
    await startWithMedia(page, { forcedColors: 'active' });
    await patternField(page).fill('^a(b|c)+$');
    // M15 made analysis explicit: filling the editor analyses nothing.
    await pressAnalyze(page, 'pattern');
    await awaitAnalysis(page);
    await expect(page.getByText(/Capture group/).first()).toBeVisible();

    await page.getByRole('radio', { name: 'JSON' }).click();
    await page.getByRole('textbox', { name: 'JSON document' }).fill('{"a":[1,2]}');
    await pressAnalyze(page, 'json');
    await expect(page.getByRole('tree', { name: 'JSON structure' })).toBeVisible({
      timeout: 15_000,
    });
  });
});

/* ------------------------------------------------------------------ *
 * Hostile input, through the real application
 * ------------------------------------------------------------------ */

const XSS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  // eslint-disable-next-line no-script-url -- payload under test
  'javascript:alert(1)',
  '"><script>alert(1)</script>',
  "';alert(1);//",
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">x</a>',
];

test.describe('hostile input', () => {
  test('nothing typed into the regex editor becomes markup', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await start(page);

    for (const payload of XSS) {
      await patternField(page).fill(payload);
      await page.waitForTimeout(350);
    }

    expect(dialogs).toEqual([]);
    // CodeMirror renders two aria-hidden buffer images of its own; an injected
    // one would carry a src.
    expect(await page.locator('img[src]').count()).toBe(0);
    expect(await page.locator('iframe, object, embed').count()).toBe(0);
    expect(await page.locator('script:not([src])').count()).toBe(0);
    expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
  });

  test('hostile JSON keys and values render as text', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await start(page);
    await page.getByRole('radio', { name: 'JSON' }).click();

    const document_ = JSON.stringify({
      '<img src=x onerror=alert(1)>': '<script>alert(1)</script>',
      nested: { '<svg onload=alert(1)>': ['<iframe src="javascript:alert(1)">'] },
      __proto__: { polluted: true },
      constructor: '<script>alert(1)</script>',
    });
    await page.getByRole('textbox', { name: 'JSON document' }).fill(document_);
    await pressAnalyze(page, 'json');
    await expect(page.getByRole('tree', { name: 'JSON structure' })).toBeVisible({
      timeout: 15_000,
    });

    expect(dialogs).toEqual([]);
    expect(await page.locator('img[src]').count()).toBe(0);
    expect(await page.locator('iframe, object, embed').count()).toBe(0);

    // The hostile key is shown, as a key, as text.
    await expect(page.getByText('<img src=x onerror=alert(1)>').first()).toBeVisible();

    // And nothing reached Object.prototype.
    const polluted = await page.evaluate(() => ({ hit: 'polluted' in {} }));
    expect(polluted.hit).toBe(false);
  });

  test('a hostile pattern stored in history renders as text on reload', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await start(page);

    await patternField(page).fill('<img src=x onerror=alert(1)>');
    // The entry only reaches history once it has been analysed.
    await pressAnalyze(page, 'pattern');
    // The region is always visible; wait for the analysis itself.
    await awaitAnalysis(page);
    await page.waitForTimeout(4000);

    await page.reload();
    await page.getByRole('button', { name: /^History/ }).click();
    const drawer = page.getByRole('dialog', { name: 'History' });
    await expect(drawer.getByText(/<img src=x onerror=alert\(1\)>/)).toBeVisible();

    expect(dialogs).toEqual([]);
    expect(await page.locator('img[src]').count()).toBe(0);
  });

  test('a hostile history record planted directly in IndexedDB stays inert', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await start(page);
    // Let the database exist first.
    await patternField(page).fill('seed');
    await page.waitForTimeout(4000);

    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('syntaxlab');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('history', 'readwrite');
          tx.objectStore('history').put({
            id: 'hostile-1',
            schemaVersion: 1,
            type: 'regex',
            title: '<img src=x onerror=alert(1)>',
            isCustomTitle: true,
            input: '<script>alert(1)</script>',
            inputTruncated: false,
            metadata: { type: 'regex', flags: 'g', groupCount: 0, hadErrors: false, nodeCount: 1 },
            createdAt: 1,
            lastOpenedAt: 1,
            openCount: 1,
            pinned: false,
            tags: ['<svg onload=alert(1)>'],
            searchText: 'x',
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
    await page.getByRole('button', { name: /^History/ }).click();
    await expect(
      page.getByRole('dialog', { name: 'History' }).getByText(/<img src=x onerror/),
    ).toBeVisible();

    expect(dialogs).toEqual([]);
    expect(await page.locator('img[src]').count()).toBe(0);
    expect(await page.locator('svg[onload]').count()).toBe(0);
  });

  test('a hostile search term does not become a selector or markup', async ({ page }) => {
    await start(page);
    await patternField(page).fill('seed-pattern');
    await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(4000);

    await page.getByRole('button', { name: /^History/ }).click();
    const drawer = page.getByRole('dialog', { name: 'History' });
    for (const payload of ['<img src=x onerror=alert(1)>', '*', '"]', '\\']) {
      await drawer.getByRole('searchbox', { name: 'Search history' }).fill(payload);
      await page.waitForTimeout(200);
      await expect(drawer).toBeVisible();
    }
    expect(await page.locator('img[src]').count()).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

test.describe('keyboard only', () => {
  test('the skip link is first and moves focus to the workspace', async ({ page }) => {
    await start(page);
    // Reloaded rather than blurred. Dismissing the first-run notice leaves the
    // sequential-navigation starting point on a button that no longer exists,
    // and blurring does not reset it — a fresh document does, which is also
    // the state a returning visitor is actually in.
    await page.reload();
    await page.keyboard.press('Tab');

    const first = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(first).toContain('Skip to content');

    await page.keyboard.press('Enter');
    const landed = await page.evaluate(() => document.activeElement?.id ?? '');
    expect(landed).toBe('main');
  });

  test('every visible control is reachable, and focus is always visible', async ({ page }) => {
    await start(page);

    const invisible: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      await page.keyboard.press('Tab');
      const problem = await page.evaluate(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) return null;

        // Checked up the ancestor chain, because that is what a user sees.
        // CodeMirror sets `outline: none` on itself and the visible ring is
        // drawn by the wrapper via :focus-within — measured. A ring on the
        // container the user perceives as "the editor" is a correct indicator.
        let element: Element | null = active;
        for (let depth = 0; depth < 4 && element !== null; depth += 1) {
          const style = getComputedStyle(element);
          const outlined =
            Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none';
          if (outlined || style.boxShadow !== 'none') return null;
          element = element.parentElement;
        }
        return `${active.tagName}:${(active.getAttribute('aria-label') ?? '').slice(0, 30)}`;
      });
      if (problem !== null) invisible.push(problem);
    }
    expect(invisible).toEqual([]);
  });

  test('mode can be switched from the keyboard alone', async ({ page }) => {
    await start(page);
    await page.getByRole('radio', { name: 'Regex' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('textbox', { name: 'JSON document' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(patternField(page)).toBeVisible();
  });

  test('every overlay closes on Escape and returns focus to its opener', async ({ page }) => {
    await start(page);

    for (const name of [/^History/, /^Appearance/]) {
      const opener = page.getByRole('button', { name });
      await opener.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(opener).toBeFocused();
    }
  });
});

/* ------------------------------------------------------------------ *
 * Reduced motion
 * ------------------------------------------------------------------ */

test.describe('reduced motion', () => {
  test('no transition or animation runs long enough to be perceived', async ({ page }) => {
    await startWithMedia(page, { reducedMotion: 'reduce' });
    // Open things that animate, so their styles are actually computed.
    await page.getByRole('button', { name: /^Appearance/ }).click();
    await page.waitForTimeout(200);

    const moving = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .slice(0, 400)
        .map((element) => {
          const style = getComputedStyle(element);
          return {
            transition: Number.parseFloat(style.transitionDuration),
            animation: Number.parseFloat(style.animationDuration),
          };
        })
        .filter((value) => value.transition > 0.01 || value.animation > 0.01),
    );
    expect(moving).toEqual([]);
  });

  test('nothing conveys state through motion alone', async ({ page }) => {
    await startWithMedia(page, { reducedMotion: 'reduce' });
    // The analysing state is a status the user must be able to read.
    await patternField(page).fill('^(a|b)+$');
    await expect(page.getByRole('region', { name: 'Explanation' })).toBeVisible({
      timeout: 15_000,
    });
    // Selection in the mode selector is conveyed by aria-checked, not motion.
    await expect(page.getByRole('radio', { name: 'Regex' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
