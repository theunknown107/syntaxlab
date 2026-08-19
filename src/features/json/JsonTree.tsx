import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JsonRow } from './viewModel';
import { TYPE_LABELS } from './viewModel';
import styles from './json.module.css';

/**
 * The JSON tree.
 *
 * Feature-local rather than the shared `<TreeView>`, and that is a considered
 * choice rather than a shortcut. The two trees differ in both of the ways that
 * matter: the regex AST is a nested structure of a few dozen rows, while this
 * one is pre-flattened (so the duplicate-key and unsafe-number annotations can
 * be computed once, outside React) and can be hundreds of thousands of rows.
 * Serving both from one component would mean the regex tree paying for
 * virtualisation it never needs, or this one re-flattening on every render.
 * `Panel`, `Badge` and `CopyButton` are still shared.
 *
 * **Two things keep a large document responsive**, and the first is the
 * cheaper: only expanded branches are flattened at all, so a collapsed
 * 500 000-node document is one row. Virtualisation below is the second, for
 * when the user does expand.
 */

export interface JsonTreeProps {
  readonly rows: readonly JsonRow[];
  readonly expandedKeys: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onSelect: (row: JsonRow) => void;
  readonly selectedKey: string | null;
  /** Rows matching the current search, highlighted in place. */
  readonly matchedKeys: ReadonlySet<string>;
}

/**
 * Fixed row height, in pixels. Must match `.row` in the stylesheet.
 *
 * A fixed height is what makes the arithmetic below a subtraction rather than
 * a measurement pass, and it is the reason a windowing library is not needed
 * (10_COMPONENT_ARCHITECTURE.md §3.2).
 */
const ROW_HEIGHT = 24;

/** Below this many rows, everything renders. See §9 of the M6 brief. */
const VIRTUALIZE_THRESHOLD = 500;

/** Rows rendered beyond the viewport, so a fast scroll does not show gaps. */
const OVERSCAN = 12;

