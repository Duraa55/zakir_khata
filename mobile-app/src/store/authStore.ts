import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { verifyUserLogin, updateUser } from '../services/database/userDb';
import { ensureFirebaseAccount, signOutFirebase } from '../services/firebase/firebaseAuth';
import { adoptAccountFromCloud, mayBeAdoptable, publishAccountProfile } from '../services/firebase/firebaseProfile';
import { bootstrapTeamFromCloud } from '../services/firebase/firebaseTeam';
import { User, AuthState } from '../types';

const AUTH_KEY = 'auth_session';
const RATE_KEY = 'login_attempts';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days


interface AuthStore extends AuthState {
  loading: boolean;
  /**
   * The Firebase credential holds a DIFFERENT password from this phone's local one, so
   * nothing can upload. Local hashes never sync, so they are per device: change a password
   * on one phone and the other still accepts the old one quite happily. Set after a login
   * that succeeded locally but was refused by Firebase.
   */
  passwordDiverged: boolean;
  /** Firebase is the tiebreaker: if it accepts this password, the local hash follows. */
  resolvePasswordDivergence: (password: string) => Promise<boolean>;
  login: (phone: string, password: string) => Promise<
    | 'ok'
    | 'invalid'
    | 'locked'
    /** Signed in to Firebase, but this account has published no profile, so a second
     *  device has nothing to rebuild it from. No local account is created. */
    | 'no-cloud-profile'
    /** A real local account already holds that phone under a different id. Never merged. */
    | 'account-conflict'
    /** Two cloud profiles claim this Firebase identity. Nothing is adopted; it needs cleanup. */
    | 'identity-ambiguous'
  >;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  updateProfilePicture: (userId: string, uri: string) => Promise<void>;
}



