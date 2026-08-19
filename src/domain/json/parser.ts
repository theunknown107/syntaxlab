import { LIMITS } from '../shared/limits';
import { domainError, type DomainError, type SourceSpan } from '../shared/result';
import type { JsonMember, JsonNode, JsonPath } from './ast';
import { tokenize, type JsonToken } from './tokenizer';

/**
 * JSON parser — 04_PARSER_ARCHITECTURE.md §3.4
 *
 * **Iterative, with an explicit stack.** This is the one place the project
 * deviates from recursive descent, and it is deliberate: `[[[[…]]]]` costs one
 * byte of input per level, so a recursive parser exhausts the JavaScript stack
 * at a few thousand levels. A `RangeError` from stack exhaustion inside a
 * worker is unattributable and looks like a crash. An explicit stack makes
 * depth a number we control and turns the failure into a clean
 * `LIMIT_EXCEEDED` at exactly the documented limit (J-I3).
 *
 * Error recovery is panic-mode: record the error, emit an `error` node, skip
 * forward to the next structurally meaningful token, and carry on. One missing
 * comma leaves the rest of the document explained rather than blanking the
 * screen (J-I6).
 */

export interface ParseResult {
  readonly root: JsonNode | null;
  readonly errors: readonly DomainError[];
  readonly maxDepth: number;
  readonly nodeCount: number;
}

interface ObjectFrame {
  readonly kind: 'object';
  readonly members: JsonMember[];
  readonly start: number;
  readonly line: number;
  readonly column: number;
  readonly path: JsonPath;
  expecting: 'keyOrEnd' | 'colon' | 'value' | 'commaOrEnd';
  pendingKey: { key: string; keyRaw: string; keySpan: SourceSpan } | null;
}

interface ArrayFrame {
  readonly kind: 'array';
  readonly elements: JsonNode[];
  readonly start: number;
  readonly line: number;
  readonly column: number;
  readonly path: JsonPath;
  expecting: 'valueOrEnd' | 'value' | 'commaOrEnd';
}

type Frame = ObjectFrame | ArrayFrame;

/**
 * How many errors are collected before parsing stops reporting.
 *
 * A single missing brace can cascade into dozens of complaints about the rest
 * of the document, which is noise rather than information. The parser keeps
 * building the tree; it just stops adding to the list (§3.5).
 */
const MAX_ERRORS = 24;

/** Stand-in for an impossible out-of-range read; see `peek`. */
const END_OF_INPUT: JsonToken = {
  kind: 'eof',
  raw: '',
  span: { start: 0, end: 0, line: 1, column: 1 },
};

export function parseJson(source: string): ParseResult {
  return new JsonParser(source).run();
}

class JsonParser {
  private readonly tokens: readonly JsonToken[];
  private index = 0;
  private readonly stack: Frame[] = [];
  private readonly errors: DomainError[] = [];
  private root: JsonNode | null = null;
  private rootDone = false;
  private nodeCount = 0;
  private maxDepth = 0;
  private limitHit = false;

  constructor(private readonly source: string) {
    const scanned = tokenize(source);
    this.tokens = scanned.tokens;
    for (const error of scanned.errors) this.report(error);
  }

  run(): ParseResult {
    // The token list is finite and every branch consumes at least one token
    // or pops a frame, so this terminates. The guard exists so a bug becomes
    // a reported INTERNAL error rather than a frozen worker.
    let guard = 0;
    const guardLimit = this.tokens.length * 8 + 64;

    while (!this.limitHit) {
      if (++guard > guardLimit) {
        this.report(
          domainError('INTERNAL', 'The document could not be read.', {
            detail: `parser stalled at token ${this.index}`,
          }),
        );
        break;
      }

      if (this.stack.length === 0) {
        if (!this.rootDone) {
          this.readRoot();
          continue;
        }
        this.checkTrailingContent();
        break;
      }

      this.step();
    }

    return {
      root: this.root,
      errors: this.errors,
      maxDepth: this.maxDepth,
      nodeCount: this.nodeCount,
    };
  }

  /* ---------------------------------------------------------------- *
   * Token access
   * ---------------------------------------------------------------- */

