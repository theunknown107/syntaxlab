import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { pressAnalyze } from './analyze';

/**
 * M12 — the release gates that are about the *deployment*, not the features.
 *
 * Three things that are true of the shipped artefact rather than of any user
 * journey: the headers a browser actually receives, whether the app is
 * installable, and whether it survives a full history at the documented limit.
 *
 * Runs against :4183, which serves the real `vercel.json` header rules —
 * the configuration production actually applies, not a second copy of it.
 */

const ORIGIN = 'http://localhost:4183';

/* ------------------------------------------------------------------ *
 * Production headers and CSP
 * ------------------------------------------------------------------ */

interface VercelHeaderRule {
  readonly source: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

/**
 * The policy, read out of `vercel.json` rather than restated.
 *
 * A header test that hard-codes the policy it expects passes forever after
 * someone edits the configuration, which is the opposite of what it is for.
 * Reading the *deployed* configuration is the part that matters: until M14 this
 * read `public/_headers`, a Cloudflare file Vercel never looked at, so the gate
 * was green while production served no CSP at all.
 */
function declaredPolicy(source: string): Record<string, string> {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    headers: readonly VercelHeaderRule[];
  };
  const rule = config.headers.find((entry) => entry.source === source);
  expect(rule, `no rule with source ${source} in vercel.json`).toBeDefined();

  const headers: Record<string, string> = {};
  for (const header of rule?.headers ?? []) headers[header.key.toLowerCase()] = header.value;
  return headers;
}

/** The site-wide rule: everything except the service worker and its Workbox chunk. */
const PAGE_RULE = String.raw`/((?!sw\.js$)(?!workbox-[^/]*\.js$).*)`;
/** The service worker and the chunk it importScripts, which share a context. */
const WORKER_RULE = String.raw`/(sw\.js|workbox-[^/]*\.js)`;

/** Splits a CSP into its directives, so a reordering is not a failure. */
function directives(policy: string): string[] {
  return policy
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '')
    .sort();
}

test.describe('production headers', () => {
  test('the page is served the policy that `vercel.json` declares', async ({ request }) => {
    const declared = declaredPolicy(PAGE_RULE);
    const response = await request.get(`${ORIGIN}/`);
    expect(response.status()).toBe(200);

    const served = response.headers()['content-security-policy'] ?? '';
    // `upgrade-insecure-requests` is the one directive the local server drops,
    // because this origin is HTTP and WebKit would rewrite every subresource
    // to https://localhost, where nothing is listening. It is a no-op on the
    // HTTPS production origin. Everything else must match exactly.
    const expected = directives(declared['content-security-policy'] ?? '').filter(
      (directive) => directive !== 'upgrade-insecure-requests',
    );
    expect(directives(served)).toEqual(expected);
  });

  test('the policy denies everything that is not needed', async ({ request }) => {
    const served = (await request.get(`${ORIGIN}/`)).headers()['content-security-policy'] ?? '';

    // Asserted individually so a failure names the directive that regressed.
    expect(served).toContain("default-src 'none'");
    expect(served).toContain("script-src 'self'");
    expect(served).toContain("connect-src 'none'");
    expect(served).toContain("object-src 'none'");
    expect(served).toContain("base-uri 'none'");
    expect(served).toContain("form-action 'none'");
    expect(served).toContain("frame-ancestors 'none'");
    expect(served).toContain("worker-src 'self'");

    // The two that would undo the rest.
    expect(served).not.toContain('unsafe-eval');
    expect(served).not.toContain("script-src 'unsafe-inline'");
    // `style-src` keeps 'unsafe-inline' deliberately: CSS-in-JS custom
    // properties are written with setProperty, and every value is validated
    // against a hex allowlist first (09_DESIGN_SYSTEM.md §11.3).
    expect(served).toContain("style-src 'self' 'unsafe-inline'");
  });

  test('every security header is present, not only the CSP', async ({ request }) => {
    const headers = (await request.get(`${ORIGIN}/`)).headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
    expect(headers['strict-transport-security']).toContain('max-age=31536000');
    expect(headers['permissions-policy']).toContain('geolocation=()');
  });

  test('the service worker gets its own narrower policy, not the page’s', async ({ request }) => {
    const response = await request.get(`${ORIGIN}/sw.js`);
    expect(response.status()).toBe(200);
    const served = response.headers()['content-security-policy'] ?? '';

    // It must be the worker rule's policy, and the two rules must be mutually
    // exclusive: the page rule excludes this path by negative lookahead, so no
    // response can carry both and nothing depends on which would have won.
    expect(directives(served)).toEqual(
      directives(declaredPolicy(WORKER_RULE)['content-security-policy'] ?? ''),
    );
    expect(new RegExp(`^${PAGE_RULE}$`).test('/sw.js')).toBe(false);
    expect(new RegExp(`^${PAGE_RULE}$`).test('/workbox-abc123.js')).toBe(false);
    expect(response.headers()['x-frame-options']).toBeUndefined();

    // A worker's CSP comes from the headers on its own script. The page's
    // `connect-src 'none'` is right for the page and fatal here — Workbox
    // precaches by calling fetch() during install (M9, measured A/B).
    expect(directives(served)).toEqual(
      directives("default-src 'none'; script-src 'self'; connect-src 'self'"),
    );
    // Narrower, not looser: no style, image, font or frame in a worker.
    expect(served).not.toContain('style-src');
    expect(served).not.toContain('unsafe-eval');
    expect(served).not.toContain('unsafe-inline');
  });

  test('hashed assets are immutable and entry points are revalidated', async ({ request }) => {
    const html = await (await request.get(`${ORIGIN}/`)).text();
    const asset = /\/assets\/index-[\w-]+\.js/.exec(html)?.[0];
    expect(asset, 'no hashed entry chunk in index.html').toBeDefined();

    const assetHeaders = (await request.get(`${ORIGIN}${asset}`)).headers();
    expect(assetHeaders['cache-control']).toBe('public, max-age=31536000, immutable');

    for (const path of ['/index.html', '/sw.js', '/theme-bootstrap.js', '/manifest.webmanifest']) {
      const headers = (await request.get(`${ORIGIN}${path}`)).headers();
      expect(headers['cache-control'], path).toBe('public, max-age=0, must-revalidate');
    }
  });
});

