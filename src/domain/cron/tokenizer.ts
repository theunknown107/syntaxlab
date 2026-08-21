import type { SourceSpan } from '../shared/result';
import type { CronToken, CronTokenType } from './ast';

/**
 * Cron tokenizer — 04_PARSER_ARCHITECTURE.md §4.3
 *
 * Single pass, deterministic, and **structurally incapable of not advancing**:
 * every branch below consumes at least one code unit, and the loop asserts it.
 * A tokenizer that can stand still is a tokenizer that can hang the worker.
 *
 * Not one big regular expression. A cron expression is small, but the spans
 * have to be exact — the explanation links every term back to the characters
 * the user typed — and a single regex over the whole input gives up the
 * position bookkeeping that makes that possible.
 *
 * Whitespace is emitted rather than skipped. The parser needs it to split
 * fields, and keeping it in the stream means the token list covers the source
 * with no gaps, which is what makes the span invariants checkable.
 */

/** Positions are UTF-16 code units, matching the regex and JSON parsers. */
function spanAt(source: string, start: number, end: number): SourceSpan {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < start; index += 1) {
    if (source.charCodeAt(index) === 10 /* \n */) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { start, end, line, column: start - lineStart + 1 };
}

const isDigit = (code: number): boolean => code >= 48 && code <= 57;

/** Letters only. Names are `JAN`–`DEC` and `SUN`–`SAT`; case is folded later. */
const isLetter = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

/** Space, tab, CR, LF — anything that separates two fields. */
const isSpace = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 13;

const SINGLE: Readonly<Record<string, CronTokenType>> = {
  '*': 'star',
  '/': 'slash',
  '-': 'dash',
  ',': 'comma',
};

/** Consumes a run of characters matching `matches`, returning the new index. */
function runOf(source: string, from: number, matches: (code: number) => boolean): number {
  let index = from;
  while (index < source.length && matches(source.charCodeAt(index))) index += 1;
  return index;
}

export function tokenize(source: string): readonly CronToken[] {
  const tokens: CronToken[] = [];
  let index = 0;

  while (index < source.length) {
    const start = index;
    const char = source[index] ?? '';
    const code = source.charCodeAt(index);
    const single = SINGLE[char];

    if (isSpace(code)) {
      index = runOf(source, index, isSpace);
      tokens.push({
        type: 'whitespace',
        raw: source.slice(start, index),
        span: spanAt(source, start, index),
      });
    } else if (isDigit(code)) {
      index = runOf(source, index, isDigit);
      tokens.push({
        type: 'number',
        raw: source.slice(start, index),
        span: spanAt(source, start, index),
      });
    } else if (isLetter(code)) {
      index = runOf(source, index, isLetter);
      tokens.push({
        type: 'name',
        raw: source.slice(start, index),
        span: spanAt(source, start, index),
      });
    } else if (char === '@') {
      // A macro is `@` plus letters. `@` alone is still one token, so the
      // parser can report "unknown macro" rather than the tokenizer guessing.
      index = runOf(source, index + 1, isLetter);
      tokens.push({
        type: 'macro',
        raw: source.slice(start, index),
        span: spanAt(source, start, index),
      });
    } else if (single !== undefined) {
      index += 1;
      tokens.push({ type: single, raw: char, span: spanAt(source, start, index) });
    } else {
      // Everything else — `L`, `W`, `#`, `?`, `(`, anything. Carried through as
      // one code unit so the parser can name the character and, where it
      // recognises it, say which scheduler it belongs to.
      index += 1;
      tokens.push({ type: 'unknown', raw: char, span: spanAt(source, start, index) });
    }

    /* istanbul ignore next -- structural guard; no input reaches it */
    if (index === start) {
      // Unreachable: every branch above advances. Kept because "the loop
      // always advances" is the property that makes this terminate, and a
      // future edit that breaks it should fail loudly rather than hang.
      throw new Error('cron tokenizer failed to advance');
    }
  }

  return tokens;
}

/** The tokens that carry meaning, with whitespace dropped. */
export function significant(tokens: readonly CronToken[]): readonly CronToken[] {
  return tokens.filter((token) => token.type !== 'whitespace');
}
