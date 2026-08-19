import {
  code,
  emphasis,
  joinClauses,
  list,
  section,
  text,
  type Explanation,
  type ExplanationNode,
  type ExplanationSection,
} from '../shared/explanation';
import { assertNever, type DomainError } from '../shared/result';
import type { JsonNode, JsonNodeType } from './ast';
import type { JsonFindings } from './analyze';
import { unsafeNumberDetail } from './numbers';
import { formatPath } from './path';

/**
 * JSON explanation — 03_DOMAIN_MODEL.md §2.4, ADR-011
 *
 * Produces `ExplanationNode[]`, never a string of HTML or markdown. User keys
 * and values are quoted through `code()`, which the renderer emits as a text
 * node — so the highest-frequency operation in the product has no injection
 * sink to sanitise.
 *
 * The shape of the output is deliberately bounded. A JSON document can have
 * half a million nodes; explaining each one would be a wall of text nobody
 * reads, which is the failure mode R-04 describes. What a reader actually
 * wants is: what is this, how big is it, what is at the top level, and what
 * should I be worried about.
 */

export interface ExplainJsonInput {
  readonly root: JsonNode | null;
  readonly errors: readonly DomainError[];
  readonly findings: JsonFindings;
}

/** How many property or element names are listed before summarising. */
const NAME_LIMIT = 10;