/* ------------------------------------------------------------------ *
 * Installability
 * ------------------------------------------------------------------ */

/** The manifest fields these gates read. Narrow on purpose. */
interface Manifest {
  readonly name: string;
  readonly short_name: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: string;
  readonly theme_color: string;
  readonly background_color: string;
  readonly icons: { src: string; sizes: string; purpose?: string }[];
  readonly shortcuts?: { name: string; url: string }[];
}

test.describe('installability', () => {
  test('the manifest is linked, valid, and describes an installable app', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();

    const response = await request.get(`${ORIGIN}${href}`);
    expect(response.headers()['content-type']).toContain('application/manifest+json');
    const manifest = JSON.parse(await response.text()) as Manifest;

    // The fields every installability check actually requires.
    expect(manifest.name).toBe('SyntaxLab — Regex & JSON Explainer');
    expect(manifest.short_name).toBe('SyntaxLab');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#0a0e0c');
    expect(manifest.background_color).toBe('#0a0e0c');

    // The em dash is a real U+2014, not a mojibake round trip. Worth pinning:
    // the app name is the string a user sees in the install prompt and on
    // their home screen, and an encoding slip there is invisible in review.
    expect(manifest.name).toContain('—');
  });

  test('every declared icon exists, at the size it claims', async ({ request }) => {
    const manifest = JSON.parse(
      await (await request.get(`${ORIGIN}/manifest.webmanifest`)).text(),
    ) as Manifest;
    const icons = manifest.icons;

    // 192 and 512 are the two an install prompt needs; maskable is what keeps
    // the icon from being letterboxed on Android.
    expect(icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

    for (const icon of icons) {
      const response = await request.get(`${ORIGIN}${icon.src}`);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()['content-type'], icon.src).toContain('image/png');

      // A PNG's IHDR carries its real dimensions at a fixed offset, so a
      // mislabelled icon is caught rather than trusted.
      const body = await response.body();
      const width = body.readUInt32BE(16);
      const height = body.readUInt32BE(20);
      expect(`${width}x${height}`, `${icon.src} is not ${icon.sizes}`).toBe(icon.sizes);
    }
  });

  test('the launch URL and shortcuts all resolve within scope', async ({ request }) => {
    const manifest = JSON.parse(
      await (await request.get(`${ORIGIN}/manifest.webmanifest`)).text(),
    ) as Manifest;
    const urls = [
      manifest.start_url,
      ...(manifest.shortcuts ?? []).map((shortcut) => shortcut.url),
    ];

    for (const url of urls) {
      expect(url.startsWith(manifest.scope), `${url} is outside scope`).toBe(true);
      const response = await request.get(`${ORIGIN}${url}`);
      expect(response.status(), url).toBe(200);
    }
  });

  test('a shortcut URL actually selects that mode', async ({ page }) => {
    await page.goto('/?mode=json');
    const gotIt = page.getByRole('button', { name: 'Got it' });
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    await expect(page.getByRole('radio', { name: 'JSON' })).toHaveAttribute('aria-checked', 'true');
  });
});

