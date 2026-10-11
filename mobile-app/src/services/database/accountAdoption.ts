import type { SQLiteDatabase } from 'expo-sqlite';
import { SYNC_PATHS } from './syncPaths';
import { hashPassword, normalisePhone } from './userDb';
import { ADMIN_SEED_PHONE } from './seedData';

/**
 * MAKING THIS DEVICE THE ACCOUNT A CLOUD PROFILE DESCRIBES — the local half.
 *
 * Deliberately free of any Firebase import. Everything risky here is local-database work:
 * deciding whether a row may be rewritten, and refusing when it may not. Keeping it apart
 * from `firebaseProfile.ts` is what lets it be TESTED by running it, rather than by reading
 * its source — the test harness cannot load the Firebase packages, so anything living beside
 * them can only ever be asserted as text.
 *
 * WHY ANY OF THIS IS NEEDED: every document path is `users/{LOCAL id}/…`, and that id is
 * generated per device. A second device that merely logs in is a DIFFERENT account sharing a
 * phone number — its paths would not match and every pulled row's `user_id` would point at
 * an account that does not exist locally. The id has to be shared, so it has to be adopted.
 */

/** The identity fields a cloud profile carries. No credential: there is none in it. */
export type CloudProfile = {
  id: string;
  name: string;
  name_ur: string | null;
  phone: string;
  role: string;
  account_level: string | null;
  businessName: string | null;
  businessType: string | null;
  area: string | null;
  pictureUrl: string | null;
  parentId: string | null;
  default_currency: string | null;
  createdAt: string | null;
};

export type ApplyResult =
  /** Nothing to do: this device already is that account. */
  | { status: 'already'; localId: string }
  /** No local row existed; one was built from the profile. */
  | { status: 'materialised'; localId: string }
  /** An untouched seeded admin was rewritten to the shared id. */
  | { status: 'adopted'; localId: string }
  /** A real local account already holds that phone under a different id. Never merged. */
  | { status: 'conflict' };

/**
 * Has this local account ever authored anything?
 *
 * Asked of every table whose author is a COLUMN, taken from `SYNC_PATHS` rather than a list
 * written out here — a hardcoded list is how a table gets added on one side and forgotten on
 * the other. The five parent-resolved tables are covered transitively: a bill line cannot
 * exist without its bill, and the bill carries the author.
 */
export const hasAuthoredAnything = async (db: SQLiteDatabase, localUserId: string): Promise<boolean> => {
  for (const [table, spec] of Object.entries(SYNC_PATHS)) {
    if (spec.author.kind !== 'column') continue;
    const hit = await db.getFirstAsync<{ one: number }>(
      `SELECT 1 AS one FROM ${table} WHERE ${spec.author.column} = ? LIMIT 1`, [localUserId]
    );
    if (hit) {
      if (__DEV__) console.log('[Adopt] ' + localUserId + ' has authored rows in ' + table);
      return true;
    }
  }
  return false;
};

/**
 * Could a cloud profile still replace this local row? The CHEAP, OFFLINE guard that keeps
 * the network out of every ordinary login: only an untouched seeded admin can be adopted, so
 * only that row is worth asking Firebase about.
 *
 * THE SEEDED ADMIN IS WHY ADOPTION EXISTS AT ALL. `seedDatabase` runs at boot on EVERY
 * install and creates an admin on the bootstrap number with a freshly generated local id, so
 * on a second device that row answers the login FIRST. Without this the user lands in a
 * brand-new empty account that looks entirely legitimate, with the right Firebase uid mapped
 * to the wrong local id, and pull returns nothing because every pulled row's `user_id` points
 * somewhere else.
 */
export const mayBeAdoptable = async (
  db: SQLiteDatabase,
  localUserId: string,
  e164Phone: string
): Promise<boolean> => {
  if (e164Phone !== normalisePhone(ADMIN_SEED_PHONE)) return false;
  const row = await db.getFirstAsync<{ role: string; adopted_at: string | null }>(
    'SELECT role, adopted_at FROM users WHERE id = ? AND is_deleted = 0', [localUserId]
  );
  if (row?.role !== 'admin') return false;
  // ALREADY PROVED TO BE A CLOUD IDENTITY, so nothing can replace it — and asked before the
  // table sweep, so the common case costs one indexed lookup instead of nineteen counts.
  if (row.adopted_at) return false;
  return !(await hasAuthoredAnything(db, localUserId));
};

/**
 * Write the profile into the local `users` table, or refuse.
 *
 * ADOPTION IS DELIBERATELY NARROW: an ADMIN row, on the seeded phone, that has authored
 * NOTHING in any table. Nothing can reference such a row, so rewriting its id is safe. Any
 * other collision is a real account and returns `conflict` rather than being merged — silent
 * data loss is the one outcome worse than a refused login.
 *
 * The password is the one just proved against FIREBASE, which is the shared credential; the
 * local hash is derived here and never travels.
 */
export const applyCloudProfile = async (
  db: SQLiteDatabase,
  profile: CloudProfile,
  rawPhone: string,
  password: string
): Promise<ApplyResult> => {
  const phone = normalisePhone(rawPhone);

  const existing = await db.getFirstAsync<{ id: string; role: string }>(
    'SELECT id, role FROM users WHERE phone = ? LIMIT 1', [phone]
  );
  if (existing?.id === profile.id) return { status: 'already', localId: profile.id };

  if (existing) {
    if (!(await mayBeAdoptable(db, existing.id, phone))) return { status: 'conflict' };
    // Rewrite the id in place. The row has authored nothing, so nothing points at it; and the
    // hash is replaced because the password just proved belongs to the CLOUD account, which
    // is not necessarily the one the seed created.
    await db.runAsync(
      `UPDATE users SET id = ?, name = ?, name_ur = ?, role = ?, account_level = ?,
         businessName = ?, businessType = ?, area = ?, pictureUrl = ?, parentId = ?,
         default_currency = COALESCE(?, default_currency), passwordHash = ?,
         adopted_at = ?
       WHERE id = ?`,
      [profile.id, profile.name, profile.name_ur ?? null, profile.role, profile.account_level ?? null,
       profile.businessName ?? null, profile.businessType ?? null, profile.area ?? null,
       profile.pictureUrl ?? null, profile.parentId ?? null, profile.default_currency ?? null,
       await hashPassword(password), new Date().toISOString(), existing.id]
    );
    if (__DEV__) console.log('[Adopt] seeded admin ' + existing.id + ' is now ' + profile.id);
    return { status: 'adopted', localId: profile.id };
  }

  await db.runAsync(
    `INSERT INTO users (id, name, name_ur, phone, passwordHash, role, account_level, businessName, businessType, area, pictureUrl, parentId, default_currency, createdAt, updatedAt, adopted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [profile.id, profile.name, profile.name_ur ?? null, phone, await hashPassword(password),
     profile.role, profile.account_level ?? null, profile.businessName ?? null,
     profile.businessType ?? null, profile.area ?? null, profile.pictureUrl ?? null,
     profile.parentId ?? null, profile.default_currency ?? null,
     profile.createdAt ?? new Date().toISOString(), new Date().toISOString(), new Date().toISOString()]
  );
  if (__DEV__) console.log('[Adopt] materialised ' + profile.id + ' from the cloud profile');
  return { status: 'materialised', localId: profile.id };
};
