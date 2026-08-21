import { inflateSync } from 'node:zlib';

import { chromium } from '@playwright/test';

/**
 * Colour-vision-deficiency audit — 13_ACCESSIBILITY criterion A-11
 *
 *   npm run build && node scripts/serve-production.mjs 4183 &
 *   node scripts/audit-cvd.mjs
 *
 * Carried as "manual, NOT RUN" since M10 for want of a simulator. There is
 * one: Chromium implements `Emulation.setEmulatedVisionDeficiency`, the same
 * transform DevTools applies, and Playwright can reach it over CDP.
 *
 * This does not ask a human to look at a screenshot and judge. It paints the
 * live token palette as solid swatches, samples the **rendered pixel** of each
 * under each deficiency, and reports the smallest distance between any two.
 * Two token colours collapsing into one shows up as a small number.
 *
 * **Swatches, not glyphs.** Sampling the editor's own text was the first
 * approach and it lies: `|` is a one-pixel-wide bar, so almost every pixel in
 * its box is antialiased toward the background and the sampled colour comes
 * out far darker than the token actually is. It reported alternation and
 * character-class as nearly identical under achromatopsia when their relative
 * luminances are 0.89 and 0.57. The swatches carry the same custom-property
 * values with none of the antialiasing.
 *
 * **Pixels, not `getComputedStyle`.** The emulation is a compositing filter:
 * computed style returns the authored colour and is completely unchanged by
 * it. A first version of this file read computed style and reported an
 * identical figure for all five settings — including "no colour at all",
 * which is the tell. The same class of mistake M10 found in axe under forced
 * colors.
 *
 * Distance is CIE76 in Lab. Not the last word in perceptual difference, but
 * defensible, reproducible, and the failure being looked for is coarse.
 */

const URL = process.env.PREVIEW_URL ?? 'http://localhost:4183';

/** What Chromium can emulate, plus the unmodified baseline. */
const DEFICIENCIES = [
  ['none', 'normal vision'],
  ['protanopia', 'no red cones'],
  ['deuteranopia', 'no green cones'],
  ['tritanopia', 'no blue cones'],
  ['achromatopsia', 'no colour at all'],
];

/**
 * A pattern that puts every regex token class on screen at once.
 *
 * Coverage of the *palette*, not of the parser: anchors, quantifiers, groups,
 * classes, escapes and alternation each get their own colour, and those are
 * the ones that have to stay apart.
 */
