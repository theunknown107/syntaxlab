import { LIMITS } from '../shared/limits';
import { domainError, err, ok, truncateForMessage } from '../shared/result';
import type { DomainError, Result, SourceSpan } from '../shared/result';
import {
  CRON_FIELD_ORDER,
  CRON_FIELD_SPECS,
  type CronField,
  type CronFieldName,
  type CronFieldSpec,
  type CronTerm,
  type CronToken,
} from './ast';
import { tokenize } from './tokenizer';

/**
 * Cron parser — 04_PARSER_ARCHITECTURE.md §4.1–4.3
 *
 * The single most important rule in this file is that **a field count other
 * than 5 is refused, not parsed** (§4.2). Everything else is ordinary
 * validation.
 */

/* ------------------------------------------------------------------ *
 * Macros
 * ------------------------------------------------------------------ */

/**
 * The macros the dialect defines, and their 5-field equivalents.
 *
 * `@reboot` is deliberately absent from this map: it is *recognised* — see
 * `NON_SCHEDULABLE_MACROS` — but it has no schedule, so expanding it to five
 * fields would be a lie.
 */
export const CRON_MACROS: Readonly<Record<string, string>> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export const NON_SCHEDULABLE_MACROS: readonly string[] = ['@reboot'];

/**
 * Characters that belong to a scheduler we do not implement, and which one.
 *
 * Naming the source turns a refusal into an explanation. Someone pasting
 * `0 0 L * ?` has a Quartz expression and needs to be told that, not told
 * "unexpected character".
 */
const FOREIGN_SYNTAX: Readonly<Record<string, string>> = {
  L: 'Quartz (last day of the month or week)',
  W: 'Quartz (nearest weekday)',
  '#': 'Quartz (nth weekday of the month)',
  '?': 'Quartz (no specific value)',
  H: 'Jenkins (hashed, spread-out scheduling)',
};

/* ------------------------------------------------------------------ *
 * Splitting into fields
 * ------------------------------------------------------------------ */

export interface RawField {
  readonly raw: string;
  readonly span: SourceSpan;
}

/** Splits on whitespace, keeping each run's exact span. */
export function splitFields(source: string, tokens: readonly CronToken[]): readonly RawField[] {
  const fields: RawField[] = [];
  let current: CronToken[] = [];

  const flush = (): void => {
    const first = current[0];
    const last = current[current.length - 1];
    if (first === undefined || last === undefined) return;
    fields.push({
      raw: source.slice(first.span.start, last.span.end),
      span: { ...first.span, end: last.span.end },
    });
    current = [];
  };

  for (const token of tokens) {
    if (token.type === 'whitespace') flush();
    else current.push(token);
  }
  flush();
  return fields;
}

/* ------------------------------------------------------------------ *
 * Field-count lock
 * ------------------------------------------------------------------ */

export interface FieldCountRefusal {
  readonly error: DomainError;
}

/**
 * The refusal message, written to be useful rather than merely correct.
 *
 * A 6-field expression is ambiguous: seconds-first (Quartz, Spring) and
 * year-last conventions both exist and produce *different schedules*. Guessing
 * between them yields a confidently wrong answer, which for a scheduling tool
 * is worse than no answer at all.
 */
function refuseFieldCount(count: number, span: SourceSpan): DomainError {
  if (count === 6 || count === 7) {
    const hint =
      count === 6
        ? 'Some schedulers (Quartz, Spring) put seconds first; others append a year. SyntaxLab does not guess between them, because they describe different schedules. If your first field is seconds, removing it may give the equivalent 5-field expression.'
        : 'Seven fields is the Quartz form, with seconds first and a year last. SyntaxLab supports the standard 5-field format only.';
    return domainError(
      'UNSUPPORTED',
      `This expression has ${String(count)} fields. SyntaxLab supports the standard 5-field cron format — minute, hour, day-of-month, month, day-of-week.`,
      { span, hint },
    );
  }
  return domainError(
    'SYNTAX',
    `Expected 5 fields — minute, hour, day-of-month, month, day-of-week — but found ${String(count)}.`,
    {
      span,
      hint: count < 5 ? 'Add the missing fields, separated by spaces.' : 'Remove the extra fields.',
    },
  );
}

/* ------------------------------------------------------------------ *
 * Term parsing
 * ------------------------------------------------------------------ */

interface TermOutcome {
  readonly term?: CronTerm;
  readonly error?: DomainError;
}

/**
 * Recognises syntax from a scheduler SyntaxLab does not implement, and names
 * it. Returns `null` when the token is simply not foreign.
 *
 * For an all-letters token, *every* character must be a foreign symbol —
 * `L`, `W`, `LW`. Requiring the whole token to equal one symbol missed
 * Quartz's `LW`; allowing any character to match reported Jenkins for
 * `SMARCH`, which merely contains an H. "All of them" is the rule that
 * separates a foreign operator from a misspelt name.
 */
