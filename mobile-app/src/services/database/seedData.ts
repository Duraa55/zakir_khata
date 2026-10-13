import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from './db';
import { createUser, normalisePhone } from './userDb';

/**
 * THE SEEDED ACCOUNTS. Two admins since 2026-10-13, by the owner's decision, which
 * REVERSES the single-seed rule of 2026-10-07 — see CLAUDE.md for why that rule existed
 * and what is accepted by reversing it.
 *
 * EACH IS A SEPARATE BUSINESS. `parentId` is null on both, so by rule 1 they share
 * nothing: not books, not stock, not customers, not staff. Neither appears in the
 * other's Staff Book and neither can ever read the other's entries. If these two are
 * ever meant to be co-owners of ONE business, this is the wrong shape and the fix is a
 * shared-business feature, not a second admin.
 *
 * BOTH PASSWORDS SHIP IN THE APK. They are defaults to be changed on first login
 * (Settings -> Change password, which needs to be online), not secrets.
 *
 * Each must satisfy `userDb.accountPasswordProblem` (>= 8 characters, an uppercase
 * letter, a digit). `createUser` enforces it, so a weak value fails at startup rather
 * than shipping. Do not log these, and do not repeat them outside the documented lines
 * in CLAUDE.md and TESTING.md.
 *
 * CHANGING ANY OF THIS AFFECTS A FRESH INSTALL ONLY. `seedDatabase` creates an account
 * only when no row holds its phone, so a device that already has one keeps the name and
 * password it was created with — and so does that account's Firebase credential. There
 * is no rename screen, so a device wanting a new name has to be wiped.
 */
export type SeededAdmin = {
  readonly name: string;
  /** The login username as well as the contact number. UNIQUE on `users.phone`. */
  readonly phone: string;
  readonly password: string;
  readonly businessName: string;
  readonly area: string;
};

export const ZAKIR_SEED_NAME = 'Zakir';
export const ZAKIR_SEED_PHONE = '03368542509';
export const ZAKIR_SEED_PASSWORD = 'Zakir@123';

export const WASEEM_SEED_NAME = 'Waseem';
export const WASEEM_SEED_PHONE = '03337334333';
export const WASEEM_SEED_PASSWORD = 'Wasi@123';

export const SEEDED_ADMINS: readonly SeededAdmin[] = [
  { name: ZAKIR_SEED_NAME,  phone: ZAKIR_SEED_PHONE,  password: ZAKIR_SEED_PASSWORD,  businessName: 'Al Reef', area: 'Bahawalpur' },
  { name: WASEEM_SEED_NAME, phone: WASEEM_SEED_PHONE, password: WASEEM_SEED_PASSWORD, businessName: 'Al Reef', area: 'Bahawalpur' },
];

/**
 * The FIRST seeded admin, kept under the old single-admin names so callers that mean
 * "the bootstrap account" keep reading. Anything that must cover BOTH asks
 * `isSeededAdminPhone` or walks `SEEDED_ADMINS`.
 */
export const ADMIN_SEED_PHONE = ZAKIR_SEED_PHONE;
export const ADMIN_SEED_NAME = ZAKIR_SEED_NAME;
export const ADMIN_SEED_PASSWORD = ZAKIR_SEED_PASSWORD;

/**
 * Is this E.164 number one the seed owns?
 *
 * ADOPTION DEPENDS ON THIS. `accountAdoption.mayBeAdoptable` used to compare against the
 * one seed phone, so with a second seeded admin the second account would never have been
 * adoptable — a second device signing in as them would land in a brand-new empty account
 * that looks entirely legitimate, which is the exact failure adoption exists to prevent.
 */
export const isSeededAdminPhone = (e164Phone: string): boolean =>
  SEEDED_ADMINS.some(a => normalisePhone(a.phone) === e164Phone);

/**
 * Make sure every seeded account exists, once, at boot.
 *
 * PER ACCOUNT, INDEPENDENTLY. One account being present says nothing about the other, so
 * each is guarded on its own phone — a single early return would have left the second
 * admin uncreated for ever on any device that already had the first.
 */
export const seedDatabase = async (): Promise<void> => {
  const db = await getDatabase();
  for (const admin of SEEDED_ADMINS) await seedOneAdmin(db, admin);
};

const seedOneAdmin = async (db: SQLiteDatabase, admin: SeededAdmin): Promise<void> => {
  // The guard MUST look for the stored (normalised) spelling. createUser normalises on
  // the way in, so checking the raw string found nothing, re-seeded on every launch, and
  // then threw "This phone number already has a login" out of app startup.
  const phone = normalisePhone(admin.phone);
  const existing = await db.getFirstAsync<{ id: string; is_deleted: number }>(
    'SELECT id, is_deleted FROM users WHERE phone = ? LIMIT 1', [phone]
  );

  // A LIVE admin: nothing to do, the normal case.
  if (existing && !existing.is_deleted) return;

  // A SOFT-DELETED row holding a seed phone is a permanent lockout, and it is silent:
  // the old guard counted it, skipped creation, and login then found no live account
  // ("no matching account"). It cannot be fixed by creating a second row either —
  // users.phone is UNIQUE, so createUser would throw "This phone number already has a
  // login". The only way back in is to revive the row that holds it.
  //
  // Reviving a removed account is normally wrong. These accounts are the BOOTSTRAP: with
  // them gone there is no way into the app at all, and nothing can be recovered by hand on
  // a phone. The password is NOT reset — only the removal is undone.
  if (existing?.is_deleted) {
    if (__DEV__) console.warn('[Seed] a seeded admin was soft-deleted and is the only account holding its number — reviving it, or the app is unreachable');
    await db.runAsync(
      "UPDATE users SET is_deleted = 0, deleted_at = NULL, role = 'admin', account_level = 'admin' WHERE id = ?",
      [existing.id]
    );
    return;
  }

  if (__DEV__) console.log('[Seed] creating the seeded admin ' + admin.name);

  // createUser(name, phone, password, role, businessName, parentId, name_ur, businessType, area)
  //
  // THROUGH createUser, never raw SQL: that is what applies the password strength rule and
  // `assertConsistentLevel`. parentId is undefined, so each account is its own business —
  // two seeded admins are two isolated users, not co-owners of one.
  //
  // Only the admins. Staff, sub-staff and every entry are created live in the app —
  // no demo people or demo money ship in a real install.
  await createUser(
    admin.name, admin.phone, admin.password,
    'admin',              // role
    'admin',              // accountLevel — ROLE CHECKS ONLY, never scoping (rule 1)
    admin.businessName,   // what the home hero and every bill PDF show
    undefined,            // parentId: null, so this account is its own business
    undefined, undefined, // name_ur, businessType
    admin.area
  );
};
// seedTestUsers DELETED (2026-10-07). It created a SECOND admin — 'AL-REEF Admin',
// 03339999999 / 'admin123' — by raw SQL that bypassed createUser, and so bypassed the
// password strength rule that account would otherwise have failed (no uppercase). It ran
// in every build, shipped a known weak admin to production, and because it inserted a
// hardcoded id it survived every wipe and re-appeared on the next launch. CLAUDE.md says
// the seed creates ONE admin. Migration v45 retires the row it already created on
// existing devices (soft delete, so anything it authored stays visible).
