import {
  cursorCharLeft,
  cursorCharRight,
  cursorDocEnd,
  cursorDocStart,
  cursorGroupLeft,
  cursorGroupRight,
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  cursorLineBoundaryLeft,
  cursorLineBoundaryRight,
  cursorLineDown,
  cursorLineUp,
  cursorPageDown,
  cursorPageUp,
  deleteCharBackward,
  deleteCharForward,
  deleteGroupBackward,
  deleteGroupForward,
  deleteLineBoundaryBackward,
  deleteLineBoundaryForward,
  emacsStyleKeymap,
  insertNewlineKeepIndent,
  selectAll,
  selectCharLeft,
  selectCharRight,
  selectDocEnd,
  selectDocStart,
  selectGroupLeft,
  selectGroupRight,
  selectLineBoundaryBackward,
  selectLineBoundaryForward,
  selectLineBoundaryLeft,
  selectLineBoundaryRight,
  selectLineDown,
  selectLineUp,
  selectPageDown,
  selectPageUp,
} from '@codemirror/commands';
import type { KeyBinding } from '@codemirror/view';

/**
 * CodeMirror's `standardKeymap`, rebuilt binding for binding — 12_PERFORMANCE.md §12.2
 *
 * **Why this file exists.** `standardKeymap` binds Enter to
 * `insertNewlineAndIndent`, which reads the syntax tree to decide the new
 * line's indentation. That single reference is the only thing in SyntaxLab
 * that reaches `@codemirror/language`, and through it `@lezer/highlight` and
 * `@lezer/common`. Measured: **14.49 KB gzipped**, 8% of the initial bundle,
 * for one keybinding.
 *
 * It is dead weight here in particular, because SyntaxLab configures **no
 * language at all** — no parser, no `LanguageSupport`, no syntax tree. Regex
 * and JSON are tokenised by the domain layer in a worker and rendered through
 * `Decoration`, never through CodeMirror's highlighter. So `getIndentation`
 * has no indent service to consult and already falls back to copying the
 * current line's leading whitespace, which is precisely what
 * `insertNewlineKeepIndent` does directly.
 *
 * Every binding below is the one `standardKeymap` uses, imported individually
 * so tree-shaking can see what is unused. The list is verbose on purpose: a
 * hand-written approximation of text-editing behaviour would drift from the
 * platform, and bidi, word boundaries and grapheme clusters are exactly the
 * things not worth reimplementing. Only Enter differs.
 *
 * **The one behavioural difference** is bracket explosion: with the cursor
 * between `{` and `}`, upstream inserts two line breaks and leaves the cursor
 * on an indented blank line between them. That is not reproduced. It is a
 * small loss — the editor has no bracket auto-closing, so the cursor only
 * lands there if the user typed both characters — and the JSON workspace has
 * a Format action that does the same job for the whole document.
 *
 * If a real language mode is ever added, delete this file and go back to
 * `standardKeymap`: the Lezer stack would be paid for by then anyway.
 */
export const standardBindings: readonly KeyBinding[] = [
  { key: 'ArrowLeft', run: cursorCharLeft, shift: selectCharLeft, preventDefault: true },
  {
    key: 'Mod-ArrowLeft',
    mac: 'Alt-ArrowLeft',
    run: cursorGroupLeft,
    shift: selectGroupLeft,
    preventDefault: true,
  },
  {
    mac: 'Cmd-ArrowLeft',
    run: cursorLineBoundaryLeft,
    shift: selectLineBoundaryLeft,
    preventDefault: true,
  },
  { key: 'ArrowRight', run: cursorCharRight, shift: selectCharRight, preventDefault: true },
  {
    key: 'Mod-ArrowRight',
    mac: 'Alt-ArrowRight',
    run: cursorGroupRight,
    shift: selectGroupRight,
    preventDefault: true,
  },
  {
    mac: 'Cmd-ArrowRight',
    run: cursorLineBoundaryRight,
    shift: selectLineBoundaryRight,
    preventDefault: true,
  },
  { key: 'ArrowUp', run: cursorLineUp, shift: selectLineUp, preventDefault: true },
  { mac: 'Cmd-ArrowUp', run: cursorDocStart, shift: selectDocStart },
  { mac: 'Ctrl-ArrowUp', run: cursorPageUp, shift: selectPageUp },
  { key: 'ArrowDown', run: cursorLineDown, shift: selectLineDown, preventDefault: true },
  { mac: 'Cmd-ArrowDown', run: cursorDocEnd, shift: selectDocEnd },
  { mac: 'Ctrl-ArrowDown', run: cursorPageDown, shift: selectPageDown },
  { key: 'PageUp', run: cursorPageUp, shift: selectPageUp },
  { key: 'PageDown', run: cursorPageDown, shift: selectPageDown },
  {
    key: 'Home',
    run: cursorLineBoundaryBackward,
    shift: selectLineBoundaryBackward,
    preventDefault: true,
  },
  { key: 'Mod-Home', run: cursorDocStart, shift: selectDocStart },
  {
    key: 'End',
    run: cursorLineBoundaryForward,
    shift: selectLineBoundaryForward,
    preventDefault: true,
  },
  { key: 'Mod-End', run: cursorDocEnd, shift: selectDocEnd },
  // The whole reason for this file. Upstream: `insertNewlineAndIndent`.
  { key: 'Enter', run: insertNewlineKeepIndent, shift: insertNewlineKeepIndent },
  { key: 'Mod-a', run: selectAll },
  { key: 'Backspace', run: deleteCharBackward, shift: deleteCharBackward, preventDefault: true },
  { key: 'Delete', run: deleteCharForward, preventDefault: true },
  { key: 'Mod-Backspace', mac: 'Alt-Backspace', run: deleteGroupBackward, preventDefault: true },
  { key: 'Mod-Delete', mac: 'Alt-Delete', run: deleteGroupForward, preventDefault: true },
  { mac: 'Mod-Backspace', run: deleteLineBoundaryBackward, preventDefault: true },
  { mac: 'Mod-Delete', run: deleteLineBoundaryForward, preventDefault: true },
  // macOS additionally gets the emacs-style Ctrl bindings, as upstream does.
  // flatMap rather than map: upstream types both `key` and `run` as optional,
  // and a binding missing either has nothing to bind. Dropping those is what
  // the old `map` did in effect, minus the undefined it smuggled through.
  ...emacsStyleKeymap.flatMap((binding) =>
    binding.key === undefined || binding.run === undefined
      ? []
      : [
          {
            mac: binding.key,
            run: binding.run,
            ...(binding.shift === undefined ? {} : { shift: binding.shift }),
          },
        ],
  ),
];
