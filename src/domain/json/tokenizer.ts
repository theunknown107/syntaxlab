import { LIMITS } from '../shared/limits';
import { domainError, type DomainError, type SourceSpan } from '../shared/result';

/**
 * JSON scanner — 04_PARSER_ARCHITECTURE.md §3.3
 *
 * Single pass over UTF-16 code units, tracking line and column alongside the
 * offset. Strict RFC 8259: comments, trailing commas, single quotes, unquoted
 * keys, `NaN`, `Infinity` and `undefined` are all errors — but each gets a
 * message naming the specific rule, because recognising the near-miss is far
 * more useful to a developer than "unexpected token" (§3.6).
 *
 * Not a chain of regular expressions. A scanner has to report *where* it
 * failed and *why*, and it has to distinguish a lexical failure from a
 * structural one; a replace-chain can do neither.
 */

export type JsonTokenKind =
  | 'braceOpen'
  | 'braceClose'
  | 'bracketOpen'
  | 'bracketClose'
  | 'colon'
  | 'comma'
  | 'string'
  | 'number'
  | 'true'
  | 'false'
  | 'null'
  /** A lexical failure. Carries its own error; the parser reports it once. */
  | 'invalid'
  | 'eof';

export interface JsonToken {
  readonly kind: JsonTokenKind;
  /** Exactly as written. */
  readonly raw: string;
  readonly span: SourceSpan;
  /** Decoded value, for `string` tokens only. */
  readonly stringValue?: string;
  /** IEEE-754 value, for `number` tokens only. */
  readonly numberValue?: number;
  /** Present only on `invalid`. */
  readonly error?: DomainError;
}

export interface TokenizeResult {
  readonly tokens: readonly JsonToken[];
  /** Lexical errors, in source order. Structural errors come from the parser. */
  readonly errors: readonly DomainError[];
}

