import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * CodeMirror theme — 09_DESIGN_SYSTEM.md §3
 *
 * Every value is a design token rather than a literal, so the editor follows
 * the theme system for free when M8 makes it user-adjustable. CM6 injects
 * these as a runtime stylesheet, which is the reason `style-src` carries
 * `'unsafe-inline'` (05_SECURITY.md §4.3, residual risk RR-02).
 *
 * The token classes below are applied through the shared decoration
 * mechanism in `CodeEditor`, not by a CM6 language mode: our own tokenizer
 * already produces exactly the spans the explanation refers to, so deriving
 * the colouring from a second grammar would let the two disagree.
 */
export function editorTheme(minHeight = '2.5rem'): Extension {
  return EditorView.theme(
    {
      '&': {
        color: 'var(--color-text)',
        backgroundColor: 'transparent',
        fontSize: 'var(--text-base)',
        fontFamily: 'var(--font-mono)',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        lineHeight: 'var(--leading-relaxed)',
        minHeight,
      },
      '.cm-content': {
        padding: 'var(--space-3)',
        caretColor: 'var(--color-accent)',
      },
      '.cm-line': { padding: '0 var(--space-1)' },
      '.cm-placeholder': { color: 'var(--color-text-muted)' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--color-text-muted)',
        border: 'none',
        borderRight: '1px solid var(--color-border)',
      },
      '.cm-activeLineGutter': { backgroundColor: 'transparent' },
      // A selection with no visible contrast is a real usability failure for
      // anyone who selects with the keyboard, so this is a token and not a
      // translucent tint over an unknown background.
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--color-selection)',
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },

      /* Regex token colours (09_DESIGN_SYSTEM.md §3.3). */
      '.tok-meta': { color: 'var(--syntax-rx-meta)' },
      '.tok-class': { color: 'var(--syntax-rx-class)' },
      '.tok-group': { color: 'var(--syntax-rx-group)' },
      '.tok-quantifier': { color: 'var(--syntax-rx-quantifier)' },
      '.tok-anchor': { color: 'var(--syntax-rx-anchor)' },
      '.tok-escape': { color: 'var(--syntax-rx-escape)' },
      '.tok-invalid': {
        color: 'var(--syntax-error)',
        textDecoration: 'underline wavy var(--syntax-error)',
      },

      /* Linked span, driven by hover or focus in the explanation. */
      '.tok-linked': {
        backgroundColor: 'var(--color-accent-subtle)',
        outline: '1px solid var(--color-border-accent)',
        borderRadius: '2px',
      },

      /* Match highlighting. Background tint *and* underline, so colour is
         never the only signal (09_DESIGN_SYSTEM.md §3.3). */
      '.match-even': {
        backgroundColor: 'var(--color-match-a)',
        textDecoration: 'underline',
        textDecorationColor: 'var(--color-accent)',
      },
      '.match-odd': {
        backgroundColor: 'var(--color-match-b)',
        textDecoration: 'underline',
        textDecorationColor: 'var(--color-info)',
      },
    },
    { dark: true },
  );
}
