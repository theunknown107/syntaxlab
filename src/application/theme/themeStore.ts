import {
  DEFAULT_THEME,
  interpolateStops,
  lightenToPass,
  presetById,
  presetIdFor,
  readTheme,
  themeFromPreset,
  type ThemePreferences,
} from '@/domain/theme/preferences';
import { themeFromParams, withThemeParams } from '@/domain/theme/urlPreferences';

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
 *
 * **Where a theme lives changed at M15: the URL, not localStorage.** The store
 * is still in-memory state and `applyTheme` still writes CSS properties; what
 * moved is persistence. A theme is now something you can send someone, and
 * something that survives a browser that clears site data. localStorage is
 * read exactly once, to migrate an existing user, and then let go of.
 *
 * The chain is unchanged where it matters:
 *
 *   URL params → readTheme → in-memory store → CSS custom properties
 *
 * `readTheme` is still the single validation choke point. A URL is
 * attacker-authored in a way localStorage never was — anyone can send anyone a
 * link — which makes that choke point more important, not less.
 */

/**
 * The key M8 through M14 wrote to.
 *
 * Kept only so an existing user's theme can be read once and moved into the
 * URL. Nothing writes it any more.
 */
const LEGACY_STORAGE_KEY = 'syntaxlab.theme.v1';

/** How long after the last change the URL is rewritten. */
const URL_WRITE_DELAY_MS = 250;

/**
 * The theme an existing installation left behind, if any.
 *
 * Read through `readTheme` exactly as before, because a stored value is still
 * attacker-writable and this is still a `setProperty` sink. The only change is
 * that the result is migrated into the URL rather than trusted as the ongoing
 * source of truth.
 */
function readLegacyStored(): ThemePreferences | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw === null) return null;
    return readTheme(JSON.parse(raw) as unknown);
  } catch {
    // Unparseable JSON, or storage that throws on access — private mode, or an
    // enterprise policy. There is nothing to migrate, and defaults are a
    // working app.
    return null;
  }
}

/**
 * Forgets the legacy key, and only that key.
 *
 * History lives in IndexedDB and settings under their own keys; a migration
 * that swept localStorage would destroy data it was never asked about.
 */
function dropLegacyStored(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage unavailable. The value is already superseded by the URL, so a
    // failure to tidy up changes nothing the user can see.
  }
}

function currentParams(): URLSearchParams {
  return new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
}

/**
 * The theme this document starts with.
 *
 * The URL wins. Only when it says nothing about the theme is the legacy store
 * consulted, and a value found there is migrated into the URL immediately so
 * the next load takes the first branch.
 */
function readInitial(): ThemePreferences {
  const fromUrl = themeFromParams(currentParams());
  if (fromUrl !== null) return fromUrl;

  const legacy = readLegacyStored();
  if (legacy === null) return DEFAULT_THEME;

  writeUrl(legacy);
  dropLegacyStored();
  return legacy;
}

export const themeStore = createStore<ThemePreferences>(readInitial());

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
  style.setProperty('--gradient-mid-1', theme.gradient.mid1);
  style.setProperty('--gradient-mid-2', theme.gradient.mid2);
  style.setProperty('--gradient-to', theme.gradient.to);
  style.setProperty('--gradient-angle', `${theme.gradient.angleDeg}deg`);
  style.setProperty('--gradient-intensity', String(theme.gradient.intensity / 100));
  style.setProperty('--color-accent', theme.accent);
  style.setProperty('--color-accent-legible', theme.accentLegible);
  style.setProperty('--glow-intensity', String(theme.glowIntensity / 100));
  style.setProperty('--font-scale', String(theme.fontScale));

  // Drives the neutral ramp. One attribute rather than nine colour writes,
  // and the tint lives in the stylesheet where the design system is.
  root.dataset.themeFamily = theme.family;
  root.dataset.contrast = theme.contrastMode;
  root.dataset.motion = theme.reducedMotion;
}

let urlTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Applies immediately, rewrites the URL shortly afterwards.
 *
 * The split matters for a slider: dragging it should repaint on every frame,
 * and must not rewrite the address bar on every frame. The visual update is
 * synchronous; only the URL write is debounced.
 *
 * **Everything is revalidated here, including values from our own UI.** The
 * colour controls hand over `input[type="color"].value`, which the platform
 * guarantees to be `#rrggbb` — but that guarantee lives in a specification,
 * not in this codebase, and `applyTheme` is a `setProperty` sink. Validating
 * at this one choke point makes the invariant structural instead of a comment
 * every future caller has to have read. `readTheme` is total and idempotent,
 * so a theme that is already valid passes through unchanged.
 */
export function setTheme(candidate: ThemePreferences): void {
  const theme = readTheme(candidate);
  themeStore.setState(theme);
  applyTheme(theme);

  if (urlTimer !== null) clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    urlTimer = null;
    writeUrl(theme);
  }, URL_WRITE_DELAY_MS);
}

/**
 * Rewrites the address bar in place.
 *
 * **`replaceState`, never `pushState`.** Dragging the intensity slider changes
 * the theme dozens of times; each one pushing a history entry would bury
 * whatever page the user came from under a hundred identical-looking URLs and
 * make Back useless. A theme tweak is not a navigation.
 *
 * Debounced above as well, so a drag rewrites the URL once when it settles
 * rather than on every frame.
 */
function writeUrl(theme: ThemePreferences): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  const search = withThemeParams(location.search, theme);
  if (search === location.search) return;
  try {
    history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
  } catch {
    // Some embedded contexts refuse history writes. The theme still applies
    // for this session; it simply will not survive a reload.
  }
}

/** Writes any pending change now. Used before the tab is hidden or closed. */
export function flushTheme(): void {
  if (urlTimer === null) return;
  clearTimeout(urlTimer);
  urlTimer = null;
  writeUrl(themeStore.getState());
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

/**
 * Applies one change to the gradient.
 *
 * The preset name is re-derived from the resulting values rather than carried
 * forward, so it describes what the theme *is*. Editing away from Amber names
 * the theme custom; editing exactly back to Amber names it Amber again.
 */
export function updateGradient(patch: Partial<ThemePreferences['gradient']>): void {
  const current = themeStore.getState();
  const ends = { ...current.gradient, ...patch };

  // Editing either end re-derives the middle stops. Keeping the old ones would
  // leave a crimson ramp running through green, which is not a gradient anyone
  // asked for. An edit that only changes the angle or intensity leaves them
  // alone, so a preset that names its own stops — Matrix — keeps them.
  const endsMoved = patch.from !== undefined || patch.to !== undefined;
  const [mid1, mid2] = endsMoved ? interpolateStops(ends.from, ends.to) : [ends.mid1, ends.mid2];
  const gradient = { ...ends, mid1, mid2 };

  setTheme({
    ...current,
    gradient,
    // The accent follows the start colour, lightened only as far as legibility
    // requires. The gradient itself always keeps the chosen colour exactly.
    accent: gradient.from,
    accentLegible: lightenToPass(gradient.from),
    preset: presetIdFor(gradient),
  });
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

/**
 * Re-reads the theme from the URL and applies it.
 *
 * Used when the document's URL changes underneath the app — a Back or Forward
 * that lands on a different theme, which is the one navigation case
 * `replaceState` does not eliminate.
 *
 * **Not a cross-tab mechanism.** Losing localStorage's `storage` event means
 * two tabs no longer share a theme, and that is the correct behaviour now that
 * the theme is part of the address: two tabs on two URLs are two documents
 * with two themes, exactly as they are with any other page. Adding a
 * BroadcastChannel to recreate the old behaviour would be rebuilding a
 * coupling the move to the URL deliberately removed.
 */
export function reloadThemeFromUrl(): void {
  const theme = themeFromParams(currentParams()) ?? DEFAULT_THEME;
  themeStore.setState(theme);
  applyTheme(theme);
}

export { LEGACY_STORAGE_KEY as THEME_LEGACY_STORAGE_KEY };
