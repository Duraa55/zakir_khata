import { getApp } from 'firebase/app';
import {
  initializeAuth, getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  type Auth,
} from 'firebase/auth';
// Not re-exported from the browser build's types, but it IS what Metro resolves for
// React Native (@firebase/auth's index.rn). Without it Firebase keeps its session in
// memory only, so a restart would sign the account out and uploads would stop until the
// next local login — which may be weeks away.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import AsyncStorage from '@react-native-async-storage/async-storage';
import { IS_FIREBASE_CONFIGURED, initializeFirebase } from './firebaseConfig';
import { getDatabase } from '../database/db';

/**
 * Firebase Auth is a TRANSPORT credential, not this app's authentication.
 *
 * The app authenticates locally, against `users.passwordHash` in SQLite, and that does not
 * change. Firestore simply refuses to accept a write from nobody, so each account needs a
 * Firebase identity whose uid the security rules can compare against the `ownerId` on each
 * document. Nothing about login, offline use or the local session depends on any of this
 * working.
 */

/**
 * Firebase Auth has no phone+password method — phone auth means SMS codes, which cost
 * money and need a real number for every staff member. The account is therefore keyed on
 * a synthetic address built from the E.164 phone, which is already canonical and unique
 * (`users.phone` is UNIQUE, and normalisePhone guarantees one spelling).
 *
 * The domain is deliberately NOT a real one: no mail is ever sent to it, and no password
 * reset can arrive through it. That is also why a divergent password cannot be repaired
 * by the usual "email me a reset link" route.
 */
const AUTH_EMAIL_DOMAIN = 'digikhata.internal';

/** `+923001234567` -> `923001234567@digikhata.internal`. */
export const authEmailFor = (e164Phone: string): string =>
  `${e164Phone.replace(/\D/g, '')}@${AUTH_EMAIL_DOMAIN}`;

export type FirebaseAccountResult =
  | { status: 'skipped'; code: 'not-configured' }
  | { status: 'signed-in'; uid: string }
  | { status: 'created'; uid: string }
  /**
   * `password-divergence` is the one failure that will not fix itself: the Firebase
   * account exists but holds a DIFFERENT password from the local one. Every other code
   * here is transient and retried at the next login.
   */
  | { status: 'failed'; code: string };

let cachedAuth: Auth | null = null;

/**
 * The Auth instance, with React Native persistence so the session survives a restart.
 *
 * `initializeAuth` may only be called once per app; a second call throws. It is also the
 * only way to set persistence, so this caches the first result and falls back to
 * `getAuth` if initialisation already happened elsewhere.
 */
export const getFirebaseAuth = (): Auth => {
  if (cachedAuth) return cachedAuth;
  if (!IS_FIREBASE_CONFIGURED) throw new Error('Firebase is not configured.');
  initializeFirebase();
  const app = getApp();
  try {
    // getReactNativePersistence is present in the React Native build that Metro resolves,
    // but absent from the browser typings, so it is read off the module at runtime.
    const authModule = require('firebase/auth') as {
      getReactNativePersistence?: (storage: unknown) => unknown;
    };
    cachedAuth = authModule.getReactNativePersistence
      ? initializeAuth(app, { persistence: authModule.getReactNativePersistence(AsyncStorage) as never })
      : initializeAuth(app);
  } catch {
    // Already initialised (a hot reload, or a second call) — reuse it.
    cachedAuth = getAuth(app);
  }
  return cachedAuth;
};