  private peek(): JsonToken {
    // The scanner always appends an `eof` token, so the index is always in
    // range. The fallback exists so the invariant is expressed as a value
    // rather than as a non-null assertion.
    return this.tokens[Math.min(this.index, this.tokens.length - 1)] ?? END_OF_INPUT;
  }

  private next(): JsonToken {
    const token = this.peek();
    if (this.index < this.tokens.length - 1) this.index += 1;
    return token;
  }

  private report(error: DomainError): void {
    if (this.errors.length >= MAX_ERRORS) return;
    this.errors.push(error);
  }

  /* ---------------------------------------------------------------- *
   * Root
   * ---------------------------------------------------------------- */

  private readRoot(): void {
    const token = this.peek();

    if (token.kind === 'eof') {
      this.report(
        domainError('SYNTAX', 'The document is empty.', {
          span: token.span,
          hint: 'JSON needs a value — an object, an array, a string, a number, `true`, `false` or `null`.',
        }),
      );
      this.rootDone = true;
      return;
    }

    this.readValue([]);
    // A container pushed a frame; a scalar completed and set the root.
    if (this.stack.length === 0) this.rootDone = true;
  }

  private checkTrailingContent(): void {
    const token = this.peek();
    if (token.kind === 'eof') return;
    this.report(
      domainError('SYNTAX', 'There is more content after the end of the JSON value.', {
        span: token.span,
        hint: 'A JSON document holds exactly one value. Wrap several values in an array.',
      }),
    );
  }

  /* ---------------------------------------------------------------- *
   * The step machine
   * ---------------------------------------------------------------- */

  private step(): void {
    const frame = this.stack[this.stack.length - 1];
    if (!frame) return;
    if (frame.kind === 'array') this.stepArray(frame);
    else this.stepObject(frame);
  }

  private stepArray(frame: ArrayFrame): void {
    const token = this.peek();

    if (token.kind === 'eof') {
      this.reportUnterminated(frame, ']');
      this.finishArray(frame);
      return;
    }

    if (frame.expecting === 'commaOrEnd') {
      if (token.kind === 'bracketClose') {
        this.next();
        this.finishArray(frame);
        return;
      }
      if (token.kind === 'comma') {
        this.next();
        frame.expecting = 'value';
        return;
      }
      this.report(
        domainError('SYNTAX', 'Expected a comma or `]` between array items.', {
          span: token.span,
          hint: 'Array items are separated by commas.',
        }),
      );
      this.recover(frame);
      return;
    }

    if (token.kind === 'bracketClose') {
      this.next();
      if (frame.expecting === 'value') {
        // We reached `]` right after a comma, so the comma was trailing.
        this.report(
          domainError('SYNTAX', 'Trailing comma before `]`.', {
            span: token.span,
            hint: 'JSON forbids trailing commas. JavaScript and JSON5 allow them.',
          }),
        );
      }
      this.finishArray(frame);
      return;
    }

    this.readValue(this.childPath(frame));
  }

  private stepObject(frame: ObjectFrame): void {
    const token = this.peek();

    if (token.kind === 'eof') {
      this.reportUnterminated(frame, '}');
      this.finishObject(frame);
      return;
    }

    switch (frame.expecting) {
      case 'keyOrEnd':
      case 'value':
        this.stepObjectKeyOrValue(frame, token);
        return;
      case 'colon':
        this.stepObjectColon(frame, token);
        return;
      case 'commaOrEnd':
        this.stepObjectCommaOrEnd(frame, token);
        return;
    }
  }

  private stepObjectKeyOrValue(frame: ObjectFrame, token: JsonToken): void {
    // `value` here means "a key is expected because a comma was just read".
    if (frame.pendingKey !== null) {
      this.readValue(this.childPath(frame));
      return;
    }

    if (token.kind === 'braceClose') {
      this.next();
      if (frame.expecting === 'value') {
        this.report(
          domainError('SYNTAX', 'Trailing comma before `}`.', {
            span: token.span,
            hint: 'JSON forbids trailing commas. JavaScript and JSON5 allow them.',
          }),
        );
      }
      this.finishObject(frame);
      return;
    }

    if (token.kind === 'string') {
      this.next();
      frame.pendingKey = {
        key: token.stringValue ?? '',
        keyRaw: token.raw,
        keySpan: token.span,
      };
      frame.expecting = 'colon';
      return;
    }

    this.report(
      domainError('SYNTAX', 'Object keys must be quoted strings.', {
        span: token.span,
        hint: `Write \`"${previewKey(token.raw)}"\` rather than \`${previewKey(token.raw)}\`.`,
      }),
    );
    this.recover(frame);
  }

