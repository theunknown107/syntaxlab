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
 * ---
 *
 * This file deliberately **duplicates** the rules in
 * `src/domain/theme/preferences.ts`, because it must run with no module
 * system, no build output and no imports. The duplication is a real risk, so
 * the two are held together from both ends:
 *
 *   - the rules here are *reject*, never clamp, exactly as the domain does.
 *     A bootstrap that clamped 100000 to 359 while the domain reset it to 135
 *     would paint one theme and then replace it — a flash caused by nothing
 *     but disagreement.
 *   - `tests/e2e/theme.spec.ts` drives real hostile values through this file
 *     in a real browser and asserts the computed styles.
 *
 * Plain JS, no build step, kept under 1 KB.
 */
(function bootstrapTheme() {
  'use strict';

  var HEX = /^#[0-9a-fA-F]{6}$/;
  var SCHEMA_VERSION = 1;
  var FONT_SCALES = [0.875, 1, 1.125, 1.25];
  var root = document.documentElement;

  function readStored() {
    try {
      var raw = localStorage.getItem('syntaxlab.theme.v1');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (error) {
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

  /** An integer inside [min, max]. Rejected, never clamped — see the note above. */
  function readInt(value, min, max) {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    var rounded = Math.round(value);
    return rounded >= min && rounded <= max ? rounded : null;
  }

  function applyInt(property, value, min, max, suffix) {
    var parsed = readInt(value, min, max);
    if (parsed !== null) root.style.setProperty(property, String(parsed) + (suffix || ''));
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

  // A theme written by a newer build is not applied. Guessing at a schema we
  // do not know could paint an interface the user cannot fix from inside the
  // app; the default is always usable. Absent means pre-versioning data.
  if (theme.schemaVersion !== undefined && readInt(theme.schemaVersion, 1, SCHEMA_VERSION) === null) {
    return;
  }

  var gradient = theme.gradient && typeof theme.gradient === 'object' ? theme.gradient : {};
  applyHex('--gradient-from', gradient.from);
  applyHex('--gradient-to', gradient.to);
  applyHex('--color-accent', theme.accent);
  applyInt('--gradient-angle', gradient.angleDeg, 0, 359, 'deg');
  applyFraction('--gradient-intensity', gradient.intensity);
  applyFraction('--glow-intensity', theme.glowIntensity);

  if (FONT_SCALES.indexOf(theme.fontScale) !== -1) {
    root.style.setProperty('--font-scale', String(theme.fontScale));
  }

  applyEnum('contrast', theme.contrastMode, ['normal', 'high']);
  applyEnum('motion', theme.reducedMotion, ['system', 'always', 'never']);
})();
