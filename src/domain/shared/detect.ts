/**
 * Input detection — 08_UI_UX_SPEC.md §3, 04_PARSER_ARCHITECTURE.md §6
 *
 * Decides whether pasted text *looks like* JSON or a regular expression, so
 * the workspace can offer the right mode. Three rules govern it, and they are
 * the reason this is deliberately cheap and deliberately unsure of itself:
 *
 *   1. **It suggests, never traps.** A wrong auto-switch loses the user's
 *      place in a tool they came to for one specific job.
 *   2. **It reads a sample, not the document.** A 5 MB paste must not be
 *      scanned twice — once to guess and once to parse.
 *   3. **"Unknown" is a real answer.** Below the confidence floor it says so
 *      rather than picking the more likely of two bad guesses.
 *
 * There is no cron branch. Cron is V1.1 and must not appear in V1.0 in any
 * form, including a detection result nothing can act on.
 */

export type DetectedType = 'json' | 'regex' | 'unknown';

export interface DetectionResult {
  readonly type: DetectedType;
  /** 0–1. Above `AUTO_SELECT` the mode may switch; above `SUGGEST` it offers. */
  readonly confidence: number;
}

/** Bytes examined. Enough to be sure, small enough to be free. */
const SAMPLE_SIZE = 1024;

/** At or above this, a mode switch is safe on an empty editor. */
export const AUTO_SELECT = 0.85;
/** At or above this, offer a dismissible suggestion. */
export const SUGGEST = 0.6;

const UNKNOWN: DetectionResult = { type: 'unknown', confidence: 0 };

export function detectInput(input: string): DetectionResult {
  const sample = input.slice(0, SAMPLE_SIZE).trim();
  if (sample === '') return UNKNOWN;

  const json = scoreJson(sample);
  const regex = scoreRegex(sample);

  if (json < SUGGEST && regex < SUGGEST) return UNKNOWN;
  return json >= regex ? { type: 'json', confidence: json } : { type: 'regex', confidence: regex };
}

/**
 * How much this looks like JSON.
 *
 * Structural evidence only — a brace with a quoted key after it, a bracket
 * with a value after it, a bare literal. No parse attempt: the whole point is
 * to be cheap enough to run on every keystroke.
 */
function scoreJson(sample: string): number {
  const first = sample[0] ?? '';
  const last = sample[sample.length - 1] ?? '';

  if (first === '{' || first === '[') return scoreContainer(sample, first, last);
  return scoreBareLiteral(sample);
}

/** A brace or bracket, open or closed. The strongest signals live here. */
function scoreContainer(sample: string, first: string, last: string): number {
  const hasKey = /"[^"]*"\s*:/.test(sample);
  const hasElement = /^\[\s*[[{"\d\-tfn]/.test(sample);
  const closed = (first === '{' && last === '}') || (first === '[' && last === ']');

  // A complete-looking container with contents that parse-shaped is as sure
  // as a cheap check gets.
  if (closed) return hasKey || hasElement ? 0.95 : 0.8;
  if (first === '{') return hasKey ? 0.9 : 0.65;
  return hasElement ? 0.85 : 0.6;
}

/**
 * Bare literals are valid JSON documents, but a lone `true` is equally likely
 * to be a word someone is about to build a pattern out of — so these sit at
 * the suggestion floor rather than above the auto-select line.
 */
function scoreBareLiteral(sample: string): number {
  if (/^(true|false|null)$/.test(sample)) return 0.65;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(sample)) return 0.6;
  return 0;
}

/**
 * How much this looks like a regular expression.
 *
 * Weaker evidence by nature: almost any text is a *syntactically* valid
 * pattern, so the score comes from constructs that would be unusual in prose
 * and from the `/…/flags` form people paste out of source code.
 */
function scoreRegex(sample: string): number {
  if (sample.includes('\n')) return 0; // patterns are single-line

  // The literal form, copied straight out of JavaScript.
  if (/^\/.+\/[dgimsuvy]*$/.test(sample)) return 0.95;

  let score = 0;
  if (sample.startsWith('^') || sample.endsWith('$')) score += 0.35;
  if (/\\[dwsbDWSB]/.test(sample)) score += 0.3;
  if (/\[[^\]]+\]/.test(sample)) score += 0.2;
  if (/\((\?[:=!<]|[^)])*\)/.test(sample)) score += 0.15;
  if (/[*+?]|\{\d+(,\d*)?\}/.test(sample)) score += 0.15;
  if (/\\[.+*?^$()[\]{}|/\\]/.test(sample)) score += 0.15;

  return Math.min(score, 0.9);
}
