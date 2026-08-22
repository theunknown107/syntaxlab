import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyTheme,
  flushTheme,
  reloadThemeFromUrl,
  resetTheme,
  selectPreset,
  setTheme,
  themeStore,
  updateGradient,
  updateTheme,
  THEME_LEGACY_STORAGE_KEY,
} from '@/application/theme/themeStore';
import { DEFAULT_THEME, isHexColor, PRESETS, readTheme } from '@/domain/theme/preferences';
import { encodeThemeParams } from '@/domain/theme/urlPreferences';

/**
 * Theme application — 09_DESIGN_SYSTEM.md §4.4
 *
 * What matters here is that a change reaches CSS custom properties and only
 * validated values ever get there, and that the URL write is debounced without
 * the *visual* update being debounced with it.
 *
 * From M15 the theme persists in the URL rather than localStorage, so the
 * persistence tests below assert on `location.search` and on the *absence* of
 * storage writes.
 */

const root = document.documentElement;

function property(name: string): string {
  return root.style.getPropertyValue(name);
}

/** The theme parameters currently in the address bar. */
function urlParams(): URLSearchParams {
  return new URLSearchParams(location.search);
}

function urlValue(name: string): string | null {
  return urlParams().get(name);
}

function setUrl(search: string): void {
  history.replaceState(null, '', `/${search}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  setUrl('');
  root.removeAttribute('style');
  delete root.dataset.contrast;
  delete root.dataset.motion;
  themeStore.setState(DEFAULT_THEME);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('applyTheme', () => {
  it('writes the whole theme into custom properties', () => {
    applyTheme(DEFAULT_THEME);

    expect(property('--gradient-from')).toBe('#00FF41');
    expect(property('--gradient-mid-1')).toBe('#008F11');
    expect(property('--gradient-mid-2')).toBe('#003B00');
    expect(property('--gradient-to')).toBe('#0D0208');
    expect(property('--gradient-angle')).toBe('135deg');
    expect(property('--gradient-intensity')).toBe('0.4');
    expect(property('--color-accent')).toBe('#00FF41');
    expect(property('--glow-intensity')).toBe('0.25');
    expect(property('--font-scale')).toBe('1');
    expect(root.dataset.contrast).toBe('normal');
    expect(root.dataset.motion).toBe('system');
  });

  it('writes an angle as a unit-suffixed integer, never a raw number', () => {
    applyTheme({ ...DEFAULT_THEME, gradient: { ...DEFAULT_THEME.gradient, angleDeg: 90 } });
    expect(property('--gradient-angle')).toBe('90deg');
  });

  it('converts a 0–100 stored value to the 0–1 fraction the tokens expect', () => {
    applyTheme({ ...DEFAULT_THEME, glowIntensity: 0 });
    expect(property('--glow-intensity')).toBe('0');

    applyTheme({ ...DEFAULT_THEME, glowIntensity: 100 });
    expect(property('--glow-intensity')).toBe('1');
  });
});

describe('setTheme', () => {
  it('applies immediately and writes the URL after a delay', () => {
    setTheme({ ...DEFAULT_THEME, glowIntensity: 60 });

    // Visible at once — a slider must not lag behind the thumb.
    expect(property('--glow-intensity')).toBe('0.6');
    expect(urlValue('glow')).toBeNull();

    vi.advanceTimersByTime(300);
    expect(urlValue('glow')).toBe('60');
  });

  it('writes the URL once for a burst of changes, not once per change', () => {
    const replaceState = vi.spyOn(history, 'replaceState');

    for (let value = 0; value <= 100; value += 5) {
      setTheme({ ...DEFAULT_THEME, glowIntensity: value });
    }
    expect(replaceState).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(replaceState).toHaveBeenCalledTimes(1);
    replaceState.mockRestore();
  });

  it('never pushes a history entry — Back must stay useful', () => {
    // Dragging a slider changes the theme dozens of times. Each one pushing an
    // entry would bury the page the user came from under identical URLs.
    const pushState = vi.spyOn(history, 'pushState');
    const replaceState = vi.spyOn(history, 'replaceState');

    for (let value = 0; value <= 100; value += 10) {
      setTheme({ ...DEFAULT_THEME, glowIntensity: value });
      vi.advanceTimersByTime(300);
    }

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState.mock.calls.length).toBeGreaterThan(0);
    pushState.mockRestore();
    replaceState.mockRestore();
  });

  it('never writes the theme to localStorage', () => {
    // The architectural claim of M15, asserted rather than assumed.
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const instanceSetItem = vi.spyOn(localStorage, 'setItem');

    setTheme({ ...DEFAULT_THEME, glowIntensity: 33 });
    selectPreset('amber');
    updateGradient({ from: '#ff0000' });
    updateTheme({ fontScale: 1.25 });
    vi.advanceTimersByTime(1000);
    flushTheme();

    expect(setItem).not.toHaveBeenCalled();
    expect(instanceSetItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    instanceSetItem.mockRestore();
  });

  it('leaves parameters it does not own alone', () => {
    setUrl('?mode=json');
    setTheme({ ...DEFAULT_THEME, preset: 'amber' });
    vi.advanceTimersByTime(300);

    expect(urlValue('mode')).toBe('json');
    expect(urlValue('theme')).toBe('amber');
  });

  it('flushes a pending write on demand', () => {
    setTheme({ ...DEFAULT_THEME, glowIntensity: 42 });
    expect(urlValue('glow')).toBeNull();

    flushTheme();
    expect(urlValue('glow')).toBe('42');
  });

  it('survives a history API that refuses to write', () => {
    const replaceState = vi.spyOn(history, 'replaceState').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => {
      setTheme({ ...DEFAULT_THEME, glowIntensity: 10 });
      vi.advanceTimersByTime(300);
    }).not.toThrow();
    // The theme still applies for the session.
    expect(property('--glow-intensity')).toBe('0.1');
    replaceState.mockRestore();
  });
});

describe('presets', () => {
  it('applies a preset to CSS', () => {
    selectPreset('amber');
    expect(property('--gradient-from')).toBe('#fbbf24');
    expect(themeStore.getState().preset).toBe('amber');
  });

  it('ignores an unknown preset id rather than producing a broken theme', () => {
    selectPreset('matrix');
    selectPreset('neon-gamer');
    expect(themeStore.getState().preset).toBe('matrix');
    expect(property('--gradient-from')).toBe('#00FF41');
  });

  it('keeps the accessibility settings when the colour scheme changes', () => {
    // Picking a new palette must not quietly undo the setting someone needs
    // in order to read the screen.
    updateTheme({ contrastMode: 'high', reducedMotion: 'never', fontScale: 1.25 });
    selectPreset('cyan');

    const theme = themeStore.getState();
    expect(theme.preset).toBe('cyan');
    expect(theme.contrastMode).toBe('high');
    expect(theme.reducedMotion).toBe('never');
    expect(theme.fontScale).toBe(1.25);
  });
});

describe('custom colours', () => {
  it('marks the theme custom once it diverges from its preset', () => {
    selectPreset('matrix');
    expect(themeStore.getState().preset).toBe('matrix');

    updateGradient({ from: '#ff0000' });
    expect(themeStore.getState().preset).toBe('custom');
    expect(property('--gradient-from')).toBe('#ff0000');
  });

  it('keeps the accent on the primary colour, so the focus ring matches', () => {
    updateGradient({ from: '#ff0000' });
    expect(themeStore.getState().accent).toBe('#ff0000');
    expect(property('--color-accent')).toBe('#ff0000');
  });

  it('returns to naming the preset when the values match it again', () => {
    selectPreset('amber');
    updateGradient({ from: '#ff0000' });
    expect(themeStore.getState().preset).toBe('custom');

    updateGradient({ from: '#fbbf24' });
    expect(themeStore.getState().preset).toBe('amber');
  });

  it('changes direction through the bounded angle', () => {
    updateGradient({ angleDeg: 90 });
    expect(property('--gradient-angle')).toBe('90deg');
  });
});

describe('reset', () => {
  it('restores the default, applies it, and persists without a reload', () => {
    selectPreset('mono');
    updateGradient({ from: '#ff0000' });
    updateTheme({ fontScale: 1.25 });

    resetTheme();

    expect(themeStore.getState()).toEqual(DEFAULT_THEME);
    expect(property('--gradient-from')).toBe('#00FF41');
    expect(property('--font-scale')).toBe('1');
    // Written at once, not on a debounce: reset is a deliberate act.
    expect(urlValue('theme')).toBe('matrix');
    // And the overrides are gone rather than left behind.
    expect(urlValue('font')).toBeNull();
    expect(urlValue('gf')).toBeNull();
  });
});

describe('reading the theme back from the URL', () => {
  it('applies what the URL says', () => {
    setUrl(
      `?${new URLSearchParams(
        encodeThemeParams(
          readTheme({
            ...DEFAULT_THEME,
            preset: 'cyan',
            gradient: { from: '#22d3ee', to: '#0e4f5c', angleDeg: 145, intensity: 35 },
          }),
        ),
      ).toString()}`,
    );
    reloadThemeFromUrl();
    expect(property('--gradient-from')).toBe('#22d3ee');
    expect(themeStore.getState().preset).toBe('cyan');
  });

  it('falls back to the default when the URL says nothing', () => {
    setUrl('?mode=json');
    reloadThemeFromUrl();
    expect(themeStore.getState()).toEqual(DEFAULT_THEME);
    expect(property('--gradient-from')).toBe('#00FF41');
  });

  it('never writes an unvalidated value into CSS, whatever the URL holds', () => {
    // A URL is attacker-authored in a way localStorage never was: anyone can
    // send anyone a link. These are the payloads that would matter.
    const queries = [
      '?theme=matrix&gf=red%3Bbackground%3Aurl(https%3A%2F%2Fattacker.example)',
      '?theme=matrix&gf=url(x)&gt=javascript%3Aalert(1)&accent=%3Cstyle%3Ex%3C%2Fstyle%3E',
      '?theme=matrix&ga=90deg%3B%20--color-bg%3A%20red',
      '?theme=matrix&tv=99&gf=000000',
      '?theme=matrix&contrast=high%22%5D%20*%20%7B%20display%3A%20none%20%7D%20%5Bx%3D%22',
      '?theme=%2E%2E%2F%2E%2E%2F',
      '?accent=%23%23%23%23%23%23',
      '?gi=1e309',
    ];

    for (const query of queries) {
      setUrl(query);
      reloadThemeFromUrl();

      for (const name of ['--gradient-from', '--gradient-to', '--color-accent']) {
        expect(isHexColor(property(name)), `${query} → ${name}`).toBe(true);
      }
      expect(property('--gradient-angle'), query).toMatch(/^\d{1,3}deg$/);
      expect(property('--gradient-intensity'), query).toMatch(/^\d(\.\d+)?$/);
      expect(['normal', 'high'], query).toContain(root.dataset.contrast);
    }
  });

  it('exposes the legacy storage key only so a migration can read it', () => {
    // The key still exists as an export because the one-time migration needs
    // it. Nothing writes it.
    expect(THEME_LEGACY_STORAGE_KEY).toBe('syntaxlab.theme.v1');
  });
});

describe('the presets as applied', () => {
  it('every preset produces only valid CSS values', () => {
    for (const preset of PRESETS) {
      selectPreset(preset.id);
      expect(isHexColor(property('--gradient-from')), preset.id).toBe(true);
      expect(isHexColor(property('--gradient-to')), preset.id).toBe(true);
      expect(property('--gradient-angle')).toMatch(/^\d{1,3}deg$/);
    }
  });
});

describe('the setProperty boundary', () => {
  /**
   * `applyTheme` writes into CSS custom properties, so the guarantee that only
   * validated values reach it has to hold for *every* caller — including our
   * own controls, whose values come from the platform rather than from us.
   */
  it('revalidates even a theme handed straight in', () => {
    setTheme({
      ...DEFAULT_THEME,
      // The shapes a compromised or mistaken caller could produce. TypeScript
      // does not run at runtime, so the type here proves nothing.
      gradient: {
        from: 'red; background: url(https://attacker.example)',
        mid1: 'expression(alert(1))',
        mid2: '#00FF41; --injected: 1',
        to: 'url(x)',
        angleDeg: Number.POSITIVE_INFINITY,
        intensity: 100_000,
      },
      accent: '<style>x</style>',
      contrastMode: 'high"] * { display: none } [x="' as never,
      fontScale: 99,
    });

    expect(isHexColor(property('--gradient-from'))).toBe(true);
    expect(isHexColor(property('--gradient-to'))).toBe(true);
    expect(isHexColor(property('--color-accent'))).toBe(true);
    expect(property('--gradient-angle')).toMatch(/^\d{1,3}deg$/);
    expect(property('--gradient-intensity')).toMatch(/^\d*\.?\d+$/);
    expect(property('--font-scale')).toBe('1');
    expect(['normal', 'high']).toContain(root.dataset.contrast);
  });

  it('leaves an already-valid theme untouched', () => {
    // Idempotent, or revalidating at the boundary would quietly rewrite the
    // user's choices every time they changed something.
    const theme = { ...DEFAULT_THEME, glowIntensity: 55, fontScale: 1.125 } as const;
    setTheme(theme);
    expect(themeStore.getState()).toEqual(theme);
  });
});
