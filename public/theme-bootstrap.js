/**
 * Theme bootstrap — 06_DATA_STORAGE.md §5.1, 09_DESIGN_SYSTEM.md §4.4
 *
 * Runs before the app bundle so the user's theme is applied before first
 * paint. A separate same-origin file rather than an inline script, because
 * script-src is 'self' and the CSP is not weakened for convenience.
 *
 * From M15 the theme lives in the URL. localStorage is read only as a fallback
 * for an installation that predates the move, and is not written here.
 *
 * SECURITY: both sources are attacker-supplied — a URL more so, since anyone
 * can send anyone a link — and these values are written into CSS custom
 * properties. Every value is validated by positive match against a strict
 * pattern: an allowlist, not a sanitiser. Anything that does not match is
 * discarded and the default is used (03_DOMAIN_MODEL.md §7.1).
 *
 * This file duplicates the rules in `src/domain/theme/preferences.ts` and
 * `urlPreferences.ts`, and MUST agree with them exactly — reject, never clamp.
 * Why, and how they are kept together, is in 09_DESIGN_SYSTEM.md §4.6.
 *
 * This file is served verbatim, so every byte here — comments included — is
 * shipped to every user. Keep it short.
 */
(function bootstrapTheme() {
  'use strict';

  var HEX = /^[0-9a-fA-F]{6}$/;
  var SCHEMA_VERSION = 2;
  var FONT_SCALES = ['0.875', '1', '1.125', '1.25'];
  var root = document.documentElement;

  /** Theme values as strings, from the URL. Null when the URL names none. */
  function readUrl() {
    try {
      var params = new URLSearchParams(location.search);
      if (params.toString().length > 512) return null;
      var names = [
        'theme',
        'gf',
        'gm1',
        'gm2',
        'gt',
        'ga',
        'gi',
        'accent',
        'al',
        'fam',
        'glow',
        'contrast',
        'motion',
        'font',
        'tv',
      ];
      var found = names.some(function (name) {
        return params.has(name);
      });
      return found ? params : null;
    } catch {
      return null;
    }
  }

  /**
   * The pre-M15 stored theme, flattened to the same string shape.
   *
   * Only consulted when the URL says nothing. The application migrates this
   * into the URL on load; this exists so the one paint before that happens is
   * not the wrong colour.
   */
  function readLegacy() {
    try {
      var raw = localStorage.getItem('syntaxlab.theme.v1');
      if (!raw) return null;
      var t = JSON.parse(raw);
      if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
      var g = t.gradient && typeof t.gradient === 'object' ? t.gradient : {};
      var params = new URLSearchParams();
      var put = function (name, value, strip) {
        if (typeof value === 'string') params.set(name, strip ? value.replace('#', '') : value);
        else if (typeof value === 'number' && isFinite(value)) params.set(name, String(value));
      };
      put('gf', g.from, true);
      put('gm1', g.mid1, true);
      put('gm2', g.mid2, true);
      put('gt', g.to, true);
      put('ga', g.angleDeg);
      put('gi', g.intensity);
      put('accent', t.accent, true);
      put('al', t.accentLegible, true);
      put('fam', t.family);
      put('glow', t.glowIntensity);
      put('contrast', t.contrastMode);
      put('motion', t.reducedMotion);
      put('font', t.fontScale);
      put('tv', t.schemaVersion);
      return params;
    } catch {
      // Corrupt, unparseable, or storage unavailable (private mode, policy).
      return null;
    }
  }

  function applyHex(property, value) {
    if (typeof value === 'string' && HEX.test(value)) {
      root.style.setProperty(property, '#' + value);
    }
  }

  /** An integer inside [min, max]. Rejected, never clamped. */
  function readInt(value, min, max) {
    if (typeof value !== 'string' || value === '') return null;
    var parsed = Number(value);
    if (!isFinite(parsed)) return null;
    var rounded = Math.round(parsed);
    return rounded >= min && rounded <= max ? rounded : null;
  }

  function applyAngle(property, value) {
    var parsed = readInt(value, 0, 359);
    if (parsed !== null) root.style.setProperty(property, String(parsed) + 'deg');
  }

  /** 0–100 in the URL, written as the 0–1 fraction the tokens expect. */
  function applyFraction(property, value) {
    var parsed = readInt(value, 0, 100);
    if (parsed !== null) root.style.setProperty(property, String(parsed / 100));
  }

  function applyEnum(attribute, value, allowed) {
    if (allowed.indexOf(value) !== -1) root.dataset[attribute] = value;
  }

  var p = readUrl() || readLegacy();
  if (!p) return;

  // A theme from a newer build is not applied: the default is always usable, a
  // guessed one may not be. Absent means an unmodified preset.
  if (p.has('tv') && readInt(p.get('tv'), 1, SCHEMA_VERSION) === null) return;

  /**
   * The presets, expanded here rather than waiting for the bundle.
   *
   * A URL usually names a preset and nothing else — that is the whole point of
   * encoding against a baseline — so without this table `?theme=crimsonNight`
   * would paint Matrix green for one frame and then correct itself. That is
   * the flash this file exists to prevent.
   *
   * Order: from, mid1, mid2, to, accent, accentLegible, family. Generated from
   * `PRESETS`, and `tests/unit/theme/bootstrap.test.ts` fails if the two ever
   * disagree, so this is a checked copy rather than a remembered one.
   */
  var PRESETS = {
    matrix: ['00FF41', '008F11', '003B00', '0D0208', '00FF41', '00FF41', 'green'],
    crimsonNight: ['DC143C', 'a41f39', '6c2937', '343434', 'DC143C', 'e34363', 'crimson'],
    emerald: ['10b981', '0d956a', '097252', '064e3b', '10b981', '10b981', 'green'],
    cyan: ['22d3ee', '1ba7bd', '157b8d', '0e4f5c', '22d3ee', '22d3ee', 'cyan'],
    amber: ['fbbf24', 'cf911d', 'a46316', '78350f', 'fbbf24', 'fbbf24', 'amber'],
    mono: ['a6a6a6', '7b7b7b', '505050', '252525', 'a6a6a6', 'a6a6a6', 'mono'],
  };

  // An explicit parameter always wins over the preset it overrides.
  var base = PRESETS[p.get('theme')] || [];
  var pick = function (name, index) {
    return p.get(name) || base[index] || null;
  };

  applyHex('--gradient-from', pick('gf', 0));
  applyHex('--gradient-mid-1', pick('gm1', 1));
  applyHex('--gradient-mid-2', pick('gm2', 2));
  applyHex('--gradient-to', pick('gt', 3));
  applyHex('--color-accent', pick('accent', 4));
  applyHex('--color-accent-legible', pick('al', 5));
  applyAngle('--gradient-angle', p.get('ga'));
  applyFraction('--gradient-intensity', p.get('gi'));
  applyFraction('--glow-intensity', p.get('glow'));

  if (FONT_SCALES.indexOf(p.get('font')) !== -1) {
    root.style.setProperty('--font-scale', p.get('font'));
  }

  // The neutral ramp depends on this, so it must land before first paint or a
  // crimson theme flashes green-tinted surfaces on every load.
  applyEnum('themeFamily', pick('fam', 6), ['green', 'cyan', 'amber', 'crimson', 'mono']);
  applyEnum('contrast', p.get('contrast'), ['normal', 'high']);
  applyEnum('motion', p.get('motion'), ['system', 'always', 'never']);
})();
