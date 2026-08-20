import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  readSplitPercent,
  settingsStore,
  updateSettings,
} from '@/application/stores/settingsStore';
import styles from './Splitter.module.css';

/**
 * The workspace divider — 08_UI_UX_SPEC.md §5
 *
 * Specified since M1 and unbuilt until M11: "developers reflexively drag panel
 * dividers; not honouring that feels broken."
 *
 * No library. A separator is a `role="separator"` with a value, a pointer
 * handler and five key bindings — a splitter package is that plus a layout
 * engine the app already has in CSS Grid.
 *
 * Four things it has to get right:
 *
 *   1. **The drag must not re-render the workspace.** The position is written
 *      to a CSS custom property on the grid element, the same way the theme is
 *      applied: the grid re-lays out, React does not reconcile. Putting it in
 *      state instead would reconcile both panels — including a 200-row match
 *      table — on every pointermove.
 *   2. **It cannot be dragged into uselessness.** The percentage is clamped to
 *      25–75, and the grid's `minmax` floor is a second guard. A divider that
 *      can hide half the interface is a way to lose your work.
 *   3. **It works without a mouse.** Arrows move it, Home and End go to the
 *      limits, Enter resets — the keyboard equivalent of the double-click,
 *      because a keyboard user cannot double-click.
 *   4. **It disappears when the layout stacks.** Below 1024 px the grid is a
 *      single column; the element is removed from the box tree by CSS, which
 *      removes it from the accessibility tree too. A separator with nothing to
 *      separate is noise to a screen reader.
 *
 * Pointer events rather than mouse events, so touch and pen work through the
 * same path, with capture so a fast drag that leaves the element keeps
 * tracking.
 */

const KEYBOARD_STEP = 2;

export function Splitter({ label }: { label: string }): React.JSX.Element {
  const handleRef = useRef<HTMLDivElement>(null);
  // Live position. Seeded from the store rather than subscribed to it: during
  // a drag this is the source of truth and the store is only written at the
  // end, so a drag is not a burst of localStorage writes.
  const [percent, setPercent] = useState(() => settingsStore.getState().splitPercent);

  useEffect(() => {
    handleRef.current?.parentElement?.style.setProperty('--split', `${percent}%`);
  }, [percent]);

  const moveTo = useCallback((clientX: number) => {
    const row = handleRef.current?.parentElement;
    if (!row) return;
    const bounds = row.getBoundingClientRect();
    if (bounds.width === 0) return;
    setPercent(readSplitPercent(((clientX - bounds.left) / bounds.width) * 100));
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Primary button only: a right-click on a divider should open a menu,
      // not begin a drag that never ends.
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      handle.focus();

      const onMove = (moveEvent: PointerEvent) => {
        moveTo(moveEvent.clientX);
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        // Persist once, at the end of the gesture.
        const row = handle.parentElement;
        const current = row?.style.getPropertyValue('--split') ?? '';
        updateSettings({ splitPercent: Number.parseFloat(current) });
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [moveTo],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const next = {
        ArrowLeft: percent - KEYBOARD_STEP,
        ArrowRight: percent + KEYBOARD_STEP,
        Home: SPLIT_MIN,
        End: SPLIT_MAX,
        Enter: SPLIT_DEFAULT,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const clamped = readSplitPercent(next);
      setPercent(clamped);
      // Discrete, so it is persisted immediately rather than on release.
      updateSettings({ splitPercent: clamped });
    },
    [percent],
  );

  const reset = useCallback(() => {
    setPercent(SPLIT_DEFAULT);
    updateSettings({ splitPercent: SPLIT_DEFAULT });
  }, []);

  return (
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a focusable separator is the ARIA window-splitter widget; see eslint.config.js */
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-valuetext={`${percent}% to the left panel`}
      tabIndex={0}
      className={styles.splitter}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
    >
      <span className={styles.grip} aria-hidden="true" />
    </div>
  );
}
