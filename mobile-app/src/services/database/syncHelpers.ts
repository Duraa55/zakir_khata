import type { SQLiteDatabase } from 'expo-sqlite';
import { withWriteTransaction } from './writeTransaction';
import { isAuditedBook, mutateAuditedEntry } from './entryAuditDb';
import { WriteOptions } from '../../types/sync.types';
import { useSyncStore } from '../../store/useSyncStore';

/**
 * Columns written to SQLite that must NEVER leave the phone. Keyed by table so a caller
 * cannot forget: the queue payload is the row MINUS these, and the SQLite write itself is
 * untouched, so the app keeps full local use of them.
 *
 *   customers.cnic    — national ID data.
 *   users.passwordHash — a credential.
 *
 * NOT "until sync is authenticated". Authentication changes who can read the project; it
 * does not make a password hash or a national ID safe to store in it.
 */
export const LOCAL_ONLY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  customers: ['cnic'],
  // `users` rows do not sync today — createUser writes direct SQL, not writeWithSync —
  // but this is listed NOW, before the step that makes them sync, because the cost of
  // remembering it late is every password hash in the project's Firestore. A hash is a
  // credential: it is offline-attackable, and this one is a homegrown 10k-iteration
  // SHA-256 with the salt applied only at iteration 0, which is weaker than it looks.
  users: ['passwordHash'],
};

/**
 * Columns stored as a JSON STRING locally that must travel as a REAL ARRAY, under a
 * different field name. Keyed by table: column -> document field.
 *
 * `activities.visible_to` is the one case, and the rename is the point of it. It holds a
 * JSON string of LOCAL ids — the Activity Log's own per-entry audience — while
 * `visibleTo`, stamped on every document by `syncAuthorisation`, is a real array of
 * FIREBASE uids that the security rules test. Two fields differing by one underscore,
 * with opposite shapes and different id spaces, in the same document.
 *
 * Nothing broke on the way up, which is exactly the danger: a pull query written as
 * `where('visible_to', 'array-contains', uid)` is wrong on all three counts and would
 * return NOTHING rather than failing. Renaming it `activityAudience` makes the mistake
 * unavailable instead of merely unlikely.
 *
 * PULL USES THIS MAP INVERTED — see `columnForPayloadField`. Documents written before this
 * rename still carry the old string `visible_to`; it is a real column, so a pull that
 * whitelists columns will accept it unchanged and no repair is needed.
 */
export const JSON_ARRAY_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  activities: { visible_to: 'activityAudience' },
};

/** Total by construction: a malformed stored value becomes an empty list, never a throw. */
const asArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** For PULL: the column a document field belongs in, or null when it is not a reshaped one. */
export const columnForPayloadField = (tableName: string, field: string): string | null => {
  const renames = JSON_ARRAY_FIELDS[tableName];
  if (!renames) return null;
  for (const [column, documentField] of Object.entries(renames)) if (documentField === field) return column;
  return null;
};

/** For PULL: that field's value back in the column's shape. */
export const columnValueForPayloadField = (value: unknown): string => JSON.stringify(asArray(value));

/**
 * The row as it may be queued for upload: every local-only column removed, and every
 * JSON-string list turned into a real array under its document field name.
 */
export const syncPayloadFor = (tableName: string, data: Record<string, any>): Record<string, any> => {
  const hidden = LOCAL_ONLY_FIELDS[tableName];
  const renames = JSON_ARRAY_FIELDS[tableName];
  if (!hidden?.length && !renames) return data;

  let out = hidden?.length
    ? Object.fromEntries(Object.entries(data).filter(([key]) => !hidden.includes(key)))
    : { ...data };
  if (renames) {
    for (const [column, documentField] of Object.entries(renames)) {
      if (!Object.prototype.hasOwnProperty.call(out, column)) continue;
      const stored = out[column];
      delete out[column];
      out[documentField] = asArray(stored);
    }
  }
  return out;
};

/**
 * Columns that are written to SQLite but must never travel: this phone's own bookkeeping.
 *
 * `synced` is per-device by definition, and `firestore_path` is where the document already
 * is — sending either back would be telling the server what it just told us. They are
 * stripped from the live payload and from the backfill's alike, which is the whole reason
 * this lives here rather than once in each: a live document and a backfilled one must be
 * the SAME SHAPE, or pull is being tested against a document the app does not actually send.
 */
export const LOCAL_BOOKKEEPING = ['synced', 'firestore_path'] as const;

/**
 * The document for a row as it was written: local-only fields removed, JSON lists reshaped,
 * this phone's bookkeeping dropped. The one way a payload is built, for live writes and for
 * the backfill.
 */
export const outgoingPayload = (tableName: string, row: Record<string, any>): Record<string, any> => {
  const payload = { ...syncPayloadFor(tableName, row) };
  for (const column of LOCAL_BOOKKEEPING) delete payload[column];
  return payload;
};

export async function writeWithSync(options: WriteOptions): Promise<void> {
  const { tableName, recordId, operation, data, firestorePath } = options;
  // Canonical identifiers prevent a differently-cased/quoted table bypassing the gate.
  if (!/^[a-z_]+$/.test(tableName)) throw new Error('Invalid book table.');
  if (tableName === 'entry_audit') throw new Error('Entry history can only be appended by an audited edit.');
  if (isAuditedBook(tableName) && operation !== 'create') {
    return mutateAuditedEntry(tableName, recordId, operation === 'delete' ? 'deleted' : 'edited', data);
  }
  if (__DEV__) console.log(`[Sync] writeWithSync — table: ${tableName}, op: ${operation}, id: ${recordId}`);

  try {
    await withWriteTransaction(db => writeRowWithSyncIn(db, options));
    if (__DEV__) console.log(`[Sync] writeWithSync ok — ${tableName}/${recordId}`);
  } catch (err) {
    if (__DEV__) console.error(`[Sync] writeWithSync failed — ${tableName}/${operation}/${recordId}:`, err);
    throw err; // re-throw so callers can handle it
  }

  afterSyncedWrite();
}

