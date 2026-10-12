import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { IS_FIREBASE_CONFIGURED, getFirestoreDB } from './firebaseConfig';
import { currentFirebaseUid } from './firebaseAuth';
import { getDatabase } from '../database/db';
import { applyTeamMembers, type MemberOutcome, type TeamMemberIdentity } from '../database/teamBootstrap';

/**
 * THE TEAM BOOTSTRAP — the Firebase half. ONE cursor-free query, then one direct read per
 * member. No cursor is read, written or advanced here, by design.
 *
 * WHY IT IS NOT A PULL PASS (CLAUDE.md, 2026-10-12). The obvious way to bootstrap a fresh
 * device is two pull passes — pull as just yourself, learn the team from what arrives, pull
 * again. IT LOSES DATA SILENTLY: pass one advances the `bills` cursor past a staff member's
 * bills the audience filter had just dropped, and pass two never asks for them again.
 * Advancing only over ACCEPTED documents is no fix either, since one document with a
 * permanently unknown owner would block that collection for ever. So the team has to be
 * known BEFORE pull runs at all, and it has to be learned without a cursor.
 *
 * WHERE MEMBERSHIP COMES FROM, AND WHY NOT FROM A COLLECTION-GROUP QUERY.
 * `users/{myLocalId}/staff_records` — the viewer's OWN records collection, one `getDocs`.
 * The tempting shortcut is the collection-group query over `profile` that
 * `findAccountProfile` already runs: it returns a parent's staff profiles too, in one go,
 * with the uid and the local id both on the document. IT MUST NOT BE USED FOR THIS. That
 * query returns every profile naming the viewer in `visibleTo`, and `visibleTo` is written
 * by whoever authored the document — so a stranger holding the API key that ships in the APK
 * could add THEMSELVES to the team, which is precisely what the audience filter exists to
 * prevent. Membership must come from a document the VIEWER wrote.
 *
 * AND THE SAME FILTER AGAIN, FOR THE SAME REASON: `ownerId === own uid`, applied to the
 * viewer's own staff_records documents. The path is unconstrained by design — it is a local
 * id — so a stranger can create `users/<the viewer's id>/staff_records/<anything>`; the
 * create rule asks only that `ownerId` be their own uid. It is harmless ONLY because a
 * document whose `ownerId` is the viewer's uid cannot have been written by anyone else. This
 * is the third place the client is the thing enforcing `ownerId`, beside the profile lookup
 * and the audience filter. The rules can prove who WROTE a document, never who it is ABOUT.
 *
 * THE UID COMES FROM THE MEMBER'S OWN PROFILE. A staff_records document carries
 * `linked_user_id` — their shared LOCAL id — and nothing else could: the viewer's device
 * never learns a staff member's Firebase uid, because `firebase_uid` is written only for the
 * account that signs in on that device. So each member's uid is read off
 * `users/{linkedId}/profile/self`, by direct path, and that document's `ownerId` is a uid
 * only that account can have stamped.
 *
 * KNOWN LIMIT, worth stating rather than discovering: a member who has never published a
 * profile has no uid here. They also cannot have uploaded a single document — `authorisationFor`
 * returns null without a uid, so their rows never leave their device — so there is nothing of
 * theirs for pull to drop. A member whose profile exists but cannot be READ is the case that
 * is NOT safe, which is why it is reported as unresolved and why `complete` exists.
 */

/** A member the bootstrap could not finish. PULL MUST NOT RUN WHILE THIS LIST IS NON-EMPTY. */
export type UnresolvedMember = {
  localId: string;
  reason:
    /** No profile document: no uid, and therefore no documents of theirs anywhere. Safe. */
    | 'no-profile'
    /** The document exists and this account may not read it, so a uid exists that we cannot learn. */
    | 'denied'
    /** A profile that does not describe the account it sits under. Never adopted. */
    | 'mismatch';
};

export type TeamBootstrapResult =
  | { status: 'skipped'; reason: 'not-configured' | 'no-firebase-identity' }
  | { status: 'failed'; code: string }
  | {
      status: 'done';
      outcomes: MemberOutcome[];
      unresolved: UnresolvedMember[];
      /**
       * NOTHING OF A TEAM MEMBER'S COULD BE MISSED BY PULLING NOW. True when every member
       * whose documents could exist is known: a member with no profile at all has no uid,
       * and therefore no documents anywhere, so they do not count against it. See where
       * this is computed for the full reasoning and the residual risk.
       *
       * THE PULL STEP'S GATE: while this is false, the audience filter is incomplete in a
       * way that matters, so a pull would drop documents and advance its cursors past them.
       */
      complete: boolean;
    };

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

/**
 * Teach this device who its team is. Safe to call on every login, and safe to ignore: it
 * never throws, writes nothing but `users` rows it is allowed to write, and nothing about
 * being logged in depends on it.
 *
 * The pull step must AWAIT this and gate on `complete` — not assume a login ran it.
 */
