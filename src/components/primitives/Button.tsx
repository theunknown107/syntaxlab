import styles from './primitives.module.css';

/**
 * Button primitives — 10_COMPONENT_ARCHITECTURE.md §3.3
 *
 * Real `<button>` elements. Nothing here reimplements a control the platform
 * already provides correctly.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  /**
   * Marks the control unavailable **without removing it from the tab order.**
   *
   * A real `disabled` attribute makes the browser blur the element, so a
   * control that disables itself in response to being pressed throws the
   * keyboard user back to the top of the document. Analyze does exactly that:
   * press it, the analysis lands, and there is nothing left to submit.
   *
   * `aria-disabled` announces the same state, keeps focus where the user put
   * it, and the click is refused here rather than by the platform.
   */
  readonly keepFocusWhenDisabled?: boolean;
  readonly title?: string;
  readonly ariaLabel?: string;
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  keepFocusWhenDisabled = false,
  title,
  ariaLabel,
}: ButtonProps): React.JSX.Element {
  const soft = disabled && keepFocusWhenDisabled;
  return (
    <button
      type="button"
      className={`${styles.button} ${styles[variant]}`}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      disabled={disabled && !soft}
      aria-disabled={soft ? true : undefined}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

/**
 * A status pill. Always carries text: a badge that communicates only through
 * colour fails the colour-independence requirement (08_UI_UX_SPEC.md §12.1).
 */
export interface BadgeProps {
  readonly children: React.ReactNode;
  readonly tone?: 'neutral' | 'accent' | 'warning' | 'error' | 'info';
}

export function Badge({ children, tone = 'neutral' }: BadgeProps): React.JSX.Element {
  const toneClass = `badge${tone.charAt(0).toUpperCase()}${tone.slice(1)}`;
  return <span className={`${styles.badge} ${styles[toneClass]}`}>{children}</span>;
}