export function JsonTree({
  rows,
  expandedKeys,
  onToggle,
  onSelect,
  selectedKey,
  matchedKeys,
}: JsonTreeProps): React.JSX.Element {
  const viewport = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const [focusIndex, setFocusIndex] = useState(0);
  const pendingFocus = useRef(false);

  const virtualized = rows.length > VIRTUALIZE_THRESHOLD;

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    setViewportHeight(element.clientHeight || 480);
  }, [rows.length]);

  const start = virtualized ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const visibleCount = virtualized
    ? Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
    : rows.length;
  const end = Math.min(rows.length, start + visibleCount);
  const slice = virtualized ? rows.slice(start, end) : rows;

  // Focus follows the roving index. When the target is outside the rendered
  // window the scroll has to happen first, so the element exists to focus.
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;

    const element = viewport.current;
    if (!element) return;

    if (virtualized) {
      const top = focusIndex * ROW_HEIGHT;
      if (top < element.scrollTop || top > element.scrollTop + element.clientHeight - ROW_HEIGHT) {
        element.scrollTop = Math.max(0, top - element.clientHeight / 2);
      }
    }

    // After the scroll, the row may only exist on the next paint.
    requestAnimationFrame(() => {
      element
        .querySelector<HTMLElement>(`[data-index="${String(focusIndex)}"]`)
        ?.focus({ preventScroll: true });
    });
  }, [focusIndex, virtualized]);

  const moveTo = useCallback(
    (index: number) => {
      pendingFocus.current = true;
      setFocusIndex(Math.max(0, Math.min(rows.length - 1, index)));
    },
    [rows.length],
  );

  /** The nearest earlier row at a shallower depth. */
  const parentOf = useCallback(
    (index: number): number => {
      const depth = rows[index]?.depth ?? 0;
      for (let i = index - 1; i >= 0; i -= 1) {
        if ((rows[i]?.depth ?? 0) < depth) return i;
      }
      return index;
    },
    [rows],
  );

  const handleKeyDown = (event: React.KeyboardEvent, index: number, row: JsonRow): void => {
    const handled = keyAction(event.key, {
      index,
      row,
      moveTo,
      parentOf,
      lastIndex: rows.length - 1,
      expanded: expandedKeys.has(row.key),
      onToggle,
      onSelect,
    });
    if (handled) event.preventDefault();
  };

  return (
    <div
      ref={viewport}
      className={styles.treeViewport}
      onScroll={
        virtualized
          ? (event) => {
              setScrollTop(event.currentTarget.scrollTop);
            }
          : undefined
      }
    >
      <div
        role="tree"
        aria-label="JSON structure"
        className={styles.tree}
        style={virtualized ? { height: rows.length * ROW_HEIGHT, position: 'relative' } : undefined}
      >
        {virtualized && <div style={{ height: start * ROW_HEIGHT }} aria-hidden="true" />}

        {slice.map((row, offset) => {
          const index = start + offset;
          return (
            <Row
              key={row.key}
              row={row}
              index={index}
              total={rows.length}
              expanded={expandedKeys.has(row.key)}
              selected={row.key === selectedKey}
              matched={matchedKeys.has(row.key)}
              tabbable={index === focusIndex}
              onToggle={onToggle}
              onSelect={onSelect}
              onKeyDown={handleKeyDown}
              onFocusIndex={setFocusIndex}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

interface KeyContext {
  readonly index: number;
  readonly row: JsonRow;
  readonly moveTo: (index: number) => void;
  readonly parentOf: (index: number) => number;
  readonly lastIndex: number;
  readonly expanded: boolean;
  readonly onToggle: (key: string) => void;
  readonly onSelect: (row: JsonRow) => void;
}

/** Vertical movement. Returns whether the key was ours. */
function verticalKey(key: string, context: KeyContext): boolean {
  const { index, moveTo, lastIndex } = context;
  switch (key) {
    case 'ArrowDown':
      moveTo(index + 1);
      return true;
    case 'ArrowUp':
      moveTo(index - 1);
      return true;
    case 'Home':
      moveTo(0);
      return true;
    case 'End':
      moveTo(lastIndex);
      return true;
    default:
      return false;
  }
}

/**
 * Horizontal movement, which in a tree means expand and collapse before it
 * means motion: right opens a closed branch, left closes an open one, and
 * only when there is nothing to open or close does the focus move.
 */
function horizontalKey(key: string, context: KeyContext): boolean {
  const { index, row, moveTo, parentOf, expanded, onToggle } = context;

  if (key === 'ArrowRight') {
    if (row.expandable && !expanded) onToggle(row.key);
    else moveTo(index + 1);
    return true;
  }
  if (key === 'ArrowLeft') {
    if (row.expandable && expanded) onToggle(row.key);
    else moveTo(parentOf(index));
    return true;
  }
  return false;
}

/** The standard `role="tree"` key model. Returns whether the key was ours. */
function keyAction(key: string, context: KeyContext): boolean {
  if (verticalKey(key, context) || horizontalKey(key, context)) return true;
  if (key !== 'Enter' && key !== ' ') return false;

  if (context.row.expandable) context.onToggle(context.row.key);
  context.onSelect(context.row);
  return true;
}

/* ------------------------------------------------------------------ *
 * Row
 * ------------------------------------------------------------------ */

interface RowProps {
  readonly row: JsonRow;
  readonly index: number;
  readonly total: number;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly matched: boolean;
  readonly tabbable: boolean;
  readonly onToggle: (key: string) => void;
  readonly onSelect: (row: JsonRow) => void;
  readonly onKeyDown: (event: React.KeyboardEvent, index: number, row: JsonRow) => void;
  readonly onFocusIndex: (index: number) => void;
}

function Row({
  row,
  index,
  total,
  expanded,
  selected,
  matched,
  tabbable,
  onToggle,
  onSelect,
  onKeyDown,
  onFocusIndex,
}: RowProps): React.JSX.Element {
  return (
    <div
      role="treeitem"
      data-index={index}
      aria-level={row.depth + 1}
      // Declared per item so a screen reader says "12 of 5,000" rather than
      // "12 of 40" — the count of what happens to be rendered.
      aria-setsize={total}
      aria-posinset={index + 1}
      aria-expanded={row.expandable ? expanded : undefined}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      className={[styles.row, selected ? styles.rowSelected : '', matched ? styles.rowMatched : '']
        .filter(Boolean)
        .join(' ')}
      style={{ paddingInlineStart: `calc(var(--space-3) + ${String(row.depth)} * var(--space-4))` }}
      onFocus={() => {
        onFocusIndex(index);
      }}
      onClick={() => {
        if (row.expandable) onToggle(row.key);
        onSelect(row);
      }}
      onKeyDown={(event) => {
        onKeyDown(event, index, row);
      }}
    >
      <span className={styles.twisty} aria-hidden="true">
        {row.expandable ? (expanded ? '▾' : '▸') : ''}
      </span>
      <RowContent row={row} />
    </div>
  );
}

/** CSS-module class for a value type. Camel-cased to match the stylesheet. */
function typeClass(type: JsonRow['type']): string {
  return styles[`type${type.charAt(0).toUpperCase()}${type.slice(1)}`] ?? '';
}

function RowContent({ row }: { row: JsonRow }): React.JSX.Element {
  return (
    <>
      {row.label !== null && (
        <>
          {/* User content, always a text child. Keys render exactly as written,
              including `__proto__` — here it is a string, nothing more. */}
          <span className={styles.rowKey}>{row.label}</span>
          <span className={styles.rowColon} aria-hidden="true">
            :
          </span>
        </>
      )}

      <span className={`${styles.rowValue} ${typeClass(row.type)}`}>{row.preview}</span>

      {row.childCount !== null && row.childCount > 0 && (
        <span className={styles.rowCount}>
          {row.childCount} {row.childCount === 1 ? 'item' : 'items'}
        </span>
      )}

      {/* Badges carry text, never colour alone. */}
      {row.duplicate && <span className={styles.badgeDuplicate}>duplicate key</span>}
      {row.unsafeNumber && <span className={styles.badgeUnsafe}>precision</span>}

      <span className="srOnly">
        {TYPE_LABELS[row.type]}
        {row.duplicate ? ', duplicate key' : ''}
        {row.unsafeNumber ? ', number changes when read' : ''}
      </span>
    </>
  );
}
