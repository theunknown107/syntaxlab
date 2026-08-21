/**
 * Theme preferences — 03_DOMAIN_MODEL.md §7, 09_DESIGN_SYSTEM.md §4
 *
 * **This file is a security boundary, not a preferences bag.** Every value
 * here ends up in a CSS custom property, and `localStorage` is writable by
 * anything running in the origin and by the user directly. An unvalidated
 * value is a CSS-injection sink.
 *
 * The rule throughout is **positive match against a strict pattern** — an
 * allowlist, never a sanitiser. Nothing is stripped, escaped or filtered;
 * a value either matches exactly what is permitted or it is discarded and the
 * default is used. `red; background: url(https://evil/?x=` does not need to be
 * recognised as hostile, because it is simply not `/^#[0-9a-fA-F]{6}$/`.
 */

/**
 * Bumped to 2 at M10, when the gradient gained two intermediate stops.
 *
 * A version-1 record is migrated rather than discarded: its two colours are
 * kept exactly and the middle stops are interpolated, which is what a
 * two-stop gradient was already displaying.
 */
export const THEME_SCHEMA_VERSION = 2;

/** `#RRGGBB`, and nothing else. Not `#RGB`, not `rgb()`, not a colour name. */
const HEX = /^#[0-9a-fA-F]{6}$/;

export type HexColor = string;

/**
 * The surface the accent is judged against.
 *
 * `--color-surface` resolves to `--gray-900`, and since M10's family split
 * there are two of those: `#131313` for the neutral ramp and `#101613` for the
 * green family's tinted one. This is the **stricter** of the pair — the
 * lighter background, which yields the lower contrast ratio — so a colour that
 * passes here passes on both.
 *
 * Duplicated from CSS because the domain cannot read a stylesheet;
 * `tests/unit/theme/contrast.test.ts` reads both values back out of
 * `tokens.css` and asserts this is the conservative one, so the duplication
 * cannot drift. A guard measuring the wrong background is worse than no guard,
 * because it reports confidently.
 */
export const SURFACE_HEX = '#101613';

/**
 * Gradient direction as a closed set.
 *
 * The stored value is `angleDeg`, a bounded integer — that is what the schema
 * has held since M1 and what the pre-paint bootstrap already validates. The
 * *interface* offers these four named directions rather than a free angle,
 * because a continuous angle control invites fiddling with a value nobody can
 * name, and four directions cover what the gradient is actually for.
 *
 * Either way no user string reaches CSS: the angle is rebuilt as
 * `${integer}deg` from a number that passed validation.
 */
export const DIRECTIONS = [
  { id: 'diagonal', label: 'Diagonal', angleDeg: 135 },
  { id: 'reverseDiagonal', label: 'Reverse diagonal', angleDeg: 45 },
  { id: 'leftToRight', label: 'Left to right', angleDeg: 90 },
  { id: 'topToBottom', label: 'Top to bottom', angleDeg: 180 },
] as const;

export type DirectionId = (typeof DIRECTIONS)[number]['id'];

export const CONTRAST_MODES = ['normal', 'high'] as const;
export type ContrastMode = (typeof CONTRAST_MODES)[number];

export const MOTION_MODES = ['system', 'always', 'never'] as const;
export type MotionMode = (typeof MOTION_MODES)[number];

/** Four steps. A continuous scale would let a user reach an unreadable size. */
export const FONT_SCALES = [0.875, 1, 1.125, 1.25] as const;

