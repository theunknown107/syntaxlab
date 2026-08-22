import {
  DEFAULT_THEME,
  presetById,
  readTheme,
  themeFromPreset,
  THEME_SCHEMA_VERSION,
  type ThemePreferences,
} from './preferences';

/**
 * Theme preferences as URL parameters — 06_DATA_STORAGE.md §5, 11_STATE_MANAGEMENT.md §4.3
 *
 * Pure functions over strings. No DOM, no `location`, no storage: this module
 * turns a validated `ThemePreferences` into parameters and back, and the
 * caller decides where those parameters live.
 *
 * **This module does not validate.** It decodes into a plain candidate object
 * and hands it to `readTheme`, which is already total, already an allowlist,
 * and already the single choke point every persisted theme has passed through
 * since M8. Adding a second validator here would be a second thing to keep in
 * agreement with the first — which is exactly the failure mode
 * `theme-bootstrap.js` is documented as carrying.
 *
 * **What is deliberately absent: anything the user typed.** No pattern, no
 * JSON document, no cron expression, no test subject, no history. A URL is
 * copied, bookmarked, put in browser history and written to proxy logs; it is
 * the wrong place for source code, and putting it there would quietly ship the
 * deferred share-URL feature (`22_OPEN_QUESTIONS.md` D-02) without the design
 * work that feature needs. Only preferences live here.
 */

/* ------------------------------------------------------------------ *
 * The parameter namespace
 * ------------------------------------------------------------------ */

/**
 * Short names, because they are read by humans in an address bar.
 *
 * The gradient parameters share a `g` prefix so a glance at a URL groups them.
 * Everything else is spelled out — `contrast=high` is self-describing in a way
 * that `c=h` is not, and the bytes saved would not matter.
 */
export const THEME_PARAMS = {
  preset: 'theme',
  from: 'gf',
  mid1: 'gm1',
  mid2: 'gm2',
  to: 'gt',
  angle: 'ga',
  intensity: 'gi',
  accent: 'accent',
  accentLegible: 'al',
  family: 'fam',
  glow: 'glow',
  contrast: 'contrast',
  motion: 'motion',
  font: 'font',
  version: 'tv',
} as const;

const PARAM_NAMES: readonly string[] = Object.values(THEME_PARAMS);

/** True for a parameter this module owns. Everything else is left untouched. */
export function isThemeParam(name: string): boolean {
  return PARAM_NAMES.includes(name);
}

/**
 * The most a theme may contribute to a URL.
 *
 * A fully custom theme encodes to roughly 120 characters. The cap is generous
 * enough that no legitimate theme approaches it and small enough that a
 * hand-crafted URL cannot make the decoder allocate anything interesting.
 * Over the cap the theme parameters are ignored in full rather than partially
 * — half a theme is not a theme someone chose.
 */
export const MAX_THEME_PARAM_CHARS = 512;

/** Individual values are bounded too, so one absurd parameter cannot pass. */
const MAX_VALUE_CHARS = 32;

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

/** `#00FF41` → `00FF41`. The hash costs three characters once encoded. */
function stripHash(hex: string): string {
  return hex.startsWith('#') ? hex.slice(1) : hex;
}

function addHash(value: string): string {
  return `#${value}`;
}

/**
 * The theme a preset id alone would produce, or the default.
 *
 * This is the baseline an encoded theme is compared against, and it is why an
 * unmodified preset encodes to a single parameter.
 */
function baselineFor(presetId: string): ThemePreferences {
  const preset = presetById(presetId);
  return preset === null ? DEFAULT_THEME : themeFromPreset(preset);
}

/**
 * Encodes only what differs from the preset it names.
 *
 * `?theme=matrix` is the whole of an unmodified Matrix theme. A custom accent
 * adds `&accent=…` and nothing else. The alternative — writing all fourteen
 * parameters every time — produces a URL nobody can read and that says
 * nothing about what the user actually chose.
 *
 * The accessibility settings are compared against the *documented defaults*
 * rather than the preset, because presets deliberately do not carry them:
 * choosing a colour scheme must not silently reset someone's text size.
 */
export function encodeThemeParams(theme: ThemePreferences): Record<string, string> {
  const params: Record<string, string> = { [THEME_PARAMS.preset]: theme.preset };
  const base = baselineFor(theme.preset);

  const hex = (name: string, value: string, baseline: string): void => {
    if (value.toLowerCase() !== baseline.toLowerCase()) params[name] = stripHash(value);
  };

  hex(THEME_PARAMS.from, theme.gradient.from, base.gradient.from);
  hex(THEME_PARAMS.mid1, theme.gradient.mid1, base.gradient.mid1);
  hex(THEME_PARAMS.mid2, theme.gradient.mid2, base.gradient.mid2);
  hex(THEME_PARAMS.to, theme.gradient.to, base.gradient.to);
  hex(THEME_PARAMS.accent, theme.accent, base.accent);
  hex(THEME_PARAMS.accentLegible, theme.accentLegible, base.accentLegible);

  if (theme.gradient.angleDeg !== base.gradient.angleDeg) {
    params[THEME_PARAMS.angle] = String(theme.gradient.angleDeg);
  }
  if (theme.gradient.intensity !== base.gradient.intensity) {
    params[THEME_PARAMS.intensity] = String(theme.gradient.intensity);
  }
  if (theme.glowIntensity !== base.glowIntensity) {
    params[THEME_PARAMS.glow] = String(theme.glowIntensity);
  }
  if (theme.family !== base.family) params[THEME_PARAMS.family] = theme.family;

  // Compared against the defaults, not the preset — see the note above.
  if (theme.contrastMode !== DEFAULT_THEME.contrastMode) {
    params[THEME_PARAMS.contrast] = theme.contrastMode;
  }
  if (theme.reducedMotion !== DEFAULT_THEME.reducedMotion) {
    params[THEME_PARAMS.motion] = theme.reducedMotion;
  }
  if (theme.fontScale !== DEFAULT_THEME.fontScale) {
    params[THEME_PARAMS.font] = String(theme.fontScale);
  }

  // Only written when the theme is not simply a preset, because a bare
  // `?theme=matrix` needs no version to be understood.
  if (Object.keys(params).length > 1) {
    params[THEME_PARAMS.version] = String(theme.schemaVersion);
  }
  return params;
}

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