  private stepObjectColon(frame: ObjectFrame, token: JsonToken): void {
    if (token.kind === 'colon') {
      this.next();
      frame.expecting = 'value';
      return;
    }
    this.report(
      domainError('SYNTAX', 'Expected `:` after an object key.', {
        span: token.span,
        hint: 'Each key is followed by a colon and then its value.',
      }),
    );
    // Assume the colon was simply missing and try to read the value anyway,
    // which keeps the rest of the object usable.
    frame.expecting = 'value';
  }

  private stepObjectCommaOrEnd(frame: ObjectFrame, token: JsonToken): void {
    if (token.kind === 'braceClose') {
      this.next();
      this.finishObject(frame);
      return;
    }
    if (token.kind === 'comma') {
      this.next();
      frame.expecting = 'value';
      return;
    }
    this.report(
      domainError('SYNTAX', 'Expected a comma or `}` between object properties.', {
        span: token.span,
        hint: 'Properties are separated by commas.',
      }),
    );
    this.recover(frame);
  }

  /* ---------------------------------------------------------------- *
   * Values
   * ---------------------------------------------------------------- */

  private readValue(path: JsonPath): void {
    const token = this.peek();

    switch (token.kind) {
      case 'braceOpen':
        this.next();
        this.pushObject(token, path);
        return;
      case 'bracketOpen':
        this.next();
        this.pushArray(token, path);
        return;
      case 'string':
        this.next();
        this.attach({
          type: 'string',
          value: token.stringValue ?? '',
          raw: token.raw,
          span: token.span,
          path,
        });
        return;
      case 'number':
        this.next();
        this.attach({
          type: 'number',
          value: token.numberValue ?? 0,
          raw: token.raw,
          span: token.span,
          path,
        });
        return;
      case 'true':
      case 'false':
        this.next();
        this.attach({ type: 'boolean', value: token.kind === 'true', span: token.span, path });
        return;
      case 'null':
        this.next();
        this.attach({ type: 'null', span: token.span, path });
        return;
      case 'invalid':
        // The scanner already reported why. Emit a placeholder so the shape of
        // the surrounding document survives.
        this.next();
        this.attach({ type: 'error', raw: token.raw, span: token.span, path });
        return;
      default:
        this.reportUnexpectedValue(token);
        this.attach({ type: 'error', raw: token.raw, span: token.span, path });
        return;
    }
  }

  private reportUnexpectedValue(token: JsonToken): void {
    const what =
      token.kind === 'eof'
        ? 'The document ends where a value was expected.'
        : `Expected a value but found \`${previewKey(token.raw)}\`.`;
    this.report(
      domainError('SYNTAX', what, {
        span: token.span,
        hint: 'A value is an object, an array, a string, a number, `true`, `false` or `null`.',
      }),
    );
  }

  /* ---------------------------------------------------------------- *
   * Frames
   * ---------------------------------------------------------------- */

  private childPath(frame: Frame): JsonPath {
    if (frame.kind === 'array') {
      return [...frame.path, { kind: 'index', index: frame.elements.length }];
    }
    return [...frame.path, { kind: 'key', key: frame.pendingKey?.key ?? '' }];
  }

  private pushObject(token: JsonToken, path: JsonPath): void {
    if (!this.checkDepth(token)) return;
    this.stack.push({
      kind: 'object',
      members: [],
      start: token.span.start,
      line: token.span.line,
      column: token.span.column,
      path,
      expecting: 'keyOrEnd',
      pendingKey: null,
    });
    this.maxDepth = Math.max(this.maxDepth, this.stack.length);
  }

  private pushArray(token: JsonToken, path: JsonPath): void {
    if (!this.checkDepth(token)) return;
    this.stack.push({
      kind: 'array',
      elements: [],
      start: token.span.start,
      line: token.span.line,
      column: token.span.column,
      path,
      expecting: 'valueOrEnd',
    });
    this.maxDepth = Math.max(this.maxDepth, this.stack.length);
  }

