import { assertNever, type SourceSpan } from '../shared/result';
import {
  code,
  emphasis,
  joinClauses,
  ref,
  section,
  text,
  type Explanation,
  type ExplanationNode,
  type ExplanationSection,
} from '../shared/explanation';
import type { CharClassItem, RegexFlags, RegexNode } from './ast';

/**
 * Regex explanation engine — 04_PARSER_ARCHITECTURE.md §5
 *
 * Pure functions over the AST, dispatched on node type. The switch is
 * exhaustive: adding a node type without explaining it is a compile error,
 * which is what stops a new syntax feature shipping silently unexplained.
 *
 * Two registers of output:
 *   summary  one paragraph of prose, composed with conjunctions
 *   detail   per-construct, precise, positioned
 *
 * Summaries are composed from child summaries with joining rules rather than
 * concatenated fragments. Without that, output reads as a token dump — the
 * failure mode R-04 describes, and what every existing tool already does badly.
 *
 * Where ECMAScript semantics are subtle, the explanation states what
 * JavaScript actually does rather than simplifying into something wrong.
 */

export interface ExplainContext {
  readonly flags: RegexFlags;
  /** Set while explaining the inside of a character class. */
  readonly inCharClass: boolean;
}

export function explainRegex(ast: RegexNode, flags: RegexFlags): Explanation {
  const context: ExplainContext = { flags, inCharClass: false };
  const summaryBody = summarise(ast, context);

  const summary: ExplanationNode[] =
    summaryBody.length === 0
      ? [text('An empty pattern, which matches at every position.')]
      : [text('Matches '), ...summaryBody, text('.')];

  return { summary, details: detail(ast, context) };
}

/* ------------------------------------------------------------------ *
 * Summary — prose
 * ------------------------------------------------------------------ */

function summarise(node: RegexNode, context: ExplainContext): ExplanationNode[] {
  switch (node.type) {
    case 'Alternation': {
      const only = node.alternatives.length === 1 ? node.alternatives[0] : undefined;
      if (only) return summarise(only, context);
      const branches = node.alternatives.map((alternative) => summarise(alternative, context));
      return [text('either '), ...joinClauses(branches, 'or')];
    }

    case 'Sequence': {
      const parts = node.elements
        .map((element) => summarise(element, context))
        .filter((p) => p.length > 0);
      if (parts.length === 0) return [];
      return joinClauses(parts, 'then');
    }

    case 'Literal':
      return [text('the character '), code(node.raw)];

    case 'Dot':
      return context.flags.dotAll
        ? [text('any character, including line breaks')]
        : [text('any character except a line break')];

    case 'Anchor':
      return [text(anchorPhrase(node.anchor, context.flags))];

    case 'CharClass': {
      const inner = node.items.map((item) => summariseClassItem(item));
      const joined = joinClauses(inner, 'or');
      return node.negated
        ? [text('any character except '), ...joined]
        : [text('any of '), ...joined];
    }

    case 'Quantifier': {
      // Read the body in its plural form where one exists, so `\d+` reads as
      // "one or more digits" rather than "one or more of a digit". Wording is
      // the differentiator here; a technically correct summary that reads
      // like a token dump is the failure mode R-04 describes.
      const wantsPlural = node.max === null || node.max > 1;
      const body = wantsPlural
        ? (pluralBody(node.body, context) ?? summarise(node.body, context))
        : summarise(node.body, context);
      const usedPlural = wantsPlural && pluralBody(node.body, context) !== null;

      // A multi-part body must be bracketed, or the summary reads as if the
      // quantifier applied only to the first part: `(?:ab)+` would say
      // "one or more of the character a, then the character b", which states
      // the wrong thing about what repeats.
      if (isCompound(node.body)) {
        const inner = summarise(node.body, context);
        if (node.min === 0 && node.max === 1) {
          return [text('optionally the sequence ['), ...inner, text(']')];
        }
        return [
          ...quantifierPhrase(node.min, node.max, node.lazy),
          text(' repetitions of ['),
          ...inner,
          text(']'),
        ];
      }

      if (node.min === 0 && node.max === 1) {
        return [text(node.lazy ? 'optionally (preferring none) ' : 'optionally '), ...body];
      }
      return [
        ...quantifierPhrase(node.min, node.max, node.lazy),
        text(usedPlural ? ' ' : ' of '),
        ...body,
      ];
    }

    case 'Group': {
      const body = summarise(node.body, context);
      // A multi-part assertion body is bracketed so its extent is unambiguous:
      // without it, `(?=.*a)b` reads as though the assertion swallowed `b`.
      const assertionBody = isCompound(node.body) ? [text('['), ...body, text(']')] : body;
      switch (node.groupKind) {
        case 'lookahead':
          return [text('a position followed by '), ...assertionBody];
        case 'negativeLookahead':
          return [text('a position '), emphasis('not'), text(' followed by '), ...assertionBody];
        case 'lookbehind':
          return [text('a position preceded by '), ...assertionBody];
        case 'negativeLookbehind':
          return [text('a position '), emphasis('not'), text(' preceded by '), ...assertionBody];
        case 'named':
          return [
            text('a captured group named '),
            code(node.name ?? ''),
            text(' containing '),
            ...body,
          ];
        case 'capturing':
          return [
            text(`a captured group (number ${String(node.number ?? 0)}) containing `),
            ...body,
          ];
        case 'nonCapturing':
          return body;
      }
      return body;
    }

    case 'Backreference':
      return typeof node.ref === 'number'
        ? [text(`the same text captured by group ${String(node.ref)}`)]
        : [text('the same text captured by the group named '), code(node.ref)];

    case 'CharEscape':
      return [text(escapePhrase(node.escape, node.raw, node.value))];

    case 'UnicodeProperty':
      return [
        text(
          node.negated
            ? 'any character without the Unicode property '
            : 'any character with the Unicode property ',
        ),
        code(node.value === undefined ? node.property : `${node.property}=${node.value}`),
      ];

    case 'Error':
      return [text('an unreadable part of the pattern')];

    default:
      return assertNever(node, 'regex node');
  }
}