async function buildSession(user: User): Promise<AuthState> {
  return {
    user,
    isAuthenticated: true,
    token: Crypto.randomUUID(),
    issuedAt: Date.now(),
  };
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isAuthenticated: false,
  token: null,
  passwordDiverged: false,

  resolvePasswordDivergence: async (password: string) => {
    const user = get().user;
    if (!user) return false;
    const { resolvePasswordDivergence } = await import('../services/firebase/firebaseAuth');
    const ok = await resolvePasswordDivergence(user.id, user.phone, password);
    if (ok) set({ passwordDiverged: false });
    return ok;
  },
  issuedAt: null,
  loading: false,

  login: async (phone, password) => {
    set({ loading: true });
    try {
      let user = await verifyUserLogin(phone, password);

      // ── A SECOND DEVICE FOR AN ACCOUNT THAT ALREADY EXISTS ──────────────────────────
      // Only reached when the local password check found nothing, so it costs an ordinary
      // login nothing. The password is proved against FIREBASE here, which is the shared
      // credential; the local hash is then derived from it on this device.
      if (!user) {
        const adoption = await adoptAccountFromCloud(phone, password);
        if (__DEV__) console.log('[Auth] adoption: ' + adoption.status + ('code' in adoption ? ' (' + adoption.code + ')' : '') + ('ids' in adoption ? ' [' + adoption.ids.join(', ') + ']' : ''));
        // Signed in, but this account has never published a profile — so there is nothing
        // to rebuild it from. Create NOTHING: a half-account with no data behind it is
        // worse than a refusal, and the message tells them the one thing that fixes it.
        if (adoption.status === 'no-profile') return 'no-cloud-profile';
        if (adoption.status === 'conflict') return 'account-conflict';
        if (adoption.status === 'ambiguous') return 'identity-ambiguous';
        if (adoption.status === 'materialised') user = await verifyUserLogin(phone, password);
      } else if (await mayBeAdoptable(user.id, user.phone)) {
        // THE SEEDED ADMIN. `seedDatabase` runs at boot on every install and creates an
        // admin on the bootstrap number with a fresh local id, so on a second device that
        // row answers the login first — and the user would land in a brand-new empty
        // account that looks legitimate, with the right uid mapped to the wrong local id.
        // Only an untouched seed row gets here, so no real data can be at stake.
        const adoption = await adoptAccountFromCloud(phone, password);
        if (__DEV__) console.log('[Auth] seed adoption: ' + adoption.status + ('code' in adoption ? ' (' + adoption.code + ')' : '') + ('ids' in adoption ? ' [' + adoption.ids.join(', ') + ']' : ''));
        if (adoption.status === 'conflict') return 'account-conflict';
        if (adoption.status === 'ambiguous') return 'identity-ambiguous';
        // 'no-profile' and 'wrong-password' are the ORDINARY fresh install: nothing exists
        // in the cloud to adopt, so fall through and log in as the seeded admin as always.
        if (adoption.status === 'adopted') user = await verifyUserLogin(phone, password);
      }

      if (!user) {
        if (__DEV__) console.warn('[Auth] Login failed — invalid credentials.');
        return 'invalid';
      }

      // Narrowed and captured: `user` is a `let` now that adoption can replace it, so the
      // async callback below cannot see the null check above without this.
      const account = user;
      const authData = await buildSession(account);
      await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(authData));
      set(authData);

      // A SIDE-EFFECT of a login that has already succeeded — never a precondition.
      // This is the one moment the plaintext password legitimately passes through, so it
      // is the only moment a Firebase identity can be created for this account; we store a
      // hash, not a password, so it cannot be done at any other time.
      //
      // Deliberately NOT awaited. ensureFirebaseAccount never throws, but it does make
      // network calls, and a slow or hanging connection must not delay the user getting
      // into their own books. Offline, it fails and retries at the next login.
      void ensureFirebaseAccount(account.id, account.phone, password)
        .then(async r => {
          if (__DEV__) console.log('[Auth] Firebase account:', r.status, 'code' in r ? r.code : '');
          // AND THE IDENTITY DOCUMENT, every login, idempotently. Until this has run once
          // online, a second device for this account cannot exist at all — it is what
          // carries the shared local id. After the uid exists, never before it.
          if (r.status === 'signed-in' || r.status === 'created') {
            const published = await publishAccountProfile(account.id);
            if (__DEV__) console.log('[Profile] ' + published.status
              + ('reason' in published ? ' (' + published.reason + ')' : '')
              + ('code' in published ? ' (' + published.code + ')' : ''));

            // AND WHO THIS ACCOUNT'S TEAM IS, which the audience filter needs before pull
            // can run at all: `users` never syncs, so a device knows only the accounts it
            // created or adopted, and `firebase_uid` is written only for whoever signs in
            // HERE. Without this, pull would drop every staff member's documents — and
            // advance its cursors past them, which is not recoverable. Published first, so
            // this account's own profile exists before it goes looking for other people's.
            const team = await bootstrapTeamFromCloud(account.id);
            if (__DEV__) console.log('[Team] ' + team.status
              + ('reason' in team ? ' (' + team.reason + ')' : '')
              + ('code' in team ? ' (' + team.code + ')' : '')
              + ('complete' in team ? ' complete=' + team.complete
                  + ' ' + team.outcomes.map(o => o.status).join(',')
                  + (team.unresolved.length ? ' unresolved=' + team.unresolved.map(u => u.localId + ':' + u.reason).join(',') : '')
                : ''));
          }
          // Only divergence is surfaced: every other failure is transient and retried at
          // the next login, so nagging about it would be noise.
          set({ passwordDiverged: r.status === 'failed' && r.code === 'password-divergence' });
        })
        .catch(e => { if (__DEV__) console.warn('[Auth] Firebase account step failed:', e?.message); });

      return 'ok';
    } catch (err) {
      if (__DEV__) console.error('[Auth] Login threw an unexpected error:', err);
      return 'invalid';
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      await SecureStore.deleteItemAsync(AUTH_KEY);
    } catch {}
    // Leave FIREBASE as well. Its session is persisted so uploads survive a restart,
    // which also means it outlives a logout: without this the credential stays behind
    // and the next person to use this phone would have their rows offered to Firestore
    // as the previous one. It swallows its own errors, so it cannot hold a logout up.
    await signOutFirebase();
    // The flag belongs to the account that just left, not to whoever logs in next.
    set({ user: null, isAuthenticated: false, token: null, issuedAt: null, passwordDiverged: false });
  },

  checkSession: async () => {
    try {
      const raw = await SecureStore.getItemAsync(AUTH_KEY);
      if (!raw) return;
      const authData = JSON.parse(raw) as AuthState;
      if (
        !authData.issuedAt ||
        !authData.user ||
        !authData.isAuthenticated ||
        Date.now() - authData.issuedAt > SESSION_TTL_MS
      ) {
        if (__DEV__) console.warn('[Auth] Session expired or invalid, clearing.');
        await SecureStore.deleteItemAsync(AUTH_KEY);
        return;
      }
      set(authData);
    } catch (err) {
      // corrupted session — clear it
      if (__DEV__) console.error('[Auth] Failed to restore session:', err);
      try { await SecureStore.deleteItemAsync(AUTH_KEY); } catch {}
    }
  },

  updateProfilePicture: async (userId, uri) => {
    try {
      // 1. Persist to SQLite
      await updateUser(userId, { pictureUrl: uri });
      // 2. Patch in-memory user state immediately
      set(state => ({
        user: state.user ? { ...state.user, pictureUrl: uri } : state.user,
      }));
      // 3. Re-save patched session to SecureStore so it survives app restart
      const raw = await SecureStore.getItemAsync(AUTH_KEY);
      if (raw) {
        const session = JSON.parse(raw) as AuthState;
        if (session.user) {
          session.user.pictureUrl = uri;
          await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(session));
        }
      }
    } catch (err) {
      if (__DEV__) console.error('[Auth] Failed to update profile picture:', err);
    }
  },
}));