export function checkInputLength(source: string): DomainError | null {
  if (source.length <= LIMITS.json.input) return null;
  return domainError(
    'LIMIT_EXCEEDED',
    `Input is ${formatSize(source.length)}; the limit is ${formatSize(LIMITS.json.input)}.`,
    { hint: 'Try a smaller sample, or split the document.' },
  );
}

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} characters`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ *
 * Cursor
 * ------------------------------------------------------------------ */

/** Where a token began. Passed as one value rather than three loose numbers. */
interface Mark {
  readonly start: number;
  readonly line: number;
  readonly column: number;
}

class Cursor {
  position = 0;
  line = 1;
  /** Offset of the current line's first character, so column is a subtraction. */
  private lineStart = 0;

  constructor(private readonly source: string) {}

  /**
   * A method rather than a getter. TypeScript narrows a getter after a
   * `while (!cursor.isDone())` test and does not know that scanning moved the
   * cursor, which makes a later re-check look unreachable when it is not.
   */
  isDone(): boolean {
    return this.position >= this.source.length;
  }

  get column(): number {
    return this.position - this.lineStart + 1;
  }

  /** Where the token about to be scanned starts. */
  mark(): Mark {
    return { start: this.position, line: this.line, column: this.column };
  }

  peek(offset = 0): string {
    return this.source[this.position + offset] ?? '';
  }

  advance(): string {
    const char = this.source[this.position] ?? '';
    this.position += 1;
    if (char === '\n') {
      this.line += 1;
      this.lineStart = this.position;
    }
    return char;
  }

  /** A span from a remembered mark to the current position. */
  spanFrom(mark: Mark): SourceSpan {
    return { start: mark.start, end: this.position, line: mark.line, column: mark.column };
  }
}

const VALID_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

function isHex(char: string): boolean {
  return (
    (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')
  );
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isLetter(char: string): boolean {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}

function codePointLabel(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Bounds what a hostile document can put into an error message. */
function preview(raw: string): string {
  const trimmed = raw.length <= 24 ? raw : `${raw.slice(0, 24)}…`;
  return trimmed.replace(/[\n\r\t]/g, ' ');
}

function invalidToken(cursor: Cursor, source: string, mark: Mark, error: DomainError): JsonToken {
  return {
    kind: 'invalid',
    raw: source.slice(mark.start, cursor.position),
    span: cursor.spanFrom(mark),
    error,
  };
}

/* ------------------------------------------------------------------ *
 * Scanner
 * ------------------------------------------------------------------ */

export function tokenize(source: string): TokenizeResult {
  const cursor = new Cursor(source);
  const tokens: JsonToken[] = [];
  const errors: DomainError[] = [];

  // Every iteration consumes at least one character. The guard is a backstop
  // against a scanning bug becoming a frozen worker; that it never fires is
  // asserted by a property test rather than assumed.
  let guard = 0;
  const guardLimit = source.length * 4 + 64;

  while (!cursor.isDone()) {
    if (++guard > guardLimit) {
      errors.push(
        domainError('INTERNAL', 'The document could not be read.', {
          detail: `scanner stalled at offset ${cursor.position}`,
        }),
      );
      break;
    }

    skipWhitespace(cursor);
    if (cursor.isDone()) break;

    const token = scanToken(cursor, source);
    tokens.push(token);
    if (token.error) errors.push(token.error);
  }

  tokens.push({
    kind: 'eof',
    raw: '',
    span: { start: source.length, end: source.length, line: cursor.line, column: cursor.column },
  });

  return { tokens, errors };
}

function skipWhitespace(cursor: Cursor): void {
  // RFC 8259 whitespace is exactly these four. A non-breaking space or a BOM
  // is an error rather than whitespace, and saying so is more useful than
  // skipping over it silently.
  while (!cursor.isDone()) {
    const char = cursor.peek();
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') cursor.advance();
    else break;
  }
}

function scanPunctuation(char: string): JsonTokenKind | null {
  switch (char) {
    case '{':
      return 'braceOpen';
    case '}':
      return 'braceClose';
    case '[':
      return 'bracketOpen';
    case ']':
      return 'bracketClose';
    case ':':
      return 'colon';
    case ',':
      return 'comma';
    default:
      return null;
  }
}

function scanToken(cursor: Cursor, source: string): JsonToken {
  const mark = cursor.mark();
  const char = cursor.peek();

  const punctuation = scanPunctuation(char);
  if (punctuation) {
    cursor.advance();
    return { kind: punctuation, raw: char, span: cursor.spanFrom(mark) };
  }

  if (char === '"') return scanString(cursor, source, mark);
  if (char === '-' || isDigit(char)) return scanNumber(cursor, source, mark);
  if (isLetter(char)) return scanWord(cursor, source, mark);

  return scanUnexpected(cursor, source, mark);
}

/* ------------------------------------------------------------------ *
 * Strings
 * ------------------------------------------------------------------ */

function scanString(cursor: Cursor, source: string, mark: Mark): JsonToken {
  cursor.advance(); // opening quote
  let value = '';

  while (!cursor.isDone()) {
    const char = cursor.peek();

    if (char === '"') {
      cursor.advance();
      return {
        kind: 'string',
        raw: source.slice(mark.start, cursor.position),
        span: cursor.spanFrom(mark),
        stringValue: value,
      };
    }

    if (char === '\\') {
      const escaped = scanEscape(cursor, source, mark);
      if (escaped.failure) return escaped.failure;
      value += escaped.value;
      continue;
    }

    const code = char.charCodeAt(0);
    if (code < 0x20) {
      // RFC 8259 forbids raw control characters inside strings. Almost every
      // hand-built parser accepts them, and a literal tab pasted into a value
      // is a common enough mistake to be worth naming.
      cursor.advance();
      return invalidToken(
        cursor,
        source,
        mark,
        domainError(
          'SYNTAX',
          `A raw control character (${codePointLabel(code)}) is not allowed inside a string.`,
          {
            span: cursor.spanFrom(mark),
            hint: 'Escape it — a tab is `\\t` and a newline is `\\n`.',
          },
        ),
      );
    }

    value += cursor.advance();
  }

  return invalidToken(
    cursor,
    source,
    mark,
    domainError('SYNTAX', `The string starting on line ${mark.line} is never closed.`, {
      span: cursor.spanFrom(mark),
      hint: 'Check for a missing `"`, or a `"` inside the value that needs escaping.',
    }),
  );
}

interface EscapeResult {
  readonly value: string;
  /** Set when the escape was invalid; the whole string token fails. */
  readonly failure: JsonToken | null;
}

function scanEscape(cursor: Cursor, source: string, mark: Mark): EscapeResult {
  const escapeMark = cursor.mark();
  cursor.advance(); // backslash
  const marker = cursor.peek();

  if (marker === 'u') {
    cursor.advance();
    let hex = '';
    while (hex.length < 4 && isHex(cursor.peek())) hex += cursor.advance();

    if (hex.length !== 4) {
      return {
        value: '',
        failure: invalidToken(
          cursor,
          source,
          mark,
          domainError('SYNTAX', 'A `\\u` escape needs exactly four hexadecimal digits.', {
            span: cursor.spanFrom(escapeMark),
            hint: 'For example `\\u00e9`. Pad shorter values with zeros.',
          }),
        ),
      };
    }

    // `fromCharCode` on a single code unit preserves an unpaired surrogate
    // exactly as written (J-I5). A well-formed pair combines naturally,
    // because the two units land next to each other in the result string.
    return { value: String.fromCharCode(parseInt(hex, 16)), failure: null };
  }

  const decoded = VALID_ESCAPES[marker];
  if (decoded !== undefined) {
    cursor.advance();
    return { value: decoded, failure: null };
  }

  // Not repaired. A `\x41` quietly turned into `A` would be a different
  // document from the one the user wrote.
  if (marker !== '') cursor.advance();
  return {
    value: '',
    failure: invalidToken(
      cursor,
      source,
      mark,
      domainError('SYNTAX', `\`\\${preview(marker)}\` is not a valid JSON escape.`, {
        span: cursor.spanFrom(escapeMark),
        hint: 'JSON allows `\\" \\\\ \\/ \\b \\f \\n \\r \\t` and `\\uXXXX`.',
      }),
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

