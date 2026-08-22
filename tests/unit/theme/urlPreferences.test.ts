import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME,
  presetById,
  readTheme,
  themeFromPreset,
  THEME_SCHEMA_VERSION,
} from '@/domain/theme/preferences';
import {
  decodeThemeCandidate,
  encodeThemeParams,
  isThemeParam,
  MAX_THEME_PARAM_CHARS,
  THEME_PARAMS,
  themeFromParams,
  withThemeParams,
} from '@/domain/theme/urlPreferences';

/**
 * URL-backed preferences — 06_DATA_STORAGE.md §5, 14_THREAT_MODEL.md
 *
 * A URL is attacker-authored: anyone can send anyone a link. These values end
 * up in `setProperty`, so the tests that matter most are the hostile ones.
 */

const params = (query: string): URLSearchParams => new URLSearchParams(query);

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

describe('encoding', () => {
  it('reduces an unmodified preset to a single parameter', () => {
    // The whole point of encoding against a baseline: a URL should say what
    // the user chose, not restate fourteen values they never touched.
    expect(encodeThemeParams(DEFAULT_THEME)).toEqual({ theme: 'matrix' });
  });

  it('encodes every preset as just its id', () => {
    for (const id of ['matrix', 'crimsonNight', 'emerald', 'cyan', 'amber', 'mono']) {
      const preset = presetById(id);
      expect(preset, id).not.toBeNull();
      if (preset === null) continue;
      expect(encodeThemeParams(themeFromPreset(preset)), id).toEqual({ theme: id });
    }
  });

  it('adds only the values that differ', () => {
    const encoded = encodeThemeParams({ ...DEFAULT_THEME, accent: '#123456' });
    expect(encoded).toEqual({
      theme: 'matrix',
      accent: '123456',
      tv: String(THEME_SCHEMA_VERSION),
    });
  });

  it('drops the hash from colours, because a URL has to carry it as %23', () => {
    const encoded = encodeThemeParams({ ...DEFAULT_THEME, accent: '#00FF41', preset: 'custom' });
    expect(Object.values(encoded).join('')).not.toContain('#');
  });

  it('encodes accessibility settings against the defaults, not the preset', () => {
    // A preset is a colour scheme. It does not get to decide someone's text
    // size, so switching preset must not make `font` disappear from the URL.
    const encoded = encodeThemeParams({
      ...DEFAULT_THEME,
      preset: 'amber',
      contrastMode: 'high',
      reducedMotion: 'never',
      fontScale: 1.25,
    });
    expect(encoded.contrast).toBe('high');
    expect(encoded.motion).toBe('never');
    expect(encoded.font).toBe('1.25');
  });

  it('stays well inside the size cap even when everything is custom', () => {
    const custom = readTheme({
      ...DEFAULT_THEME,
      preset: 'custom',
      gradient: {
        from: '#112233',
        mid1: '#445566',
        mid2: '#778899',
        to: '#aabbcc',
        angleDeg: 359,
        intensity: 100,
      },
      accent: '#ddeeff',
      accentLegible: '#ffffff',
      family: 'mono',
      glowIntensity: 100,
      contrastMode: 'high',
      reducedMotion: 'never',
      fontScale: 1.25,
    });
    const query = new URLSearchParams(encodeThemeParams(custom)).toString();
    expect(query.length).toBeLessThan(MAX_THEME_PARAM_CHARS);
  });
});

/* ------------------------------------------------------------------ *
 * Round trip
 * ------------------------------------------------------------------ */

describe('round trip', () => {
  it('survives encode → decode for every preset', () => {
    for (const id of ['matrix', 'crimsonNight', 'emerald', 'cyan', 'amber', 'mono']) {
      const preset = presetById(id);
      if (preset === null) continue;
      const original = themeFromPreset(preset);
      const restored = themeFromParams(new URLSearchParams(encodeThemeParams(original)));
      expect(restored, id).toEqual(original);
    }
  });

  it('survives encode → decode for a fully custom theme', () => {
    const custom = readTheme({
      ...DEFAULT_THEME,
      preset: 'custom',
      gradient: {
        from: '#112233',
        mid1: '#445566',
        mid2: '#778899',
        to: '#aabbcc',
        angleDeg: 45,
        intensity: 73,
      },
      accent: '#ddeeff',
      family: 'cyan',
      glowIntensity: 12,
      contrastMode: 'high',
      reducedMotion: 'never',
      fontScale: 0.875,
    });
    const restored = themeFromParams(new URLSearchParams(encodeThemeParams(custom)));
    expect(restored).toEqual(custom);
  });
});

/* ------------------------------------------------------------------ *
 * Hostile and malformed input
 * ------------------------------------------------------------------ */

