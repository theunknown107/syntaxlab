import { storageError, type StorageError } from '@/domain/history/entry';
import { err, ok, type Result } from '@/domain/shared/result';

/**
 * IndexedDB, on the platform API — 06_DATA_STORAGE.md §2, §7.1
 *
 * No wrapper library. `idb` was listed as a planned dependency, and the whole
 * of what it provides here is turning four event-based calls into promises,
 * which is the thirty lines below. Against that: a runtime dependency in the
 * initial bundle, a supply-chain surface on the code that touches the user's
 * saved work, and a layer between us and the error semantics that the failure
 * model depends on getting exactly right.
 *
 * The one place the platform API is genuinely awkward is transaction
 * lifetime — a transaction closes when the microtask queue drains, so an
 * `await` in the middle of one silently aborts it. Every helper here therefore
 * completes its transaction before resolving.
 */

export const DB_NAME = 'syntaxlab';
export const DB_VERSION = 1;
export const STORE_HISTORY = 'history';
export const STORE_META = 'meta';

/**
 * Indices on `history` — 06_DATA_STORAGE.md §2.1
 *
 * Created up front although the current repository reads none of them: it
 * loads the whole store, which is capped at 500 entries, and filters in
 * memory. Adding an index later would need a version bump and an upgrade
 * path, so the cheap moment to declare them is now — an unused index on a
 * 500-record store costs nothing measurable.
 *
 * `by-pinned` from the spec is **not** created. `pinned` is a boolean, and
 * IndexedDB rejects booleans as keys: the index would silently contain
 * nothing. Pinned-first ordering is done in `queryEntries` instead.
 */
export const INDEX_CREATED = 'by-created';
export const INDEX_OPENED = 'by-opened';
export const INDEX_TYPE = 'by-type';
export const INDEX_TYPE_CREATED = 'by-type-created';

export type DbEvent =
  /** Another tab holds an older connection and is preventing the upgrade. */
  | { readonly kind: 'blocked' }
  /** A newer version wants to open; this connection must close. */
  | { readonly kind: 'blocking' }
  /** The connection died — disk error, or the browser reclaimed it. */
  | { readonly kind: 'terminated' };

export type DbListener = (event: DbEvent) => void;

/** Wraps a request so its two events become one promise. */
function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => {
      resolve(source.result);
    };
    source.onerror = () => {
      reject(source.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/** Resolves when the transaction actually commits, not merely when it is queued. */
export function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}

export function isQuotaError(error: unknown): boolean {
  // Matched by name rather than by the legacy numeric code, which is
  // deprecated. Some engines have historically thrown a plain error here, so
  // the name is checked on any object that carries one.
  if (error instanceof DOMException) return error.name === 'QuotaExceededError';
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'QuotaExceededError'
  );
}

function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const history = db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
    history.createIndex(INDEX_CREATED, 'createdAt');
    history.createIndex(INDEX_OPENED, 'lastOpenedAt');
    history.createIndex(INDEX_TYPE, 'type');
    history.createIndex(INDEX_TYPE_CREATED, ['type', 'createdAt']);
    db.createObjectStore(STORE_META, { keyPath: 'key' });
  }
  // if (oldVersion < 2) { … additive changes only, where possible … }
}

/**
 * Opens the database, or explains why it could not be opened.
 *
 * Never throws. Every caller treats an unavailable database as an ordinary
 * outcome, because in a browser it is one: private mode, enterprise policy, a
 * disabled setting, or a corrupt file.
 */
