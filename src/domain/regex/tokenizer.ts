import { LIMITS } from '../shared/limits';
import { domainError, type DomainError, type SourceSpan } from '../shared/result';

/**
 * Regex tokenizer — 04_PARSER_ARCHITECTURE.md §2.3
 *
 * Single left-to-right pass over UTF-16 code units. Offsets are code units
 * throughout, matching `String.prototype.slice`, CodeMirror document offsets,
 * and `RegExp` indices. Mixing code units and code points here is a classic
 * off-by-N bug with astral characters, so the unit is fixed once and never
 * varied — `😀` is two units wide and the tokenizer says so.
 *
 * Context sensitivity is exactly one boolean: inside `[...]` most
 * metacharacters lose their meaning. That is the whole complexity; the JS
 * grammar genuinely needs no mode stack.
 *
 * Termination (invariant R-I8): every loop iteration either advances the
 * cursor or exits. A development-time guard asserts this rather than trusting
 * it, because a stalled tokenizer is indistinguishable from a hung tab.
 */

export type LexTokenKind =
  | 'char'
  | 'dot'
  | 'anchor'
  | 'groupOpen'
  | 'groupClose'
  | 'alternate'
  | 'classOpen'
  | 'classClose'
  | 'classNegate'
  | 'classRange'
  | 'quantifier'
  | 'escape'
  | 'unicodeProperty'
  | 'backreference'
  | 'invalid';

export type GroupOpenKind =
  | 'capturing'
  | 'nonCapturing'
  | 'named'
  | 'lookahead'
  | 'negativeLookahead'
  | 'lookbehind'
  | 'negativeLookbehind';

export type EscapeCategory =
  | 'shorthand'
  | 'control'
  | 'controlLetter'
  | 'hex'
  | 'unicode'
  | 'identity'
  | 'legacyOctal'
  | 'invalid';

export interface LexToken {
  readonly kind: LexTokenKind;
  readonly raw: string;
  readonly span: SourceSpan;
  /** Decoded value for chars and escapes. */
  readonly value?: string;
  readonly groupKind?: GroupOpenKind;
  readonly groupName?: string;
  readonly escape?: EscapeCategory;
  readonly min?: number;
  readonly max?: number | null;
  readonly lazy?: boolean;
  readonly property?: string;
  readonly propertyValue?: string;
  readonly negated?: boolean;
  readonly ref?: number | string;
  /** Set when the construct belongs to another regex dialect. */
  readonly foreignDialect?: ForeignDialect;
}

export interface ForeignDialect {
  readonly construct: string;
  readonly origin: string;
  readonly message: string;
  readonly hint?: string;
}

export interface TokenizeOptions {
  readonly unicode: boolean;
}

export interface TokenizeResult {
  readonly tokens: readonly LexToken[];
  readonly errors: readonly DomainError[];
}

/**
 * Constructs from other regex dialects — 04_PARSER_ARCHITECTURE.md §2.0.
 *
 * A recognition table, not a second parser. It converts "invalid" into the
 * most useful error in the product: what the user wrote, which engine it comes
 * from, and the JavaScript equivalent. Only high-confidence constructs appear;
 * we do not guess.
 */
