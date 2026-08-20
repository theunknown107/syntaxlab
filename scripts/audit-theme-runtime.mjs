import { chromium } from '@playwright/test';

/**
 * Runtime hue audit — 09_DESIGN_SYSTEM.md §13.3
 *
 *   npm run build && npm run preview &
 *   node scripts/audit-theme-runtime.mjs
 *
 * The static audit (`audit:hues`) resolves `tokens.css` as authored, which
 * means it only ever sees the *default* theme. This one selects each preset in
 * a real browser and reads the computed value of every decorative token, which
 * is the only way to know what a user of Crimson Night actually looks at.
 */

const URL = process.env.PREVIEW_URL ?? 'http://localhost:4173';

/** Decorative chrome. Semantic status colours are audited separately. */
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
  '--gradient-from',
  '--gradient-mid-1',
  '--gradient-mid-2',
  '--gradient-to',
];

/** Semantic, and allowed to keep its own hue whatever the theme. */
const SEMANTIC = ['--color-success', '--color-error', '--color-warning', '--color-info'];

const PRESETS = ['Matrix', 'Emerald', 'Deep Cyan', 'Amber Console', 'Crimson Night', 'Mono'];
const GREEN_FAMILY = new Set(['Matrix', 'Emerald']);

function parse(value) {
  const nums = value.match(/[\d.]+/g)?.map(Number) ?? [];
  if (value.startsWith('#')) {
    return [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  }
  return nums.slice(0, 3);
}

/** Hue family, plus the channel bias that matters for near-neutrals. */
function classify(value) {
  const [r = 0, g = 0, b = 0] = parse(value);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  if (spread === 0) return { family: 'neutral', greenish: false, spread };

  const lightness = (max + min) / 2 / 255;
  const saturation = spread / 255 / (1 - Math.abs(2 * lightness - 1) || 1);

  let hue;
  if (max === r) hue = (((g - b) / spread) % 6) * 60;
  else if (max === g) hue = ((b - r) / spread + 2) * 60;
  else hue = ((r - g) / spread + 4) * 60;
  if (hue < 0) hue += 360;

  const greenHue = hue >= 70 && hue < 170;
  // A *near-neutral* counts as contaminated when green simply dominates, even
  // at a spread far too small to register as a hue — that is exactly what made
  // `#101613` read as green. The same test on a saturated colour is wrong: a
  // yellow has more green than red by construction.
  const greenBias = saturation < 0.06 && g > r && g > b;
  return {
    family: saturation < 0.06 ? `neutral(${Math.round(hue)}°)` : `${Math.round(hue)}°`,
    greenish: greenHue || greenBias,
    spread,
  };
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL);
const gotIt = page.getByRole('button', { name: 'Got it' });
if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
await page.getByRole('button', { name: /^Appearance/ }).click();

let leaks = 0;
for (const preset of PRESETS) {
  await page.getByRole('radio', { name: preset }).click();
  await page.waitForTimeout(120);

  // Resolved through a probe element rather than read off `:root`. A custom
  // property computes as-specified, so `getPropertyValue` hands back the
  // literal text `color-mix(in oklab, …)` — which an audit then misparses into
  // a hue that was never on screen. Assigning it to `color` and reading the
  // computed value forces the browser to do the mixing, which is the number a
  // user actually sees.
  const values = await page.evaluate(
    (names) => {
      const probe = document.createElement('span');
      probe.style.display = 'none';
      document.body.append(probe);
      const resolved = Object.fromEntries(
        names.map((name) => {
          probe.style.color = 'transparent';
          probe.style.color = `var(${name})`;
          const used = getComputedStyle(probe).color;
          return [name, used === 'rgba(0, 0, 0, 0)' ? '' : used];
        }),
      );
      probe.remove();
      return resolved;
    },
    [...DECORATIVE, ...SEMANTIC],
  );

  const family = await page.evaluate(() => document.documentElement.dataset.themeFamily ?? '?');
  console.log(`\n${preset}  (family: ${family})`);

  const offenders = [];
  for (const name of DECORATIVE) {
    const raw = values[name] ?? '';
    if (raw === '') continue;
    const { family: hue, greenish, spread } = classify(raw);
    if (greenish && !GREEN_FAMILY.has(preset)) offenders.push(`${name} = ${raw} (${hue})`);
    if (process.env.VERBOSE === '1') {
      console.log(`   ${name.padEnd(26)} ${raw.padEnd(26)} ${hue} spread ${spread}`);
    }
  }

  if (offenders.length === 0) {
    console.log('   ✓ no green in any decorative token');
  } else {
    leaks += offenders.length;
    console.log('   ✗ GREEN LEAK:');
    for (const offender of offenders) console.log(`     ${offender}`);
  }

  const semantic = SEMANTIC.map((name) => `${name.replace('--color-', '')}=${values[name] ?? ''}`);
  console.log(`   semantic (allowed any hue): ${semantic.join('  ')}`);
}

await browser.close();
console.log(
  leaks === 0
    ? '\nNo green in the decorative tokens of any non-green theme.\n'
    : `\n${leaks} decorative token(s) still green in a non-green theme.\n`,
);
process.exit(leaks === 0 ? 0 : 1);
