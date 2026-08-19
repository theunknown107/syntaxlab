import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeJson } from '@/domain/json/analyze';

/**
 * JSONTestSuite conformance — acceptance criterion J-2
 *
 * The published RFC 8259 conformance corpus by Nicolas Seriot, vendored under
 * `tests/fixtures/jsontestsuite/` with its MIT licence. Vendored rather than
 * fetched so the result is reproducible offline and in CI, and so the exact
 * bytes under test are auditable in the repository.
 *
 * The corpus names its own expectations:
 *
 *   `y_*`  must be accepted
 *   `n_*`  must be rejected
 *   `i_*`  implementation-defined — either outcome is conforming, and the
 *          outcome must be *stated* rather than left implicit
 *
 * **What is under test is decoded text, not bytes.** SyntaxLab's parser takes
 * a JavaScript string, because that is what it receives from an editor, a
 * paste, or a file read — decoding happened before it. The harness therefore
 * decodes each file with `TextDecoder('utf-8')`, exactly as a browser would,
 * and runs the oracle on the same decoded string. That makes every divergence
 * attributable to the parser rather than to a decoding choice, and it is why
 * the byte-level UTF-8 cases below land where they do: by the time any
 * JavaScript JSON parser sees the text, an invalid sequence is already U+FFFD.
 */

const DIR = join(process.cwd(), 'tests/fixtures/jsontestsuite');

function decode(bytes: Buffer): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function read(name: string): string {
  return decode(readFileSync(join(DIR, name)));
}

function weAccept(text: string): boolean {
  const result = analyzeJson(text);
  return result.ok && result.value.valid;
}