const FOREIGN_PREFIXES: readonly {
  readonly probe: RegExp;
  readonly build: (matched: string) => ForeignDialect;
}[] = [
  {
    probe: /^\(\?P<([^>]*)>/,
    build: (matched) => ({
      construct: matched,
      origin: 'Python',
      message: '`(?P<name>…)` is Python syntax and is not valid in JavaScript.',
      hint: 'JavaScript writes named groups as `(?<name>…)`.',
    }),
  },
  {
    probe: /^\(\?P=([^)]*)\)/,
    build: (matched) => ({
      construct: matched,
      origin: 'Python',
      message: '`(?P=name)` is a Python named backreference and is not valid in JavaScript.',
      hint: 'JavaScript writes named backreferences as `\\k<name>`.',
    }),
  },
  {
    probe: /^\(\?>/,
    build: (matched) => ({
      construct: matched,
      origin: 'PCRE and Java',
      message: 'Atomic groups `(?>…)` are not supported in JavaScript.',
      hint: 'There is no direct equivalent. A lookahead with a capture can sometimes emulate it.',
    }),
  },
  {
    probe: /^\(\?#[^)]*\)/,
    build: (matched) => ({
      construct: matched,
      origin: 'PCRE',
      message: 'Inline comments `(?#…)` are not supported in JavaScript.',
      hint: 'Remove the comment, or keep the explanation outside the pattern.',
    }),
  },
  {
    probe: /^\(\?R\)/,
    build: (matched) => ({
      construct: matched,
      origin: 'PCRE',
      message: 'Recursion `(?R)` is not supported in JavaScript.',
      hint: 'JavaScript regular expressions cannot match recursive structures.',
    }),
  },
  {
    probe: /^\(\?(\d+)\)/,
    build: (matched) => ({
      construct: matched,
      origin: 'PCRE',
      message: 'Subroutine calls such as `(?1)` are not supported in JavaScript.',
      hint: 'Repeat the group, or match the structure in code instead.',
    }),
  },
];

/** Escapes that belong to other dialects. Keyed by the letter after the backslash. */
const FOREIGN_ESCAPES: Readonly<Record<string, ForeignDialect>> = {
  A: {
    construct: '\\A',
    origin: 'PCRE and Python',
    message: '`\\A` (start of subject) is not supported in JavaScript.',
    hint: 'Use `^`. With the `m` flag `^` also matches at line starts, so omit `m` if you mean the very start.',
  },
  Z: {
    construct: '\\Z',
    origin: 'PCRE and Python',
    message: '`\\Z` (end of subject) is not supported in JavaScript.',
    hint: 'Use `$`. With the `m` flag `$` also matches at line ends, so omit `m` if you mean the very end.',
  },
  z: {
    construct: '\\z',
    origin: 'PCRE and Python',
    message: '`\\z` (absolute end of subject) is not supported in JavaScript.',
    hint: 'Use `$` without the `m` flag.',
  },
  h: {
    construct: '\\h',
    origin: 'PCRE',
    message: '`\\h` (horizontal whitespace) is not supported in JavaScript.',
    hint: 'Use an explicit class such as `[ \\t]`.',
  },
  R: {
    construct: '\\R',
    origin: 'PCRE',
    message: '`\\R` (any line break) is not supported in JavaScript.',
    hint: 'Use `(?:\\r\\n|\\n|\\r)`.',
  },
  K: {
    construct: '\\K',
    origin: 'PCRE',
    message: '`\\K` (reset match start) is not supported in JavaScript.',
    hint: 'Use a lookbehind `(?<=…)` instead.',
  },
};

const SHORTHAND_CLASSES = new Set(['d', 'D', 'w', 'W', 's', 'S']);
const CONTROL_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  f: '\f',
  v: '\v',
  0: '\0',
};

class Cursor {
  position = 0;
  private line = 1;
  private lineStart = 0;

  constructor(readonly source: string) {}

  get atEnd(): boolean {
    return this.position >= this.source.length;
  }

  peek(offset = 0): string {
    return this.source[this.position + offset] ?? '';
  }

  /** Advances by code units. Astral characters advance by two. */
  advance(count = 1): void {
    for (let index = 0; index < count && this.position < this.source.length; index++) {
      if (this.source[this.position] === '\n') {
        this.line++;
        this.lineStart = this.position + 1;
      }
      this.position++;
    }
  }

  spanFrom(start: number): SourceSpan {
    return {
      start,
      end: this.position,
      line: this.line,
      column: start - this.lineStart + 1,
    };
  }

  startsWith(pattern: RegExp): RegExpMatchArray | null {
    return pattern.exec(this.source.slice(this.position));
  }
}

export function tokenize(source: string, options: TokenizeOptions): TokenizeResult {
  const tokens: LexToken[] = [];
  const errors: DomainError[] = [];
  const cursor = new Cursor(source);
  /**
   * Character-class context — the tokenizer's only mode.
   *
   * Held in an object rather than as loose `let`s because the nested readers
   * mutate it: TypeScript's control-flow analysis cannot see those writes from
   * the main loop and would narrow a plain boolean to the literal `false`.
   */
  const cls = {
    inside: false,
    startedAt: -1,
    /** Atoms seen so far, which decides whether `-` is a range or a literal. */
    atomCount: 0,
  };

  const push = (token: LexToken): void => {
    tokens.push(token);
  };

  const fail = (message: string, span: SourceSpan, hint?: string): void => {
    errors.push(domainError('SYNTAX', message, hint === undefined ? { span } : { span, hint }));
  };

  const failUnsupported = (dialect: ForeignDialect, span: SourceSpan): void => {
    errors.push(
      domainError(
        'UNSUPPORTED',
        dialect.message,
        dialect.hint === undefined ? { span } : { span, hint: dialect.hint },
      ),
    );
  };

  let guard = 0;
  const guardLimit = source.length * 4 + 16;

  while (!cursor.atEnd) {
    // Termination guard (R-I8). Each iteration must consume input; if one ever
    // does not, this fails loudly instead of hanging the worker.
    if (++guard > guardLimit) {
      errors.push(
        domainError('INTERNAL', 'The pattern could not be read.', {
          detail: `tokenizer stalled at offset ${cursor.position}`,
        }),
      );
      break;
    }

    const start = cursor.position;
    const char = cursor.peek();

    if (cls.inside) {
      readClassToken(char, start);
      continue;
    }

    readPatternToken(char, start);
  }

  if (cls.inside) {
    fail('Unterminated character class.', cursor.spanFrom(cls.startedAt), 'Add a closing `]`.');
  }

  return { tokens, errors };

  /* ---------------------------------------------------------------- *
   * Pattern context
   * ---------------------------------------------------------------- */

  function readPatternToken(char: string, start: number): void {
    switch (char) {
      case '[':
        cursor.advance();
        cls.inside = true;
        cls.startedAt = start;
        cls.atomCount = 0;
        push({ kind: 'classOpen', raw: '[', span: cursor.spanFrom(start) });
        if (cursor.peek() === '^') {
          const negateStart = cursor.position;
          cursor.advance();
          push({ kind: 'classNegate', raw: '^', span: cursor.spanFrom(negateStart) });
        }
        return;

      case '(':
        readGroupOpen(start);
        return;

      case ')':
        cursor.advance();
        push({ kind: 'groupClose', raw: ')', span: cursor.spanFrom(start) });
        return;

      case '|':
        cursor.advance();
        push({ kind: 'alternate', raw: '|', span: cursor.spanFrom(start) });
        return;

      case '.':
        cursor.advance();
        push({ kind: 'dot', raw: '.', span: cursor.spanFrom(start) });
        return;

      case '^':
      case '$':
        cursor.advance();
        push({ kind: 'anchor', raw: char, span: cursor.spanFrom(start), value: char });
        return;

      case '*':
      case '+':
      case '?':
        readSimpleQuantifier(char, start);
        return;

      case '{':
        readBraceQuantifier(start);
        return;

      case '\\':
        readEscape(start, false);
        return;

      case ']':
      case '}':
        // Annex B web-compatibility: a stray `]` or `}` is a literal outside a
        // class, but a syntax error under /u. We implement both and report
        // which applies, because explaining the pattern the user's engine will
        // actually run is the point.
        cursor.advance();
        if (options.unicode) {
          fail(
            `A lone \`${char}\` is not allowed with the \`u\` flag.`,
            cursor.spanFrom(start),
            `Escape it as \`\\${char}\`.`,
          );
          push({ kind: 'invalid', raw: char, span: cursor.spanFrom(start) });
        } else {
          push({ kind: 'char', raw: char, value: char, span: cursor.spanFrom(start) });
        }
        return;

      default:
        readLiteralChar(start);
    }
  }

  function readLiteralChar(start: number): void {
    const codePoint = cursor.source.codePointAt(cursor.position);
    // Astral characters are one code point but two code units. Advancing by
    // the right amount here is what keeps every downstream span correct.
    const width = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    const raw = cursor.source.slice(cursor.position, cursor.position + width);
    cursor.advance(width);
    push({ kind: 'char', raw, value: raw, span: cursor.spanFrom(start) });
  }

  function readGroupOpen(start: number): void {
    for (const entry of FOREIGN_PREFIXES) {
      const match = cursor.startsWith(entry.probe);
      if (match) {
        cursor.advance(match[0].length);
        const span = cursor.spanFrom(start);
        const dialect = entry.build(match[0]);
        failUnsupported(dialect, span);
        push({ kind: 'invalid', raw: match[0], span, foreignDialect: dialect });
        return;
      }
    }

    const named = cursor.startsWith(/^\(\?<([A-Za-z_$][\w$]*)>/);
    if (named?.[1] !== undefined) {
      cursor.advance(named[0].length);
      push({
        kind: 'groupOpen',
        raw: named[0],
        span: cursor.spanFrom(start),
        groupKind: 'named',
        groupName: named[1],
      });
      return;
    }

    const simple: readonly [RegExp, GroupOpenKind][] = [
      [/^\(\?<=/, 'lookbehind'],
      [/^\(\?<!/, 'negativeLookbehind'],
      [/^\(\?=/, 'lookahead'],
      [/^\(\?!/, 'negativeLookahead'],
      [/^\(\?:/, 'nonCapturing'],
    ];
    for (const [probe, groupKind] of simple) {
      const match = cursor.startsWith(probe);
      if (match) {
        cursor.advance(match[0].length);
        push({ kind: 'groupOpen', raw: match[0], span: cursor.spanFrom(start), groupKind });
        return;
      }
    }

    if (cursor.peek(1) === '?') {
      // `(?` followed by something we do not recognise. Consuming both units
      // keeps the cursor advancing so the loop cannot stall.
      cursor.advance(2);
      const span = cursor.spanFrom(start);
      fail(
        'Unrecognised group syntax.',
        span,
        'JavaScript supports `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, and `(?<name>`.',
      );
      push({ kind: 'invalid', raw: cursor.source.slice(start, cursor.position), span });
      return;
    }

    cursor.advance();
    push({ kind: 'groupOpen', raw: '(', span: cursor.spanFrom(start), groupKind: 'capturing' });
  }

  function readSimpleQuantifier(char: string, start: number): void {
    cursor.advance();
    // Possessive quantifiers (`a*+`) belong to PCRE and Java. Recognised so
    // the error can name the dialect rather than saying "unexpected +".
    if (cursor.peek() === '+') {
      cursor.advance();
      const span = cursor.spanFrom(start);
      const dialect: ForeignDialect = {
        construct: `${char}+`,
        origin: 'PCRE and Java',
        message: `Possessive quantifiers such as \`${char}+\` are not supported in JavaScript.`,
        hint: 'Remove the `+`, or use a lookahead with a capture to prevent backtracking.',
      };
      failUnsupported(dialect, span);
      push({ kind: 'invalid', raw: `${char}+`, span, foreignDialect: dialect });
      return;
    }

    const lazy = cursor.peek() === '?';
    if (lazy) cursor.advance();
    const bounds: readonly [number, number | null] =
      char === '*' ? [0, null] : char === '+' ? [1, null] : [0, 1];
    push({
      kind: 'quantifier',
      raw: cursor.source.slice(start, cursor.position),
      span: cursor.spanFrom(start),
      min: bounds[0],
      max: bounds[1],
      lazy,
    });
  }

  function readBraceQuantifier(start: number): void {
    const match = cursor.startsWith(/^\{(\d+)(,(\d*)?)?\}/);
    if (!match) {
      // Annex B: `{` that does not begin a valid quantifier is a literal,
      // but an error under /u.
      cursor.advance();
      const span = cursor.spanFrom(start);
      if (options.unicode) {
        fail(
          'A lone `{` is not allowed with the `u` flag.',
          span,
          'Escape it as `\\{`, or complete the quantifier.',
        );
        push({ kind: 'invalid', raw: '{', span });
      } else {
        push({ kind: 'char', raw: '{', value: '{', span });
      }
      return;
    }

    cursor.advance(match[0].length);
    const min = Number.parseInt(match[1] ?? '0', 10);
    const hasComma = match[2] !== undefined;
    const maxText = match[3];
    const max = hasComma
      ? maxText === undefined || maxText === ''
        ? null
        : Number.parseInt(maxText, 10)
      : min;

    const lazy = cursor.peek() === '?';
    if (lazy) cursor.advance();

    const span = cursor.spanFrom(start);
    if (max !== null && min > max) {
      // Matches the JS engine, which rejects {3,1} outright.
      fail(
        `Quantifier range \`{${min},${max}}\` is backwards.`,
        span,
        'The first number must not be larger than the second.',
      );
      push({ kind: 'invalid', raw: cursor.source.slice(start, cursor.position), span });
      return;
    }

    push({
      kind: 'quantifier',
      raw: cursor.source.slice(start, cursor.position),
      span,
      min,
      max,
      lazy,
    });
  }

  /* ---------------------------------------------------------------- *
   * Escapes — shared by both contexts
   * ---------------------------------------------------------------- */

  function readEscape(start: number, insideClass: boolean): void {
    cursor.advance(); // consume the backslash

    if (cursor.atEnd) {
      const span = cursor.spanFrom(start);
      fail('The pattern ends with a lone backslash.', span, 'Escape it as `\\\\`, or remove it.');
      push({ kind: 'invalid', raw: '\\', span });
      return;
    }

    const char = cursor.peek();

    const foreign = FOREIGN_ESCAPES[char];
    if (foreign) {
      cursor.advance();
      const span = cursor.spanFrom(start);
      failUnsupported(foreign, span);
      push({ kind: 'invalid', raw: `\\${char}`, span, foreignDialect: foreign });
      return;
    }

    if (SHORTHAND_CLASSES.has(char)) {
      cursor.advance();
      push({
        kind: 'escape',
        raw: `\\${char}`,
        span: cursor.spanFrom(start),
        escape: 'shorthand',
        value: char,
      });
      return;
    }

    if (char === 'p' || char === 'P') {
      readUnicodeProperty(start, char === 'P');
      return;
    }

    if ((char === 'b' || char === 'B') && !insideClass) {
      cursor.advance();
      push({ kind: 'anchor', raw: `\\${char}`, span: cursor.spanFrom(start), value: `\\${char}` });
      return;
    }

    if (char === 'b' && insideClass) {
      // Inside a class, \b is a backspace rather than a word boundary.
      cursor.advance();
      push({
        kind: 'escape',
        raw: '\\b',
        span: cursor.spanFrom(start),
        escape: 'control',
        value: '\b',
      });
      return;
    }

    if (char === 'k' && !insideClass) {
      readNamedBackreference(start);
      return;
    }

    if (char >= '1' && char <= '9' && !insideClass) {
      const digits = cursor.startsWith(/^\d+/)?.[0] ?? char;
      cursor.advance(digits.length);
      push({
        kind: 'backreference',
        raw: `\\${digits}`,
        span: cursor.spanFrom(start),
        ref: Number.parseInt(digits, 10),
      });
      return;
    }

    if (Object.hasOwn(CONTROL_ESCAPES, char)) {
      // `\\0` is NUL, but `\\0` followed by a digit is a legacy octal escape,
      // which /u rejects. The engine draws that line and so must we.
      if (char === '0' && options.unicode && /[0-9]/.test(cursor.peek(1))) {
        cursor.advance();
        const span = cursor.spanFrom(start);
        fail(
          'Legacy octal escapes are not allowed with the `u` flag.',
          span,
          'Write `\\\\u0000` for a null character, or escape the digits separately.',
        );
        push({ kind: 'invalid', raw: `\\${char}`, span });
        return;
      }
      cursor.advance();
      push({
        kind: 'escape',
        raw: `\\${char}`,
        span: cursor.spanFrom(start),
        escape: 'control',
        value: CONTROL_ESCAPES[char] ?? '',
      });
      return;
    }

    if (char === 'x') {
      const match = cursor.startsWith(/^x([0-9a-fA-F]{2})/);
      if (match?.[1] !== undefined) {
        cursor.advance(match[0].length);
        push({
          kind: 'escape',
          raw: `\\${match[0]}`,
          span: cursor.spanFrom(start),
          escape: 'hex',
          value: String.fromCharCode(Number.parseInt(match[1], 16)),
        });
        return;
      }
    }

    if (char === 'u') {
      readUnicodeEscape(start);
      return;
    }

    if (char === 'c') {
      const match = cursor.startsWith(/^c([A-Za-z])/);
      if (match?.[1] !== undefined) {
        cursor.advance(match[0].length);
        push({
          kind: 'escape',
          raw: `\\${match[0]}`,
          span: cursor.spanFrom(start),
          escape: 'controlLetter',
          // Control letters map to code points 1..26.
          value: String.fromCharCode(match[1].toUpperCase().charCodeAt(0) - 64),
        });
        return;
      }
    }

    if (char === '8' || char === '9') {
      cursor.advance();
      const span = cursor.spanFrom(start);
      if (options.unicode) {
        fail(
          `\`\\${char}\` is not a valid escape with the \`u\` flag.`,
          span,
          `Write a literal \`${char}\`, or escape it differently.`,
        );
        push({ kind: 'invalid', raw: `\\${char}`, span });
      } else {
        push({ kind: 'escape', raw: `\\${char}`, span, escape: 'legacyOctal', value: char });
      }
      return;
    }

    // Identity escape. Under /u only syntax characters may be escaped;
    // without it, Annex B allows escaping almost anything.
    cursor.advance();
    const span = cursor.spanFrom(start);
    // Under /u only syntax characters may be escaped. Inside a character
    // class `-` joins that set, because ClassEscape permits `\\-`.
    const isSyntaxChar = '^$\\.*+?()[]{}|/'.includes(char) || (insideClass && char === '-');
    if (options.unicode && !isSyntaxChar) {
      fail(
        `\`\\${char}\` is not a valid escape with the \`u\` flag.`,
        span,
        'Only syntax characters may be escaped when the `u` flag is set.',
      );
      push({ kind: 'invalid', raw: `\\${char}`, span });
      return;
    }
    push({ kind: 'escape', raw: `\\${char}`, span, escape: 'identity', value: char });
  }

  function readUnicodeEscape(start: number): void {
    const braced = cursor.startsWith(/^u\{([0-9a-fA-F]{1,6})\}/);
    if (braced?.[1] !== undefined) {
      const codePoint = Number.parseInt(braced[1], 16);
      cursor.advance(braced[0].length);
      const span = cursor.spanFrom(start);
      if (!options.unicode) {
        fail(
          '`\\u{…}` requires the `u` flag.',
          span,
          'Add the `u` flag, or use a four-digit `\\uXXXX` escape.',
        );
        push({ kind: 'invalid', raw: `\\${braced[0]}`, span });
        return;
      }
      if (codePoint > 0x10ffff) {
        fail('Code point is above the Unicode maximum of U+10FFFF.', span);
        push({ kind: 'invalid', raw: `\\${braced[0]}`, span });
        return;
      }
      push({
        kind: 'escape',
        raw: `\\${braced[0]}`,
        span,
        escape: 'unicode',
        value: String.fromCodePoint(codePoint),
      });
      return;
    }

    const fixed = cursor.startsWith(/^u([0-9a-fA-F]{4})/);
    if (fixed?.[1] !== undefined) {
      cursor.advance(fixed[0].length);
      push({
        kind: 'escape',
        raw: `\\${fixed[0]}`,
        span: cursor.spanFrom(start),
        escape: 'unicode',
        value: String.fromCharCode(Number.parseInt(fixed[1], 16)),
      });
      return;
    }

    cursor.advance();
    const span = cursor.spanFrom(start);
    if (options.unicode) {
      fail('Incomplete `\\u` escape.', span, 'Write `\\uXXXX` or `\\u{XXXX}`.');
      push({ kind: 'invalid', raw: '\\u', span });
      return;
    }
    push({ kind: 'escape', raw: '\\u', span, escape: 'identity', value: 'u' });
  }

  function readUnicodeProperty(start: number, negated: boolean): void {
    const match = cursor.startsWith(/^[pP]\{([A-Za-z_]+)(?:=([A-Za-z_0-9]+))?\}/);
    if (!match?.[1]) {
      // Without /u, `\p` is a plain identity escape — and that is a very
      // common real bug, so the warning layer flags it separately.
      cursor.advance();
      push({
        kind: 'escape',
        raw: negated ? '\\P' : '\\p',
        span: cursor.spanFrom(start),
        escape: 'identity',
        value: negated ? 'P' : 'p',
      });
      return;
    }

    cursor.advance(match[0].length);
    const span = cursor.spanFrom(start);
    if (!options.unicode) {
      push({
        kind: 'escape',
        raw: `\\${match[0]}`,
        span,
        escape: 'identity',
        value: negated ? 'P' : 'p',
      });
      return;
    }

    const token: LexToken = {
      kind: 'unicodeProperty',
      raw: `\\${match[0]}`,
      span,
      property: match[1],
      negated,
      ...(match[2] === undefined ? {} : { propertyValue: match[2] }),
    };
    push(token);
  }

  function readNamedBackreference(start: number): void {
    const match = cursor.startsWith(/^k<([A-Za-z_$][\w$]*)>/);
    if (match?.[1] !== undefined) {
      cursor.advance(match[0].length);
      push({
        kind: 'backreference',
        raw: `\\${match[0]}`,
        span: cursor.spanFrom(start),
        ref: match[1],
      });
      return;
    }
    cursor.advance();
    const span = cursor.spanFrom(start);
    fail('Incomplete named backreference.', span, 'Write `\\k<name>`.');
    push({ kind: 'invalid', raw: '\\k', span });
  }

  /* ---------------------------------------------------------------- *
   * Character-class context
   * ---------------------------------------------------------------- */

  function readClassToken(char: string, start: number): void {
    if (char === ']') {
      cursor.advance();
      cls.inside = false;
      push({ kind: 'classClose', raw: ']', span: cursor.spanFrom(start) });
      return;
    }

    if (char === '\\') {
      readEscape(start, true);
      cls.atomCount++;
      return;
    }

    if (char === '-') {
      cursor.advance();
      const span = cursor.spanFrom(start);
      // A hyphen is a range operator only between two atoms. First or last in
      // the class it is a literal — a distinction the explanation depends on.
      const isRange = cls.atomCount > 0 && cursor.peek() !== ']' && !cursor.atEnd;
      if (isRange) {
        push({ kind: 'classRange', raw: '-', span });
      } else {
        push({ kind: 'char', raw: '-', value: '-', span });
        cls.atomCount++;
      }
      return;
    }

    readLiteralChar(start);
    cls.atomCount++;
  }
}

/** Enforces the documented pattern-length limit before any work is done. */
export function checkPatternLength(source: string): DomainError | null {
  if (source.length <= LIMITS.regex.pattern) return null;
  return domainError(
    'LIMIT_EXCEEDED',
    `This pattern is ${source.length.toLocaleString()} characters. The limit is ${LIMITS.regex.pattern.toLocaleString()}.`,
    { hint: 'Patterns this long are almost always generated. Try analysing a smaller part.' },
  );
}