function foreignSyntaxError(upper: string, span: SourceSpan): DomainError | null {
  const alphabetic = /^[A-Z]+$/.test(upper);
  const allForeignLetters =
    alphabetic && upper.split('').every((character) => character in FOREIGN_SYNTAX);

  for (const [symbol, foreign] of Object.entries(FOREIGN_SYNTAX)) {
    const present = alphabetic
      ? allForeignLetters && upper.includes(symbol)
      : upper.includes(symbol);
    if (!present) continue;
    return domainError(
      'UNSUPPORTED',
      `"${symbol}" is ${foreign} syntax, which SyntaxLab does not support.`,
      { span, hint: 'SyntaxLab supports the standard 5-field cron format only.' },
    );
  }
  return null;
}

/** Resolves a number or a name to its numeric value for this field. */
function readValue(
  raw: string,
  spec: CronFieldSpec,
  span: SourceSpan,
): { value: number } | { error: DomainError } {
  if (raw === '') {
    return { error: domainError('SYNTAX', `Expected a ${spec.label} value.`, { span }) };
  }

  if (/^\d+$/.test(raw)) {
    const value = Number.parseInt(raw, 10);
    if (value < spec.min || value > spec.max) {
      return {
        error: domainError(
          'SYNTAX',
          `${String(value)} is out of range for the ${spec.label} field, which accepts ${String(spec.min)}–${String(spec.max)}.`,
          { span },
        ),
      };
    }
    return { value };
  }

  const upper = raw.toUpperCase();
  const named = spec.names[upper];
  if (named !== undefined) return { value: named };

  /*
   * Foreign syntax, named rather than dismissed.
   *
   * The scan is deliberately not "does this token contain L, W, H, # or ?".
   * `SMARCH` contains an H and is a misspelt month, not Jenkins syntax — an
   * earlier version of this check said Jenkins and was wrong. So:
   *
   *   - an all-letters token is a name attempt, and only counts as foreign if
   *     the *whole* token is the symbol (`L`, `W`, `H`)
   *   - anything mixing digits and symbols is scanned per character, which is
   *     what catches `6#3` and `15W`
   */
  const foreign = foreignSyntaxError(upper, span);
  if (foreign !== null) return { error: foreign };

  if (Object.keys(spec.names).length > 0) {
    return {
      error: domainError(
        'SYNTAX',
        `"${truncateForMessage(raw)}" is not a recognised ${spec.label}.`,
        {
          span,
          hint: `Use ${String(spec.min)}–${String(spec.max)}, or one of ${Object.keys(spec.names).join(', ')}.`,
        },
      ),
    };
  }

  return {
    error: domainError(
      'SYNTAX',
      `The ${spec.label} field accepts numbers ${String(spec.min)}–${String(spec.max)}, not "${truncateForMessage(raw)}".`,
      { span },
    ),
  };
}

/**
 * Parses one term: `*`, a value, a range, or any of those with a step.
 *
 * Written as an explicit scan rather than a regex so every sub-part keeps its
 * own span — `1-10/2` produces three positions, not one.
 */
function parseTerm(text: string, offset: number, spec: CronFieldSpec, source: string): TermOutcome {
  const spanFor = (from: number, to: number): SourceSpan => {
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < from; index += 1) {
      if (source.charCodeAt(index) === 10) {
        line += 1;
        lineStart = index + 1;
      }
    }
    return { start: from, end: to, line, column: from - lineStart + 1 };
  };

  const whole = spanFor(offset, offset + text.length);

  if (text === '') {
    return {
      error: domainError('SYNTAX', `Empty ${spec.label} value.`, {
        span: whole,
        hint: 'Remove the stray comma, or fill in a value.',
      }),
    };
  }

  // Split the step off first: `base/step`.
  const slash = text.indexOf('/');
  let baseText = text;
  let stepText: string | null = null;
  if (slash !== -1) {
    baseText = text.slice(0, slash);
    stepText = text.slice(slash + 1);
    if (text.includes('/', slash + 1)) {
      return {
        error: domainError('SYNTAX', 'A term may contain only one step.', {
          span: whole,
          hint: 'Write it as `*/n` or `a-b/n`.',
        }),
      };
    }
  }

  const baseOutcome = parseBase(baseText, offset, spec, spanFor);
  if ('error' in baseOutcome) return { error: baseOutcome.error };
  const base = baseOutcome.base;

  if (stepText === null) return { term: base };
  return parseStep(stepText, base, { offset, slash, text, whole, spanFor });
}

type SpanFor = (from: number, to: number) => SourceSpan;

