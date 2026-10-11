import * as Crypto from 'expo-crypto';
import { getDatabase } from './db';
import { AccountLevel, assertConsistentLevel } from './accountLevel';
import { User } from '../../types';
import { resolveCurrency, type CurrencyCode } from '../../utils/currency';
import { internationalPhone, MAX_NATIONAL_DIGITS } from '../../utils/phone';

// Internal DB record — includes the hash, never returned to callers outside this file.
interface UserRecord {
  id: string;
  name: string;
  name_ur?: string | null;
  phone: string;
  passwordHash: string;
  role: 'admin' | 'staff';
  businessName?: string | null;
  businessType?: string | null;
  area?: string | null;
  pictureUrl?: string | null;
  parentId?: string | null;
  /**
   * v32. ROLE CHECKS ONLY, never scoping. Read at login so an account below staff is
   * refused the door: 'substaff' is retired in code, but legacy rows still carry it.
   */
  account_level?: string | null;
  /** v41. NOT NULL DEFAULT 'PKR', so every row has one; nullable here for old fixtures. */
  default_currency?: string | null;
  createdAt: string;
  updatedAt: string;
}

const SCHEME_PREFIX = 'sha256$';
const HASH_ITERATIONS = 10000; // work factor, similar purpose to bcrypt rounds

function generateSalt(): string {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2Like(password: string, salt: string): Promise<string> {
  let hash = password + salt;
  for (let i = 0; i < HASH_ITERATIONS; i++) {
    hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, hash);
  }
  return hash;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const hash = await pbkdf2Like(password, salt);
  return `${SCHEME_PREFIX}${salt}$${hash}`;
}

async function verifyStoredHash(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(SCHEME_PREFIX)) return false;
  const rest = stored.slice(SCHEME_PREFIX.length);
  const [salt, originalHash] = rest.split('$');
  if (!salt || !originalHash) return false;
  const candidateHash = await pbkdf2Like(password, salt);
  return candidateHash === originalHash;
}

function toPublicUser(record: UserRecord): User {
  return {
    id: record.id,
    name: record.name,
    name_ur: record.name_ur ?? undefined,
    phone: record.phone,
    role: record.role,
    businessName: record.businessName ?? undefined,
    businessType: record.businessType ?? undefined,
    area: record.area ?? undefined,
    pictureUrl: record.pictureUrl ?? undefined,
    parentId: record.parentId ?? undefined,
    // Carried on the session so a form can default its currency chip without a query.
    // resolveCurrency is total, so a pre-v41 row with no value reads as PKR.
    defaultCurrency: resolveCurrency(record.default_currency).code,
    createdAt: record.createdAt,
  };
}

/**
 * `accountLevel` is explicit rather than inferred, so seeding and account creation
 * both state the level they mean. An inconsistent role / level / parent combination
 * throws — it is never silently corrected.
 */
