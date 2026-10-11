import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { verifyUserLogin, updateUser } from '../services/database/userDb';
import { ensureFirebaseAccount, signOutFirebase } from '../services/firebase/firebaseAuth';
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
  login: (phone: string, password: string) => Promise<'ok' | 'invalid' | 'locked'>;
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
      const user = await verifyUserLogin(phone, password);
      if (!user) {
        if (__DEV__) console.warn('[Auth] Login failed — invalid credentials.');
        return 'invalid';
      }

      const authData = await buildSession(user);
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
      void ensureFirebaseAccount(user.id, user.phone, password)
        .then(r => {
          if (__DEV__) console.log('[Auth] Firebase account:', r.status, 'code' in r ? r.code : '');
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
