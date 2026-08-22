import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME,
  PRESETS,
  readTheme,
  THEME_FAMILIES,
  themeFromPreset,
  type HexColor,
} from '@/domain/theme/preferences';

/**
 * Theme families and the no-green rule — 09_DESIGN_SYSTEM.md §13
 *
 * M10 shipped Crimson Night and it looked green. Not the gradient — the
 * *chrome*: the shared neutral ramp was `#101613`, three units greener than it
 * was red, and every accent-adjacent token pointed at `--green-*`. A hex string
 * hides that; a screen does not.
 *
 * These tests measure hue rather than grep for the word "green", because the
 * leak never contained the word.
 */

const TOKENS = readFileSync('src/styles/tokens.css', 'utf8');

function rgb(hex: HexColor): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Hue in degrees and saturation. Grey has no meaningful hue, hence `null`. */
function hsl(hex: HexColor): { hue: number | null; saturation: number } {
  const [r, g, b] = rgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { hue: null, saturation: 0 };

  const lightness = (max + min) / 2;
  let hue =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  return { hue, saturation: delta / (1 - Math.abs(2 * lightness - 1) || 1) };
}

/**
 * Green as a *visible hue*, which is the thing the rule is about.
 *
 * Two ways a token gets there. A saturated colour between 70° and 170° is
 * plainly green. A near-neutral has no stable hue at all, so it is judged on
 * channel bias instead: green ahead of both red and blue is what turns a
 * "black" into a green-black. The bias test is deliberately **not** applied
 * above that saturation — a yellow has more green than red by construction and
 * is not a green.
 */
function isGreen(hex: HexColor): boolean {
  const { hue, saturation } = hsl(hex);
  if (hue === null) return false;
  if (saturation < 0.06) {
    const [r, g, b] = rgb(hex);
    return g > r && g > b;
  }
  return hue >= 70 && hue < 170;
}

/** Every `--name: #rrggbb;` in a given block of the stylesheet. */
function literalsIn(css: string): [string, HexColor][] {
  return [...css.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
    ([, name, value]) => [name, value] as [string, HexColor],
  );
}

/** The `:root` block — the tokens every theme shares unless a family overrides. */
const ROOT = /:root\s*\{([\s\S]*?)\n\}/.exec(TOKENS)?.[1] ?? '';

describe('the shared neutral ramp', () => {
  it('exists in the stylesheet at all', () => {
    // Guards the two regexes above: if the block or the naming changes, this
    // file must fail loudly rather than quietly assert over an empty list.
    expect(ROOT).not.toBe('');
    expect(literalsIn(ROOT).filter(([name]) => name.startsWith('--gray-')).length).toBeGreaterThan(
      5,
    );
  });

  it('is neutral, because every non-green theme inherits it', () => {
    // The root cause. `--gray-900` was `#101613`; a surface, a border and a
    // sunken panel all resolved to that ramp, so Crimson Night was crimson on
    // green-black.
    for (const [name, value] of literalsIn(ROOT)) {
      if (!name.startsWith('--gray-')) continue;
      expect({ [name]: value, green: isGreen(value) }).toEqual({ [name]: value, green: false });
    }
  });
});

describe('the syntax palette', () => {
  it('carries no green, since the editor renders inside every theme', () => {
    // `|` measured `#3ddc84` in Crimson Night. Editor decorations are theme
    // surface as much as the chrome is.
    for (const [name, value] of literalsIn(ROOT)) {
      if (!name.startsWith('--syntax-')) continue;
      expect({ [name]: value, green: isGreen(value) }).toEqual({ [name]: value, green: false });
    }
  });

  it('keeps the six regex hues far enough apart to tell apart', () => {
    const hues = literalsIn(ROOT)
      .filter(([name]) => name.startsWith('--syntax-rx-'))
      .map(([, value]) => hsl(value).hue ?? 0)
      .sort((a, b) => a - b);
    expect(hues.length).toBe(6);
    for (let i = 1; i < hues.length; i += 1) {
      // Dropping green also drops the green/red pair, the worst of these for
      // colour-vision deficiency (A-11).
      expect(hues[i]! - hues[i - 1]!).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('preset families', () => {
  it('assigns exactly two presets to the green family', () => {
    const green = PRESETS.filter((preset) => preset.family === 'green').map((preset) => preset.id);
    expect(green).toEqual(['matrix', 'emerald']);
  });

  it('gives every preset a declared family', () => {
    for (const preset of PRESETS) expect(THEME_FAMILIES).toContain(preset.family);
  });

  it('keeps every non-green preset free of green in its own colours', () => {
    for (const preset of PRESETS) {
      if (preset.family === 'green') continue;
      const colours = [preset.from, preset.to, ...(preset.mid ?? [])];
      expect({ [preset.id]: colours.filter(isGreen) }).toEqual({ [preset.id]: [] });
    }
  });

  it('leaves Mono with no colour cast at all', () => {
    const mono = PRESETS.find((preset) => preset.id === 'mono');
    // Mono used to be `#9aada3` on `#1f2a24` — the old tinted greys, which made
    // the "no colour" theme the second-greenest one.
    for (const colour of [mono?.from, mono?.to]) {
      expect(hsl(colour!).saturation).toBeLessThan(0.02);
    }
  });
});

describe('family persistence', () => {
  it('carries the family onto the theme a preset produces', () => {
    for (const preset of PRESETS) {
      expect(themeFromPreset(preset).family).toBe(preset.family);
    }
  });

  it('recovers the family from the preset when it is missing or corrupt', () => {
    // The field is new, so every theme already in a user's localStorage lacks
    // it. Recomputing beats discarding their theme.
    for (const stored of [undefined, 'chartreuse', 42, null, {}]) {
      const theme = readTheme({ ...themeFromPreset(PRESETS[4]!), family: stored });
      expect(theme.family).toBe(PRESETS[4]!.family);
    }
  });

  it('rejects a family that would be a CSS or attribute injection', () => {
    const hostile = readTheme({ ...DEFAULT_THEME, family: 'green" onload="alert(1)' });
    expect(THEME_FAMILIES).toContain(hostile.family);
  });
});

describe('the pre-paint bootstrap', () => {
  const BOOTSTRAP = readFileSync('public/theme-bootstrap.js', 'utf8');

  it('allows exactly the families the domain defines', () => {
    // The bootstrap duplicates the validation rules by necessity — it runs
    // before any module loads. Duplication drifts, so it is pinned here.
    // Matches the call however its value argument is spelled — at M15 the
    // family arrives through `pick`, which resolves a URL override against the
    // preset table. What is pinned is the allowlist, not the plumbing.
    const listed = /applyEnum\('themeFamily',[^[]*\[([^\]]+)\]/.exec(BOOTSTRAP)?.[1];
    expect(listed).toBeDefined();
    const families = [...(listed ?? '').matchAll(/'([\w-]+)'/g)].map(([, name]) => name);
    expect(families).toEqual([...THEME_FAMILIES]);
  });
});