export interface ThemePreferences {
  readonly schemaVersion: number;
  /** A preset id, or `'custom'` once the user changes a colour by hand. */
  readonly preset: string;
  /**
   * Four stops, always.
   *
   * `from` and `to` are the two the user edits — the primary and secondary
   * colours. `mid1` and `mid2` sit between them and exist because the Matrix
   * palette is a four-colour ramp, not a two-colour blend, and approximating
   * it with two stops would not be the palette that was specified.
   *
   * A preset either names all four (Matrix does) or names two, in which case
   * the middle pair is interpolated in sRGB at one and two thirds. Storing all
   * four rather than deriving them at paint time keeps the pre-paint bootstrap
   * free of colour maths: it writes four validated hex values and nothing else.
   */
  readonly gradient: {
    readonly from: HexColor;
    readonly mid1: HexColor;
    readonly mid2: HexColor;
    readonly to: HexColor;
    readonly angleDeg: number;
    readonly intensity: number;
  };
  readonly accent: HexColor;
  /**
   * The AA-safe companion to `accent`.
   *
   * Stored rather than recomputed so the pre-paint bootstrap needs no contrast
   * maths — it writes a validated hex like every other value.
   */
  readonly accentLegible: HexColor;
  /** Drives the neutral ramp. See `ThemeFamily`. */
  readonly family: ThemeFamily;
  readonly glowIntensity: number;
  readonly contrastMode: ContrastMode;
  readonly reducedMotion: MotionMode;
  readonly fontScale: number;
}

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

/**
 * The visual family a preset belongs to — 09_DESIGN_SYSTEM.md §13
 *
 * This exists for one reason: the neutral ramp. Green is a *deliberate* part
 * of the Matrix and Emerald identity, down to a faintly green near-black. In
 * every other family that same tint is contamination — it is what made Crimson
 * Night read as grey-with-red rather than black-with-crimson.
 *
 * Only `green` currently changes anything; the rest share the neutral ramp.
 * They are named rather than collapsed to a boolean because the classification
 * is the product decision, and a later family may want its own treatment.
 */
export const THEME_FAMILIES = ['green', 'cyan', 'amber', 'crimson', 'mono'] as const;
export type ThemeFamily = (typeof THEME_FAMILIES)[number];

export interface ThemePreset {
  readonly id: string;
  readonly name: string;
  readonly family: ThemeFamily;
  readonly from: HexColor;
  readonly to: HexColor;
  /** Named explicitly only where the palette is a ramp rather than a blend. */
  readonly mid?: readonly [HexColor, HexColor];
  readonly angleDeg: number;
  /** 0–100. */
  readonly intensity: number;
}

/**
 * The five presets from 09_DESIGN_SYSTEM.md §4.3, unchanged.
 *
 * Five, not ten. Each is a different *hue family* with its own reason to
 * exist; a sixth that sat between two of these would be a choice the user has
 * to make for no gain. Mono is deliberately part of the set — the tool with no
 * colour theatre at all is a legitimate preference, not a degraded mode.
 */
/**
 * The Matrix palette — the product's identity, and the default.
 *
 * These four values are given, not chosen, and are reproduced exactly:
 *
 *   #00FF41  the bright green the accent derives from
 *   #008F11  mid
 *   #003B00  deep green
 *   #0D0208  the near-black the ramp resolves into
 *
 * Ordered brightest to darkest so that `from` is the primary colour — the one
 * the user edits and the one the accent comes from — which is the same shape
 * every other preset has. Reversing them would make the accent near-black.
 */
const MATRIX: ThemePreset = {
  id: 'matrix',
  name: 'Matrix',
  family: 'green',
  from: '#00FF41',
  mid: ['#008F11', '#003B00'],
  to: '#0D0208',
  angleDeg: 135,
  intensity: 40,
};

/**
 * Crimson Night.
 *
 * The two colours are given: `#DC143C` primary, `#343434` secondary. Both are
 * reproduced exactly. The middle stops are interpolated between them, and the
 * accent is derived by `lightenToPass` — `#DC143C` measures **3.67:1** against
 * the interface surface, which is below AA, and the rule is to fix the derived
 * token rather than alter a colour that was specified.
 */
const CRIMSON_NIGHT: ThemePreset = {
  id: 'crimsonNight',
  name: 'Crimson Night',
  family: 'crimson',
  from: '#DC143C',
  to: '#343434',
  angleDeg: 135,
  intensity: 35,
};