/** The part of a term before any step: `*`, a value, or a range. */
function parseBase(
  baseText: string,
  offset: number,
  spec: CronFieldSpec,
  spanFor: SpanFor,
): { base: CronTerm } | { error: DomainError } {
  let base: CronTerm;
  if (baseText === '*') {
    base = { kind: 'all', span: spanFor(offset, offset + 1) };
  } else if (baseText.includes('-')) {
    const dash = baseText.indexOf('-');
    const rawFrom = baseText.slice(0, dash);
    const rawTo = baseText.slice(dash + 1);
    const fromSpan = spanFor(offset, offset + dash);
    const toSpan = spanFor(offset + dash + 1, offset + baseText.length);

    const from = readValue(rawFrom, spec, fromSpan);
    if ('error' in from) return { error: from.error };
    const to = readValue(rawTo, spec, toSpan);
    if ('error' in to) return { error: to.error };

    if (from.value > to.value) {
      // Some implementations wrap a reversed range and some reject it. Both
      // behaviours exist in the wild, so guessing would be the same mistake as
      // guessing a dialect.
      return {
        error: domainError('SYNTAX', `The range ${rawFrom}-${rawTo} runs backwards.`, {
          span: spanFor(offset, offset + baseText.length),
          hint: 'Some schedulers wrap a reversed range and others reject it, so SyntaxLab does not guess. Write it as two terms, for example `22-23,0-2`.',
        }),
      };
    }
    base = {
      kind: 'range',
      from: from.value,
      to: to.value,
      rawFrom,
      rawTo,
      span: spanFor(offset, offset + baseText.length),
    };
  } else {
    const single = readValue(baseText, spec, spanFor(offset, offset + baseText.length));
    if ('error' in single) return { error: single.error };
    base = {
      kind: 'value',
      value: single.value,
      raw: baseText,
      span: spanFor(offset, offset + baseText.length),
    };
  }
  return { base };
}

/** Where a step sits in the source, so its errors can point at the number. */
interface StepContext {
  readonly offset: number;
  readonly slash: number;
  readonly text: string;
  readonly whole: SourceSpan;
  readonly spanFor: SpanFor;
}

/** The `/n` suffix, validated against the forms the dialect allows. */
function parseStep(stepText: string, base: CronTerm, at: StepContext): TermOutcome {
  const { offset, slash, text, whole, spanFor } = at;
  const stepSpan = spanFor(offset + slash + 1, offset + text.length);
  if (!/^\d+$/.test(stepText)) {
    return {
      error: domainError(
        'SYNTAX',
        stepText === ''
          ? 'A step is missing its number.'
          : `"${truncateForMessage(stepText)}" is not a valid step.`,
        { span: stepSpan, hint: 'A step is a positive whole number, as in `*/15`.' },
      ),
    };
  }
  const step = Number.parseInt(stepText, 10);
  if (step === 0) {
    return {
      error: domainError('SYNTAX', 'A step of 0 would never advance.', {
        span: stepSpan,
        hint: 'Use a step of 1 or more.',
      }),
    };
  }

  return { term: { kind: 'step', base, step, span: whole } };
}

/* ------------------------------------------------------------------ *
 * Expansion
 * ------------------------------------------------------------------ */

/** Expands one term to the values it selects, within the field's range. */
function expand(term: CronTerm, spec: CronFieldSpec): number[] {
  switch (term.kind) {
    case 'all': {
      const values: number[] = [];
      for (let value = spec.min; value <= spec.max; value += 1) values.push(value);
      return values;
    }
    case 'value':
      return [term.value];
    case 'range': {
      const values: number[] = [];
      for (let value = term.from; value <= term.to; value += 1) values.push(value);
      return values;
    }
    case 'step': {
      const base = expand(term.base, spec);
      const start = base[0] ?? spec.min;
      // A step selects every nth value *from the start of the base range*,
      // which is what `*/15` and `1-10/2` both mean.
      return base.filter((value) => (value - start) % term.step === 0);
    }
  }
}

/**
 * Sunday is both 0 and 7. Normalising to 0 keeps the resolved set canonical
 * while `terms` still records which the user wrote (invariant C-I3).
 */
function normaliseDayOfWeek(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => (value === 7 ? 0 : value)))];
}

/* ------------------------------------------------------------------ *
 * Field parsing
 * ------------------------------------------------------------------ */

