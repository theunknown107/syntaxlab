import { useId } from 'react';

import {
  resetTheme,
  selectPreset,
  themeStore,
  updateGradient,
  updateTheme,
} from '@/application/theme/themeStore';
import { useStore } from '@/components/hooks/useStore';
import { Drawer } from '@/components/primitives/Dialog';
import {
  angleFor,
  contrastRatio,
  CONTRAST_MODES,
  DIRECTIONS,
  directionFor,
  FONT_SCALES,
  isDefaultTheme,
  lightenToPass,
  MOTION_MODES,
  PRESETS,
  SURFACE_HEX,
  verdictFor,
  type ThemePreferences,
} from '@/domain/theme/preferences';

import styles from './theme.module.css';

/**
 * The theme drawer — 08_UI_UX_SPEC.md §10, 09_DESIGN_SYSTEM.md §4
 *
 * Every control here is a native input: `<input type="color">`,
 * `<input type="range">`, and radio groups. That is not a compromise — the
 * platform's colour picker is the one the user already knows, it is keyboard
 * accessible and screen-reader labelled without any work from us, and it
 * costs zero bytes. A picker library would be several kilobytes to be worse
 * at all three (16_DEPENDENCIES.md).
 *
 * Nothing in this component computes a style. It calls an action, the action
 * writes CSS custom properties, and the interface follows. The drawer
 * subscribes to the theme only so its own controls can show the current
 * values.
 */

export interface ThemeDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ThemeDrawer({ open, onClose }: ThemeDrawerProps): React.JSX.Element {
  const theme = useStore(themeStore, (value) => value);

  return (
    <Drawer open={open} onClose={onClose} title="Appearance">
      <div className={styles.drawer}>
        <header className={styles.header}>
          <h2 className={styles.title}>Appearance</h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </header>

        <div className={styles.body}>
          <Presets theme={theme} />
          <Gradient theme={theme} />
          <Interface theme={theme} />
        </div>

        <footer className={styles.footer}>
          <p className={styles.current}>
            {isDefaultTheme(theme)
              ? 'Using the default SyntaxLab theme.'
              : `Using ${describe(theme)}. Saved in this browser.`}
          </p>
          <button
            type="button"
            className={styles.reset}
            onClick={resetTheme}
            disabled={isDefaultTheme(theme)}
          >
            Reset to default
          </button>
        </footer>
      </div>
    </Drawer>
  );
}

function describe(theme: ThemePreferences): string {
  const preset = PRESETS.find((candidate) => candidate.id === theme.preset);
  return preset === undefined ? 'a custom theme' : preset.name;
}

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