describe('hostile parameters', () => {
  it('expresses no theme when there are no theme parameters', () => {
    expect(decodeThemeCandidate(params('mode=json&foo=bar'))).toBeNull();
    expect(themeFromParams(params(''))).toBeNull();
  });

  it('ignores unknown parameters entirely', () => {
    const theme = themeFromParams(params('theme=amber&evil=1&mode=json'));
    expect(theme?.preset).toBe('amber');
  });

  it.each([
    ['a CSS injection through a colour', 'accent=red%3Bbackground%3Aurl(x)'],
    ['a url() value', 'gf=url(https%3A%2F%2Fattacker.example)'],
    ['a var() reference', 'accent=var(--secret)'],
    ['an expression', 'gf=expression(alert(1))'],
    ['a semicolon', 'accent=00FF41%3B'],
    ['a closing brace', 'accent=%7D'],
    ['too few digits', 'accent=00FF4'],
    ['too many digits', 'accent=00FF41AA'],
    ['not hex at all', 'accent=zzzzzz'],
  ])('refuses %s and falls back to a safe colour', (_label, query) => {
    const theme = themeFromParams(params(`theme=matrix&${query}`));
    expect(theme).not.toBeNull();
    if (theme === null) return;
    // Every colour that reaches applyTheme must be exactly #rrggbb.
    for (const value of [
      theme.accent,
      theme.accentLegible,
      theme.gradient.from,
      theme.gradient.mid1,
      theme.gradient.mid2,
      theme.gradient.to,
    ]) {
      expect(value, query).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it.each([
    ['an out-of-range angle', 'ga=9999'],
    ['a negative angle', 'ga=-1'],
    ['a non-numeric angle', 'ga=abc'],
    ['an out-of-range intensity', 'gi=1000'],
    ['an out-of-range glow', 'glow=-50'],
    ['NaN', 'gi=NaN'],
    ['Infinity', 'glow=Infinity'],
  ])('refuses %s and keeps a legal number', (_label, query) => {
    const theme = themeFromParams(params(`theme=matrix&${query}`));
    expect(theme).not.toBeNull();
    if (theme === null) return;
    expect(theme.gradient.angleDeg).toBeGreaterThanOrEqual(0);
    expect(theme.gradient.angleDeg).toBeLessThanOrEqual(359);
    expect(theme.gradient.intensity).toBeGreaterThanOrEqual(0);
    expect(theme.gradient.intensity).toBeLessThanOrEqual(100);
    expect(theme.glowIntensity).toBeGreaterThanOrEqual(0);
    expect(theme.glowIntensity).toBeLessThanOrEqual(100);
  });

  it.each([
    ['an unknown preset', 'theme=../../etc/passwd'],
    ['an unknown family', 'theme=matrix&fam=<script>'],
    ['an unknown contrast mode', 'theme=matrix&contrast=none'],
    ['an unknown motion mode', 'theme=matrix&motion=always-on'],
    ['an unlisted font scale', 'theme=matrix&font=99'],
  ])('refuses %s and keeps an allowlisted value', (_label, query) => {
    const theme = themeFromParams(params(query));
    expect(theme).not.toBeNull();
    if (theme === null) return;
    expect(['green', 'cyan', 'amber', 'crimson', 'mono']).toContain(theme.family);
    expect(['normal', 'high']).toContain(theme.contrastMode);
    expect(['system', 'always', 'never']).toContain(theme.reducedMotion);
    expect([0.875, 1, 1.125, 1.25]).toContain(theme.fontScale);
  });

  it('ignores the theme entirely when the parameters exceed the size cap', () => {
    // Not a partial theme: half of someone's choice is not their choice, and
    // an unbounded URL should not become an unbounded parse.
    const huge = `theme=matrix&accent=${'a'.repeat(MAX_THEME_PARAM_CHARS * 2)}`;
    expect(decodeThemeCandidate(params(huge))).toBeNull();
    expect(themeFromParams(params(huge))).toBeNull();
  });

  it('bounds each value as well as the total', () => {
    const theme = themeFromParams(params(`theme=matrix&fam=${'x'.repeat(64)}`));
    expect(theme?.family).toBe('green');
  });

  it('merges partial parameters with the named preset', () => {
    const theme = themeFromParams(params('theme=crimsonNight&accent=00FF41'));
    const crimson = presetById('crimsonNight');
    expect(crimson).not.toBeNull();
    if (crimson === null) return;
    expect(theme?.accent).toBe('#00FF41');
    // Everything not named comes from the preset, not from the default.
    expect(theme?.gradient.from).toBe(themeFromPreset(crimson).gradient.from);
  });

  it('refuses a schema version from a newer build', () => {
    const theme = themeFromParams(
      params(`theme=matrix&accent=123456&tv=${THEME_SCHEMA_VERSION + 5}`),
    );
    expect(theme).toEqual(DEFAULT_THEME);
  });
});

/* ------------------------------------------------------------------ *
 * Rewriting a query string
 * ------------------------------------------------------------------ */

describe('withThemeParams', () => {
  it('leaves parameters it does not own alone', () => {
    const next = withThemeParams('?mode=json', DEFAULT_THEME);
    expect(next).toContain('mode=json');
    expect(next).toContain('theme=matrix');
  });

  it('replaces rather than accumulates', () => {
    const first = withThemeParams('', { ...DEFAULT_THEME, accent: '#111111' });
    const second = withThemeParams(first, DEFAULT_THEME);
    expect(second).toBe('?theme=matrix');
    expect(second).not.toContain('accent');
  });

  it('never carries editor content', () => {
    // The guard against this quietly becoming the deferred share-URL feature.
    const next = withThemeParams('?mode=regex', DEFAULT_THEME);
    for (const forbidden of ['regex', 'json=', 'cron', 'pattern', 'subject', 'input']) {
      if (forbidden === 'regex') continue; // `mode=regex` is a PWA shortcut, not content
      expect(next).not.toContain(forbidden);
    }
  });

  it('recognises exactly the parameters it owns', () => {
    for (const name of Object.values(THEME_PARAMS)) expect(isThemeParam(name)).toBe(true);
    for (const name of ['mode', 'pattern', 'json', 'cron', 'q']) {
      expect(isThemeParam(name), name).toBe(false);
    }
  });
});