function summariseClassItem(item: CharClassItem): ExplanationNode[] {
  switch (item.kind) {
    case 'char':
      return [code(item.raw)];
    case 'range':
      return [code(item.from.raw), text(' to '), code(item.to.raw)];
    case 'escape':
      return [text(classEscapePhrase(item.escape, item.raw))];
    case 'property':
      return [text('characters with the property '), code(item.property)];
    default:
      return assertNever(item, 'character class item');
  }
}

function anchorPhrase(
  anchor: 'start' | 'end' | 'wordBoundary' | 'nonWordBoundary',
  flags: RegexFlags,
): string {
  switch (anchor) {
    case 'start':
      // The `m` flag changes what this means, and saying only "start of the
      // string" would be actively wrong for a multiline pattern.
      return flags.multiline ? 'the start of the string or of any line' : 'the start of the string';
    case 'end':
      return flags.multiline ? 'the end of the string or of any line' : 'the end of the string';
    case 'wordBoundary':
      return 'a word boundary';
    case 'nonWordBoundary':
      return 'a position that is not a word boundary';
  }
}

function quantifierPhrase(min: number, max: number | null, lazy: boolean): ExplanationNode[] {
  const laziness = lazy ? ' (as few as possible)' : '';
  if (min === 0 && max === null) return [text(`zero or more${laziness}`)];
  if (min === 1 && max === null) return [text(`one or more${laziness}`)];
  if (max === null) return [text(`${String(min)} or more${laziness}`)];
  if (min === max) return [text(`exactly ${String(min)}${laziness}`)];
  return [text(`between ${String(min)} and ${String(max)}${laziness}`)];
}

/**
 * Whether a quantified body needs bracketing to avoid ambiguity: anything
 * whose summary is more than one clause.
 */
function isCompound(node: RegexNode): boolean {
  if (node.type === 'Sequence') return node.elements.length > 1;
  if (node.type === 'Alternation') {
    if (node.alternatives.length > 1) return true;
    const only = node.alternatives[0];
    return only === undefined ? false : isCompound(only);
  }
  if (node.type === 'Group') return isCompound(node.body);
  // A quantifier inside a quantifier also needs brackets: "one or more of
  // exactly 3 of a digit" is unreadable, and `(?:\d{3})+` is a real pattern.
  if (node.type === 'Quantifier') return true;
  return false;
}

/**
 * Plural reading of a body, where one exists. Returns null when there is no
 * natural plural, in which case the caller falls back to "N of <singular>".
 */
function pluralBody(node: RegexNode, context: ExplainContext): ExplanationNode[] | null {
  if (node.type === 'CharEscape' && node.escape === 'shorthand') {
    const plural = SHORTHAND_PLURALS[node.raw];
    return plural === undefined ? null : [text(plural)];
  }
  if (node.type === 'Dot') {
    return context.flags.dotAll
      ? [text('characters, including line breaks')]
      : [text('characters other than line breaks')];
  }
  if (node.type === 'CharClass' && !node.negated) {
    const inner = node.items.map((item) => summariseClassItem(item));
    return [text('characters from '), ...joinClauses(inner, 'or')];
  }
  return null;
}

const SHORTHAND_PLURALS: Readonly<Record<string, string>> = {
  '\\d': 'digits',
  '\\D': 'non-digits',
  '\\w': 'word characters (letters, digits, or underscores)',
  '\\W': 'non-word characters',
  '\\s': 'whitespace characters',
  '\\S': 'non-whitespace characters',
};