export const createUser = async (
  name: string,
  phone: string,
  password: string,
  role: 'admin' | 'staff',
  accountLevel: AccountLevel,
  businessName?: string,
  parentId?: string,
  name_ur?: string,
  businessType?: string,
  area?: string,
  pictureUrl?: string,
  /** Suggested from the phone by the caller; unknown values fall back to PKR. */
  defaultCurrency?: CurrencyCode
): Promise<User> => {
  const db = await getDatabase();

  const parent = parentId
    ? await db.getFirstAsync<{ account_level: AccountLevel | null }>(
        'SELECT account_level FROM users WHERE id = ?', [parentId]
      )
    : null;
  if (parentId && !parent) throw new Error('Parent account not found.');
  assertConsistentLevel({ role, parentId, parentLevel: parent?.account_level ?? null, level: accountLevel });

  // Stored in the SAME form login looks it up in. Saving the number as typed meant
  // "0300 1234567" or "+923001234567" produced an account that could never log in.
  phone = normalisePhone(phone);
  // users.phone is UNIQUE across removed accounts too (their rows are kept), so say so
  // plainly instead of surfacing a raw constraint error.
  const taken = await db.getFirstAsync<{ id: string }>('SELECT id FROM users WHERE phone = ? LIMIT 1', [phone]);
  if (taken) throw new Error('This phone number already has a login (possibly a removed account).');

  // resolveCurrency is total, so a stray or missing value can never write a bad column.
  const currency = resolveCurrency(defaultCurrency).code;
  const passwordHash = await hashPassword(password);
  const id = `user_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO users (id, name, name_ur, phone, passwordHash, role, account_level, businessName, businessType, area, pictureUrl, parentId, default_currency, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, name_ur ?? null, phone, passwordHash, role, accountLevel,
     businessName ?? null, businessType ?? null, area ?? null,
     pictureUrl ?? null, parentId ?? null, currency, now, now]
  );

  return { id, name, name_ur, phone, role, businessName, businessType, area, pictureUrl, parentId, defaultCurrency: currency, createdAt: now };
};

/**
 * THE canonical spelling of a login phone: E.164, e.g. "+923001234567".
 *
 * Every write and every lookup goes through this, so a number is stored one way and
 * found one way. A local number with no country code takes the shop's default country
 * (utils/phone.DEFAULT_COUNTRY_CODE); anything already international is trusted as given.
 */
export function normalisePhone(raw: string): string {
  // E.164: '+' then country code then the subscriber number — ONE canonical spelling,
  // so the same person typing "0300 1234567", "+92 300 1234567" or "0092 3001234567"
  // always resolves to the same login.
  //
  // This used to strip only '92' and force a leading '0' onto everything else, which
  // mangled every non-Pakistani number: a Dubai +971501234567 was stored as
  // 0971501234567 and a US +12125551234 as 012125551234. It was self-consistent, so
  // login still worked — but the stored value was not a phone number, and you cannot
  // recover the real one from it. That matters now: this value is about to become the
  // Firebase Auth identifier, and once it is, it is frozen.
  //
  // The country logic is NOT re-implemented here. utils/phone.internationalPhone already
  // resolves the four shapes this field accepts (and documents why a hardcoded country
  // list sent Saudi numbers to Pakistani strangers). A second copy of that rule is how
  // the two would drift.
  // A LOGIN FIELD IS TYPED, and people leave the trunk '0' off: "3001234567" is the same
  // number as "03001234567". internationalPhone reads a number with no leading 0 as
  // "already carries a country code" — correct for a stored contact number, wrong here,
  // and it produced '+3000000000', an account only reachable by typing it that same way.
  // Restore the trunk 0 first, so the shared helper sees the shape it documents.
  const typed = raw.trim();
  const bare = typed.replace(/\D/g, '');
  const looksNational =
    !typed.startsWith('+') && !bare.startsWith('00') && !bare.startsWith('0') &&
    bare.length === MAX_NATIONAL_DIGITS;
  const digits = internationalPhone(looksNational ? '0' + bare : raw);
  // Too short to be a number at all (a half-typed field). Return the bare digits so the
  // lookup simply finds nobody, rather than throwing inside a login attempt.
  if (!digits) return bare;
  return '+' + digits;
}

// Used by login: verifies password and returns the public user, or null on failure.
export const verifyUserLogin = async (
  phone: string,
  password: string
): Promise<User | null> => {
  const db = await getDatabase();
  const normalised = normalisePhone(phone);

  // is_deleted = 1 means the account was removed by an owner/parent staff. The row
  // is kept so their historical entries stay visible, but they cannot log in.
  const record = await db.getFirstAsync<UserRecord>(
    'SELECT * FROM users WHERE phone = ? AND is_deleted = 0 LIMIT 1',
    [normalised]
  );
  // Never log the phone (or anything typed here): it is the login and personal data.
  if (!record) {
    if (__DEV__) console.warn('[DB] verifyUserLogin — no matching account');
    return null;
  }
  const valid = await verifyStoredHash(password, record.passwordHash);
  if (!valid) {
    if (__DEV__) console.warn('[DB] verifyUserLogin — password mismatch');
    return null;
  }
  // SUB-STAFF HAVE NO LOGIN. Nothing creates one any more — assertConsistentLevel
  // refuses it outright — but a row created BEFORE that rule still carries a password
  // hash, and this function only ever checked is_deleted and the hash. So a legacy
  // sub-staff could still sign in on a phone that had not run the dev wipe. The policy
  // is enforced here, at the door, rather than relying on every row having been cleaned
  // up: no account below staff authenticates, whatever is in the table.
  if (record.account_level === 'substaff') {
    if (__DEV__) console.warn('[DB] verifyUserLogin — refused: sub-staff have no login');
    return null;
  }
  return toPublicUser(record);
};

/** THE password strength rule — account creation and password change share it. */
export function accountPasswordProblem(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return null;
}

/**
 * A signed-in user changing their OWN password: the current password must be right,
 * and the new one must pass the same strength rule as account creation (it used to
 * accept 6 characters and never asked for the current password).
 */
export const changeOwnPassword = async (userId: string, currentPassword: string, newPassword: string): Promise<void> => {
  const db = await getDatabase();
  const record = await db.getFirstAsync<UserRecord>('SELECT * FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1', [userId]);
  if (!record) throw new Error('Account not found.');
  if (!(await verifyStoredHash(currentPassword, record.passwordHash))) throw new Error('Current password is incorrect.');
  const problem = accountPasswordProblem(newPassword);
  if (problem) throw new Error(problem + '.');
  if (currentPassword === newPassword) throw new Error('The new password must be different from the current one.');

  // FIREBASE MOVES FIRST, and the local hash only follows if it succeeded.
  //
  // A local hash never syncs (syncHelpers.LOCAL_ONLY_FIELDS), so it is per device, while
  // the Firebase credential is shared. If the local hash moved first and Firebase then
  // refused, the two would be permanently out of step and this phone could never upload
  // again. Failing before anything changes is the only ordering with no broken state.
  // Loading the Firebase layer must not be able to break a local password change: the
  // module pulls in the web SDK, and if that fails to load for any reason the right
  // outcome is "there is no sync to keep in step", not a refused change.
  const firebaseConfigured = await (async () => {
    try {
      const { IS_FIREBASE_CONFIGURED } = await import('../firebase/firebaseConfig');
      return IS_FIREBASE_CONFIGURED;
    } catch {
      return false;
    }
  })();
  if (firebaseConfigured) {
    // CHANGING A PASSWORD REQUIRES CONNECTIVITY, and that is a deliberate trade. It is
    // rare and intentional, unlike writing a transaction, which must keep working offline
    // and still does — nothing else in this app asks for a network.
    const { useSyncStore } = await import('../../store/useSyncStore');
    if (!useSyncStore.getState().isOnline) throw new Error('PASSWORD_CHANGE_NEEDS_ONLINE');

    const { changeFirebasePassword } = await import('../firebase/firebaseAuth');
    const result = await changeFirebasePassword(record.phone, currentPassword, newPassword);
    if (result.status === 'failed') {
      // The CODE, not just the thrown label. The label is what the UI shows; the code is the
      // only thing that says whether this was the network, a weak password or a stale
      // session, and it used to be discarded here.
      if (__DEV__) console.warn('[Auth] Firebase password change failed:', result.code);
      throw new Error(result.code === 'password-divergence'
        ? 'PASSWORD_DIVERGED'
        : 'PASSWORD_CHANGE_FAILED');
    }
  }

  await changePassword(userId, newPassword);
};

export const changePassword = async (userId: string, newPassword: string): Promise<void> => {
  const db = await getDatabase();
  const passwordHash = await hashPassword(newPassword);
  await db.runAsync('UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?', [
    passwordHash,
    new Date().toISOString(),
    userId
  ]);
};

export const getUserByPhone = async (phone: string): Promise<User | null> => {
  const db = await getDatabase();
  const normalised = normalisePhone(phone);
  const record = await db.getFirstAsync<UserRecord>(
    'SELECT * FROM users WHERE phone = ? LIMIT 1',
    [normalised]
  );
  return record ? toPublicUser(record) : null;
};

export const getUserById = async (id: string): Promise<User | null> => {
  const db = await getDatabase();
  const record = await db.getFirstAsync<UserRecord>(
    'SELECT * FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return record ? toPublicUser(record) : null;
};

/**
 * Users inside the caller's own tree: their direct staff and those staff's
 * sub-staff. Excludes the caller and anyone removed.
 *
 * Replaces the old getAllUsers(), which had no filter at all and therefore
 * exposed every other business owner's staff on the admin dashboard.
 */
/** A scoped user plus their explicit level and parent's name, for display only. */
export interface ScopedUser extends User {
  account_level?: AccountLevel | null;
  parentName?: string | null;
}

export const getUsersInScope = async (viewerId: string): Promise<ScopedUser[]> => {
  const db = await getDatabase();
  const records = await db.getAllAsync<UserRecord & { account_level: AccountLevel | null; parentName: string | null }>(
    `SELECT u.id, u.name, u.name_ur, u.phone, u.role, u.businessName, u.businessType,
            u.area, u.pictureUrl, u.parentId, u.createdAt, u.updatedAt,
            u.account_level AS account_level, p.name AS parentName
       FROM users u
       LEFT JOIN users p ON p.id = u.parentId
      WHERE u.is_deleted = 0
        AND u.id != ?
        AND u.parentId = ?
      ORDER BY u.createdAt DESC`,
    [viewerId, viewerId]
  );
  return records.map(r => ({ ...toPublicUser(r), account_level: r.account_level, parentName: r.parentName }));
};

export const updateUser = async (
  id: string,
  updates: Partial<Pick<User, 'name' | 'name_ur' | 'phone' | 'businessName' | 'businessType' | 'area' | 'pictureUrl'>>
): Promise<void> => {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: (string | null)[] = [];

  if (updates.name)                   { fields.push('name = ?');         values.push(updates.name); }
  if (updates.name_ur !== undefined)  { fields.push('name_ur = ?');      values.push(updates.name_ur ?? null); }
  if (updates.phone)                  { fields.push('phone = ?');        values.push(updates.phone); }
  if (updates.businessName !== undefined) { fields.push('businessName = ?'); values.push(updates.businessName ?? null); }
  if (updates.businessType !== undefined) { fields.push('businessType = ?'); values.push(updates.businessType ?? null); }
  if (updates.area !== undefined)     { fields.push('area = ?');         values.push(updates.area ?? null); }
  if (updates.pictureUrl !== undefined) { fields.push('pictureUrl = ?'); values.push(updates.pictureUrl ?? null); }

  if (fields.length === 0) return;
  fields.push('updatedAt = ?');
  values.push(now);
  values.push(id);

  await db.runAsync(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
};

/**
 * Removes a person's ACCESS without destroying anything.
 *
 * This replaces a hard `DELETE FROM users`, which was the only place in the app
 * that could lose financial records: entry visibility is derived from live
 * parentId chains in `users` (see queryHelpers.userScope), so deleting the row
 * made every entry that person had ever recorded unreachable — to the owner too.
 *
 * Keeping the row is exactly what preserves that visibility. Nothing cascades.
 */
export const deactivateUser = async (id: string): Promise<void> => {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE users SET is_deleted = 1, deleted_at = ?, updatedAt = ? WHERE id = ?',
    [now, now, id]
  );
};

// getSubStaffByParentId, SubStaffRow and getSubStaffFor lived here. They existed only
// to list accounts BELOW a staff member — a level that no longer exists — and their one
// consumer (screens/admin/StaffDetailScreen) was already unreachable.
