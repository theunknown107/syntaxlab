import { code, emphasis, ref, text } from '../shared/explanation';
import type { Explanation, ExplanationNode, ExplanationSection } from '../shared/explanation';
import {
  CRON_FIELD_SPECS,
  type CronField,
  type CronFieldName,
  type CronTerm,
  type CronTimezoneContext,
} from './ast';

/**
 * Cron explanation — 04_PARSER_ARCHITECTURE.md §5
 *
 * Pure functions producing `ExplanationNode[]`. No HTML, no Markdown strings,
 * and **no sentence built by concatenating user text**: anything the user
 * typed goes in a `code` or `ref` node, which the renderer escapes.
 *
 * The dispatch on `CronTerm['kind']` is exhaustive and TypeScript checks it,
 * so adding a term type causes a compile error here rather than shipping a
 * silently unexplained construct.
 */

const ORDINAL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Renders one value the way a reader of that field would say it. */
function valueWord(name: CronFieldName, value: number): string {
  if (name === 'month') return ORDINAL_MONTHS[value - 1] ?? String(value);
  if (name === 'dayOfWeek') return WEEKDAYS[value === 7 ? 0 : value] ?? String(value);
  return String(value);
}

/** Joins a list the way English does, with an Oxford-free "and". */
function joinWords(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0] ?? ''} and ${items[1] ?? ''}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/* ------------------------------------------------------------------ *
 * Terms
 * ------------------------------------------------------------------ */

function explainTerm(term: CronTerm, name: CronFieldName): ExplanationNode[] {
  const spec = CRON_FIELD_SPECS[name];
  switch (term.kind) {
    case 'all':
      return [text(`every ${spec.label}`)];
    case 'value':
      return [text(`${spec.label} `), code(valueWord(name, term.value))];
    case 'range':
      return [
        text(`${spec.label} `),
        code(valueWord(name, term.from)),
        text(' through '),
        code(valueWord(name, term.to)),
      ];
    case 'step': {
      const every =
        term.step === 1 ? 'every' : term.step === 2 ? 'every other' : `every ${String(term.step)}`;
      if (term.base.kind === 'all') {
        return [text(`${every} ${spec.label}`)];
      }
      if (term.base.kind === 'range') {
        return [
          text(`${every} ${spec.label}, from `),
          code(valueWord(name, term.base.from)),
          text(' through '),
          code(valueWord(name, term.base.to)),
        ];
      }
      return [
        text(`${every} ${spec.label}, starting at `),
        code(valueWord(name, term.base.kind === 'value' ? term.base.value : spec.min)),
      ];
    }
  }
}

/* ------------------------------------------------------------------ *
 * Fields
 * ------------------------------------------------------------------ */

/**
 * The resolved set, when it is worth reading.
 *
 * Below two values the terms already said it; above twelve the list is longer
 * than the sentence it is meant to clarify, so only the count is given.
 */
function describeResolved(field: CronField): ExplanationNode[] {
  if (field.resolved.length > 12) {
    return [text(` Selects ${String(field.resolved.length)} values.`)];
  }
  if (field.resolved.length > 1) {
    return [
      text(' Selects '),
      code(field.resolved.map((value) => valueWord(field.name, value)).join(', ')),
      text('.'),
    ];
  }
  return [];
}

function explainField(field: CronField): ExplanationSection {
  const spec = CRON_FIELD_SPECS[field.name];

  if (field.error !== undefined) {
    return {
      id: `cron-${field.name}`,
      title: spec.label,
      span: field.span,
      severity: 'error',
      body: [ref(field.raw, field.span), text(' — '), text(field.error.message)],
    };
  }

  const body: ExplanationNode[] = [ref(field.raw, field.span), text(' — ')];

  if (field.isWildcard && field.terms.length === 1 && field.terms[0]?.kind === 'all') {
    body.push(text(`every ${spec.label}. The field places no restriction.`));
  } else {
    const parts = field.terms.map((term) => explainTerm(term, field.name));
    parts.forEach((part, index) => {
      if (index > 0) body.push(text(index === parts.length - 1 ? ', and ' : ', '));
      body.push(...part);
    });
    body.push(text('.'));

    body.push(...describeResolved(field));
  }

  if (field.name === 'dayOfWeek' && field.raw.includes('7')) {
    body.push(
      text(' In this dialect '),
      code('0'),
      text(' and '),
      code('7'),
      text(' both mean Sunday.'),
    );
  }

  return { id: `cron-${field.name}`, title: spec.label, span: field.span, body };
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

/** The one-line reading: "Runs every 15 minutes, on weekdays." */
function summarise(fields: readonly CronField[]): ExplanationNode[] {
  const by = (name: CronFieldName): CronField | undefined =>
    fields.find((field) => field.name === name);

  const minute = by('minute');
  const hour = by('hour');
  const dayOfMonth = by('dayOfMonth');
  const month = by('month');
  const dayOfWeek = by('dayOfWeek');

  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return [text('This expression could not be read.')];
  }
  if (fields.some((field) => field.error !== undefined)) {
    return [
      text(
        'This expression has an error, so it does not describe a schedule yet. The fields that do parse are explained below.',
      ),
    ];
  }

  return [
    text('Runs '),
    ...describeTime(minute, hour),
    ...describeDays(dayOfMonth, dayOfWeek),
    ...describeMonths(month),
    text('.'),
  ];
}

