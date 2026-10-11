import type { SQLiteDatabase } from 'expo-sqlite';
import { userScope, userScopeParams } from './queryHelpers';
import { SYNC_PATHS } from './syncPaths';

/**
 * WHICH PULLED DOCUMENTS MAY ENTER THIS DEVICE AT ALL.
 *
 * THE RULES CANNOT DO THIS, AND IT IS NOT DEFENCE IN DEPTH. A document is admitted by the
 * read rule because the caller is in its `visibleTo`, and `visibleTo` is written by whoever
 * AUTHORED the document. Account creation is open to anyone holding the API key that ships
 * in the APK, so a stranger can create a document, stamp `ownerId` with their OWN uid — all
 * the create rule asks — and put a victim's uid in `visibleTo`. The victim's own
 * `array-contains` query then returns it, and a forged bill lands in their book.
 *
 * `ownerId` immutability stops a document being MOVED into another business; it does nothing
 * about one being BORN pointing at it. The path cannot help either: it is the local id and
 * unconstrained by design. So the filter belongs to the READER, and it is the only thing
 * standing there. See CLAUDE.md, "AUDIENCE INJECTION", beside the same lesson about the
 * profile lookup's ownerId filter.
 *
 * DOWNWARD ONLY. The viewer and their descendants, never an ancestor: a staff member must
 * not accept a document owned by their admin, and this must not lean on the rules to stop
 * that.
 */

/**
 * The Firebase uids whose documents this viewer may accept: their own, plus every account
 * directly beneath them.
 *
 * REMOVED DESCENDANTS ARE INCLUDED, deliberately. A dismissed staff member's entries must
 * stay visible (non-negotiable rule 4), and on a device that has never pulled them, pull is
 * the only way they can arrive. Their documents were stamped `visibleTo = [them, the admin]`
 * while they were still live, so the rules admit them; excluding them here would be the only
 * thing keeping a dismissed employee's history off a second device.
 *
 * The scope predicate is `userScope`, the ONE scoping helper — not a second copy of it, and
 * it mentions neither `account_level` nor `is_deleted`, as rule 1 requires.
 */
export const knownAudience = async (
  db: SQLiteDatabase,
  viewerLocalId: string
): Promise<ReadonlySet<string>> => {
  const rows = await db.getAllAsync<{ firebase_uid: string }>(
    `SELECT firebase_uid FROM users
      WHERE firebase_uid IS NOT NULL AND firebase_uid <> ''
        AND ${userScope('id')}`,
    userScopeParams(viewerLocalId)
  );
  return new Set(rows.map(r => r.firebase_uid));
};

/**
 * May this document enter the local database?
 *
 * Pure, synchronous, and total: anything it cannot vouch for is refused. A missing or
 * non-string `ownerId` is refused rather than treated as absent, because "no owner" is
 * exactly the shape a hand-made or malformed document has.
 */
export const acceptable = (doc: unknown, known: ReadonlySet<string>): boolean => {
  if (!doc || typeof doc !== 'object') return false;
  const ownerId = (doc as Record<string, unknown>).ownerId;
  if (typeof ownerId !== 'string' || !ownerId) return false;
  return known.has(ownerId);
};

/**
 * A SECOND, CHEAPER TEST: does the document's own author column agree with its `ownerId`?
 *
 * `acceptable` proves the owner is someone this viewer may receive data from. This proves the
 * row will land in THAT person's book rather than somebody else's: `ownerId` is a Firebase
 * uid, the author column holds a LOCAL id, and the two must resolve to the same account or
 * the row is filed under the wrong one.
 *
 * Returns true for a table whose author is resolved through a parent — such a document has no
 * author column of its own, and its parent carries the check.
 */
export const ownerMatchesAuthor = async (
  db: SQLiteDatabase,
  table: string,
  doc: Record<string, unknown>
): Promise<boolean> => {
  const spec = SYNC_PATHS[table];
  if (!spec) return false;
  if (spec.author.kind !== 'column') return true;

  const claimed = doc[spec.author.column];
  if (typeof claimed !== 'string' || !claimed) return false;
  const owner = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM users WHERE firebase_uid = ? LIMIT 1', [doc.ownerId as string]
  );
  return !!owner && owner.id === claimed;
};
