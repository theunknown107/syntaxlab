import { LIMITS } from '../shared/limits';
import {
  CURRENT_SCHEMA_VERSION,
  KNOWN_TYPES,
  type HistoryEntry,
  type HistoryMetadata,
  type HistoryType,
} from './entry';

/**
 * Validate-on-read — 03_DOMAIN_MODEL.md H-I7, 06_DATA_STORAGE.md §7
 *
 * **Persisted data is untrusted input.** It can be edited by hand through
 * devtools, left behind by an older build, written by a newer one, or simply
 * corrupted. A record is therefore never cast into the model; it is checked,
 * migrated, and *reconstructed field by field*, so no unknown key survives the
 * journey from disk into application state.
 *
 * Three outcomes, and the difference between them matters:
 *
 *   `ok`      — usable, after migration if it was older
 *   `future`  — kept and hidden, because it came from a newer build. Old code
 *               destroying newer data is how a user loses everything by
 *               opening a stale tab (§7.3).
 *   `invalid` — quarantined: moved aside and reported, never shown and never
 *               silently deleted.
 */

export type ReadOutcome =
  | { readonly kind: 'ok'; readonly entry: HistoryEntry }
  | { readonly kind: 'future'; readonly id: string | null }
  | { readonly kind: 'invalid'; readonly reason: string; readonly id: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  // Finite, integral, non-negative, and not absurdly far in the future. A
  // NaN or Infinity timestamp sorts unpredictably and would corrupt the list
  // order rather than merely looking odd.
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 4_102_444_800_000 // 2100-01-01
  );
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isKnownType(value: unknown): value is HistoryType {
  return typeof value === 'string' && (KNOWN_TYPES as readonly string[]).includes(value);
}

/**
 * Record-level migrations, applied lazily on read.
 *
 * Pure, idempotent and total: a migration that throws on one record
 * quarantines that record and continues; it never aborts a read of the rest
 * (06_DATA_STORAGE.md §7.2).
 */
const RECORD_MIGRATIONS: Readonly<
  Record<number, (record: Record<string, unknown>) => Record<string, unknown>>
> = {
  // Version 1 is the original shape, so there is nothing to do. The entry
  // exists so the table is never empty and version 2 has an obvious home.
  1: (record) => record,
};

function migrate(record: Record<string, unknown>): Record<string, unknown> | string {
  const version = record.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return 'schemaVersion is missing or not a positive integer';
  }

  let migrated = record;
  for (let from = version; from < CURRENT_SCHEMA_VERSION; from += 1) {
    const step = RECORD_MIGRATIONS[from + 1];
    if (!step) return `no migration from schema version ${from}`;
    try {
      migrated = step(migrated);
    } catch {
      return `migration from schema version ${from} failed`;
    }
  }
  return migrated;
}

function readMetadata(value: unknown, type: HistoryType): HistoryMetadata | string {
  if (!isRecord(value)) return 'metadata is not an object';
  if (value.type !== type) return 'metadata type does not match the entry type';

  if (type === 'regex') {
    if (typeof value.flags !== 'string') return 'regex metadata has no flags';
    if (!isCount(value.groupCount) || !isCount(value.nodeCount)) {
      return 'regex metadata has invalid counts';
    }
    if (typeof value.hadErrors !== 'boolean') return 'regex metadata has no hadErrors';
    // Rebuilt rather than passed through, so nothing extra survives.
    return {
      type: 'regex',
      flags: value.flags,
      groupCount: value.groupCount,
      hadErrors: value.hadErrors,
      nodeCount: value.nodeCount,
    };
  }

  if (typeof value.valid !== 'boolean') return 'json metadata has no valid flag';
  if (!isCount(value.nodeCount) || !isCount(value.maxDepth) || !isCount(value.byteLength)) {
    return 'json metadata has invalid counts';
  }
  return {
    type: 'json',
    valid: value.valid,
    nodeCount: value.nodeCount,
    maxDepth: value.maxDepth,
    byteLength: value.byteLength,
  };
}

function readTags(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  // Bounded and filtered: a tag array is user data and could be anything.
  return value.filter((tag): tag is string => typeof tag === 'string').slice(0, 20);
}

/**
 * Turns one stored record into an entry, or explains why it cannot.
 *
 * The reconstruction is explicit for the same reason the JSON CST is an array
 * of pairs: a spread would carry whatever the record happened to contain,
 * including keys chosen by whoever edited the database.
 */
export function readEntry(value: unknown): ReadOutcome {
  if (!isRecord(value)) return { kind: 'invalid', reason: 'record is not an object', id: null };

  const id = typeof value.id === 'string' ? value.id : null;

  // Integer, deliberately: a fractional or NaN version is corruption, not data
  // from a newer build, and must not be preserved as though a future release
  // would understand it.
  const version = value.schemaVersion;
  if (
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version > CURRENT_SCHEMA_VERSION
  ) {
    return { kind: 'future', id };
  }

  // A type this build does not know is treated as future data rather than as
  // corruption: `cron` arrives in V1.1, and a V1.1 export opened here must
  // survive being read by V1.0.
  if (typeof value.type === 'string' && !isKnownType(value.type)) {
    return { kind: 'future', id };
  }

  const migrated = migrate(value);
  if (typeof migrated === 'string') return { kind: 'invalid', reason: migrated, id };

  const invalid = (reason: string): ReadOutcome => ({ kind: 'invalid', reason, id });

  if (id === null || id === '') return invalid('id is missing');
  if (!isKnownType(migrated.type)) return invalid('type is not recognised');
  if (typeof migrated.title !== 'string' || migrated.title === '') return invalid('title is empty');
  if (typeof migrated.input !== 'string') return invalid('input is not a string');
  if (migrated.input.length > LIMITS.history.maxInputChars) {
    return invalid('input exceeds the stored limit');
  }
  if (!isTimestamp(migrated.createdAt) || !isTimestamp(migrated.lastOpenedAt)) {
    return invalid('timestamps are invalid');
  }
  if (migrated.createdAt > migrated.lastOpenedAt) {
    return invalid('createdAt is later than lastOpenedAt');
  }
  if (!isCount(migrated.openCount)) return invalid('openCount is invalid');

  const metadata = readMetadata(migrated.metadata, migrated.type);
  if (typeof metadata === 'string') return invalid(metadata);

  const title = migrated.title;
  const input = migrated.input;

  return {
    kind: 'ok',
    entry: {
      id,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      type: migrated.type,
      title,
      isCustomTitle: migrated.isCustomTitle === true,
      input,
      inputTruncated: migrated.inputTruncated === true,
      metadata,
      createdAt: migrated.createdAt,
      lastOpenedAt: migrated.lastOpenedAt,
      openCount: migrated.openCount,
      pinned: migrated.pinned === true,
      tags: readTags(migrated.tags),
      // Recomputed rather than trusted: a stored `searchText` that disagreed
      // with the title and input would make search silently wrong.
      searchText: buildSearchText(title, input),
    },
  };
}

/** How much of the input feeds the search index. */
const SEARCH_INPUT_PREFIX = 2048;

export function buildSearchText(title: string, input: string): string {
  return `${title}\n${input.slice(0, SEARCH_INPUT_PREFIX)}`.toLowerCase();
}
