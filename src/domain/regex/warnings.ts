import type {
  CompatibilityNote,
  EcmaScriptLevel,
  EngineCompatibility,
  RegexFlags,
  RegexNode,
  RegexWarning,
} from './ast';

/**
 * Warnings and compatibility — 03_DOMAIN_MODEL.md §3.3, §3.4
 *
 * Warnings are kept strictly separate from syntax validity: a valid pattern
 * with a risky shape is not an error, and an actual syntax error is never
 * downgraded to a warning.
 *
 * NESTED_QUANTIFIER is a **heuristic**, and the wording says so. Absence of a
 * warning is not a safety guarantee — that comes from worker termination
 * (verified at M2), not from static analysis. Claiming otherwise would give a
 * user false confidence about a pattern they are about to deploy.
 */

const LEVEL_ORDER: readonly EcmaScriptLevel[] = ['es5', 'es2018', 'es2022', 'es2024', 'es2025'];

function highest(a: EcmaScriptLevel, b: EcmaScriptLevel): EcmaScriptLevel {
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b;
}

export interface WarningScanResult {
  readonly warnings: readonly RegexWarning[];
  readonly compatibility: EngineCompatibility;
}

export function scanWarnings(ast: RegexNode, flags: RegexFlags, source: string): WarningScanResult {
  const warnings: RegexWarning[] = [];
  const notes: CompatibilityNote[] = [];
  let level: EcmaScriptLevel = 'es5';

  const raiseLevel = (candidate: EcmaScriptLevel): void => {
    level = highest(level, candidate);
  };

  visit(ast, false);

  // `\p{…}` without the `u` flag is silently a literal `p{…}` rather than a
  // property escape. A very common real bug, and invisible without a warning.
  if (!flags.unicode && !flags.unicodeSets && /\\[pP]\{/.test(source)) {
    const index = source.search(/\\[pP]\{/);
    warnings.push({
      code: 'UNICODE_FLAG_ADVISED',
      message: 'Unicode property escapes need the `u` flag to work.',
      span: { start: index, end: index + 2, line: 1, column: index + 1 },
      hint: 'Without `u`, `\\p{L}` matches a literal `p` followed by `{L}`.',
    });
  }

  if (flags.hasIndices) raiseLevel('es2022');
  if (flags.unicodeSets) raiseLevel('es2024');

  return { warnings, compatibility: { ecmascript: level, notes } };

  function visit(node: RegexNode, insideQuantifier: boolean): void {
    switch (node.type) {
      case 'Alternation': {
        node.alternatives.forEach((alternative) => {
          if (alternative.type === 'Sequence' && alternative.elements.length === 0) {
            warnings.push({
              code: 'EMPTY_ALTERNATIVE',
              message: 'One alternative is empty, so this can match nothing at all.',
              span: alternative.span,
              hint: 'If that is deliberate, `(?:…)?` says it more clearly.',
            });
          }
          visit(alternative, insideQuantifier);
        });
        return;
      }

      case 'Sequence':
        node.elements.forEach((element, index) => {
          if (
            element.type === 'Anchor' &&
            element.anchor === 'start' &&
            index > 0 &&
            !flags.multiline
          ) {
            warnings.push({
              code: 'ANCHOR_IN_MIDDLE',
              message: '`^` appears after other syntax, so this can never match.',
              span: element.span,
              hint: 'Without the `m` flag, `^` only matches at the very start of the string.',
            });
          }
          visit(element, insideQuantifier);
        });
        return;

      case 'Quantifier': {
        if (node.max !== null && node.max >= 1000) {
          warnings.push({
            code: 'LARGE_BOUNDED_REPEAT',
            message: `A bounded repeat of up to ${String(node.max)} can be slow on long input.`,
            span: node.span,
          });
        }

        // Heuristic only: a quantified group whose body is also quantified is
        // the classic catastrophic-backtracking shape. It has false negatives
        // by construction, which the message does not hide.
        if (containsQuantifier(node.body)) {
          warnings.push({
            code: 'NESTED_QUANTIFIER',
            message: 'A repeat inside a repeat — this shape can backtrack catastrophically.',
            span: node.span,
            hint: 'Not every nested quantifier is slow, and this check cannot find every case. Test it against a long non-matching string.',
          });
        }

        visit(node.body, true);
        return;
      }

      case 'Group': {
        if (node.groupKind === 'lookbehind' || node.groupKind === 'negativeLookbehind') {
          raiseLevel('es2018');
          notes.push({
            feature: 'Lookbehind assertion',
            level: 'es2018',
            detail: 'Supported in all current browsers. Safari added it in 16.4 (March 2023).',
            span: node.span,
          });
          warnings.push({
            code: 'LOOKBEHIND_COMPATIBILITY',
            message: 'Lookbehind is unsupported in Safari before 16.4.',
            span: node.span,
            hint: 'Every other current browser supports it.',
          });
        }
        if (node.groupKind === 'named') raiseLevel('es2018');
        visit(node.body, insideQuantifier);
        return;
      }

      case 'UnicodeProperty':
        raiseLevel('es2018');
        notes.push({
          feature: 'Unicode property escape',
          level: 'es2018',
          detail: 'Requires the `u` or `v` flag.',
          span: node.span,
        });
        return;

      case 'CharClass':
        node.items.forEach((item) => {
          if (item.kind === 'char' && item.raw === '.') {
            warnings.push({
              code: 'UNESCAPED_DOT_IN_CLASS',
              message: 'Inside a character class, `.` matches a literal dot.',
              span: item.span,
              hint: 'That is usually what you want here — no escape is needed.',
            });
          }
        });
        return;

      case 'CharEscape':
        if (node.escape === 'identity' && !'^$\\.*+?()[]{}|/'.includes(node.value)) {
          warnings.push({
            code: 'REDUNDANT_ESCAPE',
            message: `\`${node.raw}\` escapes a character that has no special meaning.`,
            span: node.span,
            hint: 'Harmless, but it can hide a typo.',
          });
        }
        return;

      case 'Backreference':
        if (!node.resolved) {
          warnings.push({
            code: 'UNRESOLVED_BACKREFERENCE',
            message: `\`${node.raw}\` does not refer to any capture group.`,
            span: node.span,
            hint: 'Without the `u` flag JavaScript reads this as a legacy octal escape.',
          });
        }
        return;

      default:
        return;
    }
  }
}

function containsQuantifier(node: RegexNode): boolean {
  switch (node.type) {
    case 'Quantifier':
      return true;
    case 'Group':
      return containsQuantifier(node.body);
    case 'Sequence':
      return node.elements.some((element) => containsQuantifier(element));
    case 'Alternation':
      return node.alternatives.some((alternative) => containsQuantifier(alternative));
    default:
      return false;
  }
}
