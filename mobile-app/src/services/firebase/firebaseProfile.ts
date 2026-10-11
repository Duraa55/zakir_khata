import type { SQLiteDatabase } from 'expo-sqlite';
import { doc, setDoc, collectionGroup, query, where, getDocs } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { IS_FIREBASE_CONFIGURED, getFirestoreDB } from './firebaseConfig';
import { authEmailFor, getFirebaseAuth } from './firebaseAuth';
import { getDatabase } from '../database/db';
import { authorisationFor, authorisedPayload } from '../database/syncAuthorisation';
import { normalisePhone } from '../database/userDb';
import { applyCloudProfile, mayBeAdoptable as mayBeAdoptableIn, type ApplyResult, type CloudProfile } from '../database/accountAdoption';

/**
 * HOW A SECOND DEVICE BECOMES THE SAME PERSON.
 *
 * Every document path is `users/{LOCAL id}/…` and that id is generated per device
 * (`user_<ts>_<rand>`), so a fresh install that merely logs in is a DIFFERENT account that
 * happens to share a phone number: its paths would not match, and every pulled row's
 * `user_id` would point at a local account that does not exist. The local id therefore has
 * to be shared, and something has to carry it between devices.
 *
 * That something is ONE document per account at `users/{localId}/profile/self`. It is inside
 * the subtree the existing rules already match, which is why this needs no rules change —
 * `users/{localId}` itself is NOT matched, because the recursive wildcard needs at least one
 * segment below it.
 *
 * IT CARRIES NO CREDENTIAL. `passwordHash` is refused by `LOCAL_ONLY_FIELDS.users` and is
 * absent here by construction: the second device derives its own hash from the password the
 * user has just proved against Firebase, which is the shared credential.
 *
 * WRITTEN DIRECTLY, NOT THROUGH sync_queue. `users` is deliberately not in SYNC_PATHS, and
 * routing this through the queue would need a pseudo-table that check 152 rejects and would
 * make syncProcessor run `UPDATE users SET synced=1 WHERE id='self'`. It is pure derived
 * data, so a lost write costs nothing: the next login writes it again. Stamping is
 * unchanged — the same `authorisedPayload` the uploader uses, so the same rules accept it.
 */

const PROFILE_COLUMNS =
  'id, name, name_ur, phone, role, account_level, businessName, businessType, area, ' +
  'pictureUrl, parentId, default_currency, createdAt';

/**
 * Publish this account's identity document. Safe to call on every login and safe to ignore:
 * it never throws, and nothing about the login depends on it.
 *
 * A SECOND DEVICE CANNOT WORK UNTIL THIS HAS RUN ONCE, ONLINE, on the first one. No account
 * had a profile document before this shipped, so "signed in to Firebase, no profile found"
 * is the ordinary state at rollout rather than an edge case — see `findAccountProfile`.
 */
export type PublishResult =
  | { status: 'written' }
  | { status: 'skipped'; reason: 'not-configured' | 'no-local-row' | 'no-firebase-identity' | 'unadopted-seed' }
  | { status: 'failed'; code: string };

export const publishAccountProfile = async (localUserId: string): Promise<PublishResult> => {
  if (!IS_FIREBASE_CONFIGURED) return { status: 'skipped', reason: 'not-configured' };
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<CloudProfile>(
      `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = ? AND is_deleted = 0`, [localUserId]
    );
    if (!row) return { status: 'skipped', reason: 'no-local-row' };

    // PUBLISHING AN IDENTITY DOCUMENT IS A CLAIM, AND A SEED ROW HAS NO RIGHT TO MAKE ONE.
    //
    // This ran unconditionally at first, and a second device whose adoption had failed went
    // on to publish a profile for its OWN untouched seed admin under the shared Firebase uid
    // — two documents claiming one identity with different local ids, which makes the
    // collection-group lookup ambiguous and every later attempt worse than the last. The
    // flaw was thinking "idempotent for the right account" meant "idempotent for any
    // account".
    //
    // The gate is the adoption test read the other way round: a row that could still be
    // REPLACED by a cloud profile is, by definition, not the account that profile describes.
    // It is offline and costs an ordinary login nothing.
    //
    // CONSEQUENCE, accepted deliberately (owner, 2026-10-12): a brand-new business on a
    // fresh install is also an untouched seeded admin until it writes its first row, so it
    // publishes nothing until then and cannot be adopted yet. An account with no data is
    // nothing to adopt.
    if (await mayBeAdoptableIn(db, localUserId, row.phone)) {
      if (__DEV__) console.log('[Profile] not publishing for an unadopted seed row: ' + localUserId);
      return { status: 'skipped', reason: 'unadopted-seed' };
    }

    // The same stamping every uploaded document gets. Null when this account has no Firebase
    // identity yet, in which case there is nothing to authorise the write as.
    const authorisation = await authorisationFor(db, localUserId);
    if (!authorisation) return { status: 'skipped', reason: 'no-firebase-identity' };

    const firestore = getFirestoreDB();
    await setDoc(
      doc(firestore, `users/${localUserId}/profile/self`),
      authorisedPayload({ ...row }, authorisation),
      { merge: true }
    );
    if (__DEV__) console.log('[Profile] published users/' + localUserId + '/profile/self');
    return { status: 'written' };
  } catch (err: any) {
    // Offline, denied, or Firebase down. Retried at the next login; nothing depends on it.
    if (__DEV__) console.warn('[Profile] could not publish:', err?.code || err?.message);
    return { status: 'failed', code: err?.code || err?.message || 'publish-failed' };
  }
};