export function parseField(name: CronFieldName, field: RawField, source: string): CronField {
  const spec = CRON_FIELD_SPECS[name];
  const terms: CronTerm[] = [];
  let error: DomainError | undefined;

  // Split on commas, tracking each piece's offset so spans stay exact.
  const pieces = field.raw.split(',');
  if (pieces.length > LIMITS.cron.maxTermsPerField) {
    return {
      name,
      raw: field.raw,
      span: field.span,
      terms: [],
      resolved: [],
      isWildcard: false,
      error: domainError(
        'LIMIT_EXCEEDED',
        `The ${spec.label} field has ${String(pieces.length)} terms; the limit is ${String(LIMITS.cron.maxTermsPerField)}.`,
        {
          span: field.span,
          hint: 'A list this long is usually better written as a range or a step.',
        },
      ),
    };
  }

  let offset = field.span.start;
  for (const piece of pieces) {
    if (error === undefined) {
      const outcome = parseTerm(piece, offset, spec, source);
      if (outcome.error !== undefined) error = outcome.error;
      else if (outcome.term !== undefined) terms.push(outcome.term);
    }
    offset += piece.length + 1; // + 1 for the comma
  }

  if (error !== undefined) {
    return {
      name,
      raw: field.raw,
      span: field.span,
      terms,
      resolved: [],
      isWildcard: false,
      error,
    };
  }

  const collected = terms.flatMap((term) => expand(term, spec));
  const deduped = name === 'dayOfWeek' ? normaliseDayOfWeek(collected) : [...new Set(collected)];
  const resolved = deduped.sort((a, b) => a - b);

  // `*` and `*/1` both select everything, but only a literal `*` is what a
  // reader means by "every". Anything that resolves to the full range is
  // treated as a wildcard for the OR-rule check, which is about *restriction*.
  const isWildcard = resolved.length === spec.max - spec.min + (name === 'dayOfWeek' ? 0 : 1);

  return { name, raw: field.raw, span: field.span, terms, resolved, isWildcard };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export interface ParsedExpression {
  readonly tokens: readonly CronToken[];
  readonly fields: readonly CronField[];
  readonly errors: readonly DomainError[];
  readonly macro?: string;
  /** True for `@reboot`: recognised, but there is no schedule to describe. */
  readonly nonSchedulable: boolean;
}

/**
 * Parses a cron expression, or refuses.
 *
 * Returns `err` only when nothing useful can be produced at all — over the
 * length limit, or a field count that is not 5. A single bad field still
 * yields four explainable ones, the same recovery posture as the regex parser.
 */
export function parseCron(source: string): Result<ParsedExpression> {
  if (source.length > LIMITS.cron.input) {
    return err(
      domainError(
        'LIMIT_EXCEEDED',
        `A cron expression may be at most ${String(LIMITS.cron.input)} characters; this one is ${String(source.length)}.`,
        {
          hint: 'Cron expressions are five short fields. Check that the whole input is really one expression.',
        },
      ),
    );
  }

  const trimmed = source.trim();
  if (trimmed === '') {
    return err(
      domainError('SYNTAX', 'Enter a cron expression.', {
        hint: 'Five fields separated by spaces, for example `*/15 9-17 * * 1-5`.',
      }),
    );
  }

  const wholeSpan: SourceSpan = { start: 0, end: source.length, line: 1, column: 1 };

  // Macros first: they are the only form that is not five fields and is still
  // valid, so they are resolved before the count is checked.
  let effective = source;
  let macro: string | undefined;
  if (trimmed.startsWith('@')) {
    const lower = trimmed.toLowerCase();
    if (NON_SCHEDULABLE_MACROS.includes(lower)) {
      return ok({
        tokens: tokenize(source),
        fields: [],
        errors: [],
        macro: lower,
        nonSchedulable: true,
      });
    }
    const expansion = CRON_MACROS[lower];
    if (expansion === undefined) {
      return err(
        domainError(
          'SYNTAX',
          `"${truncateForMessage(trimmed)}" is not a macro SyntaxLab recognises.`,
          {
            span: wholeSpan,
            hint: `Supported macros are ${Object.keys(CRON_MACROS).join(', ')} and @reboot.`,
          },
        ),
      );
    }
    macro = lower;
    effective = expansion;
  }

  const tokens = tokenize(effective);
  const raw = splitFields(effective, tokens);

  if (raw.length !== CRON_FIELD_ORDER.length) {
    return err(refuseFieldCount(raw.length, wholeSpan));
  }

  // `raw.length` was checked against the field count above, so every index is
  // present — but the fallback is real rather than an assertion, because an
  // empty field is a thing the parser can describe and a crash is not.
  const empty: RawField = { raw: '', span: wholeSpan };
  const fields = CRON_FIELD_ORDER.map((name, index) =>
    parseField(name, raw[index] ?? empty, effective),
  );
  const errors = fields
    .map((field) => field.error)
    .filter((error): error is DomainError => error !== undefined);

  return ok({
    tokens: tokenize(source),
    fields,
    errors,
    ...(macro === undefined ? {} : { macro }),
    nonSchedulable: false,
  });
}