function platformAccepts(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .sort();

const cases = {
  y: files.filter((name) => name.startsWith('y_')),
  n: files.filter((name) => name.startsWith('n_')),
  i: files.filter((name) => name.startsWith('i_')),
};

describe('JSONTestSuite — the corpus is present and complete', () => {
  it('has the published file counts', () => {
    // A silently truncated fixture directory would turn this whole file into
    // a green test that proves nothing.
    expect(cases.y).toHaveLength(95);
    expect(cases.n).toHaveLength(188);
    expect(cases.i).toHaveLength(35);
    expect(files).toHaveLength(318);
  });
});

describe('JSONTestSuite — y_ must be accepted', () => {
  it.each(cases.y)('%s', (name) => {
    expect(weAccept(read(name))).toBe(true);
  });
});

describe('JSONTestSuite — n_ must be rejected', () => {
  it.each(cases.n)('%s', (name) => {
    expect(weAccept(read(name))).toBe(false);
  });
});

/**
 * The implementation-defined cases, recorded explicitly.
 *
 * Every one of these is `accept`, `reject`, and in every case SyntaxLab agrees
 * with `JSON.parse` on the same decoded text — asserted below, so the
 * classification cannot drift without failing.
 *
 * The three rejections are all documents that are not UTF-8 at all: UTF-16
 * with or without a BOM. Decoded as UTF-8 they become mojibake, which is not
 * JSON. Accepting them would mean guessing an encoding, which no JSON parser
 * in a browser does.
 *
 * The acceptances fall into three groups:
 *
 *   **Numbers beyond a double** (`1e999`, `-1e999`, `1e-999`, huge integers) —
 *   accepted, and then *reported* by our unsafe-number analysis as OVERFLOW or
 *   PRECISION_LOSS. Rejecting them would contradict RFC 8259, which places no
 *   limit on a number's magnitude; saying nothing would be the silent
 *   corruption `03_DOMAIN_MODEL.md` §4.3 exists to prevent. Accept and warn is
 *   the only honest option.
 *
 *   **Lone and inverted surrogates** written as `\uD800` escapes — accepted and
 *   preserved exactly (J-I5). They are valid UTF-16 code units and a JavaScript
 *   string can hold them; replacing them would corrupt data the user gave us.
 *
 *   **Invalid UTF-8 byte sequences** — accepted, because they are no longer
 *   invalid by the time we see them. `TextDecoder` has already substituted
 *   U+FFFD, which is an ordinary character. This is a property of reading
 *   bytes as text, not a parser decision, and the oracle behaves identically.
 */
const IMPLEMENTATION_DEFINED: Readonly<Record<string, 'accept' | 'reject'>> = {
  // Numbers outside the range of a double — accepted, then reported.
  'i_number_double_huge_neg_exp.json': 'accept',
  'i_number_huge_exp.json': 'accept',
  'i_number_neg_int_huge_exp.json': 'accept',
  'i_number_pos_double_huge_exp.json': 'accept',
  'i_number_real_neg_overflow.json': 'accept',
  'i_number_real_pos_overflow.json': 'accept',
  'i_number_real_underflow.json': 'accept',
  'i_number_too_big_neg_int.json': 'accept',
  'i_number_too_big_pos_int.json': 'accept',
  'i_number_very_big_negative_int.json': 'accept',

  // Lone, inverted and incomplete surrogates — accepted and preserved.
  'i_object_key_lone_2nd_surrogate.json': 'accept',
  'i_string_1st_surrogate_but_2nd_missing.json': 'accept',
  'i_string_1st_valid_surrogate_2nd_invalid.json': 'accept',
  'i_string_UTF8_surrogate_U+D800.json': 'accept',
  'i_string_incomplete_surrogate_and_escape_valid.json': 'accept',
  'i_string_incomplete_surrogate_pair.json': 'accept',
  'i_string_incomplete_surrogates_escape_valid.json': 'accept',
  'i_string_invalid_lonely_surrogate.json': 'accept',
  'i_string_invalid_surrogate.json': 'accept',
  'i_string_inverted_surrogates_U+1D11E.json': 'accept',
  'i_string_lone_second_surrogate.json': 'accept',

  // Invalid UTF-8 byte sequences — already U+FFFD by the time we see text.
  'i_string_UTF-8_invalid_sequence.json': 'accept',
  'i_string_invalid_utf-8.json': 'accept',
  'i_string_iso_latin_1.json': 'accept',
  'i_string_lone_utf8_continuation_byte.json': 'accept',
  'i_string_not_in_unicode_range.json': 'accept',
  'i_string_overlong_sequence_2_bytes.json': 'accept',
  'i_string_overlong_sequence_6_bytes.json': 'accept',
  'i_string_overlong_sequence_6_bytes_null.json': 'accept',
  'i_string_truncated-utf-8.json': 'accept',

  // Not UTF-8 documents at all. Decoded as UTF-8 they are mojibake.
  'i_string_UTF-16LE_with_BOM.json': 'reject',
  'i_string_utf16BE_no_BOM.json': 'reject',
  'i_string_utf16LE_no_BOM.json': 'reject',

  // A UTF-8 BOM is stripped by `TextDecoder`, so the parser never sees it.
  // Our own BOM error still fires for a U+FEFF that survives decoding, such
  // as one pasted into the editor — covered in `golden.test.ts`.
  'i_structure_UTF-8_BOM_empty_object.json': 'accept',

  // Exactly at the documented 500-level nesting cap, so it parses.
  'i_structure_500_nested_arrays.json': 'accept',
};

describe('JSONTestSuite — i_ outcomes are documented, not incidental', () => {
  it('classifies every implementation-defined case', () => {
    expect(Object.keys(IMPLEMENTATION_DEFINED).sort()).toEqual(cases.i);
  });

  it.each(cases.i)('%s', (name) => {
    const expected = IMPLEMENTATION_DEFINED[name];
    expect(expected).toBeDefined();
    expect(weAccept(read(name))).toBe(expected === 'accept');
  });
});

describe('JSONTestSuite — every verdict matches the platform', () => {
  it.each(files)('%s', (name) => {
    // Across all 318 files, including the implementation-defined ones. Any
    // divergence would be ours to justify; there are none.
    const text = read(name);
    expect(weAccept(text)).toBe(platformAccepts(text));
  });
});

describe('JSONTestSuite — the accepted extremes are still reported', () => {
  it('warns about numbers that overflow a double rather than accepting them silently', () => {
    const result = analyzeJson(read('i_number_huge_exp.json'));
    if (!result.ok) throw new Error('expected success');
    expect(result.value.unsafeNumbers.map((report) => report.reason)).toContain('OVERFLOW');
  });

  it('does not warn about a 21-digit integer that a double happens to hold exactly', () => {
    // `100000000000000000000` is 1e20, which is exactly representable. A
    // digit-count heuristic would flag it; the exact comparison does not.
    const result = analyzeJson(read('i_number_too_big_pos_int.json'));
    if (!result.ok) throw new Error('expected success');
    expect(result.value.unsafeNumbers).toEqual([]);
  });

  it('warns about an integer that genuinely loses digits', () => {
    const result = analyzeJson('[123456789012345678901234567890]');
    if (!result.ok) throw new Error('expected success');
    expect(result.value.unsafeNumbers[0]?.reason).toBe('PRECISION_LOSS');
  });

  it('preserves a lone surrogate rather than replacing it', () => {
    const result = analyzeJson(read('i_string_invalid_lonely_surrogate.json'));
    if (!result.ok) throw new Error('expected success');
    const root = result.value.cst;
    if (root?.type !== 'array') throw new Error('expected an array');
    const value = root.elements[0];
    if (value?.type !== 'string') throw new Error('expected a string');
    // The code unit survives intact rather than becoming U+FFFD (J-I5).
    expect(value.value).toHaveLength(1);
    expect(value.value.charCodeAt(0)).toBe(0xd800);
  });

  it('parses exactly at the nesting cap without a limit error', () => {
    const result = analyzeJson(read('i_structure_500_nested_arrays.json'));
    if (!result.ok) throw new Error('expected success');
    expect(result.value.errors).toEqual([]);
    expect(result.value.stats.maxDepth).toBe(500);
  });
});
