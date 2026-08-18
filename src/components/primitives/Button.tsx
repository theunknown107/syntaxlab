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
  readonly title?: string;
  readonly ariaLabel?: string;
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  title,
  ariaLabel,
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`${styles.button} ${styles[variant]}`}
      onClick={onClick}
      disabled={disabled}
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
