import { readFile, writeFile, mkdir } from 'node:fs/promises';

import { chromium } from '@playwright/test';

/**
 * Renders every shipped icon from `assets/icon.svg` — 07_PWA_OFFLINE.md §6
 *
 *   npm run icons
 *
 * Uses the Chromium that Playwright already installs rather than adding an
 * image-processing dependency for a handful of files that change roughly
 * never. The outputs are committed, so a normal build and a normal clone need
 * none of this.
 *
 * ---
 *
 * ONE MARK, TWO LOCKUPS, and the rule is about display size rather than about
 * which file is being written:
 *
 *   small  (≤ 48 px — favicon.svg, favicon.ico)
 *          the letter alone, viewBox tightened around it
 *   large  (≥ 180 px — apple-touch-icon, PWA manifest icons)
 *          the full `/S/`, letter plus regex delimiters
 *
 * This is not two designs. It is the same letterform, the same palette and the
 * same geometry, with a subordinate layer dropped where there are not enough
 * pixels to carry it — measured, not assumed: at 16 px the delimiters take the
 * width the S needs and the tile becomes a smudge.
 *
 * `favicon.svg` gets the small lockup specifically because a browser scales
 * one SVG to whatever the tab needs, usually 16 px. It has to be legible at
 * the smallest size it will ever be drawn at, not the largest.
 */

const SOURCE = await readFile('assets/icon.svg', 'utf8');

/** The letter's bounding box plus even padding, kept square. */
const SMALL_VIEWBOX = '82 82 348 348';

/** The letter alone: delimiters removed, viewBox and backdrop cropped to match. */
function smallLockup(svg) {
  return svg
    .replace('viewBox="0 0 512 512"', `viewBox="${SMALL_VIEWBOX}"`)
    .replace(/<g id="delimiters"[\s\S]*?<\/g>\s*/, '')
    .replace('<rect width="512" height="512"', '<rect x="82" y="82" width="348" height="348"');
}

const RASTERS = [
  // file, size, lockup, inset
  ['icons/icon-192.png', 192, 'large', 0],
  ['icons/icon-512.png', 512, 'large', 0],
  // A maskable icon is cropped to whatever shape the platform likes, so the
  // mark is inset to the 80% safe zone or it loses its ends to a circle.
  ['icons/icon-maskable-512.png', 512, 'large', 0.2],
  ['apple-touch-icon.png', 180, 'large', 0],
];

/** The sizes inside favicon.ico. Small lockup, because that is where they show. */
const ICO_SIZES = [16, 32, 48];

const BACKDROP = '#0D0208';

await mkdir('public/icons', { recursive: true });
const browser = await chromium.launch();

/** Renders one square PNG and returns its bytes. */
async function render(markup, size, inset) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  const pad = Math.round(size * inset);
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:${BACKDROP}">
       <div style="width:${size}px;height:${size}px;box-sizing:border-box;padding:${pad}px;background:${BACKDROP}">
         ${markup.replace(/viewBox/, 'width="100%" height="100%" viewBox')}
       </div>
     </body></html>`,
  );
  const buffer = await page.screenshot({ omitBackground: false });
  await page.close();
  return buffer;
}

for (const [file, size, lockup, inset] of RASTERS) {
  const markup = lockup === 'small' ? smallLockup(SOURCE) : SOURCE;
  await writeFile(`public/${file}`, await render(markup, size, inset));
  console.log(
    `  ${file.padEnd(32)} ${size}×${size}  ${lockup}${inset ? `  ${inset * 100}% inset` : ''}`,
  );
}

/* ------------------------------------------------------------------ *
 * favicon.svg and favicon.ico
 * ------------------------------------------------------------------ */

// Written rather than copied: the small lockup is a transform of the source, so
// the two cannot drift apart. The design notes are stripped — they belong with
// the canonical drawing, not in an asset every visitor downloads.
const faviconSvg = smallLockup(SOURCE)
  .replace(/<!--[\s\S]*?-->\s*/g, '')
  .replace(
    '<svg ',
    '<!-- Generated from assets/icon.svg by scripts/make-icons.mjs. Do not edit. -->\n<svg ',
  );
await writeFile('public/favicon.svg', faviconSvg);
console.log(`  ${'favicon.svg'.padEnd(32)} scalable  small`);

/**
 * Packs PNGs into an ICO container.
 *
 * Thirty lines against a documented format, rather than a dependency for one
 * file. PNG-compressed entries are what every browser and Windows since Vista
 * reads; the alternative is a BMP encoder and three times the bytes.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, data }, index) => {
    const at = index * 16;
    // 256 is encoded as 0; these are all smaller, so the size goes in as-is.
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size — 0 for truecolour
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

const icoImages = [];
for (const size of ICO_SIZES) {
  icoImages.push({ size, data: await render(smallLockup(SOURCE), size, 0) });
}
await writeFile('public/favicon.ico', buildIco(icoImages));
console.log(`  ${'favicon.ico'.padEnd(32)} ${ICO_SIZES.join(', ')}  small`);

await browser.close();
console.log('\nIcons written to public/\n');