/** A fixed time of day, when both fields select exactly one value. */
function exactTime(minute: CronField, hour: CronField): ExplanationNode[] | null {
  if (minute.resolved.length !== 1 || hour.resolved.length !== 1) return null;
  const h = String(hour.resolved[0] ?? 0).padStart(2, '0');
  const m = String(minute.resolved[0] ?? 0).padStart(2, '0');
  return [text('at '), emphasis(`${h}:${m}`)];
}

/** A repeating minute, which is the shape most schedules take. */
function repeatingMinute(minute: CronField, hour: CronField): ExplanationNode[] | null {
  const only = minute.terms.length === 1 ? minute.terms[0] : undefined;
  if (only?.kind !== 'step' || only.base.kind !== 'all' || !hour.isWildcard) return null;
  return [emphasis(`every ${String(only.step)} minutes`)];
}

/** "every minute", "every 15 minutes", "at 09:30" — the time-of-day clause. */
function describeTime(minute: CronField, hour: CronField): ExplanationNode[] {
  if (minute.isWildcard && hour.isWildcard) return [emphasis('every minute')];

  const repeating = repeatingMinute(minute, hour);
  if (repeating !== null) return repeating;

  const exact = exactTime(minute, hour);
  if (exact !== null) return exact;

  if (minute.resolved.length === 1) {
    return [
      text('at '),
      code(`:${String(minute.resolved[0] ?? 0).padStart(2, '0')}`),
      text(' past '),
      hour.isWildcard
        ? text('every hour')
        : text(`${String(hour.resolved.length)} hours of the day`),
    ];
  }

  return [
    text(`${String(minute.resolved.length)} times an hour`),
    hour.isWildcard ? text('') : text(`, during ${String(hour.resolved.length)} hours of the day`),
  ];
}

/**
 * The day clause, and the place the OR rule is spelled out in words.
 *
 * When both day fields are restricted the reading is "either", and saying so
 * in the summary — not only in a warning — is the single most useful sentence
 * this feature produces.
 */
function describeDays(dayOfMonth: CronField, dayOfWeek: CronField): ExplanationNode[] {
  const parts: string[] = [];
  if (!dayOfWeek.isWildcard) {
    parts.push(
      `on ${joinWords(dayOfWeek.resolved.map((value) => WEEKDAYS[value] ?? String(value)))}`,
    );
  }
  if (!dayOfMonth.isWildcard) {
    parts.push(`on day ${joinWords(dayOfMonth.resolved.map(String))} of the month`);
  }

  if (parts.length === 2) {
    return [
      text(', '),
      text(parts[0] ?? ''),
      text(' or '),
      text(parts[1] ?? ''),
      text(' — '),
      emphasis('either, not both'),
    ];
  }
  if (parts.length === 1) return [text(', '), text(parts[0] ?? '')];
  return [];
}

function describeMonths(month: CronField): ExplanationNode[] {
  if (month.isWildcard) return [];
  return [
    text(', in '),
    text(joinWords(month.resolved.map((value) => ORDINAL_MONTHS[value - 1] ?? String(value)))),
  ];
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export interface ExplainInput {
  readonly fields: readonly CronField[];
  readonly timezone: CronTimezoneContext;
  readonly macro?: string;
  readonly nonSchedulable: boolean;
}

export function explainCron(input: ExplainInput): Explanation {
  const { fields, timezone, macro } = input;

  if (input.nonSchedulable) {
    return {
      summary: [
        code('@reboot'),
        text(' runs once when the scheduler starts, rather than on a clock.'),
      ],
      details: [
        {
          id: 'cron-reboot',
          title: 'Not a clock schedule',
          severity: 'warning',
          body: [
            text(
              'There is no next run time to compute: it depends entirely on when the machine or service restarts. Support for ',
            ),
            code('@reboot'),
            text(
              ' also varies between schedulers — some run it on every daemon reload, not only at boot.',
            ),
          ],
        },
      ],
    };
  }

  const details: ExplanationSection[] = [];

  if (macro !== undefined) {
    details.push({
      id: 'cron-macro',
      title: 'Macro',
      body: [code(macro), text(' is shorthand. It is explained below as its 5-field equivalent.')],
    });
  }

  details.push(...fields.map(explainField));

  details.push({
    id: 'cron-timezone',
    title: 'Timezone',
    body:
      timezone.mode === 'utc'
        ? [
            text('Times are read as '),
            emphasis('UTC'),
            text(
              '. UTC has no daylight-saving transitions, which makes it the easier mode to check a scheduler against.',
            ),
          ]
        : [
            text("Times are read in your browser's timezone, "),
            code(timezone.ianaZone),
            text(
              '. If your scheduler runs somewhere else, these times will not match it. This zone observes daylight-saving changes.',
            ),
          ],
  });

  return { summary: summarise(fields), details };
}
