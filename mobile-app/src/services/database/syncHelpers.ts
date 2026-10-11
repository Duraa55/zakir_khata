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
  // 1. Write to SQLite immediately
  if (operation === 'create') {
    const keys = Object.keys(data);
    const values = Object.values(data);
    // Ensure synced and created_at and firestore_path are present
    if (!keys.includes('synced')) { keys.push('synced'); values.push(0); }
    if (!keys.includes('created_at')) { keys.push('created_at'); values.push(now); }
    if (!keys.includes('updated_at')) { keys.push('updated_at'); values.push(now); }
    if (!keys.includes('firestore_path')) { keys.push('firestore_path'); values.push(firestorePath); }

    const useCamelCase = ['users', 'transactions', 'cashbook'].includes(tableName);
    if (useCamelCase) {
      if (!keys.includes('createdAt')) { keys.push('createdAt'); values.push(now); }
      if (!keys.includes('updatedAt')) { keys.push('updatedAt'); values.push(now); }
      if (!keys.includes('isDeleted')) { keys.push('isDeleted'); values.push(0); }
    }

    const placeholders = keys.map(() => '?').join(', ');
    if (__DEV__) console.log(`[Sync] INSERT INTO ${tableName} (${keys.join(', ')})`);
    await db.runAsync(
      `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
      values
    );
  } else if (operation === 'update') {
    const keys = Object.keys(data);
    const values = Object.values(data);
    
    let setClause = keys.map(k => `${k} = ?`).join(', ');
    
    // Force synced=0 and update timestamp
    if (!keys.includes('synced')) { setClause += `, synced = 0`; }
    if (!keys.includes('updated_at')) { setClause += `, updated_at = ?`; values.push(now); }
    if (!keys.includes('firestore_path')) { setClause += `, firestore_path = ?`; values.push(firestorePath); }
    
    const useCamelCase = ['users', 'transactions', 'cashbook'].includes(tableName);
    if (useCamelCase) {
      if (!keys.includes('updatedAt')) { setClause += `, updatedAt = ?`; values.push(now); }
    }

    values.push(recordId);
    if (__DEV__) console.log(`[Sync] UPDATE ${tableName} SET ... WHERE id = ${recordId}`);
    await db.runAsync(
      `UPDATE ${tableName} SET ${setClause} WHERE id = ?`,
      values
    );
  } else if (operation === 'delete') {
    if (__DEV__) console.log(`[Sync] SOFT DELETE ${tableName} id = ${recordId}`);
    await db.runAsync(
      `UPDATE ${tableName} SET is_deleted=1, deleted_at=?, synced=0, updated_at=? WHERE id=?`,
      [now, now, recordId]
    );
  }

  // 2. Add to sync_queue
  // Don't add to queue if data contains a 'skip_sync' flag (sometimes useful for local only updates)
  if (!data.skip_sync) {
    await db.runAsync(
      `INSERT INTO sync_queue (id, table_name, record_id, operation, payload, firestore_path, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [syncId, tableName, recordId, operation, JSON.stringify(syncPayloadFor(tableName, data)), firestorePath, now]
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