function Presets({ theme }: { readonly theme: ThemePreferences }): React.JSX.Element {
  return (
    <section className={styles.section} aria-labelledby="themePresets">
      <h3 id="themePresets" className={styles.sectionTitle}>
        Preset
      </h3>
      <div className={styles.presets} role="radiogroup" aria-labelledby="themePresets">
        {PRESETS.map((preset) => {
          const selected = theme.preset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`${styles.preset} ${selected ? styles.presetActive : ''}`}
              onClick={() => {
                selectPreset(preset.id);
              }}
            >
              {/*
                The swatch is decoration; the name is the label. A preset grid
                that communicated only through colour would be unusable in
                forced-colors mode and to a screen reader.
              */}
              <span
                className={styles.swatch}
                aria-hidden="true"
                // The one inline style in the feature, and it is geometry-like
                // rather than theming: this swatch must show a colour that is
                // *not* the active theme, so it cannot come from a token. The
                // value is a validated hex from our own preset table, never
                // user input.
                style={{ background: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
              />
              <span className={styles.presetName}>{preset.name}</span>
            </button>
          );
        })}
        {theme.preset === 'custom' ? (
          <span className={styles.customBadge}>Custom colours in use</span>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Gradient
 * ------------------------------------------------------------------ */

function Gradient({ theme }: { readonly theme: ThemePreferences }): React.JSX.Element {
  const fromId = useId();
  const toId = useId();
  const intensityId = useId();
  const direction = directionFor(theme.gradient.angleDeg);

  return (
    <section className={styles.section} aria-labelledby="themeGradient">
      <h3 id="themeGradient" className={styles.sectionTitle}>
        Gradient
      </h3>

      <div className={styles.colors}>
        <div className={styles.field}>
          <label htmlFor={fromId}>Primary colour</label>
          <input
            id={fromId}
            type="color"
            className={styles.colorInput}
            value={theme.gradient.from}
            onChange={(event) => {
              updateGradient({ from: event.target.value });
            }}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor={toId}>Secondary colour</label>
          <input
            id={toId}
            type="color"
            className={styles.colorInput}
            value={theme.gradient.to}
            onChange={(event) => {
              updateGradient({ to: event.target.value });
            }}
          />
        </div>
      </div>

      <ContrastNote color={theme.gradient.from} />

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Direction</legend>
        <div className={styles.directions}>
          {DIRECTIONS.map((option) => (
            <RadioChip
              key={option.id}
              name="themeDirection"
              label={option.label}
              checked={direction === option.id}
              onSelect={() => {
                updateGradient({ angleDeg: angleFor(option.id) });
              }}
            />
          ))}
        </div>
      </fieldset>

      <div className={styles.field}>
        <label htmlFor={intensityId}>
          Intensity <span className={styles.value}>{theme.gradient.intensity}%</span>
        </label>
        <input
          id={intensityId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={theme.gradient.intensity}
          className={styles.range}
          onChange={(event) => {
            // `valueAsNumber` on a range input is always a finite number in
            // range; the domain validates again on the way back out of storage.
            updateGradient({ intensity: event.target.valueAsNumber });
          }}
        />
      </div>
    </section>
  );
}

/**
 * The contrast guard — 09_DESIGN_SYSTEM.md §4.5
 *
 * Never blocks the choice: it is the user's tool. What it does is make the
 * consequence visible and the fix one click, which is the difference between
 * respecting a preference and shipping an unreadable interface.
 */
function ContrastNote({ color }: { readonly color: string }): React.JSX.Element | null {
  const verdict = verdictFor(color);
  if (verdict === 'pass') return null;

  const ratio = contrastRatio(color, SURFACE_HEX).toFixed(1);
  return (
    <p className={styles.contrast} role="status">
      <span>
        {verdict === 'low'
          ? `Low contrast (${ratio}:1) — this colour will be hard to read at small sizes.`
          : `Fails accessibility (${ratio}:1) — text and focus rings in this colour will be hard to see.`}
      </span>
      <button
        type="button"
        className={styles.fix}
        onClick={() => {
          updateGradient({ from: lightenToPass(color) });
        }}
      >
        Lighten it
      </button>
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Interface
 * ------------------------------------------------------------------ */

function Interface({ theme }: { readonly theme: ThemePreferences }): React.JSX.Element {
  const glowId = useId();

  return (
    <section className={styles.section} aria-labelledby="themeInterface">
      <h3 id="themeInterface" className={styles.sectionTitle}>
        Interface
      </h3>

      <div className={styles.field}>
        <label htmlFor={glowId}>
          Glow <span className={styles.value}>{theme.glowIntensity}%</span>
        </label>
        <input
          id={glowId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={theme.glowIntensity}
          className={styles.range}
          onChange={(event) => {
            updateTheme({ glowIntensity: event.target.valueAsNumber });
          }}
        />
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Contrast</legend>
        <div className={styles.directions}>
          {CONTRAST_MODES.map((mode) => (
            <RadioChip
              key={mode}
              name="themeContrast"
              label={mode === 'normal' ? 'Normal' : 'High'}
              checked={theme.contrastMode === mode}
              onSelect={() => {
                updateTheme({ contrastMode: mode });
              }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Motion</legend>
        <div className={styles.directions}>
          {MOTION_MODES.map((mode) => (
            <RadioChip
              key={mode}
              name="themeMotion"
              label={MOTION_LABELS[mode]}
              checked={theme.reducedMotion === mode}
              onSelect={() => {
                updateTheme({ reducedMotion: mode });
              }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Text size</legend>
        <div className={styles.directions}>
          {FONT_SCALES.map((scale) => (
            <RadioChip
              key={scale}
              name="themeFontScale"
              label={`${Math.round(scale * 100)}%`}
              checked={theme.fontScale === scale}
              onSelect={() => {
                updateTheme({ fontScale: scale });
              }}
            />
          ))}
        </div>
      </fieldset>
    </section>
  );
}

const MOTION_LABELS: Readonly<Record<string, string>> = {
  system: 'Follow system',
  always: 'Allow motion',
  never: 'No motion',
};

/**
 * A real radio input, styled as a chip.
 *
 * Not a `<button role="radio">`: a native radio group gives arrow-key
 * navigation and a single tab stop for free, which is what a keyboard user
 * expects from a set of mutually exclusive options.
 */
function RadioChip({
  name,
  label,
  checked,
  onSelect,
}: {
  readonly name: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <label className={`${styles.chip} ${checked ? styles.chipActive : ''}`}>
      <input type="radio" name={name} className="srOnly" checked={checked} onChange={onSelect} />
      <span>{label}</span>
    </label>
  );
}