/** Record the Firebase uid against the local account. Local mapping only; never synced. */
const rememberUid = async (localUserId: string, uid: string): Promise<void> => {
  const db = await getDatabase();
  try {
    await db.runAsync('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, localUserId]);
  } catch (err: any) {
    // users.firebase_uid is UNIQUE: another local account already claims this identity.
    // Refusing is right — sharing one uid would let one person's writes pass the rules as
    // another's — and it must not disturb the login that triggered it.
    if (__DEV__) console.warn('[FirebaseAuth] could not map ' + localUserId + ' to ' + uid + ':', err?.message);
  }
};

/**
 * Give this account a Firebase identity, using the password the user has just proved they
 * know. SAFE TO CALL ON EVERY LOGIN, and safe to ignore: it never throws, and nothing it
 * returns affects whether the user is logged in.
 *
 * Sign in FIRST, then create. The other order looks cheaper but misreads Firebase: with
 * email-enumeration protection on, an unknown account returns `auth/invalid-credential`
 * rather than `auth/user-not-found`, so "create on not-found" silently stops creating
 * anyone. Falling through to create and letting `auth/email-already-in-use` be the signal
 * is the only ordering that distinguishes "new account" from "wrong password".
 */
export const ensureFirebaseAccount = async (
  localUserId: string,
  e164Phone: string,
  password: string
): Promise<FirebaseAccountResult> => {
  if (!IS_FIREBASE_CONFIGURED) return { status: 'skipped', code: 'not-configured' };

  const email = authEmailFor(e164Phone);
  let auth: Auth;
  try {
    auth = getFirebaseAuth();
  } catch (err: any) {
    return { status: 'failed', code: err?.code || 'auth-unavailable' };
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await rememberUid(localUserId, cred.user.uid);
    return { status: 'signed-in', uid: cred.user.uid };
  } catch (signInErr: any) {
    const code = signInErr?.code || '';
    // Offline, rate-limited or Firebase down: transient. Retry at the next login; the
    // queue simply keeps waiting, which is what it already does.
    if (code === 'auth/network-request-failed' || code === 'auth/too-many-requests') {
      if (__DEV__) console.warn('[FirebaseAuth] transient, will retry next login:', code);
      return { status: 'failed', code };
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await rememberUid(localUserId, cred.user.uid);
      return { status: 'created', uid: cred.user.uid };
    } catch (createErr: any) {
      const createCode = createErr?.code || '';
      if (createCode === 'auth/email-already-in-use') {
        // The account exists but its password is NOT the local one. This does not heal on
        // its own: the fake-email domain receives no mail, so there is no reset link, and
        // changing a Firebase password requires signing in with the current one first.
        // Detected and reported here; repairing it is a separate decision.
        if (__DEV__) console.warn('[FirebaseAuth] password divergence for ' + localUserId + ' — local and Firebase passwords differ');
        return { status: 'failed', code: 'password-divergence' };
      }
      if (__DEV__) console.warn('[FirebaseAuth] could not create account:', createCode || createErr?.message);
      return { status: 'failed', code: createCode || 'create-failed' };
    }
  }
};

/**
 * Move the Firebase credential to a new password. Called by userDb.changeOwnPassword
 * BEFORE the local hash moves, which is the whole point of the ordering: if Firebase
 * refuses, nothing has changed anywhere and the two cannot drift apart.
 *
 * Signing in with the CURRENT password is not an extra step for its own sake — Firebase
 * will not change a password without a recent sign-in, and it doubles as proof that
 * Firebase still holds the password the user just typed.
 */
export const changeFirebasePassword = async (
  e164Phone: string,
  currentPassword: string,
  newPassword: string
): Promise<FirebaseAccountResult> => {
  if (!IS_FIREBASE_CONFIGURED) return { status: 'skipped', code: 'not-configured' };

  const email = authEmailFor(e164Phone);
  try {
    const auth = getFirebaseAuth();
    const cred = await signInWithEmailAndPassword(auth, email, currentPassword);
    const { updatePassword } = require('firebase/auth') as {
      updatePassword: (user: unknown, p: string) => Promise<void>;
    };
    await updatePassword(cred.user, newPassword);
    return { status: 'signed-in', uid: cred.user.uid };
  } catch (err: any) {
    const code = err?.code || '';
    // No Firebase account yet (this user has never logged in since Auth landed): there is
    // nothing to keep in step, and the next login will create one with the NEW password.
    if (code === 'auth/user-not-found') return { status: 'skipped', code: 'not-configured' };
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      // Firebase holds a different password from the local one, so this change cannot be
      // applied to both. Resolve the divergence first.
      return { status: 'failed', code: 'password-divergence' };
    }
    return { status: 'failed', code: code || 'firebase-password-failed' };
  }
};

