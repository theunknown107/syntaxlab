import type { JsonPath, JsonPathSegment } from './ast';

/**
 * JSON path formatting.
 *
 * A **structural** path, not a query language: it names one node's position in
 * one document. There is no filtering, no wildcard, no recursive descent —
 * that is JSONPath the query language, which the product does not need and
 * which would be a much larger thing to get right.
 *
 * Two notations, because developers paste them into different places:
 *
 *   dot      `$.user.name`      reads well, and is what people expect first
 *   bracket  `$["user"]["name"]` always valid, whatever the key contains
 *
 * The path lives in the domain rather than in a renderer so that copying a
 * path and linking a tree row to the editor cannot disagree about what a
 * segment means.
 */

/**
 * Keys that dot notation can express without ambiguity.
 *
 * Deliberately narrower than JavaScript's identifier grammar. `$.a-b` would
 * parse as a subtraction, `$.2` as a number, and `$.a b` as two tokens — none
 * of which the user could paste anywhere useful. Anything outside this set
 * falls back to bracket notation, which is always correct.
 */
const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function isPlainKey(key: string): boolean {
  return PLAIN_KEY.test(key);
}

/**
 * Quotes a key for bracket notation.
 *
 * Built character by character rather than with `JSON.stringify`, so control
 * characters and lone surrogates are escaped explicitly instead of relying on
 * the platform's choices — the same reason the parser does not use
 * `JSON.parse`. A lone surrogate pasted into a bracket path must survive as
 * `\uD800`, not as a replacement character.
 */
export function quoteKey(key: string): string {
  let out = '"';
  for (const unit of key) {
    const code = unit.codePointAt(0) ?? 0;
    switch (unit) {
      case '"':
        out += '\\"';
        break;
      case '\\':
        out += '\\\\';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\f':
        out += '\\f';
        break;
      default:
        // Control characters and unpaired surrogates are escaped; everything
        // else is emitted as written, so non-ASCII text stays readable.
        out +=
          code < 0x20 || (code >= 0xd800 && code <= 0xdfff)
            ? `\\u${code.toString(16).padStart(4, '0')}`
            : unit;
    }
  }
  return `${out}"`;
}

function formatSegment(segment: JsonPathSegment, dotted: boolean): string {
  if (segment.kind === 'index') return `[${segment.index}]`;
  if (dotted && isPlainKey(segment.key)) return `.${segment.key}`;
  return `[${quoteKey(segment.key)}]`;
}

/** `$.user.items[0]` — falls back to brackets for any key dots cannot express. */
export function formatPath(path: JsonPath): string {
  return path.reduce<string>((out, segment) => out + formatSegment(segment, true), '$');
}

/** `$["user"]["items"][0]` — always valid, whatever the keys contain. */
export function formatPathBracket(path: JsonPath): string {
  return path.reduce<string>((out, segment) => out + formatSegment(segment, false), '$');
}

/** A short label for one segment, for a tree row rather than a full path. */
export function segmentLabel(segment: JsonPathSegment): string {
  return segment.kind === 'index' ? `[${segment.index}]` : segment.key;
}

export function pathKey(path: JsonPath): string {
  // A stable identity for the path, used as a map key when grouping duplicate
  // reports. Bracket form because it is unambiguous for every key.
  return formatPathBracket(path);
}
