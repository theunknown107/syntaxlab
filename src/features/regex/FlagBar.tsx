import { FLAGS } from './viewModel';
import styles from './regex.module.css';

/**
 * Flag toggles — 08_UI_UX_SPEC.md §7.1
 *
 * Flags are not a display preference. `i` changes what matches, `u` changes
 * how the pattern is *parsed*, and `g` changes how many results exist. Every
 * change here goes through the same pipeline as an edit to the pattern
 * itself, and the tester runs with exactly the set shown.
 *
 * `aria-pressed` rather than checkboxes: these are toggle buttons acting on
 * the analysis, not fields in a form being submitted.
 */
interface FlagBarProps {
  readonly flags: string;
  readonly onToggle: (letter: string) => void;
  readonly onReset: () => void;
}

export function FlagBar({ flags, onToggle, onReset }: FlagBarProps): React.JSX.Element {
  // `u` and `v` are mutually exclusive, and the toggle enforces that rather
  // than letting the user build a combination the engine rejects. The note
  // below explains the switch at the moment it happens.
  const unicodeMode = flags.includes('u') || flags.includes('v');

  return (
    <div className={styles.flagBar}>
      <span id="flag-bar-label" className={styles.flagLabel}>
        Flags
      </span>

      <div className={styles.flagGroup} role="group" aria-labelledby="flag-bar-label">
        {FLAGS.map((flag) => {
          const active = flags.includes(flag.letter);
          return (
            <button
              key={flag.letter}
              type="button"
              className={active ? styles.flagOn : styles.flagOff}
              aria-pressed={active}
              title={`${flag.name} — ${flag.description}`}
              onClick={() => {
                onToggle(flag.letter);
              }}
            >
              <span aria-hidden="true">{flag.letter}</span>
              <span className="srOnly">
                {flag.name}: {flag.description}
              </span>
            </button>
          );
        })}
      </div>

      <button type="button" className={styles.flagReset} onClick={onReset}>
        Reset flags
      </button>

      {unicodeMode && (
        <p className={styles.flagNote}>
          <code className={styles.code}>u</code> and <code className={styles.code}>v</code> cannot
          be combined, so turning one on turns the other off.
        </p>
      )}
    </div>
  );
}
