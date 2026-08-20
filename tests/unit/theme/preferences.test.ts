import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  angleFor,
  mixHex,
  contrastRatio,
  DEFAULT_THEME,
  DIRECTIONS,
  directionFor,
  FONT_SCALES,
  isDefaultTheme,
  isHexColor,
  lightenToPass,
  matchesPreset,
  PRESETS,
  presetById,
  readTheme,
  SURFACE_HEX,
  themeFromPreset,
  THEME_SCHEMA_VERSION,
  verdictFor,
} from '@/domain/theme/preferences';

/**
 * Theme validation — 03_DOMAIN_MODEL.md §7.1, 05_SECURITY.md §2.2
 *
 * `localStorage` is attacker-writable and these values reach
 * `style.setProperty`. Everything below is the CSS-injection boundary.
 */

/* ------------------------------------------------------------------ *
 * The colour allowlist
 * ------------------------------------------------------------------ */

describe('isHexColor', () => {
  it('accepts exactly #RRGGBB', () => {
    for (const value of ['#000000', '#ffffff', '#00ff88', '#AABBCC', '#0F0f0F']) {
      expect(isHexColor(value)).toBe(true);
    }
  });

  it('rejects every CSS-injection shape', () => {
    // Not a list of known-bad substrings — these all simply fail to match the
    // pattern, which is the point of an allowlist.
    /* eslint-disable no-script-url -- These are the payloads under test. A
       security test that asserts `javascript:` URLs are rejected has to be
       able to write one down. */
    const hostile = [
      'red; background: url(https://attacker.example)',
      'url(https://attacker.example)',
      'javascript:alert(1)',
      'expression(alert(1))',
      '<style>body{display:none}</style>',
      '</style><script>alert(1)</script>',
      '#123456789',
      '#12345',
      '#fff',
      'rgb(0,0,0)',
      'var(--color-bg)',
      '#00ff88; --color-bg: red',
      '#00ff88 ',
      ' #00ff88',
      '#00ff8g',
      'transparent',
      'currentColor',
      '',
      '\n#000000',
      '#000000 ',
      '#000000\u0000',
      'calc(1px)',
      'attr(href)',
      'image-set(url(x))',
    ];
    /* eslint-enable no-script-url */
    for (const value of hostile) {
      expect(isHexColor(value), value).toBe(false);
    }
  });

  it('rejects every non-string', () => {
    for (const value of [null, undefined, 0, 1, {}, [], true, Symbol('x'), () => '#000000']) {
      expect(isHexColor(value)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * readTheme — the persisted-data boundary
 * ------------------------------------------------------------------ */

function stored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    preset: 'cyan',
    gradient: {
      from: '#22d3ee',
      mid1: '#1cb2c7',
      mid2: '#1590a1',
      to: '#0e4f5c',
      angleDeg: 145,
      intensity: 35,
    },
    accent: '#22d3ee',
    glowIntensity: 25,
    contrastMode: 'normal',
    reducedMotion: 'system',
    fontScale: 1,
    ...overrides,
  };
}

describe('readTheme — valid input', () => {
  it('reads a well-formed theme back unchanged', () => {
    const theme = readTheme(stored());
    expect(theme.preset).toBe('cyan');
    expect(theme.gradient).toEqual({
      from: '#22d3ee',
      mid1: '#1cb2c7',
      mid2: '#1590a1',
      to: '#0e4f5c',
      angleDeg: 145,
      intensity: 35,
    });
  });

  it('accepts a custom theme', () => {
    const theme = readTheme(
      stored({
        preset: 'custom',
        gradient: { from: '#ff0000', to: '#000088', angleDeg: 90, intensity: 12 },
      }),
    );
    expect(theme.preset).toBe('custom');
    expect(theme.gradient.from).toBe('#ff0000');
  });

  it('drops keys the schema does not define', () => {
    const theme = readTheme(stored({ evil: 'payload', __proto__: { polluted: true } }));
    expect(Object.keys(theme).sort()).toEqual(
      [
        'accent',
        'accentLegible',
        'family',
        'contrastMode',
        'fontScale',
        'glowIntensity',
        'gradient',
        'preset',
        'reducedMotion',
        'schemaVersion',
      ].sort(),
    );
    expect((theme as unknown as { evil?: string }).evil).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('readTheme — hostile input cannot become CSS', () => {
  /* eslint-disable no-script-url -- payloads under test, as above */
  const payloads = [
    'red; background: url(https://attacker.example)',
    'url(https://attacker.example)',
    'javascript:alert(1)',
    '<style>x</style>',
    '#123456789',
    'expression(alert(1))',
  ];
  /* eslint-enable no-script-url */

  it('replaces a hostile gradient colour with a safe default', () => {
    for (const payload of payloads) {
      const theme = readTheme(
        stored({ gradient: { from: payload, to: payload, angleDeg: 135, intensity: 40 } }),
      );
      expect(isHexColor(theme.gradient.from)).toBe(true);
      expect(isHexColor(theme.gradient.to)).toBe(true);
      expect(theme.gradient.from).not.toContain(payload);
    }
  });

  it('replaces a hostile accent', () => {
    for (const payload of payloads) {
      expect(isHexColor(readTheme(stored({ accent: payload })).accent)).toBe(true);
    }
  });

  it('keeps a valid gradient when only the accent is corrupt', () => {
    // One bad field costs the user that field, not their whole theme.
    const theme = readTheme(stored({ accent: 'url(evil)' }));
    expect(theme.gradient.from).toBe('#22d3ee');
    expect(theme.accent).toBe('#22d3ee');
  });

  it('never returns a non-hex colour, whatever it is given', () => {
    const nonsense: unknown[] = [
      null,
      undefined,
      0,
      'string',
      [],
      true,
      { gradient: 'not-an-object' },
      { gradient: [] },
      { gradient: { from: {}, to: [] } },
      Object.create(null),
      { __proto__: { from: 'url(x)' } },
    ];
    for (const value of nonsense) {
      const theme = readTheme(value);
      expect(isHexColor(theme.gradient.from)).toBe(true);
      expect(isHexColor(theme.gradient.to)).toBe(true);
      expect(isHexColor(theme.accent)).toBe(true);
    }
  });
});

describe('readTheme — numbers', () => {
  it('rejects NaN and Infinity rather than clamping them', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const theme = readTheme(
        stored({ gradient: { from: '#22d3ee', to: '#0e4f5c', angleDeg: value, intensity: value } }),
      );
      expect(Number.isFinite(theme.gradient.angleDeg)).toBe(true);
      expect(Number.isFinite(theme.gradient.intensity)).toBe(true);
      expect(theme.gradient.intensity).toBe(DEFAULT_THEME.gradient.intensity);
    }
  });

  it('rejects out-of-range values rather than accepting them', () => {
    const theme = readTheme(
      stored({ gradient: { from: '#22d3ee', to: '#0e4f5c', angleDeg: 100_000, intensity: -50 } }),
    );
    expect(theme.gradient.angleDeg).toBe(DEFAULT_THEME.gradient.angleDeg);
    expect(theme.gradient.intensity).toBe(DEFAULT_THEME.gradient.intensity);
  });

  it('rejects numbers disguised as strings', () => {
    const theme = readTheme(
      stored({ gradient: { from: '#22d3ee', to: '#0e4f5c', angleDeg: '135', intensity: '40' } }),
    );
    expect(theme.gradient.angleDeg).toBe(DEFAULT_THEME.gradient.angleDeg);
  });

  it('accepts the boundaries', () => {
    const low = readTheme(
      stored({ gradient: { from: '#22d3ee', to: '#0e4f5c', angleDeg: 0, intensity: 0 } }),
    );
    expect(low.gradient.angleDeg).toBe(0);
    expect(low.gradient.intensity).toBe(0);

    const high = readTheme(
      stored({ gradient: { from: '#22d3ee', to: '#0e4f5c', angleDeg: 359, intensity: 100 } }),
    );
    expect(high.gradient.angleDeg).toBe(359);
    expect(high.gradient.intensity).toBe(100);
  });

  it('rounds a fractional angle instead of writing a fraction into CSS', () => {
    const theme = readTheme(
      stored({ gradient: { from: '#22d3ee', to: '#0e4f5c', angleDeg: 135.7, intensity: 40 } }),
    );
    expect(theme.gradient.angleDeg).toBe(136);
    expect(Number.isInteger(theme.gradient.angleDeg)).toBe(true);
  });
});

describe('readTheme — enums', () => {
  it('rejects an unknown contrast mode', () => {
    expect(readTheme(stored({ contrastMode: 'ultra' })).contrastMode).toBe('normal');
    expect(readTheme(stored({ contrastMode: 'high' })).contrastMode).toBe('high');
  });

  it('rejects an unknown motion mode', () => {
    expect(readTheme(stored({ reducedMotion: 'wobble' })).reducedMotion).toBe('system');
    expect(readTheme(stored({ reducedMotion: 'never' })).reducedMotion).toBe('never');
  });

  it('rejects an enum value that would be a CSS injection', () => {
    // These land in `dataset`, not in a property value, but the same rule
    // applies: membership, not filtering.
    const theme = readTheme(stored({ contrastMode: 'high"] { display: none } [x="' }));
    expect(theme.contrastMode).toBe('normal');
  });

  it('rejects an unknown preset id rather than preserving it', () => {
    expect(readTheme(stored({ preset: 'neon-gamer' })).preset).toBe('matrix');
    expect(readTheme(stored({ preset: 'custom' })).preset).toBe('custom');
    expect(readTheme(stored({ preset: 42 })).preset).toBe('matrix');
  });

  it('rejects a font scale outside the four allowed steps', () => {
    expect(readTheme(stored({ fontScale: 3 })).fontScale).toBe(1);
    expect(readTheme(stored({ fontScale: 0 })).fontScale).toBe(1);
    expect(readTheme(stored({ fontScale: 1.125 })).fontScale).toBe(1.125);
  });
});

describe('readTheme — schema versions', () => {
  it('reads the current version', () => {
    expect(readTheme(stored({ schemaVersion: THEME_SCHEMA_VERSION })).preset).toBe('cyan');
  });

  it('falls back to the default for a newer version', () => {
    // Safe to discard, unlike history: a theme is a preference the user can
    // set again, and showing them an interface they cannot fix would be worse.
    expect(readTheme(stored({ schemaVersion: 99 }))).toEqual(DEFAULT_THEME);
  });

  it('falls back for a malformed version', () => {
    for (const version of [0, -1, Number.NaN, 'one', null, {}]) {
      expect(readTheme(stored({ schemaVersion: version }))).toEqual(DEFAULT_THEME);
    }
  });

  it('reads pre-versioning data rather than discarding it', () => {
    const legacy = stored();
    delete legacy.schemaVersion;
    expect(readTheme(legacy).gradient.from).toBe('#22d3ee');
  });

  it('always stamps the current version on what it returns', () => {
    expect(readTheme(stored({ schemaVersion: 1 })).schemaVersion).toBe(THEME_SCHEMA_VERSION);
  });
});

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

describe('presets', () => {
  it('has the six documented presets, default first', () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      'matrix',
      'crimsonNight',
      'emerald',
      'cyan',
      'amber',
      'mono',
    ]);
    expect(DEFAULT_THEME.preset).toBe('matrix');
  });

  it('defines every preset with valid, in-range values', () => {
    for (const preset of PRESETS) {
      expect(isHexColor(preset.from), preset.id).toBe(true);
      expect(isHexColor(preset.to), preset.id).toBe(true);
      expect(preset.angleDeg).toBeGreaterThanOrEqual(0);
      expect(preset.angleDeg).toBeLessThanOrEqual(359);
      expect(preset.intensity).toBeGreaterThanOrEqual(0);
      expect(preset.intensity).toBeLessThanOrEqual(100);
    }
  });

  it('uses the four specified Matrix colours, exactly', () => {
    // These values are given rather than chosen. A drift here — including a
    // case change or a near-miss shade — is a silent rebrand, so they are
    // asserted literally.
    expect(DEFAULT_THEME.gradient).toEqual({
      from: '#00FF41',
      mid1: '#008F11',
      mid2: '#003B00',
      to: '#0D0208',
      angleDeg: 135,
      intensity: 40,
    });

    const stops = [
      DEFAULT_THEME.gradient.from,
      DEFAULT_THEME.gradient.mid1,
      DEFAULT_THEME.gradient.mid2,
      DEFAULT_THEME.gradient.to,
    ].map((value) => value.toUpperCase());
    expect(stops).toEqual(['#00FF41', '#008F11', '#003B00', '#0D0208']);
  });

  it('defines Crimson Night with the two specified colours, exactly', () => {
    const crimson = presetById('crimsonNight');
    expect(crimson?.from).toBe('#DC143C');
    expect(crimson?.to).toBe('#343434');
  });

  it('keeps a specified colour in the gradient even when it fails contrast', () => {
    // #DC143C measures 3.67:1 against the surface. The rule is to fix the
    // derived token, never the colour that was asked for.
    const theme = themeFromPreset(presetById('crimsonNight')!);
    expect(theme.gradient.from).toBe('#DC143C');
    expect(verdictFor(theme.gradient.from)).not.toBe('pass');

    // The accent stays the specified colour — it is the dominant one, and the
    // theme must read as black and crimson rather than grey and pink.
    expect(theme.accent).toBe('#DC143C');

    // Only the companion that carries text and the focus ring is lightened.
    expect(theme.accentLegible).not.toBe('#DC143C');
    expect(verdictFor(theme.accentLegible)).toBe('pass');
  });

  it('interpolates the middle stops for a two-colour preset', () => {
    const theme = themeFromPreset(presetById('crimsonNight')!);
    expect(theme.gradient.mid1).toBe(mixHex('#DC143C', '#343434', 1 / 3));
    expect(theme.gradient.mid2).toBe(mixHex('#DC143C', '#343434', 2 / 3));
  });

  it('gives every preset a legible accent companion', () => {
    // 09_DESIGN_SYSTEM.md §4.5. The user may choose a failing colour; a
    // shipped preset may not leave text unreadable.
    for (const preset of PRESETS) {
      const theme = themeFromPreset(preset);
      expect(verdictFor(theme.accentLegible), `${preset.id} ${theme.accentLegible}`).toBe('pass');
    }
  });

  it('keeps every preset gradient restrained', () => {
    // "The gradient is a garnish, not the meal" — 09_DESIGN_SYSTEM.md §1.
    for (const preset of PRESETS) {
      expect(preset.intensity, preset.id).toBeLessThanOrEqual(40);
    }
  });

  it('resolves and rejects preset ids', () => {
    expect(presetById('amber')?.name).toBe('Amber Console');
    expect(presetById('nope')).toBeNull();
    expect(presetById('custom')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Contrast
 * ------------------------------------------------------------------ */

describe('contrast', () => {
  it('computes the WCAG ratio', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBe(contrastRatio('#000000', '#ffffff'));
  });

  it('grades a colour against the surface', () => {
    expect(verdictFor('#00ff88')).toBe('pass');
    expect(verdictFor('#0d1117')).toBe('fail');
  });

  it('lightens a failing colour until it passes, and leaves a passing one alone', () => {
    const dark = '#1a3d2a';
    expect(verdictFor(dark)).not.toBe('pass');
    const fixed = lightenToPass(dark);
    expect(verdictFor(fixed)).toBe('pass');
    expect(isHexColor(fixed)).toBe(true);

    expect(lightenToPass('#00ff88')).toBe('#00ff88');
  });

  it('always returns a valid hex, even for black', () => {
    const fixed = lightenToPass('#000000');
    expect(isHexColor(fixed)).toBe(true);
    expect(verdictFor(fixed)).toBe('pass');
  });

  it('judges against the stricter of the two real surfaces', () => {
    // Read out of the stylesheet rather than restated here: the guard reports
    // a ratio with confidence, so the background it measures against has to be
    // one the colour is actually shown on.
    //
    // Since the M10 family split there are two `--gray-900` declarations — the
    // neutral ramp's, and the green family's tinted override. The guard must
    // use whichever yields the *lower* ratio, or it would pass a colour that
    // is unreadable in the other family.
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    const surfaces = [...tokens.matchAll(/--gray-900:\s*(#[0-9a-fA-F]{6})/g)].map((match) =>
      (match[1] ?? '').toLowerCase(),
    );

    expect(isHexColor(SURFACE_HEX)).toBe(true);
    expect(/--color-surface:\s*var\(--gray-900\)/.test(tokens)).toBe(true);
    expect(surfaces).toHaveLength(2);
    expect(surfaces).toContain(SURFACE_HEX.toLowerCase());

    // A lighter background gives a lower ratio against light text.
    const strictest = surfaces.reduce((worst, candidate) =>
      contrastRatio('#ffffff', candidate) < contrastRatio('#ffffff', worst) ? candidate : worst,
    );
    expect(SURFACE_HEX.toLowerCase()).toBe(strictest);
  });
});

/* ------------------------------------------------------------------ *
 * Directions and derived state
 * ------------------------------------------------------------------ */

describe('directions', () => {
  it('maps every direction to a bounded integer angle', () => {
    for (const direction of DIRECTIONS) {
      expect(Number.isInteger(direction.angleDeg)).toBe(true);
      expect(direction.angleDeg).toBeGreaterThanOrEqual(0);
      expect(direction.angleDeg).toBeLessThanOrEqual(359);
      expect(angleFor(direction.id)).toBe(direction.angleDeg);
    }
  });

  it('round-trips an angle through its direction', () => {
    for (const direction of DIRECTIONS) {
      expect(directionFor(direction.angleDeg)).toBe(direction.id);
    }
  });

  it('shows the nearest direction for an angle that is not one of them', () => {
    // Reachable by hand-editing storage; leaving every radio unselected would
    // be worse than showing the closest.
    expect(directionFor(140)).toBe('diagonal');
    expect(directionFor(0)).toBe('reverseDiagonal');
    expect(directionFor(359)).toBe('topToBottom');
  });
});

describe('derived state', () => {
  it('knows when a theme still matches its preset', () => {
    expect(matchesPreset(themeFromPreset(PRESETS[1]!))).toBe(true);
    const drifted = readTheme(
      stored({
        preset: 'cyan',
        gradient: { from: '#ff0000', to: '#0e4f5c', angleDeg: 145, intensity: 35 },
      }),
    );
    expect(matchesPreset(drifted)).toBe(false);
  });

  it('knows the default theme', () => {
    expect(isDefaultTheme(DEFAULT_THEME)).toBe(true);
    expect(isDefaultTheme({ ...DEFAULT_THEME, fontScale: 1.25 })).toBe(false);
    expect(isDefaultTheme(themeFromPreset(PRESETS[2]!))).toBe(false);
  });

  it('keeps the accent exact and lightens only the companion', () => {
    for (const preset of PRESETS) {
      const theme = themeFromPreset(preset);
      expect(theme.accent).toBe(preset.from);
      expect(theme.gradient.from).toBe(preset.from);
      expect(theme.accentLegible).toBe(lightenToPass(preset.from));
    }
  });

  it('offers only the four documented font scales', () => {
    expect([...FONT_SCALES]).toEqual([0.875, 1, 1.125, 1.25]);
  });
});
