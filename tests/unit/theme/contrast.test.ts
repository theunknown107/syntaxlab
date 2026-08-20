import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  lightenToPass,
  PRESETS,
  SURFACE_HEX,
  themeFromPreset,
  verdictFor,
  type HexColor,
} from '@/domain/theme/preferences';

/**
 * Contrast across every preset — 09_DESIGN_SYSTEM.md §11.4, 13_ACCESSIBILITY.md
 *
 * Computed, never asserted from a hand-written table. The point of this file is
 * that adding a preset with an unreadable accent, or drifting a token, fails
 * here rather than in front of a user.
 *
 * **Two colours are given rather than chosen** — the Matrix ramp and Crimson
 * Night's pair. Where one of those is too dark to carry a focus ring, the rule
 * is to move the *derived* token and leave the specified colour in the
 * gradient exactly as it was asked for.
 */

/**
 * The fixed tokens, **read out of the stylesheet** rather than restated here.
 *
 * Restating them is how a contrast guard ends up measuring a colour the
 * interface does not use — which happened once already, at M8, and is worse
 * than no guard because it reports confidently.
 */
const TOKENS = readFileSync('src/styles/tokens.css', 'utf8');

function token(name: string): HexColor {
  const value = new RegExp(String.raw`--${name}:\s*(#[0-9a-fA-F]{6})`).exec(TOKENS)?.[1];
  if (value === undefined) throw new Error(`token --${name} not found in tokens.css`);
  return value;
}

const BACKGROUND = token('gray-950');
const TEXT = token('gray-100');
const TEXT_SECONDARY = token('gray-300');
const TEXT_MUTED = token('gray-400');
const FOCUS = token('green-300');
const ERROR = token('red-500');
const WARNING = token('amber-500');

function ratio(a: HexColor, b: HexColor): number {
  return Number(contrastRatio(a, b).toFixed(2));
}

describe('the fixed interface tokens', () => {
  it('keeps body text well clear of AA on both surfaces', () => {
    expect(ratio(TEXT, SURFACE_HEX)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(TEXT, BACKGROUND)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps secondary and muted text at AA for their sizes', () => {
    expect(ratio(TEXT_SECONDARY, SURFACE_HEX)).toBeGreaterThanOrEqual(4.5);
    // Muted text is used for supporting detail at normal size, so it is held
    // to the same bar rather than the large-text one.
    expect(ratio(TEXT_MUTED, SURFACE_HEX)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the focus ring visible against every surface', () => {
    // The focus ring is deliberately *not* themeable: a ring a user could
    // make invisible is a keyboard trap they cannot see.
    expect(ratio(FOCUS, SURFACE_HEX)).toBeGreaterThanOrEqual(3);
    expect(ratio(FOCUS, BACKGROUND)).toBeGreaterThanOrEqual(3);
  });

  it('keeps error and warning legible', () => {
    expect(ratio(ERROR, SURFACE_HEX)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(WARNING, SURFACE_HEX)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('every preset', () => {
  it.each(PRESETS.map((preset) => [preset.name, preset] as const))(
    '%s derives a legible accent companion that passes AA',
    (_name, preset) => {
      // `accent` is the specified colour and stays exactly that — it is what
      // the gradient, buttons and borders use. `accentLegible` is the token
      // that carries text and the focus ring, and it is the one that must
      // clear AA.
      const theme = themeFromPreset(preset);
      expect(theme.accent).toBe(preset.from);
      expect(verdictFor(theme.accentLegible)).toBe('pass');
      expect(ratio(theme.accentLegible, SURFACE_HEX)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(PRESETS.map((preset) => [preset.name, preset] as const))(
    '%s keeps its specified gradient colours exactly',
    (_name, preset) => {
      const theme = themeFromPreset(preset);
      expect(theme.gradient.from).toBe(preset.from);
      expect(theme.gradient.to).toBe(preset.to);
      if (preset.mid) {
        expect([theme.gradient.mid1, theme.gradient.mid2]).toEqual([...preset.mid]);
      }
    },
  );

  it('records the measured accent ratios, so a drift is visible in the diff', () => {
    const measured = Object.fromEntries(
      PRESETS.map((preset) => [
        preset.id,
        ratio(themeFromPreset(preset).accentLegible, SURFACE_HEX),
      ]),
    );
    expect(measured).toEqual({
      matrix: 13.42,
      crimsonNight: 4.58,
      emerald: 7.22,
      cyan: 10.14,
      amber: 10.98,
      mono: 7.53,
    });
  });

  it('records where a specified colour needed a lightened companion', () => {
    // Only Crimson Night. Matrix's #00FF41 is 13.42:1 and is used untouched.
    const lightened = PRESETS.filter(
      (preset) => themeFromPreset(preset).accentLegible !== preset.from,
    ).map((preset) => preset.id);
    expect(lightened).toEqual(['crimsonNight']);

    expect(lightenToPass('#DC143C')).toBe('#e34363');
    expect(ratio('#DC143C', SURFACE_HEX)).toBe(3.67);
    expect(ratio('#e34363', SURFACE_HEX)).toBeGreaterThanOrEqual(4.5);
  });
});