/**
 * Resolve a divergence, with FIREBASE as the tiebreaker for which password is newer.
 *
 * Local password hashes never sync (syncHelpers.LOCAL_ONLY_FIELDS), so they are per
 * device: change a password on one phone and the other still holds the old hash and will
 * happily accept it. Firebase is the only copy both devices share, so if Firebase accepts
 * the password the user typed, that password is the current one and the LOCAL hash is the
 * stale side — so the local hash is brought up to match it.
 *
 * Returns true when the local account now matches Firebase.
 */
export const resolvePasswordDivergence = async (
  localUserId: string,
  e164Phone: string,
  password: string
): Promise<boolean> => {
  if (!IS_FIREBASE_CONFIGURED) return false;
  try {
    const auth = getFirebaseAuth();
    const cred = await signInWithEmailAndPassword(auth, authEmailFor(e164Phone), password);
    // Firebase accepted it, so it is authoritative. Bring the local hash into line.
    const { changePassword } = await import('../database/userDb');
    await changePassword(localUserId, password);
    await rememberUid(localUserId, cred.user.uid);
    return true;
  } catch (err: any) {
    if (__DEV__) console.warn('[FirebaseAuth] divergence not resolved:', err?.code || err?.message);
    return false;
  }
};

/**
 * The Firebase uid that Firestore will present to the security rules RIGHT NOW, or null
 * when nobody is signed in. Safe to call at any time, and it never fails.
 *
 * WHY THE UPLOADER HAS TO ASK. getFirebaseAuth was only ever reached from a login, so a
 * cold start that restored a local session from SecureStore never touched Firebase at
 * all: the credential sat unread in AsyncStorage, nobody was signed in, and every upload
 * went out unauthenticated. The deny-all hid that completely, because everything is
 * refused anyway. Against the real rules it would be a permanent `permission-denied` on
 * every row until the user happened to log in again — which reads exactly like a mistake
 * in the rules, and is not one.
 *
 * Two details decide whether this works at all:
 *
 *   ORDER. Importing firebase/auth registers the auth component, and Firestore will
 *   instantiate it ON DEMAND, with the default IN-MEMORY persistence, if nobody has
 *   called initializeAuth first. The AsyncStorage session is then never read back, and
 *   the initializeAuth at the next login loses to that instance and falls through to
 *   getAuth — so the session would not survive the FOLLOWING restart either. Asking this
 *   before anything asks for Firestore is what keeps the persistent instance the first one.
 *
 *   TIMING. The restore is ASYNCHRONOUS. `currentUser` is null for a moment after
 *   initializeAuth returns, so reading it without awaiting authStateReady() reports
 *   "signed out" for someone who is about to be signed in.
 */
export const currentFirebaseUid = async (): Promise<string | null> => {
  if (!IS_FIREBASE_CONFIGURED) return null;
  try {
    const auth = getFirebaseAuth();
    // Resolves once the persisted session has been read back; immediately, thereafter.
    await auth.authStateReady();
    return auth.currentUser?.uid ?? null;
  } catch (err: any) {
    if (__DEV__) console.warn('[FirebaseAuth] no session could be restored:', err?.code || err?.message);
    return null;
  }
};

/**
 * Drop the Firebase credential, as part of logging out.
 *
 * Without this the Firebase session is simply WHOEVER LOGGED IN LAST on the phone, and it
 * outlives their local session by design: the persistence that keeps uploads working
 * across a restart keeps them working across a logout too. On a single-account phone that
 * is invisible. On a shared one it means the next person’s rows are offered to Firestore
 * under the previous person’s identity, and the rules compare `ownerId` to the CALLER’s
 * uid — so they would be refused, correctly, for a reason nobody could see.
 *
 * Never fails the logout: leaving locally has to happen whatever Firebase does.
 */
export const signOutFirebase = async (): Promise<void> => {
  if (!IS_FIREBASE_CONFIGURED) return;
  try {
    const auth = getFirebaseAuth();
    if (auth.currentUser) await signOut(auth);
  } catch (err: any) {
    if (__DEV__) console.warn('[FirebaseAuth] sign-out failed:', err?.code || err?.message);
  }
};
