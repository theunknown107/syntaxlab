import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyTheme,
  flushTheme,
  reloadTheme,
  resetTheme,
  selectPreset,
  setTheme,
  themeStore,
  updateGradient,
  updateTheme,
  THEME_STORAGE_KEY,
} from '@/application/theme/themeStore';
import { DEFAULT_THEME, isHexColor, PRESETS, readTheme } from '@/domain/theme/preferences';

/**
 * Theme application — 09_DESIGN_SYSTEM.md §4.4
 *
 * What matters here is that a change reaches CSS custom properties and only
 * validated values ever get there, and that persistence is debounced without
 * the *visual* update being debounced with it.
 */

const root = document.documentElement;

function property(name: string): string {
  return root.style.getPropertyValue(name);
}

function stored(): unknown {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
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
  it('applies immediately and saves after a delay', () => {
    setTheme({ ...DEFAULT_THEME, glowIntensity: 60 });

    // Visible at once — a slider must not lag behind the thumb.
    expect(property('--glow-intensity')).toBe('0.6');
    expect(stored()).toBeNull();

    vi.advanceTimersByTime(300);
    expect((stored() as { glowIntensity: number }).glowIntensity).toBe(60);
  });

  it('writes once for a burst of changes, not once per change', () => {
    // Spied on the instance rather than `Storage.prototype`: under happy-dom a
    // prototype spy does not observe these writes, which would make this test
    // pass without measuring anything.
    const setItem = vi.spyOn(localStorage, 'setItem');

    for (let value = 0; value <= 100; value += 5) {
      setTheme({ ...DEFAULT_THEME, glowIntensity: value });
    }
    expect(setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
  });

  it('flushes a pending write on demand', () => {
    setTheme({ ...DEFAULT_THEME, glowIntensity: 42 });
    expect(stored()).toBeNull();

    flushTheme();
    expect((stored() as { glowIntensity: number }).glowIntensity).toBe(42);
  });

  it('survives storage that refuses to write', () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => {
      setTheme({ ...DEFAULT_THEME, glowIntensity: 10 });
      vi.advanceTimersByTime(300);
    }).not.toThrow();
    // The theme still applies for the session.
    expect(property('--glow-intensity')).toBe('0.1');
    setItem.mockRestore();
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
    // Persisted at once, not on a debounce: reset is a deliberate act.
    expect(stored()).toEqual(DEFAULT_THEME);
  });
});

describe('reading back from storage', () => {
  it('applies what another tab wrote', () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify(
        readTheme({
          ...DEFAULT_THEME,
          preset: 'cyan',
          gradient: { from: '#22d3ee', to: '#0e4f5c', angleDeg: 145, intensity: 35 },
        }),
      ),
    );
    reloadTheme();
    expect(property('--gradient-from')).toBe('#22d3ee');
    expect(themeStore.getState().preset).toBe('cyan');
  });

  it('falls back to the default when another tab wrote rubbish', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '{not json');
    reloadTheme();
    expect(themeStore.getState()).toEqual(DEFAULT_THEME);
    expect(property('--gradient-from')).toBe('#00FF41');
  });

  it('never writes an unvalidated value into CSS, whatever storage holds', () => {
    const payloads = [
      '{"gradient":{"from":"red; background:url(https://attacker.example)"}}',
      '{"gradient":{"from":"url(x)","to":"javascript:alert(1)"},"accent":"<style>x</style>"}',
      '{"gradient":{"angleDeg":"90deg; --color-bg: red"}}',
      '{"schemaVersion":99,"gradient":{"from":"#000000"}}',
      '{"contrastMode":"high\\"] * { display: none } [x=\\""}',
      '[]',
      'null',
      '"a string"',
    ];

    for (const payload of payloads) {
      localStorage.setItem(THEME_STORAGE_KEY, payload);
      reloadTheme();

      for (const name of ['--gradient-from', '--gradient-to', '--color-accent']) {
        expect(isHexColor(property(name)), `${payload} → ${name}`).toBe(true);
      }
      expect(property('--gradient-angle')).toMatch(/^\d{1,3}deg$/);
      expect(property('--gradient-intensity')).toMatch(/^\d(\.\d+)?$/);
      expect(['normal', 'high']).toContain(root.dataset.contrast);
    }
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