export const PRESETS: readonly ThemePreset[] = [
  MATRIX,
  CRIMSON_NIGHT,
  {
    id: 'emerald',
    name: 'Emerald',
    family: 'green',
    from: '#10b981',
    to: '#064e3b',
    angleDeg: 120,
    intensity: 35,
  },
  {
    id: 'cyan',
    name: 'Deep Cyan',
    family: 'cyan',
    from: '#22d3ee',
    to: '#0e4f5c',
    angleDeg: 145,
    intensity: 35,
  },
  {
    id: 'amber',
    name: 'Amber Console',
    family: 'amber',
    from: '#fbbf24',
    to: '#78350f',
    angleDeg: 130,
    intensity: 30,
  },
  {
    id: 'mono',
    name: 'Mono',
    family: 'mono',
    // True greys, R = G = B. These were `#9aada3` and `#1f2a24` — the old
    // green-tinted neutrals — which made the one preset whose entire purpose
    // is "no colour theatre" the second-greenest theme in the set.
    from: '#a6a6a6',
    to: '#252525',
    angleDeg: 180,
    intensity: 25,
  },
];

export const DEFAULT_PRESET_ID = 'matrix';

export function presetById(id: string): ThemePreset | null {
  return PRESETS.find((preset) => preset.id === id) ?? null;
}

/** The theme a first-time visitor gets, and what Reset restores. */
export const DEFAULT_THEME: ThemePreferences = themeFromPreset(MATRIX);

export function themeFromPreset(preset: ThemePreset): ThemePreferences {
  const [mid1, mid2] = preset.mid ?? interpolateStops(preset.from, preset.to);
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    preset: preset.id,
    gradient: {
      from: preset.from,
      mid1,
      mid2,
      to: preset.to,
      angleDeg: preset.angleDeg,
      intensity: preset.intensity,
    },
    // Derived, never separately chosen. An amber gradient with a green focus
    // ring is incoherent, and one fewer control is one fewer way to build an
    // unreadable interface (09_DESIGN_SYSTEM.md §4.5).
    //
    // Lightened until it reaches AA against the interface surface. The
    // *gradient* keeps the colour exactly as specified; only this derived
    // token moves, which is the rule when a requested colour is too dark to
    // carry a focus ring (09_DESIGN_SYSTEM.md §11.4).
    accent: preset.from,
    // The gradient always shows the specified colour; only this companion
    // moves when the colour is too dark to carry a focus ring.
    accentLegible: lightenToPass(preset.from),
    family: preset.family,
    glowIntensity: 25,
    contrastMode: 'normal',
    reducedMotion: 'system',
    fontScale: 1,
  };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && HEX.test(value);
}

