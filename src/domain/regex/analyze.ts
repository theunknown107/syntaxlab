import { err, ok, type Result } from '../shared/result';
import type { RegexAnalysis, RegexFlags, RegexToken, RegexTokenType } from './ast';
import { EMPTY_FLAGS } from './ast';
import { explainRegex } from './explain';
import { parsePattern } from './parser';
import { checkPatternLength, type LexToken } from './tokenizer';
import { scanWarnings } from './warnings';

/**
 * Regex analysis pipeline — 04_PARSER_ARCHITECTURE.md §2.1
 *
 *   pattern → tokenize → parse → group/backreference pass
 *           → warnings → explanation → RegexAnalysis
 *
 * Parsing only. No `RegExp` is constructed and nothing is executed here:
 * execution belongs to the disposable worker (M4), and mixing the two would
 * put uninterruptible foreign code in the long-lived analysis worker.
 */

const VALID_FLAGS = 'dgimsuvy';

export function parseFlags(input: string): Result<RegexFlags> {
  const seen = new Set<string>();

  for (const flag of input) {
    if (!VALID_FLAGS.includes(flag)) {
      return err({
        code: 'SYNTAX',
        message: `\`${flag}\` is not a JavaScript regex flag.`,
        hint: `Valid flags are ${VALID_FLAGS.split('').join(', ')}.`,
      });
    }
    if (seen.has(flag)) {
      return err({ code: 'SYNTAX', message: `The \`${flag}\` flag is repeated.` });
    }
    seen.add(flag);
  }

  if (seen.has('u') && seen.has('v')) {
    return err({
      code: 'SYNTAX',
      message: 'The `u` and `v` flags cannot be combined.',
      hint: '`v` is a superset of `u`; use one or the other.',
    });
  }

  return ok({
    global: seen.has('g'),
    ignoreCase: seen.has('i'),
    multiline: seen.has('m'),
    dotAll: seen.has('s'),
    unicode: seen.has('u'),
    sticky: seen.has('y'),
    hasIndices: seen.has('d'),
    unicodeSets: seen.has('v'),
  });
}

export function flagsToString(flags: RegexFlags): string {
  return (
    (flags.hasIndices ? 'd' : '') +
    (flags.global ? 'g' : '') +
    (flags.ignoreCase ? 'i' : '') +
    (flags.multiline ? 'm' : '') +
    (flags.dotAll ? 's' : '') +
    (flags.unicode ? 'u' : '') +
    (flags.unicodeSets ? 'v' : '') +
    (flags.sticky ? 'y' : '')
  );
}

const TOKEN_TYPE_MAP: Readonly<Record<LexToken['kind'], RegexTokenType>> = {
  char: 'Char',
  dot: 'Dot',
  anchor: 'Anchor',
  groupOpen: 'GroupOpen',
  groupClose: 'GroupClose',
  alternate: 'Alternate',
  classOpen: 'ClassOpen',
  classClose: 'ClassClose',
  classNegate: 'ClassOpen',
  classRange: 'Char',
  quantifier: 'Quantifier',
  escape: 'Escape',
  unicodeProperty: 'UnicodeProperty',
  backreference: 'Backreference',
  invalid: 'Invalid',
};

export interface AnalyzeRegexInput {
  readonly source: string;
  readonly flags: string;
}

/**
 * Analyses a pattern. Returns `err` only when nothing useful can be produced
 * (over the length limit, or unusable flags). Syntax errors inside the pattern
 * are recovered from and reported as part of a successful analysis, so a
 * single typo still yields an explanation for the rest.
 */
export function analyzeRegex(input: AnalyzeRegexInput): Result<RegexAnalysis> {
  const tooLong = checkPatternLength(input.source);
  if (tooLong) return err(tooLong);

  const flagsResult = parseFlags(input.flags);
  if (!flagsResult.ok) return err(flagsResult.error);
  const flags = flagsResult.value;

  const parsed = parsePattern(input.source, flags);
  const { warnings, compatibility } = scanWarnings(parsed.ast, flags, input.source);
  const explanation = explainRegex(parsed.ast, flags);

  const tokens: RegexToken[] = parsed.tokens.map((token) => ({
    type: TOKEN_TYPE_MAP[token.kind],
    raw: token.raw,
    span: token.span,
  }));

  return ok({
    kind: 'regex',
    source: input.source,
    flags,
    ast: parsed.ast,
    tokens,
    groups: parsed.groups,
    explanation,
    warnings,
    compatibility,
    errors: parsed.errors,
  });
}

export { EMPTY_FLAGS };
