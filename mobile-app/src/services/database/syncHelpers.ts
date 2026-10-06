import type { SQLiteDatabase } from 'expo-sqlite';
import { withWriteTransaction } from './writeTransaction';
import { isAuditedBook, mutateAuditedEntry } from './entryAuditDb';
import { WriteOptions } from '../../types/sync.types';
import { useSyncStore } from '../../store/useSyncStore';

/**
 * Columns that are written to SQLite but must NEVER leave the phone while sync is
 * unauthenticated. Keyed by table so a caller cannot forget: the queue payload is
 * built from the row minus these, and the SQLite write is untouched.
 *   customers.cnic — national ID data.
 */
export const LOCAL_ONLY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  customers: ['cnic'],
};

/** The row as it may be queued for upload: every local-only column removed. */
export const syncPayloadFor = (tableName: string, data: Record<string, any>): Record<string, any> => {
  const hidden = LOCAL_ONLY_FIELDS[tableName];
  if (!hidden?.length) return data;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !hidden.includes(key)));
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