/**
 * The JSON number grammar, enforced exactly:
 *
 *   `-? ( 0 | [1-9][0-9]* ) ( . [0-9]+ )? ( [eE] [+-]? [0-9]+ )?`
 *
 * Written out rather than delegated to `Number()`, which accepts `0x10`,
 * `1_000`, `Infinity`, a leading `+`, and surrounding whitespace — none of
 * which are JSON. Each rejection names the rule it broke.
 */
function scanNumber(cursor: Cursor, source: string, mark: Mark): JsonToken {
  const fail = (message: string, hint: string): JsonToken => {
    // Consume the rest of the numeric-looking run, so the parser resumes at a
    // structural token instead of re-reading the same digits.
    while (!cursor.isDone() && /[0-9eExXa-fA-F_+\-.]/.test(cursor.peek())) cursor.advance();
    return invalidToken(
      cursor,
      source,
      mark,
      domainError('SYNTAX', message, { span: cursor.spanFrom(mark), hint }),
    );
  };

  if (cursor.peek() === '-') cursor.advance();

  if (!isDigit(cursor.peek())) {
    return fail('A number needs at least one digit.', 'For example `-1` or `0`.');
  }

  if (cursor.peek() === '0') {
    cursor.advance();
    if (isDigit(cursor.peek())) {
      return fail(
        'Numbers may not have leading zeros.',
        'Write `0` on its own, or remove the leading zero.',
      );
    }
  } else {
    while (isDigit(cursor.peek())) cursor.advance();
  }

  const fractionFailure = scanFraction(cursor, fail);
  if (fractionFailure) return fractionFailure;

  const exponentFailure = scanExponent(cursor, fail);
  if (exponentFailure) return exponentFailure;

  if (isLetter(cursor.peek()) || cursor.peek() === '_') {
    return fail('A number cannot be followed by a letter.', 'Check for a missing comma or quote.');
  }

  const raw = source.slice(mark.start, cursor.position);
  return {
    kind: 'number',
    raw,
    span: cursor.spanFrom(mark),
    numberValue: Number(raw),
  };
}

type NumberFail = (message: string, hint: string) => JsonToken;

function scanFraction(cursor: Cursor, fail: NumberFail): JsonToken | null {
  if (cursor.peek() !== '.') return null;
  cursor.advance();
  if (!isDigit(cursor.peek())) {
    return fail(
      'A decimal point must be followed by at least one digit.',
      'Write `1.0` rather than `1.`.',
    );
  }
  while (isDigit(cursor.peek())) cursor.advance();
  return null;
}

function scanExponent(cursor: Cursor, fail: NumberFail): JsonToken | null {
  const marker = cursor.peek();
  if (marker !== 'e' && marker !== 'E') return null;
  cursor.advance();
  if (cursor.peek() === '+' || cursor.peek() === '-') cursor.advance();
  if (!isDigit(cursor.peek())) {
    return fail(
      'An exponent must be followed by at least one digit.',
      'Write `1e10` rather than `1e`.',
    );
  }
  while (isDigit(cursor.peek())) cursor.advance();
  return null;
}

/* ------------------------------------------------------------------ *
 * Literals and near-misses
 * ------------------------------------------------------------------ */

