/**
 * Theme bootstrap — 06_DATA_STORAGE.md §5.1, 09_DESIGN_SYSTEM.md §4.4
 *
 * Runs before the app bundle so the user's theme is applied before first
 * paint. An async read (IndexedDB) cannot do this, which is the entire reason
 * theme lives in localStorage while history lives in IndexedDB (ADR-007).
 *
 * A separate same-origin file rather than an inline script, because
 * script-src is 'self' and the CSP is not weakened for convenience.
 *
 * SECURITY: localStorage is attacker-writable, and these values are written
 * into CSS custom properties. Every value is validated by positive match
 * against a strict pattern — an allowlist, not a sanitiser. Anything that does
 * not match is discarded and the default is used (03_DOMAIN_MODEL.md §7.1).
 *
 * This file duplicates the rules in `src/domain/theme/preferences.ts` and MUST
 * agree with them exactly — reject, never clamp. Why, and how the two are kept
 * together, is in 09_DESIGN_SYSTEM.md §4.6.
 *
 * This file is served verbatim, so every byte here — comments included — is
 * shipped to every user. Keep it short.
 */
(function bootstrapTheme() {
  'use strict';

  var HEX = /^#[0-9a-fA-F]{6}$/;
  var SCHEMA_VERSION = 2;
  var FONT_SCALES = [0.875, 1, 1.125, 1.25];
  var root = document.documentElement;

  function readStored() {
    try {
      var raw = localStorage.getItem('syntaxlab.theme.v1');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      // Corrupt, unparseable, or storage unavailable (private mode, policy).
      // A bad stored value must never stop the application loading.
      return null;
    }
  }

  function applyHex(property, value) {
    if (typeof value === 'string' && HEX.test(value)) {
      root.style.setProperty(property, value);
    }
  }

  /** An integer inside [min, max]. Rejected, never clamped. */
  function readInt(value, min, max) {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    var rounded = Math.round(value);
    return rounded >= min && rounded <= max ? rounded : null;
  }

  function applyAngle(property, value) {
    var parsed = readInt(value, 0, 359);
    if (parsed !== null) root.style.setProperty(property, String(parsed) + 'deg');
  }

  /** 0–100 stored, written as the 0–1 fraction the tokens expect. */
  function applyFraction(property, value) {
    var parsed = readInt(value, 0, 100);
    if (parsed !== null) root.style.setProperty(property, String(parsed / 100));
  }

  function applyEnum(attribute, value, allowed) {
    if (allowed.indexOf(value) !== -1) root.dataset[attribute] = value;
  }

  var theme = readStored();
  if (!theme) return;

  // A theme from a newer build is not applied: the default is always usable,
  // a guessed one may not be. Absent means pre-versioning data.
  if (
    theme.schemaVersion !== undefined &&
    readInt(theme.schemaVersion, 1, SCHEMA_VERSION) === null
  ) {
    return;
  }

  var gradient = theme.gradient && typeof theme.gradient === 'object' ? theme.gradient : {};
  applyHex('--gradient-from', gradient.from);
  applyHex('--gradient-mid-1', gradient.mid1);
  applyHex('--gradient-mid-2', gradient.mid2);
  applyHex('--gradient-to', gradient.to);
  applyHex('--color-accent', theme.accent);
  applyHex('--color-accent-legible', theme.accentLegible);
  applyAngle('--gradient-angle', gradient.angleDeg);
  applyFraction('--gradient-intensity', gradient.intensity);
  applyFraction('--glow-intensity', theme.glowIntensity);

  if (FONT_SCALES.indexOf(theme.fontScale) !== -1) {
    root.style.setProperty('--font-scale', String(theme.fontScale));
  }

  // The neutral ramp depends on this, so it must land before first paint or a
  // crimson theme flashes green-tinted surfaces on every load.
  applyEnum('themeFamily', theme.family, ['green', 'cyan', 'amber', 'crimson', 'mono']);
  applyEnum('contrast', theme.contrastMode, ['normal', 'high']);
  applyEnum('motion', theme.reducedMotion, ['system', 'always', 'never']);
})();
