import { getDatabase } from './database/db';
import { getPendingSyncExpenses } from './database/expenseDb';
import { useSyncStore } from '../store/useSyncStore';
import { doc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { getFirestoreDB, IS_FIREBASE_CONFIGURED } from './firebase/firebaseConfig';
import { SyncQueueItem } from '../types/sync.types';
import { authorLocalIdFrom, authorisationFor, authorisedPayload, deletionPayload } from './database/syncAuthorisation';
import { currentFirebaseUid } from './firebase/firebaseAuth';

/**
 * The Sync Centre's two tiles. Pending and failed are both still QUEUED — failed is a
 * label on a row that will be tried again, not a row that has been given up on.
 */
const refreshPendingCount = async (db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> => {
  const remaining = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM sync_queue WHERE status IN ('pending', 'failed')`
  );
  useSyncStore.getState().setPendingCount(remaining?.count || 0);
};

export async function processSyncQueue(): Promise<void> {
  const isOnline = useSyncStore.getState().isOnline;
  if (!isOnline || !IS_FIREBASE_CONFIGURED) return;

  // WHO Firestore will present to the rules, asked BEFORE Firestore is touched. That
  // ordering is not incidental: it is what makes Auth initialise with its AsyncStorage
  // persistence rather than being created in-memory on Firestore’s behalf, and so it is
  // what lets the session a previous run saved be read back at all.
  const signedInUid = await currentFirebaseUid();

  let firestore;
  try {
    firestore = getFirestoreDB();
  } catch (e) {
    return;
  }

  const db = await getDatabase();

  if (!signedInUid) {
    // Nobody is signed in to Firebase, so every write would go out unauthenticated and
    // be refused. That is a state of the APP, not a fault in any row: leave the whole
    // queue PENDING and let the next login clear it.
    if (__DEV__) console.log('[Sync] no Firebase session yet; the queue stays pending');
    await refreshPendingCount(db);
    return;
  }

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

      // WHO owns this and who may read it, stamped onto the document itself. The security
      // rules test these two fields rather than the path, because the path key is the
      // LOCAL id and an owner must be able to read a staff member's books.
      const authorId = authorLocalIdFrom(path);
      const authorisation = authorId ? await authorisationFor(db, authorId) : null;
      if (!authorisation) {
        // The author has no Firebase identity yet (they have not logged in since Auth
        // landed). Leave the row PENDING, not failed: it is a perfectly good row, and it
        // will upload on its own once they log in. Marking it failed would bury it.
        if (__DEV__) console.log('[Sync] waiting for a Firebase identity before uploading ' + item.id);
        await db.runAsync(`UPDATE sync_queue SET status='pending' WHERE id=?`, [item.id]);
        continue;
      }

      if (authorisation.ownerId !== signedInUid) {
        // Another account’s row, on a phone they share. The create rule compares the
        // stamped ownerId to the CALLER’s uid, so offering this under the current
        // session would be refused — and that is not a fault in the row. It stays
        // PENDING and goes up when its own author next logs in here.
        if (__DEV__) console.log('[Sync] ' + item.id + ' belongs to another account on this phone; staying pending');
        await db.runAsync(`UPDATE sync_queue SET status='pending' WHERE id=?`, [item.id]);
        continue;
      }

      // The uid Firestore is about to present, beside the one stamped on the document.
      // These two must be equal or the rules refuse the write, so logging both is what
      // tells a denial caused by the RULES apart from one caused by the wrong session.
      if (__DEV__) console.log('[Sync] uploading ' + item.id + ' as ' + signedInUid + ', ownerId ' + authorisation.ownerId);

      // A delete only flips the flags; the document already carries its ownerId, and the
      // update rule keeps that field immutable anyway. IT STILL CARRIES THE SERVER STAMP,
      // through the shared helper: pull orders on that field and Firestore excludes a
      // document that lacks it, so an unstamped deletion would never travel and the other
      // phone would go on showing a row its owner deleted.
      const outgoing = item.operation === 'delete'
        ? deletionPayload(payload.deleted_at || new Date().toISOString(), serverTimestamp())
        : authorisedPayload(payload, authorisation, serverTimestamp());

      // THE DOCUMENT ITSELF, not a description of it, and the SAME object that is sent
      // below — a log built separately is free to disagree with the write.
      //
      // A create is refused by exactly three things: no caller, an ownerId that is not the
      // caller, or sane() — which wants visibleTo to BE a list, to hold at most 8 entries,
      // and to contain ownerId. The line above already prints the caller beside the
      // stamped owner, so printing the audience is what is left to tell a payload fault
      // apart from a ruleset that is not the one we think is live.
      if (__DEV__) {
        const audience = (outgoing as Record<string, any>).visibleTo;
        console.log('[Sync] ' + item.operation + ' -> ' + path);
        console.log('[Sync]   visibleTo: isArray=' + Array.isArray(audience)
          + ' type=' + typeof audience
          + ' size=' + (Array.isArray(audience) ? audience.length : 'n/a')
          + ' holdsOwnerId=' + (Array.isArray(audience) && audience.includes((outgoing as Record<string, any>).ownerId)));
        console.log('[Sync]   payload: ' + JSON.stringify(outgoing));
      }

      if (item.operation === 'delete') {
        await updateDoc(docRef, outgoing);
      } else {
        await setDoc(docRef, outgoing, { merge: true });
      }

      // Success: mark local record as synced
      if (item.table_name !== 'entry_audit') {
        await db.runAsync(`UPDATE ${item.table_name} SET synced=1 WHERE id=?`, [item.record_id]);
      }
      
      // Remove from queue
      await db.runAsync(`DELETE FROM sync_queue WHERE id=?`, [item.id]);

    } catch (error: any) {
      // The CODE as well as the message. "Missing or insufficient permissions" is what a
      // rules refusal reads as, and it is also what an App Check rejection reads as; only
      // error.code separates them, and the branch below already turns on it.
      if (__DEV__) console.warn(`[Sync] Skipped item ${item.id} due to sync error [${error?.code || 'no-code'}]: ${error?.message || error}`);
      const retryCount = (item.retry_count || 0) + 1;
      const message = error?.message || 'Sync error';

      // A MALFORMED PATH is permanently wrong. An odd number of segments cannot address
      // a document, no amount of retrying changes that, and the row needs a person to
      // look at it. Fail it on the first attempt, which is what it always did.
      const isMalformedPath = message.includes('segments');

      // A PERMISSION DENIAL is the opposite, and it used to be treated the same way.
      // It says something about the SERVER as it stands right now — which rules are
      // published, and who is signed in — and both of those change without the row
      // changing at all. Short-circuiting it meant the deny-all turned a queue of
      // perfectly good rows into a red FAILED count on their FIRST attempt, one tap away
      // from "Stop retrying". It now keeps the row PENDING for as long as it takes, and
      // the retry budget below cannot bury it either: the budget exists to stop an
      // endlessly failing row, and a denial is not the row failing.
      //
      // Nothing is hidden by this. The row carries its reason, and the Sync Centre shows
      // it on the waiting card, so "waiting" never means "waiting, cause unknown".
      const isDenied = error?.code === 'permission-denied' || message.includes('permission');

      if (isMalformedPath || (retryCount >= 3 && !isDenied)) {
        await db.runAsync(
          `UPDATE sync_queue SET status='failed', retry_count=?, error_message=?, last_attempt_at=? WHERE id=?`,
          [retryCount, message, new Date().toISOString(), item.id]
        );
      } else {
        await db.runAsync(
          `UPDATE sync_queue SET status='pending', retry_count=?, error_message=?, last_attempt_at=? WHERE id=?`,
          [retryCount, message, new Date().toISOString(), item.id]
        );
      }
    }
  }

  await refreshPendingCount(db);
}

export async function batchProcessSyncQueue(): Promise<void> {
  const isOnline = useSyncStore.getState().isOnline;
  if (!isOnline || !IS_FIREBASE_CONFIGURED) return;

  // WHO Firestore will present to the rules, asked BEFORE Firestore is touched. That
  // ordering is not incidental: it is what makes Auth initialise with its AsyncStorage
  // persistence rather than being created in-memory on Firestore’s behalf, and so it is
  // what lets the session a previous run saved be read back at all.
  const signedInUid = await currentFirebaseUid();

  let firestore;
  try {
    firestore = getFirestoreDB();
  } catch (e) {
    return;
  }

  const db = await getDatabase();
  // Signed out: nothing can be authorised, so send nothing and leave it all pending.
  if (!signedInUid) return;

  const pendingItems = await db.getAllAsync<SyncQueueItem>(
    `SELECT * FROM sync_queue WHERE status='pending' LIMIT 500`
  );
  if (pendingItems.length === 0) return;

  const batch = writeBatch(firestore);
  // Only the rows that could actually be authorised go into the batch. One unauthorised
  // row must not take the whole commit down with it — a batch is all-or-nothing.
  const batched: SyncQueueItem[] = [];

  for (const item of pendingItems) {
    const payload = JSON.parse(item.payload);
    const authorId = authorLocalIdFrom(item.firestore_path);
    const authorisation = authorId ? await authorisationFor(db, authorId) : null;
    // Stays pending, and uploads once its author has an identity AND is the account
    // signed in to Firebase here — the rules test the caller, not the phone.
    if (!authorisation || authorisation.ownerId !== signedInUid) continue;
    const docRef = doc(firestore, item.firestore_path);
    if (item.operation === 'delete') {
      // The same two helpers as the single uploader, for the same reason: a stamp missing
      // here and present there would mean deletions that travel from one code path only.
      batch.update(docRef, deletionPayload(payload.deleted_at || new Date().toISOString(), serverTimestamp()));
    } else {
      batch.set(docRef, authorisedPayload(payload, authorisation, serverTimestamp()), { merge: true });
    }
    batched.push(item);
  }
  if (batched.length === 0) return;

  try {
    await batch.commit();
    // Mark as synced ONLY what was actually sent.
    for (const item of batched) {
      if (item.table_name !== 'entry_audit') {
        await db.runAsync(`UPDATE ${item.table_name} SET synced=1 WHERE id=?`, [item.record_id]);
      }
      await db.runAsync(`DELETE FROM sync_queue WHERE id=?`, [item.id]);
    }
  } catch (error) {
    if (__DEV__) console.error(`[Sync] batch commit failed [${(error as any)?.code || 'no-code'}]: ${(error as any)?.message || error}`);
  }

  await refreshPendingCount(db);
}
