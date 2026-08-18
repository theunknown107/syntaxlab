import { LIMITS } from '../shared/limits';
import { domainError, err, ok, type Result } from '../shared/result';

/**
 * Regex execution — 04_PARSER_ARCHITECTURE.md §7, 05_SECURITY.md §6
 *
 * The **only** place in the application that constructs a `RegExp` from user
 * input. It exists to be imported by the disposable execution worker and by
 * nothing else: running this on the main thread would put uninterruptible
 * foreign code on the thread that owns the UI, which no timeout can rescue.
 *
 * There is deliberately no cancellation path in here. JavaScript regex
 * execution cannot be interrupted — no step limit, no abort signal, no
 * yielding — so the stop mechanism lives one level up, in the client that
 * terminates the whole thread. Everything this module can do is bound the
 * *output*: the input limits and the match caps below are what stop a pattern
 * that finishes quickly but produces a gigabyte of results.
 */

/** A single numbered capture group's contribution to one match. */
export interface MatchCapture {
  readonly number: number;
  /** `null` when the group did not participate in this match. */
  readonly value: string | null;
  /** True length before clipping; may exceed `value.length`. */
  readonly length: number;
  /** Offsets are only available when the `d` flag is set. */
  readonly start?: number;
  readonly end?: number;
}

/**
 * A named group's contribution, reported separately from the numbered list.
 *
 * The engine exposes names and numbers as two independent views of the same
 * match and offers no mapping between them: `match.groups` is name → value and
 * `match[n]` is number → value. Reuniting them by comparing values is
 * ambiguous whenever two groups capture the same text, so both views are
 * reported as the engine gives them rather than merged on a guess.
 */
export interface NamedCapture {
  readonly name: string;
  readonly value: string | null;
  readonly length: number;
}

export interface RegexMatch {
  /** 0-based position in the result list. */
  readonly ordinal: number;
  /** UTF-16 code-unit offsets into the subject, from the engine. */
  readonly start: number;
  readonly end: number;
  /** The matched text, clipped to `maxMatchTextChars`. */
  readonly value: string;
  /** True length before clipping. */
  readonly length: number;
  readonly captures: readonly MatchCapture[];
  readonly named: readonly NamedCapture[];
}

/**
 * Why the result stopped short. Never silent: every value other than `none`
 * is surfaced in the UI (08_UI_UX_SPEC.md §7.1).
 */
export type ExecTruncation = 'none' | 'matchCount' | 'outputSize';

export interface RegexExecResult {
  readonly kind: 'regexExec';
  readonly matches: readonly RegexMatch[];
  readonly truncated: ExecTruncation;
  /** `g` or `y` is set, so the engine scans past the first match. */
  readonly findsAll: boolean;
  /** `d` is set, so capture offsets are present. */
  readonly hasIndices: boolean;
  readonly subjectLength: number;
  readonly elapsedMs: number;
}

export interface ExecuteRegexInput {
  readonly source: string;
  readonly flags: string;
  readonly subject: string;
}

export function checkSubjectLength(subject: string) {
  if (subject.length <= LIMITS.regex.testSubject) return null;
  return domainError(
    'LIMIT_EXCEEDED',
    `The test string is ${subject.length.toLocaleString('en')} characters; the limit is ${LIMITS.regex.testSubject.toLocaleString('en')}.`,
    { hint: 'Test against a smaller sample.' },
  );
}

/**
 * Advances past a zero-length match.
 *
 * Without this the loop never terminates, because `exec` leaves `lastIndex`
 * where it found the empty match. The step is a whole code point under `u`
 * and `v` and a single code unit otherwise, which is what the specification's
 * AdvanceStringIndex does — stepping by one code unit under `u` would land
 * inside a surrogate pair and report matches at positions the engine itself
 * would never produce.
 */
function advanceIndex(subject: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= subject.length) return index + 1;
  const code = subject.codePointAt(index);
  return index + (code !== undefined && code > 0xffff ? 2 : 1);
}

function clip(value: string): string {
  return value.length <= LIMITS.regex.maxMatchTextChars
    ? value
    : value.slice(0, LIMITS.regex.maxMatchTextChars);
}