const PATTERN = String.raw`^(?<id>\d{2,4})|[a-z.]+\s*$`;

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB to CIE Lab, D65. */
function toLab([r, g, b]) {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function distance(a, b) {
  const [la, aa, ba] = toLab(a);
  const [lb, ab, bb] = toLab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
}

/** The predictor a PNG scanline filter adds back. `a`/`b`/`c` are left/up/up-left. */
function unfilter(filter, a, b, c) {
  if (filter === 1) return a;
  if (filter === 2) return b;
  if (filter === 3) return (a + b) >> 1;
  if (filter !== 4) return 0;
  // Paeth: whichever neighbour the linear predictor lands closest to.
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decodes the truecolour PNGs Playwright produces, using only `node:zlib`.
 *
 * A dependency would be the obvious move and is not worth it: this handles
 * bit depth 8, non-interlaced, colour type 2 (RGB) or 6 (RGBA) — Playwright
 * writes type 2 for an opaque screenshot and type 6 when it carries alpha —
 * and refuses anything else rather than guessing.
 */
function decodePng(buffer) {
  let offset = 8; // skip the signature
  let width = 0;
  let height = 0;
  let bytesPerPixel = 4;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data.readUInt8(8);
      const colourType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (depth !== 8 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colourType}`);
      }
      bytesPerPixel = colourType === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(height * stride);

  // Undo the per-scanline filters — five of them, defined by the spec.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      pixels[y * stride + x] = (line[x] + unfilter(filter, a, b, c)) & 0xff;
    }
  }

  return { width, height, pixels, bytesPerPixel };
}

/** The pixel at the centre of a box. Solid swatches, so one sample is enough. */
function centrePixel({ width, pixels, bytesPerPixel }, box) {
  const x = Math.min(width - 1, Math.round(box.x + box.width / 2));
  const y = Math.round(box.y + box.height / 2);
  const index = (y * width + x) * bytesPerPixel;
  return [pixels[index], pixels[index + 1], pixels[index + 2]];
}

/** The two colours in `sampled` that are hardest to tell apart. */
function closestPair(names, sampled) {
  let closest = { pair: null, distance: Infinity };
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const gap = distance(sampled[names[i]], sampled[names[j]]);
      if (gap < closest.distance) closest = { pair: [names[i], names[j]], distance: gap };
    }
  }
  return closest;
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

await page.goto(URL);
const gotIt = page.getByRole('button', { name: 'Got it' });
if (await gotIt.isVisible().catch(() => false)) await gotIt.click();

// The palette, painted as solid blocks from the live custom properties. The
// pattern is still typed in first so the tokens exist and the values being
// read are the ones the editor is really using.
const editor = page.getByRole('textbox', { name: 'Regular expression' });
await editor.click();
await page.keyboard.insertText(PATTERN);
await page.waitForTimeout(900);

const boxes = await page.evaluate(() => {
  const names = ['anchor', 'class', 'escape', 'group', 'meta', 'quantifier'];
  const strip = document.createElement('div');
  strip.id = 'cvd-strip';
  strip.style.cssText =
    'position:fixed;inset:auto auto 0 0;z-index:2147483647;display:flex;margin:0;padding:0';
  const found = {};
  for (const name of names) {
    const swatch = document.createElement('div');
    swatch.style.cssText = `width:60px;height:60px;background:var(--syntax-rx-${name})`;
    strip.append(swatch);
  }
  document.body.append(strip);
  const children = [...strip.children];
  names.forEach((name, index) => {
    const rect = children[index].getBoundingClientRect();
    found[`tok-${name}`] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  return found;
});

const names = Object.keys(boxes).sort();
console.log(`\nCVD audit — ${URL}\n${'='.repeat(72)}`);
console.log(`pattern: ${PATTERN}`);
console.log(`token classes on screen: ${names.length} — ${names.join(', ')}\n`);

let worst = { pair: null, distance: Infinity, deficiency: null };

for (const [deficiency, description] of DEFICIENCIES) {
  await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: deficiency });
  await page.waitForTimeout(200);

  const image = decodePng(await page.screenshot());
  const sampled = Object.fromEntries(names.map((name) => [name, centrePixel(image, boxes[name])]));

  const closest = closestPair(names, sampled);

  console.log(`${deficiency.padEnd(15)} ${description}`);
  for (const name of names) {
    const [r, g, b] = sampled[name];
    console.log(`   ${name.padEnd(16)} rgb(${r}, ${g}, ${b})`);
  }
  console.log(
    `   closest pair: ${closest.pair?.[0]} / ${closest.pair?.[1]}  dE ${closest.distance.toFixed(1)}\n`,
  );
  if (closest.distance < worst.distance) worst = { ...closest, deficiency };
}

await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: 'none' });
await browser.close();

console.log('='.repeat(72));
console.log(
  `worst case: ${worst.pair?.[0]} / ${worst.pair?.[1]} under ${worst.deficiency}, dE ${worst.distance.toFixed(1)}`,
);

/*
 * What these numbers mean, and why there is no single pass/fail line.
 *
 * Under a deficiency the hue channel collapses and only luminance separates
 * the palette. Six token colours all holding 7:1 or better against a dark
 * surface leaves a luminance range of roughly 0.38 to 0.89 to divide six ways,
 * so some pair is always going to be close. Moving one token was tried and
 * measured: lightening the anchor from #bd93f9 improved its distance from the
 * quantifier and pushed it into the group's band instead. The crowding moves,
 * it does not go away.
 *
 * That is why this reports rather than gates. The reason it is acceptable is
 * not the number — it is that colour is never the only signal here. Every
 * construct is also named in words, in the Explanation panel, the Structure
 * tree and the Tokens table, which is what WCAG 1.4.1 actually asks for.
 * Separating the palette properly means redesigning it against luminance, not
 * patching one value at a release gate.
 */
const COMMON = new Set(['protanopia', 'deuteranopia']);
console.log('');
console.log('Reported, not gated — see the note in this file and 23_RISK_REGISTER.md.');
console.log(`Red-green deficiencies (${[...COMMON].join(', ')}) are the common ones and are the`);
console.log('cases to watch; achromatopsia is the hardest and the rarest.');
console.log('');
