import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * WHO a document belongs to and WHO may read it, in Firebase uids — the two fields the
 * security rules test.
 *
 *   ownerId   the author. Write rules compare it to request.auth.uid, and it is immutable
 *             on update, which is what stops one business planting documents in another's
 *             view.
 *   visibleTo the author plus their parent chain. Read rules test membership.
 *
 * WHY A LIST AND NOT JUST ownerId: a staff member's document carries THEIR uid, not their
 * owner's, so `ownerId == request.auth.uid` alone would hide staff books from the owner —
 * which is the product. Walking parentId inside the rules instead would mean a get() per
 * evaluation: billed as a read, latency on every call, capped at 10 per request, and it
 * would drag the users collection into Firestore purely so rules could read it. A list
 * written at upload time makes it one O(1) test.
 */
export type SyncAuthorisation = { ownerId: string; visibleTo: string[] };

/**
 * THE FIELD PULL ORDERS ON, and the reason it is a SERVER timestamp.
 *
 * A cursor cannot be a client clock. Every `updated_at` in this database is written by the
 * device that made the change, so two phones disagree about "later" by however much their
 * clocks disagree — and a cursor that moves on a wrong clock skips documents permanently.
 * Firestore's own write time is the one value both devices read identically.
 *
 * TWO CONSEQUENCES THAT ARE EASY TO MISS, and both are why this constant is here rather
 * than inline in the uploader:
 *
 *   1. A QUERY ORDERING ON THIS FIELD RETURNS ONLY DOCUMENTS THAT HAVE IT. Firestore does
 *      not treat a missing field as "oldest" — it excludes the document from the result
 *      altogether. So every document uploaded before this existed is invisible to pull
 *      until it is uploaded again, which is why the initial upload was re-run from scratch
 *      (owner, 2026-10-12).
 *   2. A DELETION MUST CARRY IT TOO. A soft delete uploads only its flags, and if that
 *      write skipped the stamp the deletion would never be pulled — the other phone would
 *      keep showing a row its owner deleted, which is worse than one arriving late.
 *      `deletionPayload` below exists so no uploader can build that write by hand.
 */
export const SYNCED_AT_FIELD = 'syncedAt';

/**
 * The local account that authored a queued row, taken from its document path.
 *
 * Every path is built as `users/{localUserId}/…` — by writeRowWithSyncIn's callers and by
 * entryAuditDb alike — and the local id is the path key by decision (per-uid paths break
 * the owner's view of staff books). sync_queue does not carry the author separately, so
 * this is where it comes from.
 */
export const authorLocalIdFrom = (firestorePath: string): string | null => {
  const parts = (firestorePath || '').split('/');
  return parts[0] === 'users' && parts[1] ? parts[1] : null;
};

/**
 * Resolve a local author into the uids the rules need, or NULL when it cannot be done.
 *
 * NULL means "do not upload this yet", and the caller must leave the row pending rather
 * than fail it. The ordinary reason is that the author has never logged in since Firebase
 * Auth landed, so `users.firebase_uid` is still NULL — we hold a password hash, not a
 * password, so no account can exist for them until they next log in. Uploading without an
 * ownerId would simply be denied, and marking it failed would bury a perfectly good row.
 */
export const authorisationFor = async (
  db: SQLiteDatabase,
  authorLocalId: string
): Promise<SyncAuthorisation | null> => {
  const author = await db.getFirstAsync<{ firebase_uid: string | null; parentId: string | null }>(
    'SELECT firebase_uid, parentId FROM users WHERE id = ? AND is_deleted = 0',
    [authorLocalId]
  );
  // No account, removed, or not yet mapped to a Firebase identity.
  if (!author?.firebase_uid) return null;

  const ownerId = author.firebase_uid;
  const visibleTo = [ownerId];

  // Upward through parentId. The tree is two levels (admin -> staff), but the loop guards
  // against a cycle rather than trusting that, because a cycle here would hang a sync.
  const seen = new Set<string>([authorLocalId]);
  let cursor = author.parentId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const parent: { firebase_uid: string | null; parentId: string | null } | null =
      await db.getFirstAsync('SELECT firebase_uid, parentId FROM users WHERE id = ? AND is_deleted = 0', [cursor]);
    // A removed or missing ancestor ENDS the chain: a removed account must not keep
    // reading its old team's books, and there is nothing dependable above it either.
    if (!parent) break;
    if (parent.firebase_uid && !visibleTo.includes(parent.firebase_uid)) visibleTo.push(parent.firebase_uid);
    cursor = parent.parentId;
  }

  return { ownerId, visibleTo };
};

/**
 * The payload as it goes to Firestore. Computed at UPLOAD time, never stored as columns.
 *
 * Upload time rather than write time, deliberately: a row queued before its author had a
 * Firebase uid would otherwise carry an ownerId of nothing forever, and be refused by the
 * rules even after that person logged in. At upload the uid is necessarily present — you
 * cannot upload without being signed in — and the parent chain is the CURRENT one, so a
 * staff member moved between owners does not ship a stale audience.
 */
export const authorisedPayload = (
  payload: Record<string, any>,
  authorisation: SyncAuthorisation,
  syncedAt: unknown
): Record<string, any> => ({
  ...payload,
  ownerId: authorisation.ownerId,
  visibleTo: authorisation.visibleTo,
  [SYNCED_AT_FIELD]: syncedAt,
});

/**
 * A soft delete as it goes to Firestore: the flags, and the stamp pull orders on.
 *
 * The only fields a delete writes. The document already carries its `ownerId`, which the
 * update rule keeps immutable, so re-sending the audience would be noise — but the STAMP is
 * not optional, and this exists so that cannot be got wrong in two uploaders independently.
 * `syncedAt` is a sentinel the caller passes in (`serverTimestamp()`), never built here:
 * this module is loaded and RUN by the test harness, which cannot load the Firebase
 * packages, and that is worth more than the convenience of importing it.
 */
export const deletionPayload = (deletedAt: string, syncedAt: unknown): Record<string, any> => ({
  is_deleted: true,
  deleted_at: deletedAt,
  [SYNCED_AT_FIELD]: syncedAt,
});