/* ------------------------------------------------------------------ *
 * Brand icons
 * ------------------------------------------------------------------ */

test.describe('brand icons', () => {
  test('the page declares an icon, and every declaration resolves', async ({ page, request }) => {
    await page.goto('/');

    // Three declarations and no more: the .ico for browsers that look for only
    // one, the SVG that current browsers prefer and scale, and the Apple touch
    // icon iOS uses for the home screen. A fourth would be a conflict, and
    // none at all is what left the live site showing a blank document.
    const declared = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map(
        (link) => ({
          rel: link.getAttribute('rel'),
          href: link.getAttribute('href'),
          type: link.getAttribute('type'),
        }),
      ),
    );
    expect(declared).toEqual([
      { rel: 'icon', href: '/favicon.ico', type: null },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', type: null },
    ]);

    for (const { href } of declared) {
      expect(href, 'every declared icon needs an href').not.toBeNull();
      const path = href ?? '';
      const response = await request.get(`${ORIGIN}${path}`);
      expect(response.status(), path).toBe(200);
      expect((await response.body()).length, path).toBeGreaterThan(100);
    }
  });

  test('favicon.ico carries the small sizes, as PNG entries', async ({ request }) => {
    const ico = await (await request.get(`${ORIGIN}/favicon.ico`)).body();

    // Parsed rather than trusted: an .ico that declares sizes it does not
    // contain still returns 200 and still shows nothing in a tab.
    expect(ico.readUInt16LE(0), 'reserved').toBe(0);
    expect(ico.readUInt16LE(2), 'type 1 = icon').toBe(1);
    const count = ico.readUInt16LE(4);
    expect(count).toBe(3);

    const sizes = [];
    for (let index = 0; index < count; index += 1) {
      const at = 6 + index * 16;
      const declaredSize = ico.readUInt8(at) || 256;
      const bytes = ico.readUInt32LE(at + 8);
      const offset = ico.readUInt32LE(at + 12);
      const entry = ico.subarray(offset, offset + bytes);

      // PNG signature, then the real dimensions out of the IHDR.
      expect(entry.subarray(0, 8).toString('hex'), 'PNG signature').toBe('89504e470d0a1a0a');
      expect(entry.readUInt32BE(16), `entry ${declaredSize} width`).toBe(declaredSize);
      expect(entry.readUInt32BE(20), `entry ${declaredSize} height`).toBe(declaredSize);
      sizes.push(declaredSize);
    }
    expect(sizes).toEqual([16, 32, 48]);
  });

  test('every icon is one mark — same palette, same source', async ({ request }) => {
    const svg = await (await request.get(`${ORIGIN}/favicon.svg`)).text();

    // The specified Matrix palette, not the theme tokens: a manifest is a
    // static build artefact and cannot follow a runtime theme.
    expect(svg).toContain('#0D0208');
    expect(svg).toContain('#00FF41');
    // Generated, so it cannot drift from the canonical drawing by hand.
    expect(svg).toContain('Generated from assets/icon.svg');

    // Every raster is a real PNG of the size its name and manifest claim.
    for (const [path, size] of [
      ['/apple-touch-icon.png', 180],
      ['/icons/icon-192.png', 192],
      ['/icons/icon-512.png', 512],
      ['/icons/icon-maskable-512.png', 512],
    ] as const) {
      const body = await (await request.get(`${ORIGIN}${path}`)).body();
      expect(body.subarray(0, 8).toString('hex'), path).toBe('89504e470d0a1a0a');
      expect(body.readUInt32BE(16), `${path} width`).toBe(size);
      expect(body.readUInt32BE(20), `${path} height`).toBe(size);
    }
  });

  test('the icons are precached, so they survive offline', async ({ request }) => {
    const sw = await (await request.get(`${ORIGIN}/sw.js`)).text();
    // `.ico` had to be added to globPatterns explicitly — it is the one icon a
    // browser requests entirely on its own, and it was the one that would have
    // 404'd offline.
    for (const asset of [
      'favicon.ico',
      'favicon.svg',
      'apple-touch-icon.png',
      'icons/icon-192.png',
    ]) {
      expect(sw, asset).toContain(asset);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Storage at the documented limit
 * ------------------------------------------------------------------ */

/**
 * Writes `count` well-formed entries straight into IndexedDB.
 *
 * Every field `HistoryEntry` declares is written, including the shape
 * `metadata` must take for a regex entry — `type`, `flags`, `groupCount`,
 * `nodeCount`, `hadErrors`.
 *
 * Two earlier attempts got this wrong and the drawer showed nothing but
 * "N entries could not be read and were set aside rather than deleted". That
 * is validate-on-read and the quarantine path working exactly as designed;
 * seeding storage directly means matching the schema or testing the recovery
 * path by accident.
 */
async function seedHistory(page: Page, count: number): Promise<number> {
  return page.evaluate(async (total) => {
    const open = indexedDB.open('syntaxlab');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        reject(open.error ?? new Error('indexedDB.open failed'));
      };
    });

    const now = Date.now();
    const transaction = db.transaction('history', 'readwrite');
    const store = transaction.objectStore('history');
    for (let index = 0; index < total; index += 1) {
      const title = `seeded entry ${index}`;
      const input = `seeded${index}[0-9]+`;
      store.put({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        schemaVersion: 1,
        type: 'regex',
        title,
        isCustomTitle: false,
        input,
        inputTruncated: false,
        metadata: {
          type: 'regex',
          flags: 'g',
          groupCount: 0,
          nodeCount: 3,
          hadErrors: false,
        },
        createdAt: now - index * 1_000,
        lastOpenedAt: now - index * 1_000,
        openCount: 0,
        pinned: false,
        tags: [],
        searchText: `${title} ${input}`.toLowerCase(),
      });
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('history seed transaction failed'));
      };
    });

    const stored = await new Promise<number>((resolve) => {
      const read = db.transaction('history', 'readonly').objectStore('history').count();
      read.onsuccess = () => {
        resolve(read.result);
      };
    });
    db.close();
    return stored;
  }, count);
}

