import { useId, useState } from 'react';
import styles from './primitives.module.css';

/**
 * A titled, optionally collapsible section — the layout unit of the analysis
 * pane (10_COMPONENT_ARCHITECTURE.md §3.3).
 *
 * Composition over configuration: it takes children rather than fifteen
 * booleans describing what to render inside.
 */
export interface PanelProps {
  readonly title: string;
  /** Short text after the title — a count, a state. Never the only signal. */
  readonly meta?: string;
  readonly collapsible?: boolean;
  readonly defaultOpen?: boolean;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
}

export function Panel({
  title,
  meta,
  collapsible = false,
  defaultOpen = true,
  actions,
  children,
}: PanelProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className={styles.panel} aria-labelledby={`${bodyId}-title`}>
      <div className={styles.panelHeader}>
        {collapsible ? (
          // The button sits *inside* the heading rather than replacing it.
          // A collapsible panel is still a section of the page, and losing its
          // heading would take it out of the document outline a screen-reader
          // user navigates by (08_UI_UX_SPEC.md §12.1).
          <h3 className={styles.panelHeading}>
            <button
              type="button"
              id={`${bodyId}-title`}
              className={styles.panelToggle}
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => {
                setOpen((previous) => !previous);
              }}
            >
              <span className={styles.panelChevron} aria-hidden="true">
                {open ? '▾' : '▸'}
              </span>
              <span className={styles.panelTitle}>{title}</span>
              {meta !== undefined && <span className={styles.panelMeta}>{meta}</span>}
            </button>
          </h3>
        ) : (
          <h3 id={`${bodyId}-title`} className={styles.panelTitle}>
            {title}
            {meta !== undefined && <span className={styles.panelMeta}>{meta}</span>}
          </h3>
        )}
        {actions !== undefined && <div className={styles.panelActions}>{actions}</div>}
      </div>

      {open && (
        <div id={bodyId} className={styles.panelBody}>
          {children}
        </div>
      )}
    </section>
  );
}
