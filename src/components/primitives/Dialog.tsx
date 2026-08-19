import { useEffect, useId, useRef } from 'react';

import styles from './primitives.module.css';

/**
 * Modal surfaces — 10_COMPONENT_ARCHITECTURE.md §3.4, 13_ACCESSIBILITY.md §7
 *
 * Built on the native `<dialog>` element, which already provides everything a
 * hand-rolled modal gets wrong: focus is trapped inside it, Escape closes it,
 * the rest of the page becomes inert to assistive technology, and focus
 * returns to whatever opened it. A custom implementation would be several
 * hundred lines reproducing that, and would be the part nobody retests.
 *
 * `Drawer` and `ConfirmDialog` differ only in presentation.
 */

interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: React.ReactNode;
  /** Describes the dialog for screen readers when the body needs more than a title. */
  readonly describedBy?: string;
}

function useDialog(
  open: boolean,
  onClose: () => void,
): React.RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return undefined;

    // `close` fires for Escape as well as for `close()`, so this is the one
    // place that has to report the dialog closing itself.
    const onNativeClose = (): void => {
      onClose();
    };

    // Click-outside, attached to the element rather than through a JSX prop:
    // a modal <dialog> fills the viewport, so its own bounds *are* the
    // backdrop, and a click that lands on the element itself missed the panel.
    const onClick = (event: MouseEvent): void => {
      if (event.target === dialog) dialog.close();
    };

    dialog.addEventListener('close', onNativeClose);
    dialog.addEventListener('click', onClick);
    return () => {
      dialog.removeEventListener('close', onNativeClose);
      dialog.removeEventListener('click', onClick);
    };
  }, [onClose]);

  return ref;
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  describedBy,
}: ModalProps): React.JSX.Element {
  const ref = useDialog(open, onClose);
  return (
    <dialog
      ref={ref}
      className={styles.drawer}
      aria-label={title}
      aria-describedby={describedBy}
    >
      {/* Rendered only while open, so its contents are not in the accessibility
          tree — and not focusable — when the drawer is shut. */}
      {open ? children : null}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly confirmLabel: string;
  /** Marks a destructive action, so the confirm button reads as one. */
  readonly destructive?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  destructive = false,
}: ConfirmDialogProps): React.JSX.Element {
  const ref = useDialog(open, onClose);
  // Generated, not fixed: two confirm dialogs in one tree would otherwise
  // share an id and both label the first one.
  const titleId = useId();

  return (
    <dialog ref={ref} className={styles.confirm} aria-labelledby={titleId}>
      {open ? (
        <div className={styles.confirmBody}>
          <h2 id={titleId} className={styles.confirmTitle}>
            {title}
          </h2>
          <div className={styles.confirmText}>{children}</div>
          <div className={styles.confirmActions}>
            {/* Cancel first in DOM order, so it is what Enter reaches first and
                what a hurried keyboard user lands on. */}
            <button
              type="button"
              className={`${styles.button} ${styles.secondary}`}
              onClick={() => {
                ref.current?.close();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.button} ${destructive ? styles.danger : styles.primary}`}
              onClick={() => {
                onConfirm();
                ref.current?.close();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