export const bootstrapTeamFromCloud = async (viewerLocalId: string): Promise<TeamBootstrapResult> => {
  if (!IS_FIREBASE_CONFIGURED) return { status: 'skipped', reason: 'not-configured' };
  const uid = await currentFirebaseUid();
  // Signed out: there is nothing to authorise the reads as, and no uid to test ownerId
  // against. The next login retries, exactly as the profile publish does.
  if (!uid) return { status: 'skipped', reason: 'no-firebase-identity' };

  try {
    const firestore = getFirestoreDB();
    const db = await getDatabase();

    // ONE QUERY. `array-contains` is not a filter for our convenience — Firestore REJECTS a
    // query it cannot prove against the read rule rather than filtering it, so a query
    // without it fails whole. A single-field index is automatic for a collection (unlike the
    // collection GROUP the identity lookup needs), so this needs nothing in
    // firestore.indexes.json.
    const snapshot = await getDocs(query(
      collection(firestore, 'users', viewerLocalId, 'staff_records'),
      where('visibleTo', 'array-contains', uid)
    ));

    const records = snapshot.docs
      .map(d => d.data() as Record<string, unknown>)
      // THE LOAD-BEARING FILTER. A stranger can plant a document in this very collection —
      // the path is a local id and is unconstrained — and the create rule asks only that
      // ownerId be their own uid. Only a document carrying OUR uid can be ours.
      .filter(d => d.ownerId === uid);

    const members: TeamMemberIdentity[] = [];
    const unresolved: UnresolvedMember[] = [];

    for (const record of records) {
      // NULL for a sub-staff RECORD, which is the normal case for most rows: no login, no
      // identity, nothing it could ever author. Nothing to bootstrap.
      const localId = asText(record.linked_user_id);
      if (!localId || localId === viewerLocalId) continue;

      let profile: Record<string, unknown> | null = null;
      try {
        const snap = await getDoc(doc(firestore, 'users', localId, 'profile', 'self'));
        profile = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      } catch (err: any) {
        // Refused, or offline mid-run. ONE member failing must not take the rest down.
        if (__DEV__) console.warn('[Team] profile unreadable for ' + localId + ':', err?.code || err?.message);
        unresolved.push({ localId, reason: 'denied' });
        continue;
      }
      if (!profile) {
        // The ordinary state for someone who has never logged in online: no uid exists, so
        // they own no documents and pull has nothing of theirs to drop.
        unresolved.push({ localId, reason: 'no-profile' });
        continue;
      }
      const memberUid = asText(profile.ownerId);
      // It must describe the account it sits under, and a member cannot be the viewer.
      if (!memberUid || memberUid === uid || asText(profile.id) !== localId) {
        unresolved.push({ localId, reason: 'mismatch' });
        continue;
      }

      members.push({
        localId,
        firebaseUid: memberUid,
        // IDENTITY from the profile; STRUCTURE is the local half's business and is not read
        // from any document — see teamBootstrap.ts.
        name: asText(profile.name) || asText(record.name_en) || localId,
        name_ur: asText(profile.name_ur),
        phone: asText(profile.phone) || '',
        area: asText(profile.area),
        businessType: asText(profile.businessType),
        pictureUrl: asText(profile.pictureUrl),
        default_currency: asText(profile.default_currency),
        createdAt: asText(profile.createdAt),
        // The VIEWER's own record is what says someone has been dismissed: removeStaffAccess
        // marks the record inactive and soft-deletes the login.
        removed: record.status === 'inactive' || record.is_deleted === 1 || record.is_deleted === true,
      });
    }

    const outcomes = await applyTeamMembers(db, viewerLocalId, members);
    const refused = outcomes.filter(o => o.status === 'refused');
    if (__DEV__ && refused.length) {
      console.warn('[Team] refused: ' + refused.map(o => o.localId + ' (' + ('reason' in o ? o.reason : '') + ')').join(', '));
    }
    return {
      status: 'done',
      outcomes,
      unresolved,
      // COMPLETE MEANS "NOTHING OF THEIRS COULD BE MISSED", NOT "EVERYONE WAS RESOLVED".
      //
      // A member with NO PROFILE has no Firebase uid, and without one `authorisationFor`
      // returns null, so not a single row of theirs has ever left their device. There is
      // nothing of theirs for pull to drop and nothing for a cursor to pass, so they must
      // not hold pull up — and they would hold it up for ever: a staff member who has never
      // logged in anywhere is the ORDINARY state today (see the two recorded gaps in
      // CLAUDE.md), so blocking on them would make pull unusable rather than careful.
      //
      // 'denied' and 'mismatch' are the opposite: the profile EXISTS, so a uid exists that
      // this device cannot learn, and documents stamped with it would be dropped and passed.
      // Those block. So does a REFUSED member, whose uid could not be mapped locally at all.
      //
      // The residual risk, stated rather than assumed: a member whose profile publish failed
      // while their uploads succeeded reads as 'no-profile' yet has documents. Narrow — the
      // publish runs in the same callback as the sign-in that enables any upload — and it
      // shows up as a non-zero `dropped` count on a pull, which is why that number is kept
      // per table in `sync_pull`.
      complete: !refused.length && !unresolved.some(u => u.reason !== 'no-profile'),
    };
  } catch (err: any) {
    // Offline, denied, or Firebase down. Retried at the next login; nothing depends on it.
    if (__DEV__) console.warn('[Team] bootstrap failed:', err?.code || err?.message);
    return { status: 'failed', code: err?.code || err?.message || 'team-bootstrap-failed' };
  }
};
