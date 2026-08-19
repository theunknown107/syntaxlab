import type { JsonNode } from './ast';

/**
 * CST → plain JavaScript value — 03_DOMAIN_MODEL.md §4.2
 *
 * The CST is the representation everything in the product uses, precisely so
 * that user keys never become real object keys. This function exists for the
 * few places that genuinely need a plain value later (a future TypeScript
 * interface generator, and anything handed to `structuredClone` for storage),
 * and it is the one place where the pollution risk has to be handled by code
 * rather than by the shape of the data.
 *
 * Three rules, all load-bearing:
 *
 *   1. **`Object.create(null)`**, so the result inherits nothing. A plain
 *      `{}` carries `Object.prototype`, which is what makes `__proto__` a
 *      setter rather than an ordinary key.
 *   2. **`defineProperty`, never assignment.** Assignment consults setters on
 *      the prototype chain; `defineProperty` creates an own data property and
 *      cannot be intercepted.
 *   3. **`__proto__` is dropped**, and reported rather than silently lost.
 *      Rules 1 and 2 already make the write itself safe here, but the value
 *      does not stay here: the moment a caller does `Object.assign(target,
 *      value)` — which *does* use assignment — a retained `__proto__` becomes
 *      a pollution vector in code this module cannot see. Dropping it at the
 *      boundary is what makes the guarantee survive its consumers.
 *
 * This is a strong structural defence, not a proof. It removes the vector this
 * conversion creates; it says nothing about code elsewhere that builds objects
 * some other way.
 */

/** Keys JavaScript treats specially when they become real object keys. */
export const RISKY_KEYS: ReadonlySet<string> = new Set(['__proto__']);

/**
 * Keys that are not dangerous *here* but are worth telling the user about,
 * because they collide with names some tools and frameworks treat specially.
 * They are kept in the output — they are ordinary data on a null-prototype
 * object — and merely reported.
 */
export const NOTABLE_KEYS: ReadonlySet<string> = new Set(['constructor', 'prototype']);

export type PlainValue =
  string | number | boolean | null | readonly PlainValue[] | { readonly [key: string]: PlainValue };

export interface PlainResult {
  readonly value: PlainValue;
  /** Keys that were dropped, so a caller can say so rather than lose them. */
  readonly droppedKeys: readonly string[];
}

export function toPlainValue(node: JsonNode): PlainResult {
  const dropped: string[] = [];
  return { value: convert(node, dropped), droppedKeys: dropped };
}

function convert(node: JsonNode, dropped: string[]): PlainValue {
  switch (node.type) {
    case 'string':
      return node.value;
    case 'number':
      return node.value;
    case 'boolean':
      return node.value;
    case 'null':
      return null;
    case 'array':
      return node.elements.map((element) => convert(element, dropped));
    case 'object':
      return convertObject(node.members, dropped);
    case 'error':
      // A recovery placeholder has no value. `null` is the honest stand-in;
      // the errors list is where the user learns what actually happened.
      return null;
  }
}

function convertObject(
  members: readonly { key: string; value: JsonNode }[],
  dropped: string[],
): PlainValue {
  // No prototype: nothing is inherited, so no key can reach a setter.
  const target = Object.create(null) as Record<string, PlainValue>;

  for (const member of members) {
    if (RISKY_KEYS.has(member.key)) {
      dropped.push(member.key);
      continue;
    }
    // Duplicate keys collapse here, last one winning — the same rule
    // `JSON.parse` follows. Every occurrence is still reported separately by
    // the analysis, so nothing is hidden; this value is simply one of the
    // two things a duplicate can mean.
    Object.defineProperty(target, member.key, {
      value: convert(member.value, dropped),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  return target;
}
