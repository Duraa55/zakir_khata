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
  authorisation: SyncAuthorisation
): Record<string, any> => ({
  ...payload,
  ownerId: authorisation.ownerId,
  visibleTo: authorisation.visibleTo,
});