/** A number, or undefined. `readTheme` decides whether the number is legal. */
function numberOf(raw: string | null): number | undefined {
  if (raw === null || raw === '' || raw.length > MAX_VALUE_CHARS) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A string, bounded in length. Its legality is `readTheme`'s business. */
function stringOf(raw: string | null): string | undefined {
  if (raw === null || raw === '' || raw.length > MAX_VALUE_CHARS) return undefined;
  return raw;
}

function hexOf(raw: string | null): string | undefined {
  const value = stringOf(raw);
  return value === undefined ? undefined : addHash(value);
}

/**
 * How much of the query string this module's parameters occupy.
 *
 * Counted over our own parameters only: an unrelated long parameter belonging
 * to something else is not this module's problem, and refusing a theme because
 * of it would be wrong.
 */
export function themeParamSize(params: URLSearchParams): number {
  let total = 0;
  for (const [name, value] of params) {
    if (isThemeParam(name)) total += name.length + value.length + 2;
  }
  return total;
}

/**
 * Turns parameters into a candidate object for `readTheme`.
 *
 * Returns `null` when there is nothing to read — no theme parameters at all,
 * or more of them than the cap allows. `null` means "this URL expresses no
 * theme", which is different from "this URL expresses a broken theme": the
 * latter decodes to a candidate that `readTheme` then repairs field by field.
 *
 * Unknown parameters are not consulted, so they are ignored by construction
 * rather than by a filter that could be forgotten.
 */
export function decodeThemeCandidate(params: URLSearchParams): unknown {
  if (![...params.keys()].some(isThemeParam)) return null;
  if (themeParamSize(params) > MAX_THEME_PARAM_CHARS) return null;

  const preset = stringOf(params.get(THEME_PARAMS.preset));
  // The named preset supplies every value the URL does not override, which is
  // what lets `?theme=crimsonNight&accent=00FF41` mean what it looks like.
  const base = baselineFor(preset ?? DEFAULT_THEME.preset);

  return {
    schemaVersion: numberOf(params.get(THEME_PARAMS.version)) ?? THEME_SCHEMA_VERSION,
    preset: preset ?? base.preset,
    gradient: decodeGradient(params, base),
    accent: hexOf(params.get(THEME_PARAMS.accent)) ?? base.accent,
    accentLegible: hexOf(params.get(THEME_PARAMS.accentLegible)) ?? base.accentLegible,
    family: stringOf(params.get(THEME_PARAMS.family)) ?? base.family,
    glowIntensity: numberOf(params.get(THEME_PARAMS.glow)) ?? base.glowIntensity,
    ...decodeAccessibility(params),
  };
}

/**
 * Contrast, motion and text size.
 *
 * Defaulted from `DEFAULT_THEME` rather than the named preset, matching the
 * encoder: a preset is a colour scheme, and it does not get to decide how
 * large someone needs their text.
 */
function decodeAccessibility(params: URLSearchParams): Record<string, unknown> {
  return {
    contrastMode: stringOf(params.get(THEME_PARAMS.contrast)) ?? DEFAULT_THEME.contrastMode,
    reducedMotion: stringOf(params.get(THEME_PARAMS.motion)) ?? DEFAULT_THEME.reducedMotion,
    fontScale: numberOf(params.get(THEME_PARAMS.font)) ?? DEFAULT_THEME.fontScale,
  };
}

function decodeGradient(params: URLSearchParams, base: ThemePreferences): unknown {
  return {
    from: hexOf(params.get(THEME_PARAMS.from)) ?? base.gradient.from,
    mid1: hexOf(params.get(THEME_PARAMS.mid1)) ?? base.gradient.mid1,
    mid2: hexOf(params.get(THEME_PARAMS.mid2)) ?? base.gradient.mid2,
    to: hexOf(params.get(THEME_PARAMS.to)) ?? base.gradient.to,
    angleDeg: numberOf(params.get(THEME_PARAMS.angle)) ?? base.gradient.angleDeg,
    intensity: numberOf(params.get(THEME_PARAMS.intensity)) ?? base.gradient.intensity,
  };
}

/**
 * The theme a URL expresses, or `null` when it expresses none.
 *
 * Every value has been through `readTheme`, so the result is safe to hand to
 * `applyTheme` — which is a `setProperty` sink and accepts nothing else.
 */
export function themeFromParams(params: URLSearchParams): ThemePreferences | null {
  const candidate = decodeThemeCandidate(params);
  return candidate === null ? null : readTheme(candidate);
}

/**
 * Rewrites a query string so it carries `theme`, leaving anything else alone.
 *
 * `?mode=json` is a PWA shortcut this module does not own, and a theme change
 * must not drop it.
 */
export function withThemeParams(search: string, theme: ThemePreferences): string {
  const params = new URLSearchParams(search);
  for (const name of PARAM_NAMES) params.delete(name);
  for (const [name, value] of Object.entries(encodeThemeParams(theme))) {
    params.set(name, value);
  }
  const next = params.toString();
  return next === '' ? '' : `?${next}`;
}