test.describe('storage at scale', () => {
  test('a full history opens and searches without breaking the app', async ({ page }) => {
    test.slow();
    await page.goto('/');
    const gotIt = page.getByRole('button', { name: 'Got it' });
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();

    // The documented cap is 500 entries; 1 000 is deliberately past it, so
    // this exercises the prune path as well as the read path.
    const stored = await seedHistory(page, 1_000);
    expect(stored).toBeGreaterThanOrEqual(1_000);

    const opened = Date.now();
    await page.reload();
    await page.getByRole('button', { name: /^History/ }).click();
    const drawer = page.getByRole('dialog', { name: 'History' });
    await expect(drawer.getByRole('button', { name: /^Open / }).first()).toBeVisible({
      timeout: 20_000,
    });
    const elapsed = Date.now() - opened;

    // Not a benchmark — a guard against the drawer becoming unusable at the
    // limit. A page of entries should never take seconds to appear.
    expect(elapsed, 'history drawer at 1 000 entries').toBeLessThan(10_000);

    await drawer.getByRole('searchbox', { name: 'Search history' }).fill('seeded entry 742');
    await expect(drawer.getByRole('button', { name: /seeded entry 742/ }).first()).toBeVisible({
      timeout: 10_000,
    });

    // And the product still works with a full store behind it.
    //
    // Closed with the button rather than Escape: focus is in the search field,
    // where Escape clears the query first — which is the right behaviour for a
    // search box and the wrong way to close a drawer from a test.
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
    await page.getByRole('textbox', { name: 'Regular expression' }).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('afterFullStore\\w+');
    // M15 made analysis explicit: typing analyses nothing.
    await pressAnalyze(page, 'pattern');
    await expect(page.getByRole('region', { name: 'Explanation' }).first()).toContainText(
      /word character/i,
      { timeout: 20_000 },
    );
  });
});
