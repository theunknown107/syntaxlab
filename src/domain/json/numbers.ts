import type { UnsafeNumberReason } from './ast';

/**
 * Number faithfulness — 03_DOMAIN_MODEL.md §4.3
 *
 * JSON numbers are arbitrary-precision decimals on paper. JavaScript numbers
 * are IEEE-754 doubles. The product therefore keeps the raw text *and* the
 * double, and this module answers the one question that matters: **would a
 * reader of the parsed value be misled about what the document said?**
 *
 * `{"id": 9007199254740993}` becomes `9007199254740992` in every JavaScript
 * JSON parser. Silently corrupted identifiers are a real production bug, and
 * the raw text is the only place the evidence survives.
 *
 * What this deliberately does *not* flag: `0.1`, which is not exactly
 * representable in binary but round-trips through the double back to `0.1`,
 * and `1e5`, which is a formatting difference rather than a loss. Flagging
 * either would produce a warning on almost every document and teach users to
 * ignore the one that matters.
 *
 * The comparison is exact, not a digit-count heuristic: both the source text
 * and the double's own shortest representation are reduced to a normalised
 * `digits × 10^exponent` form and compared.
 */

interface Decimal {
  readonly negative: boolean;
  /** Significant digits, no leading or trailing zeros. Empty means zero. */
  readonly digits: string;
  /** Power of ten applied to the digits. */
  readonly exponent: number;
}

/** Splits a JSON/JavaScript decimal literal into a normalised form. */
export function decimalParts(text: string): Decimal | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (!match) return null;

  const [, sign = '', whole = '', fraction = '', exponentText] = match;
  if (whole === '' && fraction === '') return null;

  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  if (!Number.isFinite(exponent)) return null;

  // Fold the fraction into the digit string, moving the exponent to match.
  let digits = whole + fraction;
  let scale = exponent - fraction.length;

  // Normalise: strip leading zeros, then trailing zeros (raising the scale).
  digits = digits.replace(/^0+/, '');
  const trailing = /0+$/.exec(digits);
  if (trailing) {
    digits = digits.slice(0, digits.length - trailing[0].length);
    scale += trailing[0].length;
  }

  if (digits === '') return { negative: false, digits: '', exponent: 0 };
  return { negative: sign === '-', digits, exponent: scale };
}

function sameDecimal(a: Decimal | null, b: Decimal | null): boolean {
  if (!a || !b) return false;
  if (a.digits === '' && b.digits === '') return true;
  return a.negative === b.negative && a.digits === b.digits && a.exponent === b.exponent;
}

/**
 * Why this number cannot be trusted to mean what it says, or `null` when it
 * can.
 */
export function unsafeNumberReason(raw: string, value: number): UnsafeNumberReason | null {
  if (!Number.isFinite(value)) return 'OVERFLOW';

  if (value === 0) {
    // `-0` is a real IEEE-754 value that compares equal to `0` and serialises
    // as `0`. Worth naming, because a round trip loses the sign.
    return Object.is(value, -0) ? 'NEGATIVE_ZERO' : null;
  }

  // `String(value)` is the double's shortest round-tripping representation.
  // If the source text denotes a different number, the double is not what the
  // document said.
  return sameDecimal(decimalParts(raw), decimalParts(String(value))) ? null : 'PRECISION_LOSS';
}

/** A short, plain explanation of the consequence, for the UI. */
export function unsafeNumberDetail(reason: UnsafeNumberReason): string {
  switch (reason) {
    case 'PRECISION_LOSS':
      return 'JavaScript stores this as a 64-bit float, which cannot hold every digit. Reading it back gives a different number.';
    case 'OVERFLOW':
      return 'This is larger than JavaScript can represent, so it becomes Infinity.';
    case 'NEGATIVE_ZERO':
      return 'Negative zero compares equal to zero and is written back as `0`, so the sign is lost.';
  }
}