function channelOf(hex: HexColor, index: number): number {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

function toHexColor(r: number, g: number, b: number): HexColor {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Blends two colours in sRGB. `t` of 0 is `a`, 1 is `b`. */
export function mixHex(a: HexColor, b: HexColor, t: number): HexColor {
  return toHexColor(
    channelOf(a, 0) + (channelOf(b, 0) - channelOf(a, 0)) * t,
    channelOf(a, 1) + (channelOf(b, 1) - channelOf(a, 1)) * t,
    channelOf(a, 2) + (channelOf(b, 2) - channelOf(a, 2)) * t,
  );
}

/**
 * The two middle stops for a palette that names only its ends.
 *
 * Even thirds, in sRGB — the same interpolation the browser would have
 * performed for a two-stop gradient, made explicit so the stored theme holds
 * four concrete colours and the pre-paint bootstrap needs no colour maths.
 */
export function interpolateStops(from: HexColor, to: HexColor): [HexColor, HexColor] {
  return [mixHex(from, to, 1 / 3), mixHex(from, to, 2 / 3)];
}

/** A finite integer inside `[min, max]`, or null. Never NaN, never Infinity. */
function readInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns whatever was in storage into a usable theme.
 *
 * **Total, and never throws.** There is no failure mode: every field falls
 * back to the default independently, so one corrupt colour costs the user
 * that colour rather than their whole theme. That is deliberate — an
 * all-or-nothing read would mean a single stray key silently resetting
 * everything a user had set up.
 *
 * The result is *rebuilt field by field*. Nothing from the input object is
 * spread or carried through, so an unknown key cannot survive into the value
 * that later reaches `setProperty`.
 */
export function readTheme(value: unknown): ThemePreferences {
  if (!isRecord(value)) return DEFAULT_THEME;

  const migrated = migrate(value);
  if (migrated === null) return DEFAULT_THEME;

  const gradient = isRecord(migrated.gradient) ? migrated.gradient : {};
  const from = isHexColor(gradient.from) ? gradient.from : DEFAULT_THEME.gradient.from;
  const to = isHexColor(gradient.to) ? gradient.to : DEFAULT_THEME.gradient.to;

  // Absent or corrupt middle stops are interpolated rather than defaulted to
  // the Matrix ones: a stored theme with a valid crimson pair and a damaged
  // middle should stay crimson.
  const [defaultMid1, defaultMid2] = interpolateStops(from, to);

  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    preset: readPresetId(migrated.preset),
    gradient: {
      from,
      mid1: isHexColor(gradient.mid1) ? gradient.mid1 : defaultMid1,
      mid2: isHexColor(gradient.mid2) ? gradient.mid2 : defaultMid2,
      to,
      angleDeg: readInt(gradient.angleDeg, 0, 359) ?? DEFAULT_THEME.gradient.angleDeg,
      intensity: readInt(gradient.intensity, 0, 100) ?? DEFAULT_THEME.gradient.intensity,
    },
    // Falls back to the gradient's own start colour rather than to the default
    // green: a stored theme with a valid amber gradient and a corrupt accent
    // should stay amber.
    accent: isHexColor(migrated.accent) ? migrated.accent : from,
    // Recomputed rather than trusted when absent or corrupt. A stored value
    // that failed contrast would put an unreadable focus ring on screen.
    accentLegible: isHexColor(migrated.accentLegible)
      ? migrated.accentLegible
      : lightenToPass(isHexColor(migrated.accent) ? migrated.accent : from),
    family: readEnum(migrated.family, THEME_FAMILIES) ?? familyOf(readPresetId(migrated.preset)),
    glowIntensity: readInt(migrated.glowIntensity, 0, 100) ?? DEFAULT_THEME.glowIntensity,
    contrastMode: readEnum(migrated.contrastMode, CONTRAST_MODES) ?? 'normal',
    reducedMotion: readEnum(migrated.reducedMotion, MOTION_MODES) ?? 'system',
    fontScale: readFontScale(migrated.fontScale),
  };
}

/**
 * The family a preset id belongs to.
 *
 * A custom theme keeps whatever family it was edited from, which is why the
 * value is persisted rather than derived on every read: a user who tweaks
 * Matrix's colours should keep the green neutrals they were looking at.
 */
function familyOf(presetId: string): ThemeFamily {
  return presetById(presetId)?.family ?? 'green';
}

/** A known preset id, or `'custom'`. An unknown id is not preserved. */
function readPresetId(value: unknown): string {
  if (value === 'custom') return 'custom';
  return typeof value === 'string' && presetById(value) !== null ? value : DEFAULT_PRESET_ID;
}

function readFontScale(value: unknown): number {
  return typeof value === 'number' && (FONT_SCALES as readonly number[]).includes(value)
    ? value
    : 1;
}

/**
 * Record migrations, by schema version.
 *
 * Returns null for a version this build cannot read — a theme written by a
 * *newer* build. Unlike history, that is safe to discard: a theme is a
 * preference the user can set again in four clicks, not content they created.
 * Keeping an unreadable theme would mean showing them a broken interface they
 * cannot fix from inside the app.
 */
function migrate(record: Record<string, unknown>): Record<string, unknown> | null {
  const version = record.schemaVersion;
  if (version === undefined) {
    // Pre-versioning data. There is none in the wild — M1 shipped with the
    // version — but a missing field must not be read as version 0 and then
    // migrated through steps that do not apply to it.
    return record;
  }
  const parsed = readInt(version, 1, THEME_SCHEMA_VERSION);
  if (parsed === null) return null;

  // Version 1 → 2 needs no rewriting here. A v1 record has `from` and `to` and
  // no middle stops; `readTheme` interpolates them, which reproduces exactly
  // what a two-stop gradient was already painting. The user's two colours are
  // carried across untouched.
  return record;
}

/* ------------------------------------------------------------------ *
 * Contrast
 * ------------------------------------------------------------------ */

/** sRGB channel to linear light, per WCAG 2.1 relative luminance. */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: HexColor): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: HexColor, b: HexColor): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastVerdict = 'pass' | 'low' | 'fail';