export function explainJson(input: ExplainJsonInput): Explanation {
  const details: ExplanationSection[] = [];

  const structure = structureSection(input.root);
  if (structure) details.push(structure);

  const shape = shapeSection(input.root);
  if (shape) details.push(shape);

  details.push(...findingSections(input.findings));

  return { summary: summarise(input), details };
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

function summarise(input: ExplainJsonInput): ExplanationNode[] {
  const { root, errors, findings } = input;

  if (errors.length > 0) {
    const problems: ExplanationNode[] = [
      text(
        errors.length === 1
          ? 'This is not valid JSON. One problem was found: '
          : `This is not valid JSON. ${errors.length} problems were found, starting with: `,
      ),
      text(errors[0]?.message ?? ''),
    ];

    if (root) {
      // Recovery produced a partial tree, so say what survived rather than
      // leaving the reader with only the failure.
      problems.push(text(' The rest of the document was read as '), ...describe(root), text('.'));
    }
    return problems;
  }

  if (!root) return [text('There is nothing to read yet.')];

  const clauses: ExplanationNode[][] = [[text('This is '), ...describe(root)]];

  if (findings.stats.maxDepth > 2) {
    clauses.push([text('nested '), emphasis(`${findings.stats.maxDepth} levels`), text(' deep')]);
  }

  return [...joinClauses(clauses, 'and'), text('.')];
}

/** A noun phrase for a node: "an object with 3 properties". */
function describe(node: JsonNode): ExplanationNode[] {
  switch (node.type) {
    case 'object':
      return node.members.length === 0
        ? [text('an empty object')]
        : [
            text('an object with '),
            emphasis(countOf(node.members.length, 'property', 'properties')),
          ];
    case 'array':
      return node.elements.length === 0
        ? [text('an empty array')]
        : [
            text('an array of '),
            emphasis(countOf(node.elements.length, 'item', 'items')),
            ...elementKindPhrase(node.elements),
          ];
    case 'string':
      return [text('a single string, '), code(truncate(node.value))];
    case 'number':
      return [text('a single number, '), code(node.raw)];
    case 'boolean':
      return [text('a single boolean, '), code(String(node.value))];
    case 'null':
      return [text('the value '), code('null')];
    case 'error':
      return [text('a part that could not be read')];
    default:
      return assertNever(node, 'json node');
  }
}

/** "all objects" / "mixed values" — the thing a reader wants next about a list. */
function elementKindPhrase(elements: readonly JsonNode[]): ExplanationNode[] {
  const kinds = new Set(elements.map((element) => element.type));
  if (kinds.size !== 1) return [text(', of mixed types')];
  const only = [...kinds][0];
  return only === undefined ? [] : [text(', all '), text(pluralType(only))];
}

function countOf(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('en')} ${count === 1 ? singular : plural}`;
}

const TYPE_PLURALS: Readonly<Record<JsonNodeType, string>> = {
  object: 'objects',
  array: 'arrays',
  string: 'strings',
  number: 'numbers',
  boolean: 'booleans',
  null: 'nulls',
  error: 'unreadable',
};

function pluralType(type: JsonNodeType): string {
  return TYPE_PLURALS[type];
}

const TYPE_NAMES: Readonly<Record<JsonNodeType, string>> = {
  object: 'object',
  array: 'array',
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  null: 'null',
  error: 'unreadable',
};

export function typeName(type: JsonNodeType): string {
  return TYPE_NAMES[type];
}

/** Values are quoted in explanations; a 5 MB string is not. */
function truncate(value: string, max = 48): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

/** What is at the top level — the question a reader asks first. */
function shapeSection(root: JsonNode | null): ExplanationSection | null {
  if (root?.type === 'object' && root.members.length > 0) {
    const shown = root.members.slice(0, NAME_LIMIT);
    const items = shown.map((member) => [
      code(truncate(member.key, 32)),
      text(' — '),
      text(typeName(member.value.type)),
    ]);

    const body: ExplanationNode[] = [text('The top level holds these properties:'), list(items)];
    if (root.members.length > shown.length) {
      body.push(text(`…and ${root.members.length - shown.length} more.`));
    }
    return section('json-shape', 'Top-level properties', body, { span: root.span });
  }

  if (root?.type === 'array' && root.elements.length > 0) {
    const counts = new Map<JsonNodeType, number>();
    for (const element of root.elements) {
      counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
    }
    const items = [...counts].map(([type, count]) => [
      text(countOf(count, typeName(type), pluralType(type))),
    ]);
    return section('json-shape', 'What the array holds', [text('At the top level:'), list(items)], {
      span: root.span,
    });
  }

  return null;
}

/** Size, in the terms a developer checks: how many, how deep, how big. */
function structureSection(root: JsonNode | null): ExplanationSection | null {
  if (!root) return null;
  return section(
    'json-structure',
    'Structure',
    [text('The document is '), ...describe(root), text('.')],
    { span: root.span },
  );
}

function findingSections(findings: JsonFindings): ExplanationSection[] {
  const sections: ExplanationSection[] = [];

  if (findings.duplicateKeys.length > 0) sections.push(duplicateSection(findings));
  if (findings.unsafeNumbers.length > 0) sections.push(unsafeNumberSection(findings));
  if (findings.riskyKeys.length > 0) sections.push(riskyKeySection(findings));

  return sections;
}

function duplicateSection(findings: JsonFindings): ExplanationSection {
  const items = findings.duplicateKeys
    .slice(0, NAME_LIMIT)
    .map((report) => [
      code(truncate(report.key, 32)),
      text(` appears ${report.occurrences.length} times in `),
      code(formatPath(report.path)),
    ]);

  return section(
    'json-duplicates',
    'Duplicate keys',
    [
      text(
        'Some keys appear more than once. JSON does not forbid this, but nothing agrees on what it means: ',
      ),
      emphasis('JavaScript keeps the last one'),
      text(', some parsers keep the first, and some reject the document outright.'),
      list(items),
    ],
    { severity: 'warning' },
  );
}

function unsafeNumberSection(findings: JsonFindings): ExplanationSection {
  const items = findings.unsafeNumbers
    .slice(0, NAME_LIMIT)
    .map((report) => [
      code(report.raw),
      text(' at '),
      code(formatPath(report.path)),
      text(' — reads back as '),
      code(String(report.parsed)),
      text('. '),
      text(unsafeNumberDetail(report.reason)),
    ]);

  return section(
    'json-numbers',
    'Numbers that change when read',
    [
      text(
        'JavaScript stores every JSON number as a 64-bit float. These do not survive that intact:',
      ),
      list(items),
      text('If these are identifiers, keep them as strings.'),
    ],
    { severity: 'warning' },
  );
}

function riskyKeySection(findings: JsonFindings): ExplanationSection {
  const items = findings.riskyKeys
    .slice(0, NAME_LIMIT)
    .map((report) => [
      code(report.key),
      text(' in '),
      code(report.path),
      text(
        report.severity === 'dropped'
          ? ' — kept in the tree, and removed if this document is converted to a JavaScript object.'
          : ' — kept, but some libraries treat this name specially.',
      ),
    ]);

  return section(
    'json-keys',
    'Keys JavaScript treats specially',
    [
      text('This document contains keys that collide with JavaScript internals:'),
      list(items),
      text(
        'SyntaxLab reads objects as an ordered list of key/value pairs rather than as JavaScript objects, so these are ordinary data here. They are worth knowing about because other tools may not do the same.',
      ),
    ],
    { severity: 'warning' },
  );
}
