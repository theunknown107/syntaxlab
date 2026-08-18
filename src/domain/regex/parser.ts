import { LIMITS } from '../shared/limits';
import { domainError, type DomainError, type SourceSpan } from '../shared/result';
import type { CaptureGroupInfo, CharClassChar, CharClassItem, RegexFlags, RegexNode } from './ast';
import { tokenize, type LexToken } from './tokenizer';

/**
 * Regex parser — 04_PARSER_ARCHITECTURE.md §2.4
 *
 * Recursive descent with explicit precedence, lowest first:
 *
 *   alternation  →  sequence  →  quantified atom  →  atom
 *
 * Two passes. The first builds the tree; the second assigns capture-group
 * numbers and resolves backreferences, because `\1(a)` is legal and a forward
 * reference cannot be resolved while the tree is still being built.
 *
 * Recursion depth is capped rather than left to the call stack. A `RangeError`
 * from a blown stack inside a worker is unattributable and looks like a crash;
 * a deliberate LIMIT_EXCEEDED is a message the UI can explain.
 */

export interface ParseResult {
  readonly ast: RegexNode;
  readonly tokens: readonly LexToken[];
  readonly groups: readonly CaptureGroupInfo[];
  readonly errors: readonly DomainError[];
}

interface ParserState {
  index: number;
  depth: number;
  groupCount: number;
}