function shorthandPhrase(raw: string): string {
  switch (raw) {
    case '\\d':
      return 'a digit';
    case '\\D':
      return 'a non-digit';
    case '\\w':
      return 'a word character (letter, digit, or underscore)';
    case '\\W':
      return 'a non-word character';
    case '\\s':
      return 'a whitespace character';
    case '\\S':
      return 'a non-whitespace character';
    default:
      return `the escape ${raw}`;
  }
}

/**
 * How an escape reads *inside a character class*.
 *
 * Only shorthand classes keep their class meaning there. `\\]`, `\\^`, and `\\-`
 * are identity escapes for the literal character, and calling them "the
 * escape" told the user nothing they could act on.
 */
function classEscapePhrase(kind: string, raw: string): string {
  if (kind === 'shorthand') return shorthandPhrase(raw);
  const escaped = raw.slice(1);
  if (kind === 'identity') return `a literal ${escaped}`;
  if (kind === 'control') return controlName(CONTROL_VALUES[escaped] ?? '');
  if (kind === 'hex' || kind === 'unicode' || kind === 'controlLetter') {
    return `the character ${raw}`;
  }
  return `the escape ${raw}`;
}

/** Decoded values for the control escapes, so a class item can name them. */
const CONTROL_VALUES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  f: '\f',
  v: '\v',
  b: '\b',
  '0': '\0',
};

function escapePhrase(kind: string, raw: string, value: string): string {
  switch (kind) {
    case 'shorthand':
      return shorthandPhrase(raw);
    case 'control':
      return controlName(value);
    case 'controlLetter':
      return `the control character ${raw}`;
    case 'hex':
    case 'unicode':
      return `the character ${raw}`;
    case 'legacyOctal':
      return `a legacy octal escape ${raw}`;
    case 'identity':
      return `a literal ${value}`;
    default:
      return `the escape ${raw}`;
  }
}

function controlName(value: string): string {
  switch (value) {
    case '\n':
      return 'a line feed';
    case '\r':
      return 'a carriage return';
    case '\t':
      return 'a tab';
    case '\f':
      return 'a form feed';
    case '\v':
      return 'a vertical tab';
    case '\0':
      return 'a null character';
    case '\b':
      return 'a backspace';
    default:
      return 'a control character';
  }
}

/* ------------------------------------------------------------------ *
 * Detail — per construct, positioned
 * ------------------------------------------------------------------ */

function detail(node: RegexNode, context: ExplainContext): ExplanationSection[] {
  const sections: ExplanationSection[] = [];
  collect(node, context, sections);
  return sections;
}