  /**
   * The reason the stack is explicit. Exceeding the limit stops the parse with
   * a message naming the limit, rather than a `RangeError` from the engine.
   */
  private checkDepth(token: JsonToken): boolean {
    if (this.stack.length < LIMITS.json.maxDepth) return true;
    this.report(
      domainError('LIMIT_EXCEEDED', `Nesting is deeper than ${LIMITS.json.maxDepth} levels.`, {
        span: token.span,
        hint: 'Real documents are rarely more than about twenty deep. This is usually generated or malformed data.',
      }),
    );
    this.limitHit = true;
    return false;
  }

  private countNode(): boolean {
    this.nodeCount += 1;
    if (this.nodeCount <= LIMITS.json.maxNodes) return true;
    this.report(
      domainError(
        'LIMIT_EXCEEDED',
        `The document has more than ${LIMITS.json.maxNodes.toLocaleString('en')} values.`,
        {
          hint: 'Analyse a smaller section of the document.',
        },
      ),
    );
    this.limitHit = true;
    return false;
  }

  private finishArray(frame: ArrayFrame): void {
    this.stack.pop();
    this.attach({
      type: 'array',
      elements: frame.elements,
      span: this.spanTo(frame),
      path: frame.path,
    });
  }

  private finishObject(frame: ObjectFrame): void {
    this.stack.pop();
    this.attach({
      type: 'object',
      members: frame.members,
      span: this.spanTo(frame),
      path: frame.path,
    });
  }

  private spanTo(frame: Frame): SourceSpan {
    const previous = this.tokens[Math.max(0, this.index - 1)];
    const end = previous ? Math.max(previous.span.end, frame.start) : this.source.length;
    return { start: frame.start, end, line: frame.line, column: frame.column };
  }

  private reportUnterminated(frame: Frame, closer: string): void {
    this.report(
      domainError('SYNTAX', `The ${frame.kind} opened on line ${frame.line} is never closed.`, {
        span: { start: frame.start, end: frame.start + 1, line: frame.line, column: frame.column },
        hint: `Add the matching \`${closer}\`.`,
      }),
    );
  }

  /**
   * Attaches a completed node to its parent, or makes it the root.
   *
   * Object members are pushed onto an array of `{key, value}` pairs. They are
   * never assigned onto a JavaScript object, which is what stops a
   * `__proto__` key in the input from becoming a real property anywhere
   * (03_DOMAIN_MODEL.md §4.2).
   */
  private attach(node: JsonNode): void {
    if (!this.countNode()) return;

    const frame = this.stack[this.stack.length - 1];

    if (!frame) {
      this.root = node;
      this.rootDone = true;
      return;
    }

    if (frame.kind === 'array') {
      frame.elements.push(node);
      frame.expecting = 'commaOrEnd';
      return;
    }

    const key = frame.pendingKey;
    if (!key) {
      // A value arrived where a key was expected. The error is already
      // reported by the key branch; drop the stray value rather than
      // inventing a member with no name.
      return;
    }

    frame.members.push({
      key: key.key,
      keyRaw: key.keyRaw,
      keySpan: key.keySpan,
      value: node,
      span: {
        start: key.keySpan.start,
        end: node.span.end,
        line: key.keySpan.line,
        column: key.keySpan.column,
      },
    });
    frame.pendingKey = null;
    frame.expecting = 'commaOrEnd';
  }

  /**
   * Panic-mode recovery: skip forward to the next token that could plausibly
   * continue the current structure, so one bad token costs one error rather
   * than one per remaining token.
   */
  private recover(frame: Frame): void {
    const closer = frame.kind === 'array' ? 'bracketClose' : 'braceClose';

    while (this.peek().kind !== 'eof') {
      const token = this.peek();
      if (token.kind === 'comma') {
        this.next();
        frame.expecting = 'value';
        if (frame.kind === 'object') frame.pendingKey = null;
        return;
      }
      if (token.kind === closer) return; // the frame's own step will close it
      if (token.kind === 'braceClose' || token.kind === 'bracketClose') return;
      this.next();
    }
  }
}

/** Keeps a hostile token out of an error message at full length. */
function previewKey(raw: string): string {
  const trimmed = raw.length <= 16 ? raw : `${raw.slice(0, 16)}…`;
  return trimmed.replace(/[\n\r\t]/g, ' ');
}
