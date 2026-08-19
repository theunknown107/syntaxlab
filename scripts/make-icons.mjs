import { readFile, mkdir } from 'node:fs/promises';

import { chromium } from '@playwright/test';

/**
 * Renders the PWA icons from `assets/icon.svg` — 07_PWA_OFFLINE.md §6
 *
 *   npm run icons
 *
 * Uses the Chromium that Playwright already installs rather than adding an
 * image-processing dependency for three files that change roughly never. The
 * PNGs are committed, so a normal build and a normal clone need none of this.
 *
 * The maskable variant is the same mark inset to the safe zone: a maskable
 * icon is cropped to whatever shape the platform likes, and a mark drawn to
 * the edges loses its ends to a circle mask.
 */

const SIZES = [
  { file: 'icon-192.png', size: 192, inset: 0 },
  { file: 'icon-512.png', size: 512, inset: 0 },
  // 20% inset on each side keeps the whole mark inside the 80% safe zone the
  // maskable spec guarantees.
  { file: 'icon-maskable-512.png', size: 512, inset: 0.2 },
];

const svg = await readFile('assets/icon.svg', 'utf8');
await mkdir('public/icons', { recursive: true });

const browser = await chromium.launch();

for (const { file, size, inset } of SIZES) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });

  const pad = Math.round(size * inset);
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#0a0e0c">
       <div style="width:${size}px;height:${size}px;box-sizing:border-box;padding:${pad}px;background:#0a0e0c">
         ${svg.replace('width="512" height="512"', 'width="100%" height="100%"')}
       </div>
     </body></html>`,
  );
  // The inset variant needs the backdrop to fill the whole tile, not just the
  // padded box, or the mask crops to transparent corners.
  await page.screenshot({ path: `public/icons/${file}`, omitBackground: false });
  await page.close();
  console.log(`  ${file}  ${size}×${size}${inset ? `  (${inset * 100}% inset)` : ''}`);
}

await browser.close();

console.log(`\nIcons written to public/icons/\n`);
