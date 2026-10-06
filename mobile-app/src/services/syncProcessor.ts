import { getDatabase } from './database/db';
import { getPendingSyncExpenses } from './database/expenseDb';
import { useSyncStore } from '../store/useSyncStore';
import { doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { getFirestoreDB, IS_FIREBASE_CONFIGURED } from './firebase/firebaseConfig';
import { SyncQueueItem } from '../types/sync.types';

export async function processSyncQueue(): Promise<void> {
  const isOnline = useSyncStore.getState().isOnline;
  if (!isOnline || !IS_FIREBASE_CONFIGURED) return;

  let firestore;
  try {
    firestore = getFirestoreDB();
  } catch (e) {
    return;
  }

  const db = await getDatabase();
  const pendingItems = await db.getAllAsync<SyncQueueItem>(
    `SELECT * FROM sync_queue WHERE status='pending' OR status='failed' ORDER BY created_at ASC LIMIT 20`
  );

  for (const item of pendingItems) {
    try {
      await db.runAsync(`UPDATE sync_queue SET status='syncing' WHERE id=?`, [item.id]);
      
      const payload = JSON.parse(item.payload);
      let path = item.firestore_path;

      // Auto-repair legacy 5-segment paths (e.g. users/uid/cash/transactions/id or users/uid/stock/items/id)
      const parts = path.split('/');
      if (parts.length === 5) {
        if (parts[2] === 'cash' && parts[3] === 'transactions') {
          path = `users/${parts[1]}/transactions/${parts[4]}`;
        } else if (parts[2] === 'stock' && parts[3] === 'items') {
          path = `users/${parts[1]}/stock_items/${parts[4]}`;
        }
      }

      const docRef = doc(firestore, path);

      if (item.operation === 'delete') {
        await updateDoc(docRef, { is_deleted: true, deleted_at: payload.deleted_at || new Date().toISOString() });
      } else {
        await setDoc(docRef, payload, { merge: true });
      }

      // Success: mark local record as synced
      if (item.table_name !== 'entry_audit') {
        await db.runAsync(`UPDATE ${item.table_name} SET synced=1 WHERE id=?`, [item.record_id]);
      }
      
      // Remove from queue
      await db.runAsync(`DELETE FROM sync_queue WHERE id=?`, [item.id]);

    } catch (error: any) {
      if (__DEV__) console.warn(`[Sync] Skipped item ${item.id} due to sync error: ${error?.message || error}`);
      const retryCount = (item.retry_count || 0) + 1;
      const isPermissionOrRefError = error?.code === 'permission-denied' || 
        error?.message?.includes('permission') || 
        error?.message?.includes('segments');
      
      if (retryCount >= 3 || isPermissionOrRefError) {
        await db.runAsync(
          `UPDATE sync_queue SET status='failed', retry_count=?, error_message=?, last_attempt_at=? WHERE id=?`,
          [retryCount, error?.message || 'Sync error', new Date().toISOString(), item.id]
        );
      } else {
        await db.runAsync(
          `UPDATE sync_queue SET status='pending', retry_count=?, last_attempt_at=? WHERE id=?`,
          [retryCount, new Date().toISOString(), item.id]
        );
      }
    }
  }

  // Update pending count
  const remainingCount = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE status IN ('pending', 'failed')`
  );
  useSyncStore.getState().setPendingCount(remainingCount?.count || 0);
}

export async function batchProcessSyncQueue(): Promise<void> {
  const isOnline = useSyncStore.getState().isOnline;
  if (!isOnline || !IS_FIREBASE_CONFIGURED) return;

  let firestore;
  try {
    firestore = getFirestoreDB();
  } catch (e) {
    return;
  }

  const db = await getDatabase();
  const pendingItems = await db.getAllAsync<SyncQueueItem>(
    `SELECT * FROM sync_queue WHERE status='pending' LIMIT 500`
  );
  if (pendingItems.length === 0) return;

  const batch = writeBatch(firestore);
  
  for (const item of pendingItems) {
    const payload = JSON.parse(item.payload);
    const docRef = doc(firestore, item.firestore_path);
    if (item.operation === 'delete') {
      batch.update(docRef, { is_deleted: true, deleted_at: payload.deleted_at || new Date().toISOString() });
    } else {
      batch.set(docRef, payload, { merge: true });
    }
  }

  try {
    await batch.commit();
    // Mark all as synced
    for (const item of pendingItems) {
      if (item.table_name !== 'entry_audit') {
        await db.runAsync(`UPDATE ${item.table_name} SET synced=1 WHERE id=?`, [item.record_id]);
      }
      await db.runAsync(`DELETE FROM sync_queue WHERE id=?`, [item.id]);
    }
  } catch (error) {
    if (__DEV__) console.error('Batch sync failed:', error);
  }

  // Update pending count
  const remainingCount = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE status IN ('pending', 'failed')`
  );
  useSyncStore.getState().setPendingCount(remainingCount?.count || 0);
}