export async function openDatabase(
  listener: DbListener = () => undefined,
): Promise<Result<IDBDatabase, StorageError>> {
  if (typeof indexedDB === 'undefined') {
    return err(
      storageError(
        'UNAVAILABLE',
        'This browser does not provide storage for history.',
        'Everything else works normally; analyses are kept for this session only.',
      ),
    );
  }

  let openRequest: IDBOpenDBRequest;
  try {
    openRequest = indexedDB.open(DB_NAME, DB_VERSION);
  } catch {
    // Firefox throws here rather than firing an error event when storage is
    // blocked by policy or by private browsing.
    return err(
      storageError(
        'UNAVAILABLE',
        'History storage is blocked in this browser mode.',
        'Everything else works normally; analyses are kept for this session only.',
      ),
    );
  }

  return new Promise<Result<IDBDatabase, StorageError>>((resolve) => {
    openRequest.onupgradeneeded = (event) => {
      const db = openRequest.result;
      try {
        upgrade(db, event.oldVersion);
      } catch {
        // An upgrade that throws leaves a half-built schema; aborting is the
        // only way to leave the database in a state the next open can fix.
        openRequest.transaction?.abort();
      }
    };

    openRequest.onblocked = () => {
      listener({ kind: 'blocked' });
      resolve(
        err(
          storageError(
            'BLOCKED',
            'Another SyntaxLab tab is holding an older version of the history database.',
            'Close the other tabs and reload to finish updating.',
          ),
        ),
      );
    };

    openRequest.onsuccess = () => {
      const db = openRequest.result;
      db.onversionchange = () => {
        // A newer build wants to upgrade. Holding the connection would block
        // it in the other tab, so this one steps aside.
        db.close();
        listener({ kind: 'blocking' });
      };
      db.onclose = () => {
        listener({ kind: 'terminated' });
      };
      resolve(ok(db));
    };

    openRequest.onerror = () => {
      resolve(
        err(
          storageError(
            'CORRUPT',
            'The history database could not be opened.',
            'History is unavailable for this session. Everything else works normally.',
          ),
        ),
      );
    };
  });
}

/* ------------------------------------------------------------------ *
 * Typed helpers
 * ------------------------------------------------------------------ */

export function store(
  db: IDBDatabase,
  name: string,
  mode: IDBTransactionMode,
): { readonly store: IDBObjectStore; readonly transaction: IDBTransaction } {
  const transaction = db.transaction(name, mode);
  return { store: transaction.objectStore(name), transaction };
}

export async function getAll(db: IDBDatabase, name: string): Promise<unknown[]> {
  const { store: target, transaction } = store(db, name, 'readonly');
  const values = await request<unknown[]>(target.getAll() as IDBRequest<unknown[]>);
  await completed(transaction);
  return values;
}

export async function getOne(db: IDBDatabase, name: string, key: string): Promise<unknown> {
  const { store: target, transaction } = store(db, name, 'readonly');
  const value = await request<unknown>(target.get(key) as IDBRequest<unknown>);
  await completed(transaction);
  return value;
}

export async function put(db: IDBDatabase, name: string, value: unknown): Promise<void> {
  const { store: target, transaction } = store(db, name, 'readwrite');
  target.put(value);
  await completed(transaction);
}

export async function putMany(db: IDBDatabase, name: string, values: unknown[]): Promise<void> {
  // One transaction for the batch: IDB transactions are atomic, so a partial
  // import cannot be left behind by a failure halfway through.
  const { store: target, transaction } = store(db, name, 'readwrite');
  for (const value of values) target.put(value);
  await completed(transaction);
}

export async function remove(db: IDBDatabase, name: string, key: string): Promise<void> {
  const { store: target, transaction } = store(db, name, 'readwrite');
  target.delete(key);
  await completed(transaction);
}

export async function removeMany(db: IDBDatabase, name: string, keys: string[]): Promise<void> {
  const { store: target, transaction } = store(db, name, 'readwrite');
  for (const key of keys) target.delete(key);
  await completed(transaction);
}

export async function clearStore(db: IDBDatabase, name: string): Promise<void> {
  const { store: target, transaction } = store(db, name, 'readwrite');
  target.clear();
  await completed(transaction);
}

export async function countStore(db: IDBDatabase, name: string): Promise<number> {
  const { store: target, transaction } = store(db, name, 'readonly');
  const total = await request<number>(target.count());
  await completed(transaction);
  return total;
}

/** Turns a thrown storage failure into the domain's error type. */
export function toStorageError(error: unknown): StorageError {
  if (isQuotaError(error)) {
    return storageError(
      'QUOTA',
      'History storage is full.',
      'Older unpinned entries were removed. Delete some entries or export them to free space.',
    );
  }
  return storageError(
    'UNKNOWN',
    'History could not be written.',
    'Your work is unaffected — this only concerns the saved list.',
  );
}