/** Near-misses worth naming rather than reporting as "unexpected token". */
const FOREIGN_WORDS: Readonly<Record<string, { message: string; hint: string }>> = {
  undefined: {
    message: '`undefined` is not a JSON value.',
    hint: 'Use `null`, or leave the property out entirely.',
  },
  nan: { message: '`NaN` is not a JSON value.', hint: 'Use `null`, or a string such as `"NaN"`.' },
  infinity: {
    message: '`Infinity` is not a JSON value.',
    hint: 'Use `null`, or a string such as `"Infinity"`.',
  },
  none: { message: '`None` is Python, not JSON.', hint: 'JSON writes this as `null`.' },
  nil: { message: '`nil` is not a JSON value.', hint: 'JSON writes this as `null`.' },
  true: { message: '`true` must be lower case in JSON.', hint: 'Write `true`.' },
  false: { message: '`false` must be lower case in JSON.', hint: 'Write `false`.' },
  null: { message: '`null` must be lower case in JSON.', hint: 'Write `null`.' },
};

function scanWord(cursor: Cursor, source: string, mark: Mark): JsonToken {
  while (!cursor.isDone() && isLetter(cursor.peek())) cursor.advance();
  const raw = source.slice(mark.start, cursor.position);
  const span = cursor.spanFrom(mark);

  if (raw === 'true' || raw === 'false' || raw === 'null') return { kind: raw, raw, span };

  const foreign = FOREIGN_WORDS[raw.toLowerCase()];
  if (foreign) {
    return invalidToken(
      cursor,
      source,
      mark,
      domainError('UNSUPPORTED', foreign.message, { span, hint: foreign.hint }),
    );
  }

  // A bare word where a value belongs is almost always an unquoted key or an
  // unquoted string, which is the most common JSON mistake there is.
  return invalidToken(
    cursor,
    source,
    mark,
    domainError('SYNTAX', `\`${preview(raw)}\` is not valid JSON.`, {
      span,
      hint: 'Strings and keys must be wrapped in double quotes.',
    }),
  );
}

function scanUnexpected(cursor: Cursor, source: string, mark: Mark): JsonToken {
  const char = cursor.peek();

  if (char === "'") return scanSingleQuoted(cursor, source, mark);
  if (char === '/' && (cursor.peek(1) === '/' || cursor.peek(1) === '*')) {
    return scanComment(cursor, source, mark);
  }

  cursor.advance();
  const span = cursor.spanFrom(mark);
  const code = char.codePointAt(0) ?? 0;

  if (char === '+') {
    return invalidToken(
      cursor,
      source,
      mark,
      domainError('SYNTAX', 'A leading `+` is not allowed on a JSON number.', {
        span,
        hint: 'Write `1` rather than `+1`.',
      }),
    );
  }

  if (code === 0xfeff) {
    return invalidToken(
      cursor,
      source,
      mark,
      domainError('SYNTAX', 'The document starts with a byte-order mark.', {
        span,
        hint: 'JSON has no BOM. Save the file as UTF-8 without one.',
      }),
    );
  }

  return invalidToken(
    cursor,
    source,
    mark,
    domainError('SYNTAX', `Unexpected character \`${preview(char)}\` (${codePointLabel(code)}).`, {
      span,
    }),
  );
}

function scanSingleQuoted(cursor: Cursor, source: string, mark: Mark): JsonToken {
  cursor.advance();
  while (!cursor.isDone() && cursor.peek() !== "'" && cursor.peek() !== '\n') cursor.advance();
  if (cursor.peek() === "'") cursor.advance();

  return invalidToken(
    cursor,
    source,
    mark,
    domainError('UNSUPPORTED', 'Strings must use double quotes.', {
      span: cursor.spanFrom(mark),
      hint: 'JSON does not allow single quotes. JavaScript and JSON5 do — replace `\'` with `"`.',
    }),
  );
}

function scanComment(cursor: Cursor, source: string, mark: Mark): JsonToken {
  const block = cursor.peek(1) === '*';
  cursor.advance();
  cursor.advance();

  if (block) {
    while (!cursor.isDone() && !(cursor.peek() === '*' && cursor.peek(1) === '/')) cursor.advance();
    if (!cursor.isDone()) {
      cursor.advance();
      cursor.advance();
    }
  } else {
    while (!cursor.isDone() && cursor.peek() !== '\n') cursor.advance();
  }

  return invalidToken(
    cursor,
    source,
    mark,
    domainError('UNSUPPORTED', 'Comments are not valid JSON.', {
      span: cursor.spanFrom(mark),
      hint: 'Strict JSON has no comments. JSONC and JSON5 allow them — remove this one, or use a tool that supports those.',
    }),
  );
}
