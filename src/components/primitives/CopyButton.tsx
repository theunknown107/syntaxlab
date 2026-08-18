import { useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '@/application/clipboard';
import { Button } from './Button';
import styles from './primitives.module.css';

/**
 * Copy with a transient confirmation — 10_COMPONENT_ARCHITECTURE.md §3.3
 *
 * The confirmation is announced as well as shown: a visual-only "Copied" tells
 * a screen-reader user nothing, and copy is precisely the action where silent
 * success is indistinguishable from silent failure.
 */
export interface CopyButtonProps {
  /** Resolved at click time, so the caller never formats text nobody copies. */
  readonly getText: () => string;
  readonly label: string;
  readonly disabled?: boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyButton({
  getText,
  label,
  disabled = false,
}: CopyButtonProps): React.JSX.Element {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const handleClick = (): void => {
    void copyToClipboard(getText()).then((succeeded) => {
      setState(succeeded ? 'copied' : 'failed');
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setState('idle');
      }, 2000);
    });
  };

  return (
    <>
      <Button onClick={handleClick} variant="ghost" disabled={disabled}>
        {label}
      </Button>
      <span className={styles.srOnly} role="status">
        {state === 'copied' && 'Copied to the clipboard.'}
        {state === 'failed' && 'Copying failed. This browser blocked clipboard access.'}
      </span>
      {state !== 'idle' && (
        <span className={styles.copyHint} aria-hidden="true">
          {state === 'copied' ? 'Copied' : 'Blocked'}
        </span>
      )}
    </>
  );
}