/**
 * How readable a chosen colour is — 09_DESIGN_SYSTEM.md §4.5
 *
 * The choice is never blocked. It is the user's tool, and a colour that fails
 * here is still legible in the places the accent is used decoratively. What we
 * owe them is the consequence, stated plainly, and a fix that costs one click.
 */
export function verdictFor(color: HexColor): ContrastVerdict {
  const ratio = contrastRatio(color, SURFACE_HEX);
  if (ratio >= 4.5) return 'pass';
  return ratio >= 3 ? 'low' : 'fail';
}

/**
 * The nearest lighter colour that reaches AA against the surface.
 *
 * Lightens toward white in sRGB rather than solving in a perceptual space:
 * the input is already the user's hue and the result must stay recognisably
 * *their* colour, so a small number of small steps is the point. Returns the
 * original if it already passes, and white in the pathological case.
 */
export function lightenToPass(color: HexColor): HexColor {
  if (verdictFor(color) === 'pass') return color;

  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);

  for (let step = 1; step <= 20; step += 1) {
    const mix = step / 20;
    const candidate = toHex(
      Math.round(r + (255 - r) * mix),
      Math.round(g + (255 - g) * mix),
      Math.round(b + (255 - b) * mix),
    );
    if (verdictFor(candidate) === 'pass') return candidate;
  }
  return '#ffffff';
}

function toHex(r: number, g: number, b: number): HexColor {
  const part = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/* ------------------------------------------------------------------ *
 * Derived helpers
 * ------------------------------------------------------------------ */

export function directionFor(angleDeg: number): DirectionId {
  const match = DIRECTIONS.find((direction) => direction.angleDeg === angleDeg);
  // A stored angle that is valid but not one of the four named directions —
  // possible from a hand-edited value — is shown as the nearest named one
  // rather than leaving every radio unselected.
  if (match) return match.id;

  // reduce rather than a `let`: `DIRECTIONS[0]` narrows to that one entry's
  // literal type, so nothing else in the tuple can be assigned to it.
  const nearest = DIRECTIONS.reduce((best, direction) =>
    Math.abs(direction.angleDeg - angleDeg) < Math.abs(best.angleDeg - angleDeg) ? direction : best,
  );
  return nearest.id;
}

export function angleFor(id: DirectionId): number {
  return (DIRECTIONS.find((direction) => direction.id === id) ?? DIRECTIONS[0]).angleDeg;
}

/**
 * The preset these gradient values *are*, or `'custom'`.
 *
 * Answered from the values alone, never from what the theme currently claims
 * to be. A theme that reached `'custom'` by one edit and was then edited back
 * to exactly Amber is Amber; saying otherwise would leave the drawer marking
 * no preset as selected while displaying one exactly.
 */
export function presetIdFor(gradient: ThemePreferences['gradient']): string {
  const match = PRESETS.find((preset) => {
    const [mid1, mid2] = preset.mid ?? interpolateStops(preset.from, preset.to);
    return (
      gradient.from === preset.from &&
      gradient.to === preset.to &&
      gradient.mid1 === mid1 &&
      gradient.mid2 === mid2 &&
      gradient.angleDeg === preset.angleDeg &&
      gradient.intensity === preset.intensity
    );
  });
  return match?.id ?? 'custom';
}

/** Whether a theme still matches the preset it claims. */
export function matchesPreset(theme: ThemePreferences): boolean {
  const preset = presetById(theme.preset);
  if (preset === null) return false;
  return presetIdFor(theme.gradient) === preset.id;
}

export function isDefaultTheme(theme: ThemePreferences): boolean {
  return (
    theme.preset === DEFAULT_PRESET_ID &&
    matchesPreset(theme) &&
    theme.glowIntensity === DEFAULT_THEME.glowIntensity &&
    theme.contrastMode === DEFAULT_THEME.contrastMode &&
    theme.reducedMotion === DEFAULT_THEME.reducedMotion &&
    theme.fontScale === DEFAULT_THEME.fontScale
  );
}