function collect(node: RegexNode, context: ExplainContext, out: ExplanationSection[]): void {
  switch (node.type) {
    case 'Alternation':
      if (node.alternatives.length > 1) {
        out.push(
          section(
            'alternation',
            'Alternation',
            [
              text(
                `Tries ${String(node.alternatives.length)} alternatives in order, left to right, and uses the first that matches.`,
              ),
            ],
            { span: node.span },
          ),
        );
      }
      node.alternatives.forEach((child) => {
        collect(child, context, out);
      });
      return;

    case 'Sequence':
      node.elements.forEach((child) => {
        collect(child, context, out);
      });
      return;

    case 'Group':
      out.push(
        section(`group-${String(node.span.start)}`, groupTitle(node), groupBody(node, context), {
          span: node.span,
        }),
      );
      collect(node.body, context, out);
      return;

    case 'Quantifier':
      out.push(
        section(
          `quantifier-${String(node.span.start)}`,
          `Quantifier ${node.raw}`,
          [
            ...quantifierPhrase(node.min, node.max, node.lazy),
            text(' occurrence'),
            text(node.max === 1 && node.min === 0 ? '' : 's'),
            text(' of the preceding item.'),
            ...(node.lazy
              ? [
                  text(
                    ' Lazy: it prefers the shortest match that still allows the rest of the pattern to succeed.',
                  ),
                ]
              : [
                  text(
                    ' Greedy: it takes as much as possible, then gives characters back if the rest of the pattern fails.',
                  ),
                ]),
          ],
          { span: node.span },
        ),
      );
      collect(node.body, context, out);
      return;

    case 'CharClass':
      out.push(
        section(
          `class-${String(node.span.start)}`,
          'Character class',
          [
            text(
              node.negated
                ? 'Matches one character that is none of: '
                : 'Matches one character from: ',
            ),
            ...joinClauses(
              node.items.map((item) => summariseClassItem(item)),
              'or',
            ),
            text('.'),
          ],
          { span: node.span },
        ),
      );
      return;

    case 'Anchor':
      out.push(
        section(
          `anchor-${String(node.span.start)}`,
          'Anchor',
          [
            text('Matches '),
            text(anchorPhrase(node.anchor, context.flags)),
            text('. It consumes no characters.'),
            ...(node.anchor === 'start' || node.anchor === 'end'
              ? [
                  text(
                    context.flags.multiline
                      ? ' The `m` flag is set, so it also applies at line boundaries.'
                      : '',
                  ),
                ]
              : []),
          ],
          { span: node.span },
        ),
      );
      return;

    case 'Backreference':
      out.push(
        section(
          `backref-${String(node.span.start)}`,
          `Backreference ${node.raw}`,
          [
            ...(node.resolved
              ? [
                  text('Matches the same text that '),
                  typeof node.ref === 'number' ? text(`group ${String(node.ref)}`) : code(node.ref),
                  text(' captured earlier — not the same pattern, the same actual text.'),
                ]
              : [
                  text('This does not refer to any capture group in the pattern. '),
                  ...(typeof node.ref === 'number'
                    ? [
                        text('Without the '),
                        code('u'),
                        text(
                          ' flag JavaScript treats it as a legacy octal escape rather than a backreference.',
                        ),
                      ]
                    : [text('There is no group with that name.')]),
                ]),
          ],
          { span: node.span, severity: node.resolved ? 'info' : 'warning' },
        ),
      );
      return;

    case 'UnicodeProperty':
      out.push(
        section(
          `property-${String(node.span.start)}`,
          `Unicode property ${node.raw}`,
          [
            text(
              node.negated
                ? 'Matches any character that does not have the property '
                : 'Matches any character with the property ',
            ),
            code(node.value === undefined ? node.property : `${node.property}=${node.value}`),
            text('.'),
          ],
          { span: node.span },
        ),
      );
      return;

    case 'Error':
      out.push(
        section(
          `error-${String(node.span.start)}`,
          'Unreadable',
          [text('This part of the pattern could not be read. See the errors above.')],
          { span: node.span, severity: 'error' },
        ),
      );
      return;

    case 'Literal':
    case 'Dot':
    case 'CharEscape':
      // Covered by the token table; a section per literal character would
      // bury the constructs that actually need explaining.
      return;

    default:
      assertNever(node, 'regex node');
  }
}

function groupTitle(node: Extract<RegexNode, { type: 'Group' }>): string {
  switch (node.groupKind) {
    case 'capturing':
      return `Capture group ${String(node.number ?? 0)}`;
    case 'named':
      return `Named group ${node.name ?? ''}`;
    case 'nonCapturing':
      return 'Non-capturing group';
    case 'lookahead':
      return 'Lookahead';
    case 'negativeLookahead':
      return 'Negative lookahead';
    case 'lookbehind':
      return 'Lookbehind';
    case 'negativeLookbehind':
      return 'Negative lookbehind';
  }
}

function groupBody(
  node: Extract<RegexNode, { type: 'Group' }>,
  context: ExplainContext,
): ExplanationNode[] {
  const inner = summarise(node.body, context);
  switch (node.groupKind) {
    case 'capturing':
      return [
        text('Captures its match so it can be referenced later, as '),
        code(`$${String(node.number ?? 0)}`),
        text(' in a replacement or '),
        code(`match[${String(node.number ?? 0)}]`),
        text(' in code. Contains '),
        ...inner,
        text('.'),
      ];
    case 'named':
      return [
        text('Captures its match under the name '),
        code(node.name ?? ''),
        text(', available as '),
        code(`groups.${node.name ?? ''}`),
        text('. Contains '),
        ...inner,
        text('.'),
      ];
    case 'nonCapturing':
      return [
        text('Groups syntax without capturing, so it does not consume a group number. Contains '),
        ...inner,
        text('.'),
      ];
    case 'lookahead':
      return [
        text('Asserts that what follows matches, without consuming any characters. Looks for '),
        ...inner,
        text('.'),
      ];
    case 'negativeLookahead':
      return [
        text('Asserts that what follows does '),
        emphasis('not'),
        text(' match, without consuming any characters. Rejects '),
        ...inner,
        text('.'),
      ];
    case 'lookbehind':
      return [
        text('Asserts that what precedes matches, without consuming any characters. Looks for '),
        ...inner,
        text('.'),
      ];
    case 'negativeLookbehind':
      return [
        text('Asserts that what precedes does '),
        emphasis('not'),
        text(' match, without consuming any characters. Rejects '),
        ...inner,
        text('.'),
      ];
  }
}

/** Builds a positioned reference node. Exported for the token table. */
export function spanRef(raw: string, span: SourceSpan): ExplanationNode {
  return ref(raw, span);
}
