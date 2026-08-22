import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CONTRAST_MODES,
  FONT_SCALES,
  MOTION_MODES,
  PRESETS,
  THEME_FAMILIES,
  THEME_SCHEMA_VERSION,
  themeFromPreset,
} from '@/domain/theme/preferences';
import { THEME_PARAMS, MAX_THEME_PARAM_CHARS } from '@/domain/theme/urlPreferences';

/**
 * The pre-paint bootstrap — 09_DESIGN_SYSTEM.md §4.6
 *
 * `public/theme-bootstrap.js` is served verbatim before the bundle, so it
 * cannot import the domain. It therefore duplicates the preset palette, the
 * parameter names and the allowlists — and a duplicate that drifts is worse
 * than no duplicate, because it fails as a wrong colour on the first frame
 * rather than as an error anyone would notice.
 *
 * These tests read the file as text and hold it to the domain. They are the
 * reason the duplication is acceptable.
 */

const source = readFileSync('public/theme-bootstrap.js', 'utf8');

/** The seven-value row the bootstrap carries for one preset. */
function bootstrapRow(id: string): string[] | null {
  const match = new RegExp(`\\b${id}:\\s*\\[([^\\]]*)\\]`).exec(source);
  if (match === null) return null;
  return (match[1] ?? '')
    .split(',')
    .map((value) => value.trim().replace(/^'|'$/g, ''))
    .filter((value) => value !== '');
}

describe('the preset table agrees with the domain', () => {
  it.each(PRESETS.map((preset) => [preset.id]))('%s', (id) => {
    const row = bootstrapRow(id);
    expect(row, `no row for ${id} in theme-bootstrap.js`).not.toBeNull();
    if (row === null) return;

    const preset = PRESETS.find((entry) => entry.id === id);
    expect(preset).toBeDefined();
    if (preset === undefined) return;
    const theme = themeFromPreset(preset);

    // Order: from, mid1, mid2, to, accent, accentLegible, family.
    expect(row).toEqual([
      theme.gradient.from.slice(1),
      theme.gradient.mid1.slice(1),
      theme.gradient.mid2.slice(1),
      theme.gradient.to.slice(1),
      theme.accent.slice(1),
      theme.accentLegible.slice(1),
      theme.family,
    ]);
  });

  it('carries every preset and no invented ones', () => {
    const ids = [...source.matchAll(/^\s{4}(\w+): \[/gm)].map((match) => match[1]);
    expect(new Set(ids)).toEqual(new Set(PRESETS.map((preset) => preset.id)));
  });
});

describe('the allowlists agree with the domain', () => {
  it('knows every parameter name the codec writes', () => {
    for (const name of Object.values(THEME_PARAMS)) {
      expect(source, name).toContain(`'${name}'`);
    }
  });

  it('carries the same families, contrast modes and motion modes', () => {
    expect(source).toContain(THEME_FAMILIES.map((value) => `'${value}'`).join(', '));
    expect(source).toContain(CONTRAST_MODES.map((value) => `'${value}'`).join(', '));
    expect(source).toContain(MOTION_MODES.map((value) => `'${value}'`).join(', '));
  });

  it('carries the same font scales', () => {
    expect(source).toContain(FONT_SCALES.map((value) => `'${String(value)}'`).join(', '));
  });

  it('carries the same schema version', () => {
    expect(source).toContain(`SCHEMA_VERSION = ${String(THEME_SCHEMA_VERSION)}`);
  });

  it('carries the same size cap', () => {
    expect(source).toContain(`> ${String(MAX_THEME_PARAM_CHARS)}`);
  });
});

describe('the security posture', () => {
  it('validates hex by positive match, not by sanitising', () => {
    expect(source).toContain('/^[0-9a-fA-F]{6}$/');
  });

  it('never writes storage — it only reads the legacy key once', () => {
    expect(source).not.toContain('setItem');
    expect(source).toContain('getItem');
    expect(source.match(/getItem/g) ?? []).toHaveLength(1);
  });

  it('has no dynamic evaluation sink', () => {
    for (const sink of [
      'eval(',
      'new Function',
      'innerHTML',
      'insertAdjacentHTML',
      'document.write',
    ]) {
      expect(source, sink).not.toContain(sink);
    }
  });

  it('reads only the query string, never a path or a hash', () => {
    expect(source).toContain('location.search');
    expect(source).not.toContain('location.hash');
  });

  it('stays small, because every byte ships to every user', () => {
    expect(source.length).toBeLessThan(9_000);
  });
});
