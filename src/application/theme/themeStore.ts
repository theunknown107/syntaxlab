import {
  DEFAULT_THEME,
  matchesPreset,
  presetById,
  readTheme,
  themeFromPreset,
  type ThemePreferences,
} from '@/domain/theme/preferences';

import { createStore } from '../stores/createStore';

/**
 * Theme state and application — 09_DESIGN_SYSTEM.md §4.4, 11_STATE_MANAGEMENT.md §4.3
 *
 * The point of the token architecture is that changing the theme is **not** a
 * React concern. `applyTheme` writes eight custom properties on `<html>` and
 * the whole interface follows, because every component already reads its
 * colours from those properties. Nothing re-renders. That is the entire
 * justification for ADR-005 (plain CSS over a styling framework).
 *
 * The store exists only so the *theme drawer* can show which values are
 * currently set. Nothing else in the application subscribes to it, which is
 * why a slider drag costs one style recalculation rather than a render of the
 * component tree.
 */

const STORAGE_KEY = 'syntaxlab.theme.v1';

/** How long after the last change the preference is written to disk. */
const PERSIST_DELAY_MS = 250;

function readStored(): ThemePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // `readTheme` is total, so a null, a corrupt string or a hostile object
    // all resolve to something usable. There is no error path to handle.
    return readTheme(raw === null ? null : (JSON.parse(raw) as unknown));
  } catch {
    // Unparseable JSON, or storage that throws on access — private mode, or
    // an enterprise policy. Defaults are a working app.
    return DEFAULT_THEME;
  }
}

export const themeStore = createStore<ThemePreferences>(readStored());

/**
 * Writes the theme into CSS custom properties.
 *
 * **Every value here has already been through `readTheme`.** `setProperty`
 * with an unvalidated string is a CSS-injection sink, so the only strings that
 * reach it are hex colours that matched `/^#[0-9a-fA-F]{6}$/` and numbers
 * rebuilt from validated integers. No user text is ever interpolated.
 */
export function applyTheme(theme: ThemePreferences): void {
  const root = document.documentElement;
  const style = root.style;

  style.setProperty('--gradient-from', theme.gradient.from);
  style.setProperty('--gradient-to', theme.gradient.to);
  style.setProperty('--gradient-angle', `${theme.gradient.angleDeg}deg`);
  style.setProperty('--gradient-intensity', String(theme.gradient.intensity / 100));
  style.setProperty('--color-accent', theme.accent);
  style.setProperty('--glow-intensity', String(theme.glowIntensity / 100));
  style.setProperty('--font-scale', String(theme.fontScale));

  root.dataset.contrast = theme.contrastMode;
  root.dataset.motion = theme.reducedMotion;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Applies immediately, saves shortly afterwards.
 *
 * The split matters for a slider: dragging it should repaint on every frame,
 * and must not serialise JSON into localStorage on every frame. The visual
 * update is synchronous; only the write is debounced.
 */
export function setTheme(theme: ThemePreferences): void {
  themeStore.setState(theme);
  applyTheme(theme);

  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist(theme);
  }, PERSIST_DELAY_MS);
}

function persist(theme: ThemePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // A theme that cannot be saved still applies for this session. Reporting
    // it would be noise about a preference, and the user can see their theme
    // working in front of them.
  }
}

/** Writes any pending change now. Used before the tab is hidden or closed. */
export function flushTheme(): void {
  if (persistTimer === null) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  persist(themeStore.getState());
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export function selectPreset(id: string): void {
  const preset = presetById(id);
  if (preset === null) return;

  // Preserves the accessibility choices: contrast, motion and text size are
  // not decoration, and picking a new colour scheme should not quietly undo
  // the setting someone needs to read the screen.
  const current = themeStore.getState();
  setTheme({
    ...themeFromPreset(preset),
    contrastMode: current.contrastMode,
    reducedMotion: current.reducedMotion,
    fontScale: current.fontScale,
  });
}

/** Applies one change to the gradient, marking the theme custom if it diverges. */
export function updateGradient(patch: Partial<ThemePreferences['gradient']>): void {
  const current = themeStore.getState();
  const gradient = { ...current.gradient, ...patch };
  const next: ThemePreferences = {
    ...current,
    gradient,
    // The accent follows the start colour, so the focus ring and the gradient
    // are always the same hue family.
    accent: gradient.from,
    preset: current.preset,
  };
  setTheme({ ...next, preset: matchesPreset(next) ? next.preset : 'custom' });
}

export function updateTheme(patch: Partial<ThemePreferences>): void {
  setTheme({ ...themeStore.getState(), ...patch });
}

/**
 * Back to the documented default.
 *
 * Applies and persists in one step, with no reload: the whole point of the
 * token architecture is that the interface follows the properties.
 */
export function resetTheme(): void {
  setTheme(DEFAULT_THEME);
  flushTheme();
}

/** Re-reads from storage. Used when another tab changes the theme. */
export function reloadTheme(): void {
  const theme = readStored();
  themeStore.setState(theme);
  applyTheme(theme);
}

export { STORAGE_KEY as THEME_STORAGE_KEY };