/** Indices for one match when the `d` flag is set, else undefined. */
type IndicesArray = (readonly [number, number] | undefined)[] | undefined;

function buildCapture(
  number: number,
  raw: string | undefined,
  indices: IndicesArray,
): MatchCapture {
  // Built field-by-field rather than by spreading, so an unexpected key can
  // never reach a capture (18_CODING_STANDARDS.md S4).
  const capture: {
    number: number;
    value: string | null;
    length: number;
    start?: number;
    end?: number;
  } = {
    number,
    value: raw === undefined ? null : clip(raw),
    length: raw === undefined ? 0 : raw.length,
  };

  const pair = indices?.[number];
  if (pair) {
    capture.start = pair[0];
    capture.end = pair[1];
  }

  return capture;
}

function buildNamed(match: RegExpExecArray): NamedCapture[] {
  const groups: Record<string, string | undefined> | undefined = match.groups;
  if (!groups) return [];
  return Object.entries(groups).map(([name, value]) => ({
    name,
    value: value === undefined ? null : clip(value),
    length: value?.length ?? 0,
  }));
}

function buildMatch(ordinal: number, match: RegExpExecArray): RegexMatch {
  const whole = match[0];
  const indices = (match as { indices?: IndicesArray }).indices;

  const captures: MatchCapture[] = [];
  for (let number = 1; number < match.length; number += 1) {
    captures.push(buildCapture(number, match[number], indices));
  }

  return {
    ordinal,
    start: match.index,
    end: match.index + whole.length,
    value: clip(whole),
    length: whole.length,
    captures,
    named: buildNamed(match),
  };
}

function outputCost(match: RegexMatch): number {
  let cost = match.value.length;
  for (const capture of match.captures) cost += capture.value?.length ?? 0;
  for (const named of match.named) cost += named.value?.length ?? 0;
  return cost;
}

/**
 * Runs a pattern against a subject.
 *
 * Returns `err` only when the pattern or the input is unusable — a pattern the
 * engine refuses to compile, or a subject over the limit. "No matches" is a
 * successful result with an empty list, because it is a real and informative
 * answer rather than a failure (08_UI_UX_SPEC.md §13).
 */
export function executeRegex(input: ExecuteRegexInput): Result<RegexExecResult> {
  const tooLong = checkSubjectLength(input.subject);
  if (tooLong) return err(tooLong);

  let regex: RegExp;
  try {
    // The authoritative validity check. Our parser recovers from syntax errors
    // to keep explaining the rest of a pattern; the engine does not, and it is
    // the engine that has to run this.
    regex = new RegExp(input.source, input.flags);
  } catch (error) {
    return err(
      domainError('SYNTAX', 'This pattern cannot be compiled by the JavaScript engine.', {
        hint: error instanceof Error ? error.message : undefined,
      }),
    );
  }

  const findsAll = regex.global || regex.sticky;
  // Read from the flag string rather than `regex.unicodeSets`, which the
  // ES2022 lib target does not declare.
  const unicodeMode = regex.unicode || input.flags.includes('v');
  const startedAt = Date.now();
  const matches: RegexMatch[] = [];
  let truncated: ExecTruncation = 'none';
  let emitted = 0;

  let raw = regex.exec(input.subject);
  while (raw !== null) {
    const match = buildMatch(matches.length, raw);
    const cost = outputCost(match);

    if (emitted + cost > LIMITS.regex.maxOutputChars && matches.length > 0) {
      truncated = 'outputSize';
      break;
    }

    matches.push(match);
    emitted += cost;

    if (!findsAll) break;

    if (matches.length >= LIMITS.regex.maxMatches) {
      truncated = 'matchCount';
      break;
    }

    if (raw[0].length === 0) {
      regex.lastIndex = advanceIndex(input.subject, regex.lastIndex, unicodeMode);
    }
    if (regex.lastIndex > input.subject.length) break;

    raw = regex.exec(input.subject);
  }

  return ok({
    kind: 'regexExec',
    matches,
    truncated,
    findsAll,
    hasIndices: regex.hasIndices,
    subjectLength: input.subject.length,
    elapsedMs: Date.now() - startedAt,
  });
}