export function parsePattern(source: string, flags: RegexFlags): ParseResult {
  const { tokens, errors: lexErrors } = tokenize(source, {
    unicode: flags.unicode || flags.unicodeSets,
  });
  const errors: DomainError[] = [...lexErrors];
  const groups: CaptureGroupInfo[] = [];
  const namesSeen = new Map<string, SourceSpan>();

  const state: ParserState = { index: 0, depth: 0, groupCount: 0 };

  const fullSpan: SourceSpan = { start: 0, end: source.length, line: 1, column: 1 };

  const ast = parseAlternation(fullSpan);

  // Any trailing tokens mean an unbalanced `)`. Consume them so the loop ends,
  // and record one error rather than one per stray character.
  if (state.index < tokens.length) {
    const stray = tokens[state.index];
    if (stray) {
      errors.push(
        domainError('SYNTAX', 'Unmatched `)`.', {
          span: stray.span,
          hint: 'Remove it, or add a matching `(`.',
        }),
      );
    }
    state.index = tokens.length;
  }

  resolveBackreferences(ast, groups, flags, errors);

  // Groups are appended when their closing parenthesis is reached, which is
  // completion order, not source order: `((a)(b))` would append 2, 3, 1.
  // Numbers are already correct (assigned on the way down), so sorting by
  // number restores the source order the group table and R-I4 both expect.
  const orderedGroups = [...groups].sort((a, b) => a.number - b.number);

  return { ast, tokens, groups: orderedGroups, errors };

  /* ---------------------------------------------------------------- *
   * Grammar
   * ---------------------------------------------------------------- */

  function peek(): LexToken | undefined {
    return tokens[state.index];
  }

  function next(): LexToken | undefined {
    return tokens[state.index++];
  }

  function spanBetween(startToken: LexToken | undefined, fallback: SourceSpan): SourceSpan {
    const endToken = tokens[state.index - 1];
    if (!startToken) return fallback;
    return {
      start: startToken.span.start,
      end: endToken?.span.end ?? startToken.span.end,
      line: startToken.span.line,
      column: startToken.span.column,
    };
  }

  function parseAlternation(fallback: SourceSpan): RegexNode {
    const startToken = peek();
    const alternatives: RegexNode[] = [parseSequence(fallback)];

    while (peek()?.kind === 'alternate') {
      next();
      alternatives.push(parseSequence(fallback));
    }

    // Invariant R-I1: the root is always an Alternation, even with one branch.
    // Uniform tree walking beats special-casing in every consumer.
    return {
      type: 'Alternation',
      alternatives,
      span:
        alternatives.length === 1
          ? (alternatives[0]?.span ?? fallback)
          : spanBetween(startToken, fallback),
    };
  }

  function parseSequence(fallback: SourceSpan): RegexNode {
    const startToken = peek();
    const elements: RegexNode[] = [];

    while (state.index < tokens.length) {
      const token = peek();
      if (!token || token.kind === 'alternate' || token.kind === 'groupClose') break;
      const element = parseQuantified(fallback);
      if (!element) break;
      elements.push(element);
    }

    const span =
      elements.length === 0
        ? emptySpanAt(startToken, fallback)
        : {
            start: elements[0]?.span.start ?? fallback.start,
            end: elements[elements.length - 1]?.span.end ?? fallback.end,
            line: elements[0]?.span.line ?? fallback.line,
            column: elements[0]?.span.column ?? fallback.column,
          };

    return { type: 'Sequence', elements, span };
  }

  /**
   * Zero-width span for an empty sequence — `()`, `a|`, or the body of an
   * unclosed group.
   *
   * It must sit at the current position, not at the start of the pattern:
   * anchoring it to the whole-pattern fallback puts an empty body *before*
   * its own parent and breaks the containment invariant (R-I7) for inputs
   * like `a(`.
   */
  function emptySpanAt(token: LexToken | undefined, fallback: SourceSpan): SourceSpan {
    if (token) {
      return {
        start: token.span.start,
        end: token.span.start,
        line: token.span.line,
        column: token.span.column,
      };
    }
    // No token ahead: collapse onto the end of the last one consumed.
    const previous = tokens[state.index - 1];
    if (previous) {
      return {
        start: previous.span.end,
        end: previous.span.end,
        line: previous.span.line,
        column: previous.span.column,
      };
    }
    return { ...fallback, end: fallback.start };
  }

  function parseQuantified(fallback: SourceSpan): RegexNode | null {
    const atom = parseAtom(fallback);
    if (!atom) return null;

    const token = peek();
    if (token?.kind !== 'quantifier') return atom;

    if (!isQuantifiable(atom)) {
      next();
      errors.push(
        domainError('SYNTAX', 'Nothing to repeat.', {
          span: token.span,
          hint: 'A quantifier must follow a character, group, or class.',
        }),
      );
      return atom;
    }

    next();
    const quantified: RegexNode = {
      type: 'Quantifier',
      min: token.min ?? 0,
      max: token.max === undefined ? null : token.max,
      lazy: token.lazy ?? false,
      body: atom,
      raw: token.raw,
      span: {
        start: atom.span.start,
        end: token.span.end,
        line: atom.span.line,
        column: atom.span.column,
      },
    };

    // Invariant R-I3: a quantifier body is never itself a quantifier. `a**` is
    // a syntax error in JavaScript; `(a*)*` nests legitimately via a group.
    const following = peek();
    if (following?.kind === 'quantifier') {
      next();
      errors.push(
        domainError('SYNTAX', 'Two quantifiers in a row.', {
          span: following.span,
          hint: 'Wrap the first in a group, for example `(a*)*`.',
        }),
      );
    }

    return quantified;
  }

  function isQuantifiable(node: RegexNode): boolean {
    // Anchors and lookarounds cannot be quantified in ECMAScript.
    if (node.type === 'Anchor') return false;
    if (node.type === 'Error') return false;
    if (node.type === 'Group') {
      return (
        node.groupKind !== 'lookahead' &&
        node.groupKind !== 'negativeLookahead' &&
        node.groupKind !== 'lookbehind' &&
        node.groupKind !== 'negativeLookbehind'
      );
    }
    return true;
  }

  function parseAtom(fallback: SourceSpan): RegexNode | null {
    const token = next();
    if (!token) return null;

    switch (token.kind) {
      case 'char':
        return {
          type: 'Literal',
          value: token.value ?? token.raw,
          raw: token.raw,
          span: token.span,
        };

      case 'dot':
        return { type: 'Dot', span: token.span };

      case 'anchor':
        return { type: 'Anchor', anchor: anchorKind(token.raw), span: token.span };

      case 'escape':
        return {
          type: 'CharEscape',
          escape: token.escape ?? 'identity',
          value: token.value ?? '',
          raw: token.raw,
          span: token.span,
        };

      case 'unicodeProperty':
        return {
          type: 'UnicodeProperty',
          property: token.property ?? '',
          ...(token.propertyValue === undefined ? {} : { value: token.propertyValue }),
          negated: token.negated ?? false,
          raw: token.raw,
          span: token.span,
        };

      case 'backreference':
        return {
          type: 'Backreference',
          ref: token.ref ?? 0,
          resolved: false, // decided in pass two
          raw: token.raw,
          span: token.span,
        };

      case 'classOpen':
        return parseCharClass(token);

      case 'groupOpen':
        return parseGroup(token, fallback);

      case 'quantifier':
        errors.push(
          domainError('SYNTAX', 'Nothing to repeat.', {
            span: token.span,
            hint: 'A quantifier must follow a character, group, or class.',
          }),
        );
        return { type: 'Error', raw: token.raw, span: token.span };

      case 'invalid':
        // The tokenizer already reported why. An Error node keeps the tree
        // usable so the rest of the pattern is still explained.
        return { type: 'Error', raw: token.raw, span: token.span };

      default:
        return { type: 'Error', raw: token.raw, span: token.span };
    }
  }

  function anchorKind(raw: string): 'start' | 'end' | 'wordBoundary' | 'nonWordBoundary' {
    if (raw === '^') return 'start';
    if (raw === '$') return 'end';
    return raw === '\\b' ? 'wordBoundary' : 'nonWordBoundary';
  }

  function parseGroup(open: LexToken, fallback: SourceSpan): RegexNode {
    if (state.depth >= LIMITS.regex.maxDepth) {
      errors.push(
        domainError(
          'LIMIT_EXCEEDED',
          `Groups are nested more than ${LIMITS.regex.maxDepth} deep.`,
          {
            span: open.span,
            hint: 'Simplify the pattern, or analyse a smaller part of it.',
          },
        ),
      );
      // Consume to the matching close so the caller still makes progress.
      skipToGroupClose();
      return { type: 'Error', raw: open.raw, span: open.span };
    }

    const groupKind = open.groupKind ?? 'capturing';
    let number: number | undefined;

    if (groupKind === 'capturing' || groupKind === 'named') {
      // Invariant R-I4: numbered by opening-parenthesis order, from 1,
      // contiguous. Assigned here, on the way down, which is what makes the
      // order match the source rather than the tree shape.
      state.groupCount += 1;
      number = state.groupCount;
    }

    if (groupKind === 'named' && open.groupName !== undefined) {
      const previous = namesSeen.get(open.groupName);
      if (previous) {
        errors.push(
          domainError('SYNTAX', `Duplicate group name \`${open.groupName}\`.`, {
            span: open.span,
            hint: 'Group names must be unique within a pattern.',
          }),
        );
      } else {
        namesSeen.set(open.groupName, open.span);
      }
    }

    // Depth of the group itself, captured before descending into its body.
    const groupDepth = state.depth;

    state.depth += 1;
    const body = parseAlternation(fallback);
    state.depth -= 1;

    const close = peek();
    if (close?.kind === 'groupClose') {
      next();
    } else {
      errors.push(
        domainError('SYNTAX', 'Unmatched `(`.', {
          span: open.span,
          hint: 'Add a closing `)`.',
        }),
      );
    }

    const span: SourceSpan = {
      start: open.span.start,
      end: tokens[state.index - 1]?.span.end ?? open.span.end,
      line: open.span.line,
      column: open.span.column,
    };

    if (number !== undefined) {
      groups.push({
        number,
        ...(open.groupName === undefined ? {} : { name: open.groupName }),
        span,
        depth: groupDepth,
      });
    }

    return {
      type: 'Group',
      groupKind,
      ...(number === undefined ? {} : { number }),
      ...(open.groupName === undefined ? {} : { name: open.groupName }),
      body,
      span,
    };
  }

  function skipToGroupClose(): void {
    let nesting = 1;
    while (state.index < tokens.length && nesting > 0) {
      const token = next();
      if (token?.kind === 'groupOpen') nesting += 1;
      if (token?.kind === 'groupClose') nesting -= 1;
    }
  }

  function parseCharClass(open: LexToken): RegexNode {
    const items: CharClassItem[] = [];
    let negated = false;

    if (peek()?.kind === 'classNegate') {
      next();
      negated = true;
    }

    while (state.index < tokens.length) {
      const token = peek();
      if (!token || token.kind === 'classClose') break;
      next();

      if (token.kind === 'classRange') {
        const from = items.pop();
        const toToken = peek();
        if (
          from?.kind === 'char' &&
          toToken &&
          (toToken.kind === 'char' || toToken.kind === 'escape')
        ) {
          next();
          const to: CharClassChar = {
            kind: 'char',
            value: toToken.value ?? toToken.raw,
            raw: toToken.raw,
            span: toToken.span,
          };
          // Both values are non-empty, so `?? 0` is unreachable in practice.
          if ((from.value.codePointAt(0) ?? 0) > (to.value.codePointAt(0) ?? 0)) {
            errors.push(
              domainError('SYNTAX', `Character range \`${from.raw}-${to.raw}\` is backwards.`, {
                span: {
                  start: from.span.start,
                  end: to.span.end,
                  line: from.span.line,
                  column: from.span.column,
                },
                hint: 'The first character must not come after the second.',
              }),
            );
          }
          items.push({
            kind: 'range',
            from,
            to,
            span: {
              start: from.span.start,
              end: to.span.end,
              line: from.span.line,
              column: from.span.column,
            },
          });
          continue;
        }
        // Not a usable range after all — treat the hyphen as a literal.
        if (from) items.push(from);
        items.push({ kind: 'char', value: '-', raw: '-', span: token.span });
        continue;
      }

      items.push(classItemFrom(token));
    }

    if (peek()?.kind === 'classClose') next();

    const span: SourceSpan = {
      start: open.span.start,
      end: tokens[state.index - 1]?.span.end ?? open.span.end,
      line: open.span.line,
      column: open.span.column,
    };

    return { type: 'CharClass', negated, items, span };
  }

  function classItemFrom(token: LexToken): CharClassItem {
    if (token.kind === 'escape') {
      return {
        kind: 'escape',
        escape: token.escape ?? 'identity',
        raw: token.raw,
        span: token.span,
      };
    }
    if (token.kind === 'unicodeProperty') {
      return {
        kind: 'property',
        property: token.property ?? '',
        ...(token.propertyValue === undefined ? {} : { value: token.propertyValue }),
        negated: token.negated ?? false,
        raw: token.raw,
        span: token.span,
      };
    }
    return { kind: 'char', value: token.value ?? token.raw, raw: token.raw, span: token.span };
  }
}

