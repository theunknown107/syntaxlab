import { useCallback, useMemo, useRef } from 'react';
import styles from './TreeView.module.css';

/**
 * Generic tree — 10_COMPONENT_ARCHITECTURE.md §3.2
 *
 * Shared by the regex AST (M4) and the JSON tree (M6), which is why it is
 * generic over the node type and takes a `renderNode` rather than knowing
 * anything about either.
 *
 * Rendered as a flat list of `role="treeitem"` rows with explicit `aria-level`
 * rather than as nested `<ul>`s. Flattening is what makes roving-tabindex
 * keyboard movement a matter of moving one index, and it is also what a
 * virtualiser needs when the JSON tree arrives — nested DOM would have to be
 * rewritten for it.
 */

export interface TreeNode<T> {
  readonly key: string;
  readonly value: T;
  readonly children: readonly TreeNode<T>[];
}

interface FlatRow<T> {
  readonly node: TreeNode<T>;
  readonly depth: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
}

export interface TreeViewProps<T> {
  readonly roots: readonly TreeNode<T>[];
  readonly expandedKeys: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly renderNode: (value: T) => React.ReactNode;
  readonly ariaLabel: string;
  readonly selectedKey?: string | null;
  readonly onSelect?: (node: TreeNode<T>) => void;
}

function flatten<T>(
  nodes: readonly TreeNode<T>[],
  expanded: ReadonlySet<string>,
  depth: number,
  out: FlatRow<T>[],
): void {
  for (const node of nodes) {
    const expandable = node.children.length > 0;
    const isExpanded = expandable && expanded.has(node.key);
    out.push({ node, depth, expandable, expanded: isExpanded });
    if (isExpanded) flatten(node.children, expanded, depth + 1, out);
  }
}

export function TreeView<T>({
  roots,
  expandedKeys,
  onToggle,
  renderNode,
  ariaLabel,
  selectedKey = null,
  onSelect,
}: TreeViewProps<T>): React.JSX.Element {
  const rows = useMemo(() => {
    const out: FlatRow<T>[] = [];
    flatten(roots, expandedKeys, 1, out);
    return out;
  }, [roots, expandedKeys]);

  const container = useRef<HTMLDivElement | null>(null);

  /** Roving tabindex: exactly one row is tabbable, arrows move between them. */
  const focusRow = useCallback((index: number): void => {
    const clamped = Math.max(0, index);
    const element = container.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[clamped];
    element?.focus();
  }, []);

  const activeIndex = Math.max(
    0,
    rows.findIndex((row) => row.node.key === selectedKey),
  );

  /** The nearest earlier row at a shallower depth. */
  const parentIndex = (index: number, depth: number): number => {
    for (let i = index - 1; i >= 0; i -= 1) {
      if ((rows[i]?.depth ?? 0) < depth) return i;
    }
    return index;
  };

  const move = (event: React.KeyboardEvent, index: number, row: FlatRow<T>): boolean => {
    switch (event.key) {
      case 'ArrowDown':
        focusRow(Math.min(index + 1, rows.length - 1));
        return true;
      case 'ArrowUp':
        focusRow(index - 1);
        return true;
      case 'Home':
        focusRow(0);
        return true;
      case 'End':
        focusRow(rows.length - 1);
        return true;
      case 'ArrowRight':
        if (row.expandable && !row.expanded) onToggle(row.node.key);
        else focusRow(Math.min(index + 1, rows.length - 1));
        return true;
      case 'ArrowLeft':
        if (row.expanded) onToggle(row.node.key);
        else focusRow(parentIndex(index, row.depth));
        return true;
      default:
        return false;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number, row: FlatRow<T>): void => {
    if (move(event, index, row)) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (row.expandable) onToggle(row.node.key);
    onSelect?.(row.node);
  };

  return (
    <div ref={container} className={styles.tree} role="tree" aria-label={ariaLabel}>
      {rows.map((row, index) => (
        <div
          key={row.node.key}
          role="treeitem"
          aria-level={row.depth}
          aria-expanded={row.expandable ? row.expanded : undefined}
          aria-selected={row.node.key === selectedKey}
          tabIndex={index === activeIndex ? 0 : -1}
          className={styles.row}
          style={{ paddingInlineStart: `calc(var(--space-3) * ${row.depth})` }}
          onKeyDown={(event) => {
            handleKeyDown(event, index, row);
          }}
          onClick={() => {
            if (row.expandable) onToggle(row.node.key);
            onSelect?.(row.node);
          }}
        >
          <span className={styles.twisty} aria-hidden="true">
            {row.expandable ? (row.expanded ? '▾' : '▸') : '·'}
          </span>
          {renderNode(row.node.value)}
        </div>
      ))}
    </div>
  );
}
