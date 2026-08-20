import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { history, historyKeymap } from '@codemirror/commands';
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  type DecorationSet,
} from '@codemirror/view';
import { editorTheme } from './editorTheme';
import { standardBindings } from './standardBindings';
import styles from './CodeEditor.module.css';

/**
 * The one CodeMirror wrapper — 10_COMPONENT_ARCHITECTURE.md §3.1
 *
 * Every editor surface in the product goes through this component. They differ
 * only in configuration, and near-identical wrappers would mean several places
 * to fix each CM6 quirk.
 *
 * Three things this has to get right, all of which are classic bugs:
 *
 *   1. **The cursor must survive an external value change.** A naive
 *      controlled editor dispatches a full document replacement on every
 *      render and resets the cursor to position 0 on every keystroke. The
 *      reconciliation below compares against the view's own document first.
 *   2. **Limits are enforced in the editor, not only downstream.** A paste
 *      that would exceed `maxLength` is rejected as a transaction, so the
 *      oversized text never enters the document at all.
 *   3. **Tab is not bound.** `standardBindings` leaves it alone, so focus moves
 *      out of the editor the way it does from any other control. This is a
 *      deliberate omission rather than an oversight: binding Tab to indent
 *      would create the keyboard trap `08_UI_UX_SPEC.md` §12.3 calls out.
 */

/** A styled range. One mechanism serves token colouring, matches, and errors. */
export interface EditorRange {
  readonly from: number;
  readonly to: number;
  readonly className: string;
}

/** Moves the cursor and scrolls, when `nonce` changes. */
export interface EditorSelection {
  readonly from: number;
  readonly to: number;
  /** Changing this re-applies the selection; the value itself is not read. */
  readonly nonce: number;
}

export interface CodeEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
  readonly ariaDescribedBy?: string;
  readonly maxLength: number;
  readonly placeholder?: string;
  readonly ranges?: readonly EditorRange[];
  readonly selection?: EditorSelection | null;
  readonly singleLine?: boolean;
  readonly showLineNumbers?: boolean;
  readonly minHeight?: string;
}

const setRanges = StateEffect.define<readonly EditorRange[]>();

/**
 * Holds the decorations. They live in editor state rather than in a React ref
 * so CM6 maps them through document changes itself — without that, a
 * decoration would point at a stale offset for the frame between a keystroke
 * and the next analysis.
 */
const rangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setRanges)) continue;
      const length = transaction.state.doc.length;
      next = Decoration.set(
        effect.value
          // Ranges come from analysis of a slightly older document during the
          // debounce window, so they are clamped rather than trusted.
          .filter((range) => range.from < range.to && range.to <= length && range.from >= 0)
          .map((range) => Decoration.mark({ class: range.className }).range(range.from, range.to)),
        true,
      );
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Rejects a transaction that would breach the length limit, and strips
 * newlines from a single-line editor.
 *
 * Filtering rather than truncating: silently keeping the first N characters of
 * a paste produces a pattern the user did not write, which is worse than
 * refusing it. The count is shown next to the editor so the refusal is
 * explicable rather than mysterious.
 */
function limitExtension(maxLength: number, singleLine: boolean): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) return transaction;
    if (transaction.newDoc.length > maxLength) return [];
    if (singleLine && transaction.newDoc.lines > 1) return [];
    return transaction;
  });
}

export function CodeEditor({
  value,
  onChange,
  ariaLabel,
  ariaDescribedBy,
  maxLength,
  placeholder,
  ranges,
  selection,
  singleLine = false,
  showLineNumbers = false,
  minHeight,
}: CodeEditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);

  // Held in a ref so the effect below does not re-create the whole editor when
  // the parent passes a new closure.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const attributes: Record<string, string> = { 'aria-label': ariaLabel };
    if (ariaDescribedBy !== undefined) attributes['aria-describedby'] = ariaDescribedBy;

    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...standardBindings, ...historyKeymap]),
          drawSelection(),
          highlightSpecialChars(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of(attributes),
          rangeField,
          editorTheme(minHeight),
          limitExtension(maxLength, singleLine),
          ...(showLineNumbers ? [lineNumbers()] : []),
          ...(placeholder === undefined ? [] : [cmPlaceholder(placeholder)]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });

    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Configuration is fixed for the lifetime of a surface. Re-creating the
    // editor when a label changes would drop undo history for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile an externally driven value (Clear, an example, a restore).
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === value) return;
    editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setRanges.of(ranges ?? []) });
  }, [ranges]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !selection) return;
    const length = editor.state.doc.length;
    const from = Math.min(selection.from, length);
    const to = Math.min(selection.to, length);
    editor.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    editor.focus();
  }, [selection]);

  // The same minimum is declared on the host as well as inside CM6's theme.
  // The theme only applies once the view has mounted, so until then the box is
  // two borders tall and everything below it moves when the editor appears —
  // measured as the larger half of a 0.026 CLS on a warm load
  // (12_PERFORMANCE.md §11.5).
  return (
    <div
      ref={host}
      className={styles.editor}
      style={
        minHeight === undefined
          ? undefined
          : ({ '--editor-min-height': minHeight } as React.CSSProperties)
      }
    />
  );
}
