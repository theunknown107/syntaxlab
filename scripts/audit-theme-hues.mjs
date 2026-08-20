import { readFileSync } from 'node:fs';

/**
 * Objective hue audit of the theme token graph — 09_DESIGN_SYSTEM.md §13
 *
 *   npm run audit:hues
 *
 * Resolves every `var()` chain in `tokens.css` down to a literal colour, then
 * classifies each by hue. The point is to find colours that are green-biased
 * without the word "green" appearing anywhere near them — a neutral like
 * `#101613` is 3% greener than it is red, which is invisible in a hex string
 * and clearly visible on a screen.
 *
 * No dependency: hue from RGB is a dozen lines.
 */

const CSS = readFileSync('src/styles/tokens.css', 'utf8');

/** Every `--name: value;` declaration, first definition wins (`:root`). */
function declarations() {
  const map = new Map();
  for (const match of CSS.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined && !map.has(name)) {
      map.set(name, value.trim());
    }
  }
  return map;
}

const DECLS = declarations();

/** Follows `var(--x)` chains until a literal hex appears, or gives up. */
function resolve(value, depth = 0) {
  if (depth > 10) return null;
  const hex = /#[0-9a-fA-F]{6}\b/.exec(value);
  if (hex) return hex[0].toLowerCase();
  const ref = /var\((--[\w-]+)/.exec(value);
  if (ref?.[1] !== undefined) {
    const next = DECLS.get(ref[1]);
    return next === undefined ? null : resolve(next, depth + 1);
  }
  return null;
}

function rgb(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** Hue in degrees, plus saturation. Grey has no meaningful hue. */
function hsl([r, g, b]) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return { hue: null, saturation: 0, lightness };

  let hue;
  if (max === rr) hue = ((gg - bb) / delta) % 6;
  else if (max === gg) hue = (bb - rr) / delta + 2;
  else hue = (rr - gg) / delta + 4;
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  const saturation = delta / (1 - Math.abs(2 * lightness - 1) || 1);
  return { hue, saturation, lightness };
}

function family(hex) {
  const channels = rgb(hex);
  const { hue, saturation } = hsl(channels);
  const [r, g, b] = channels;

  // A colour this desaturated reads as neutral whatever its nominal hue, but
  // the *bias* still matters: it is what makes a "black" look green.
  if (hue === null) return { name: 'neutral', bias: 'none' };
  if (saturation < 0.06) return { name: 'neutral', bias: describeBias(r, g, b) };

  // Above this saturation the hue is trustworthy on its own; the channel-bias
  // check below is only meaningful for near-neutrals, where a 6-unit lead in
  // green is what makes a "black" look green. A yellow at 65° has more green
  // than red by construction and is not a green.
  if (hue < 15 || hue >= 330) return { name: 'red', bias: describeBias(r, g, b) };
  if (hue < 45) return { name: 'orange/amber', bias: describeBias(r, g, b) };
  if (hue < 70) return { name: 'yellow', bias: describeBias(r, g, b) };
  if (hue < 170) return { name: 'GREEN', bias: describeBias(r, g, b) };
  if (hue < 200) return { name: 'cyan', bias: describeBias(r, g, b) };
  if (hue < 260) return { name: 'blue', bias: describeBias(r, g, b) };
  if (hue < 330) return { name: 'violet/magenta', bias: describeBias(r, g, b) };
  return { name: 'unknown', bias: describeBias(r, g, b) };
}

/** Which channel dominates, for near-neutrals where hue is unstable. */
function describeBias(r, g, b) {
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread === 0) return 'none (R=G=B)';
  const dominant =
    g > r && g > b ? 'green' : r > g && r > b ? 'red' : b > r && b > g ? 'blue' : 'mixed';
  return `${dominant} +${spread}`;
}

const INTERESTING = /^--(color|gradient|glow|syntax|gray|green|matrix|neutral|red|amber|blue)/;

console.log('\nToken hue audit — src/styles/tokens.css\n');
console.log('  token                          resolved   family          bias');
console.log('  ' + '-'.repeat(74));

const greenish = [];
for (const [name, raw] of DECLS) {
  if (!INTERESTING.test(name)) continue;
  const hex = resolve(raw);
  if (hex === null) continue;
  const { name: fam, bias } = family(hex);
  const nearNeutral = fam.startsWith('neutral');
  if (fam === 'GREEN' || (nearNeutral && bias.startsWith('green'))) greenish.push(name);
  console.log(`  ${name.padEnd(30)} ${hex.padEnd(10)} ${fam.padEnd(15)} ${bias}`);
}

console.log(`\n  ${greenish.length} token(s) are green or green-biased:\n`);
for (const name of greenish) console.log(`    ${name}`);
console.log('');