export type ProfileLookup =
  | { status: 'found'; profile: CloudProfile }
  /** Signed in, but this account has never published a profile. The rollout state. */
  | { status: 'no-profile' }
  /**
   * TWO OR MORE profiles claim this Firebase identity with different local ids. Adopt
   * NOTHING: picking one would silently make this device the wrong account, and the result
   * would depend on the order Firestore happened to return them in.
   */
  | { status: 'ambiguous'; ids: string[] }
  | { status: 'wrong-password' }
  | { status: 'unavailable'; code: string };

/**
 * Sign in to Firebase with the typed credentials and fetch this account's own profile.
 *
 * COLLECTION GROUP, not a path: the whole point is that the second device does not know the
 * local id yet, so it cannot address the document. The query carries
 * `where('visibleTo', 'array-contains', uid)` because the rules REJECT a query they cannot
 * prove — they do not filter it — and it needs the collection-group index on `profile` in
 * firestore.indexes.json, since single-field indexes are automatic for collections but not
 * for collection groups.
 *
 * A PARENT'S QUERY ALSO RETURNS THEIR STAFF'S PROFILES, because `visibleTo` is the author
 * plus the parent chain. So the match is on `ownerId === own uid`, never "the first result".
 */
export const findAccountProfile = async (rawPhone: string, password: string): Promise<ProfileLookup> => {
  if (!IS_FIREBASE_CONFIGURED) return { status: 'unavailable', code: 'not-configured' };

  let uid: string;
  try {
    const auth = getFirebaseAuth();
    const cred = await signInWithEmailAndPassword(auth, authEmailFor(normalisePhone(rawPhone)), password);
    uid = cred.user.uid;
  } catch (err: any) {
    const code = err?.code || '';
    // With email-enumeration protection on, an unknown account and a wrong password are the
    // same code, and from here they mean the same thing: this device cannot adopt anything.
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return { status: 'wrong-password' };
    }
    return { status: 'unavailable', code: code || 'sign-in-failed' };
  }

  try {
    const firestore = getFirestoreDB();
    const snapshot = await getDocs(query(
      collectionGroup(firestore, 'profile'),
      where('visibleTo', 'array-contains', uid)
    ));
    // EVERY match, not the first. The query also returns a parent's staff profiles, because
    // visibleTo is the author plus the parent chain, so the owner test is what picks ours.
    const mine = snapshot.docs
      .map(d => d.data())
      .filter(d => d.ownerId === uid && typeof d.id === 'string' && d.id);
    const ids = [...new Set(mine.map(d => d.id as string))];

    if (ids.length > 1) {
      // It has happened once already, so this cannot be left to "should not arise": the
      // publish gate stops it being created, and this stops it being acted on. Firestore
      // defines no order here, so resolving it would adopt an identity at random.
      await signOutFirebase();
      if (__DEV__) console.warn('[Profile] ' + ids.length + ' profiles claim this identity: ' + ids.join(', '));
      return { status: 'ambiguous', ids };
    }
    if (!ids.length) {
      // Signed in and nothing to adopt. The caller must create NO local account for this:
      // a half-account with no data behind it is worse than a refusal.
      await signOutFirebase();
      return { status: 'no-profile' };
    }
    return { status: 'found', profile: mine[0] as CloudProfile };
  } catch (err: any) {
    await signOutFirebase();
    return { status: 'unavailable', code: err?.code || err?.message || 'query-failed' };
  }
};

/** Local sign-out helper that cannot throw into a login path. */
const signOutFirebase = async (): Promise<void> => {
  try {
    const auth = getFirebaseAuth();
    if (auth.currentUser) await signOut(auth);
  } catch { /* nothing a login can do about it */ }
};

/** Every way adoption can end: the lookup's failures, plus what the local half decided. */
export type AdoptionResult = ApplyResult | Exclude<ProfileLookup, { status: 'found' }>;

/**
 * Make this device the account the cloud profile describes: the Firebase lookup, then the
 * local half. The local half lives in `database/accountAdoption.ts` on purpose — the test
 * harness cannot load the Firebase packages, so anything beside them can only be asserted as
 * source text, and the rules about WHICH rows may be rewritten are far too important for that.
 */
export const adoptAccountFromCloud = async (rawPhone: string, password: string): Promise<AdoptionResult> => {
  const lookup = await findAccountProfile(rawPhone, password);
  if (lookup.status !== 'found') return lookup;
  const db = await getDatabase();
  return applyCloudProfile(db, lookup.profile, rawPhone, password);
};

/** The offline guard, re-exported so callers need only this module. */
export const mayBeAdoptable = async (localUserId: string, e164Phone: string): Promise<boolean> => {
  if (!IS_FIREBASE_CONFIGURED) return false;
  return mayBeAdoptableIn(await getDatabase(), localUserId, e164Phone);
};
