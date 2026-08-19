import type { JsonNode } from './ast';

/**
 * Prettify and minify — 04_PARSER_ARCHITECTURE.md §3.7
 *
 * Both operate on the **CST**, never by round-tripping through
 * `JSON.stringify(JSON.parse(text))`. That round trip destroys three things
 * the product exists to preserve:
 *
 *   - **Raw number text.** `1e5` comes back as `100000`, `1.50` as `1.5`, and
 *     an integer beyond 2^53 comes back as a different integer. The user's
 *     digits are data, not formatting.
 *   - **Key order**, where keys are integer-like. V8 sorts `{"2":…,"1":…}`.
 *   - **Duplicate keys**, which collapse silently.
 *
 * Formatting from the CST is faithful on all three, and it also works on a
 * partially-recovered document — though the UI only offers it when the
 * document is valid, because formatting invalid JSON would mean inventing the
 * missing pieces.
 *
 * Strings are emitted from `raw` for the same reason as numbers: `A` is
 * how the user wrote it, and rewriting it as `A` is a change to their
 * document rather than to its whitespace.
 */

export type IndentStyle = 'two' | 'four' | 'tab';

const INDENTS: Readonly<Record<IndentStyle, string>> = {
  two: '  ',
  four: '    ',
  tab: '\t',
};

export const INDENT_LABELS: Readonly<Record<IndentStyle, string>> = {
  two: '2 spaces',
  four: '4 spaces',
  tab: 'Tabs',
};

export function formatJson(node: JsonNode, style: IndentStyle = 'two'): string {
  return write(node, INDENTS[style], 0);
}

export function minifyJson(node: JsonNode): string {
  return write(node, '', 0);
}

/**
 * One writer for both, because minifying is prettifying with no indent.
 *
 * Recursive rather than iterative: unlike the parser, this only ever runs on
 * a tree the parser already produced, so depth is capped at
 * `LIMITS.json.maxDepth` before it starts.
 */
function write(node: JsonNode, indent: string, depth: number): string {
  const pretty = indent !== '';
  const newline = pretty ? '\n' : '';
  const pad = pretty ? indent.repeat(depth + 1) : '';
  const closePad = pretty ? indent.repeat(depth) : '';
  const colon = pretty ? ': ' : ':';

  switch (node.type) {
    case 'object': {
      if (node.members.length === 0) return '{}';
      const members = node.members.map(
        (member) => `${pad}${member.keyRaw}${colon}${write(member.value, indent, depth + 1)}`,
      );
      return `{${newline}${members.join(`,${newline}`)}${newline}${closePad}}`;
    }

    case 'array': {
      if (node.elements.length === 0) return '[]';
      const elements = node.elements.map((element) => `${pad}${write(element, indent, depth + 1)}`);
      return `[${newline}${elements.join(`,${newline}`)}${newline}${closePad}]`;
    }

    // `raw` for both, so escapes and digits survive exactly as written.
    case 'string':
      return node.raw;
    case 'number':
      return node.raw;

    case 'boolean':
      return node.value ? 'true' : 'false';
    case 'null':
      return 'null';

    case 'error':
      // Unreachable from the UI, which only formats a valid document. Emitting
      // the raw text is the honest fallback: it changes nothing.
      return node.raw;
  }
}