/* ------------------------------------------------------------------ *
 * Pass two — backreference resolution
 * ------------------------------------------------------------------ */

/**
 * Resolves backreferences now that the total group count is known.
 *
 * ECMAScript does not say "\1 is always backreference 1". When the number
 * exceeds the group count, Annex B reinterprets it as a legacy octal escape
 * without the `u` flag, and rejects it with the flag (invariant R-I6). Getting
 * this wrong is the common shortcut, and it produces confidently wrong
 * explanations for patterns like `\1` with no groups at all.
 */
function resolveBackreferences(
  node: RegexNode,
  groups: readonly CaptureGroupInfo[],
  flags: RegexFlags,
  errors: DomainError[],
): void {
  const numbers = new Set(groups.map((group) => group.number));
  const names = new Set(
    groups.map((group) => group.name).filter((name): name is string => name !== undefined),
  );

  walk(node, (current) => {
    if (current.type !== 'Backreference') return current;

    if (typeof current.ref === 'number') {
      if (numbers.has(current.ref)) {
        return { ...current, resolved: true };
      }
      if (flags.unicode || flags.unicodeSets) {
        errors.push(
          domainError('SYNTAX', `\`${current.raw}\` refers to a group that does not exist.`, {
            span: current.span,
            hint: `This pattern has ${groups.length} capture group${groups.length === 1 ? '' : 's'}.`,
          }),
        );
        return { ...current, resolved: false };
      }
      // Annex B: without /u this is a legacy octal escape, not a reference.
      return { ...current, resolved: false };
    }

    if (names.has(current.ref)) return { ...current, resolved: true };

    // Annex B: when a pattern contains no group names at all, `\\k` is an
    // identity escape rather than a named backreference, and the engine
    // accepts it. It only becomes an error once named groups exist, or under
    // /u where the Annex B relaxation does not apply.
    const strict = flags.unicode || flags.unicodeSets || names.size > 0;
    if (!strict) return { ...current, resolved: false };

    errors.push(
      domainError('SYNTAX', `There is no group named \`${current.ref}\`.`, {
        span: current.span,
        hint:
          names.size === 0
            ? 'This pattern has no named groups.'
            : `Named groups: ${[...names].join(', ')}.`,
      }),
    );
    return { ...current, resolved: false };
  });
}

/**
 * In-place-ish walk. Nodes are readonly, so the visitor returns a replacement
 * and we write it back into the parent's array. Only used by pass two.
 */
function walk(node: RegexNode, visit: (node: RegexNode) => RegexNode): RegexNode {
  switch (node.type) {
    case 'Alternation': {
      const alternatives = node.alternatives as RegexNode[];
      alternatives.forEach((child, index) => {
        alternatives[index] = walk(child, visit);
      });
      return node;
    }
    case 'Sequence': {
      const elements = node.elements as RegexNode[];
      elements.forEach((child, index) => {
        elements[index] = walk(child, visit);
      });
      return node;
    }
    case 'Group': {
      (node as { body: RegexNode }).body = walk(node.body, visit);
      return node;
    }
    case 'Quantifier': {
      (node as { body: RegexNode }).body = walk(node.body, visit);
      return node;
    }
    default:
      return visit(node);
  }
}