/**
 * Steps 1–2 of writeWithSync — the row write and its sync_queue entry — on a
 * connection that is ALREADY inside a write transaction. For a caller that must
 * write several rows atomically (e.g. a staff login and its staff_record): it opens
 * one withWriteTransaction, calls this for each row, then afterSyncedWrite() once the
 * transaction has committed. Calling writeWithSync from inside withWriteTransaction
 * would deadlock, because withWriteTransaction serialises on a single queue.
 * Audited books are not supported here; they must go through writeWithSync.
 */
export async function writeRowWithSyncIn(db: SQLiteDatabase, options: WriteOptions): Promise<void> {
  const { tableName, recordId, operation, data, firestorePath } = options;
  if (!/^[a-z_]+$/.test(tableName)) throw new Error('Invalid book table.');
  if (tableName === 'entry_audit') throw new Error('Entry history can only be appended by an audited edit.');
  if (isAuditedBook(tableName) && operation !== 'create') throw new Error('Audited edits must go through writeWithSync.');
  const now = new Date().toISOString();
  const syncId = `sync_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  // THE ROW AS ACTUALLY WRITTEN, and the queue payload is built from THIS — never from the
  // caller's `data`.
  //
  // It used to be built from `data`, while the timestamps below were appended to a local
  // keys/values pair that `data` never saw. So they reached SQLite and never reached the
  // document: a live-written cashbook or transactions row shipped with NO `createdAt` in
  // either spelling, and both columns are NOT NULL, so the receiving phone could not
  // INSERT it and dropped it as `incomplete`. `expenses` and `reminders` shipped without
  // their NOT NULL `created_at` for the same reason and would have dropped the moment one
  // was pulled onto a device that did not already hold the row. Found on the device,
  // 2026-10-13 (owner: applied=10, dropped=2).
  //
  // A BACKFILLED document never had the bug — it is `SELECT *` of the real row — which is
  // why the first upload looked fine and only entries written afterwards vanished. Keeping
  // one object for both the write and the payload is what makes the two shapes the same by
  // construction rather than by two lists agreeing.
  const useCamelCase = ['users', 'transactions', 'cashbook'].includes(tableName);
  const written: Record<string, any> = { ...data };
  // 1. Write to SQLite immediately
  if (operation === 'create') {
    if (!('synced' in written)) written.synced = 0;
    if (!('created_at' in written)) written.created_at = now;
    if (!('updated_at' in written)) written.updated_at = now;
    if (!('firestore_path' in written)) written.firestore_path = firestorePath;
    if (useCamelCase) {
      if (!('createdAt' in written)) written.createdAt = now;
      if (!('updatedAt' in written)) written.updatedAt = now;
      if (!('isDeleted' in written)) written.isDeleted = 0;
    }

    const keys = Object.keys(written);
    const placeholders = keys.map(() => '?').join(', ');
    if (__DEV__) console.log(`[Sync] INSERT INTO ${tableName} (${keys.join(', ')})`);
    await db.runAsync(
      `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
      keys.map(k => written[k])
    );
  } else if (operation === 'update') {
    // Force synced=0 and update timestamp
    if (!('synced' in written)) written.synced = 0;
    if (!('updated_at' in written)) written.updated_at = now;
    if (!('firestore_path' in written)) written.firestore_path = firestorePath;
    if (useCamelCase && !('updatedAt' in written)) written.updatedAt = now;

    const keys = Object.keys(written);
    if (__DEV__) console.log(`[Sync] UPDATE ${tableName} SET ... WHERE id = ${recordId}`);
    await db.runAsync(
      `UPDATE ${tableName} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...keys.map(k => written[k]), recordId]
    );
  } else if (operation === 'delete') {
    // The SQL is unchanged. What is new is that the payload now carries the same values,
    // so `deletionPayload` reads a real `deleted_at` instead of falling back to its own clock.
    if (__DEV__) console.log(`[Sync] SOFT DELETE ${tableName} id = ${recordId}`);
    await db.runAsync(
      `UPDATE ${tableName} SET is_deleted=1, deleted_at=?, synced=0, updated_at=? WHERE id=?`,
      [now, now, recordId]
    );
    written.is_deleted = 1;
    written.deleted_at = now;
    written.synced = 0;
    written.updated_at = now;
  }

  // 2. Add to sync_queue
  // Don't add to queue if data contains a 'skip_sync' flag (sometimes useful for local only updates)
  if (!data.skip_sync) {
    await db.runAsync(
      `INSERT INTO sync_queue (id, table_name, record_id, operation, payload, firestore_path, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [syncId, tableName, recordId, operation, JSON.stringify(outgoingPayload(tableName, written)), firestorePath, now]
    );
  }
}

/** Step 3 of writeWithSync: nudge the uploader. Call only AFTER the transaction has committed. */
export function afterSyncedWrite(): void {
  // 3. Try immediate sync if online
  const isOnline = useSyncStore.getState().isOnline;
  if (isOnline) {
    useSyncStore.getState().processSyncQueue();  // fire and forget
  } else {
    // update pending count
    useSyncStore.getState().incrementPendingCount();
  }
}
