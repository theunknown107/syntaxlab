/**
 * Theme bootstrap — 06_DATA_STORAGE.md §5.1
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
 * M1 applies validated stored values; the customisation UI that writes them
 * arrives at M8. Plain JS, no build step, kept under 1 KB.
 */
(function bootstrapTheme() {
  'use strict';

  var HEX = /^#[0-9a-fA-F]{6}$/;
  var root = document.documentElement;

  function readStored() {
    try {
      var raw = localStorage.getItem('syntaxlab.theme.v1');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
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

  function applyNumber(property, value, range) {
    if (typeof value !== 'number' || !isFinite(value)) return;
    var clamped = Math.min(range.max, Math.max(range.min, value));
    root.style.setProperty(property, String(clamped) + (range.unit || ''));
  }

  function applyEnum(attribute, value, allowed) {
    if (allowed.indexOf(value) !== -1) root.dataset[attribute] = value;
  }

  var theme = readStored();
  if (!theme) return;

  var gradient = theme.gradient && typeof theme.gradient === 'object' ? theme.gradient : {};
  applyHex('--gradient-from', gradient.from);
  applyHex('--gradient-to', gradient.to);
  applyHex('--color-accent', theme.accent);
  applyNumber('--gradient-angle', gradient.angleDeg, { min: 0, max: 359, unit: 'deg' });
  applyNumber('--gradient-intensity', gradient.intensity / 100, { min: 0, max: 1 });
  applyNumber('--glow-intensity', theme.glowIntensity / 100, { min: 0, max: 1 });
  applyNumber('--font-scale', theme.fontScale, { min: 0.875, max: 1.25 });
  applyEnum('contrast', theme.contrastMode, ['normal', 'high']);
  applyEnum('motion', theme.reducedMotion, ['system', 'always', 'never']);
})();
