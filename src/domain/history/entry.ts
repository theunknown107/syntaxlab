import type { Result } from '../shared/result';

/**
 * History — 03_DOMAIN_MODEL.md §6, 06_DATA_STORAGE.md
 *
 * The record the product persists, and the port through which it is persisted.
 * The interface lives in the domain because storage is a detail the domain
 * *depends on* but must not know: that is what lets the application run
 * against an in-memory implementation when IndexedDB is unavailable, which is
 * the fallback the whole failure model rests on.
 *
 * **What is deliberately absent** is as important as what is here. No analysis
 * results, no regex test strings, no theme data. Results are recomputable in
 * milliseconds and storing them would duplicate the sensitive content; a test
 * string is the field most likely to hold real production data (§6.1).
 */

/** Types this build creates. Records of other types are handled as future data. */
export const KNOWN_TYPES = ['regex', 'json'] as const;
export type HistoryType = (typeof KNOWN_TYPES)[number];

/** The record schema this build writes and understands. */
export const CURRENT_SCHEMA_VERSION = 1;

export type HistoryMetadata =
  | {
      readonly type: 'regex';
      readonly flags: string;
      readonly groupCount: number;
      readonly hadErrors: boolean;
      readonly nodeCount: number;
    }
  | {
      readonly type: 'json';
      readonly valid: boolean;
      readonly nodeCount: number;
      readonly maxDepth: number;
      readonly byteLength: number;
    };

export interface HistoryEntry {
  /** A v4 UUID. Never a counter or a timestamp — those collide across tabs. */
  readonly id: string;
  readonly schemaVersion: number;
  readonly type: HistoryType;
  readonly title: string;
  readonly isCustomTitle: boolean;
  /** Truncated at `LIMITS.history.maxInputChars`. */
  readonly input: string;
  readonly inputTruncated: boolean;
  readonly metadata: HistoryMetadata;
  readonly createdAt: number;
  readonly lastOpenedAt: number;
  readonly openCount: number;
  readonly pinned: boolean;
  readonly tags: readonly string[];
  /**
   * Lowercased title + input prefix, precomputed.
   *
   * IndexedDB has no full-text index, so search is a cursor scan with a
   * substring match over this one field. At the 500-entry cap that is
   * sub-millisecond and needs no external index (06_DATA_STORAGE.md §2.1).
   */
  readonly searchText: string;
}

/** What a caller supplies; the repository fills in the rest. */
export interface NewHistoryEntry {
  readonly type: HistoryType;
  readonly title: string;
  readonly input: string;
  readonly metadata: HistoryMetadata;
}

export interface HistoryPatch {
  readonly title?: string;
  readonly isCustomTitle?: boolean;
  readonly pinned?: boolean;
  readonly lastOpenedAt?: number;
  readonly openCount?: number;
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

export interface HistoryQuery {
  readonly type?: HistoryType;
  readonly search?: string;
  readonly pinnedOnly?: boolean;
  readonly sort: 'created' | 'opened';
  readonly limit: number;
}

export interface HistoryPage {
  readonly entries: readonly HistoryEntry[];
  /** Total matching the query, so the list can say "48 more". */
  readonly total: number;
  /**
   * Records this build kept but could not show: a newer `schemaVersion`, or a
   * type it does not know. Reported rather than hidden, because old code
   * quietly discarding newer data is how users lose everything by opening a
   * stale tab (06_DATA_STORAGE.md §7.3).
   */
  readonly fromNewerVersion: number;
  /** Records that failed validation and were moved aside. */
  readonly quarantined: number;
}

/* ------------------------------------------------------------------ *
 * Failures
 * ------------------------------------------------------------------ */

export type StorageErrorCode =
  /** IndexedDB blocked, absent, or refused. */
  | 'UNAVAILABLE'
  /** `QuotaExceededError`, after pruning and one retry. */
  | 'QUOTA'
  /** The database would not open, or a record was unreadable. */
  | 'CORRUPT'
  /** An upgrade is blocked by another tab. */
  | 'BLOCKED'
  | 'VALIDATION'
  | 'UNKNOWN';

export interface StorageError {
  readonly code: StorageErrorCode;
  /** User-facing, plain language. Never a stack trace. */
  readonly message: string;
  readonly hint?: string;
}

export function storageError(code: StorageErrorCode, message: string, hint?: string): StorageError {
  // Built field-by-field rather than by spreading, so an unexpected key can
  // never reach a StorageError (18_CODING_STANDARDS.md S4).
  return hint === undefined ? { code, message } : { code, message, hint };
}

/* ------------------------------------------------------------------ *
 * Export envelope
 * ------------------------------------------------------------------ */

export const EXPORT_FORMAT = 'syntaxlab-export';
export const EXPORT_FORMAT_VERSION = 1;

export interface ExportEnvelope {
  readonly format: typeof EXPORT_FORMAT;
  readonly formatVersion: number;
  readonly generatedAt: string;
  readonly appVersion: string;
  readonly entryCount: number;
  readonly entries: readonly HistoryEntry[];
}

export interface ImportReport {
  readonly imported: number;
  readonly updated: number;
  readonly skipped: number;
  /** Why each skipped record was skipped, so the user is not left guessing. */
  readonly reasons: readonly string[];
}

/* ------------------------------------------------------------------ *
 * The port
 * ------------------------------------------------------------------ */

/**
 * **Every method returns `Result` and never throws.** Storage failure is an
 * expected condition in a browser — private mode, enterprise policy, a full
 * disk — not an exception (06_DATA_STORAGE.md §3).
 */
export interface HistoryRepository {
  list(query: HistoryQuery): Promise<Result<HistoryPage, StorageError>>;
  get(id: string): Promise<Result<HistoryEntry | null, StorageError>>;
  save(entry: NewHistoryEntry): Promise<Result<HistoryEntry, StorageError>>;
  update(id: string, patch: HistoryPatch): Promise<Result<HistoryEntry, StorageError>>;
  delete(id: string): Promise<Result<void, StorageError>>;
  clear(): Promise<Result<void, StorageError>>;
  count(): Promise<Result<number, StorageError>>;
  exportAll(): Promise<Result<ExportEnvelope, StorageError>>;
  importAll(
    envelope: unknown,
    mode: 'merge' | 'replace',
  ): Promise<Result<ImportReport, StorageError>>;
  /** Whether writes are actually reaching disk, for the UI to be honest about. */
  readonly durable: boolean;
}
