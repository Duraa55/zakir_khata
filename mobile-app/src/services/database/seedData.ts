import { getDatabase } from './db';
import { createUser, normalisePhone } from './userDb';

export const ADMIN_SEED_PHONE = '03000000000';

export const seedDatabase = async (): Promise<void> => {
  const db = await getDatabase();
  // The guard MUST look for the stored (normalised) spelling. createUser normalises on
  // the way in, so checking the raw string found nothing, re-seeded on every launch, and
  // then threw "This phone number already has a login" out of app startup.
  const phone = normalisePhone(ADMIN_SEED_PHONE);
  const existing = await db.getFirstAsync<{ id: string; is_deleted: number }>(
    'SELECT id, is_deleted FROM users WHERE phone = ? LIMIT 1', [phone]
  );

  // A LIVE admin: nothing to do, the normal case.
  if (existing && !existing.is_deleted) return;

  // A SOFT-DELETED row holding the seed phone is a permanent lockout, and it is silent:
  // the old guard counted it, skipped creation, and login then found no live account
  // ("no matching account"). It cannot be fixed by creating a second row either —
  // users.phone is UNIQUE, so createUser would throw "This phone number already has a
  // login". The only way back in is to revive the row that holds it.
  //
  // Reviving a removed account is normally wrong. This one account is the BOOTSTRAP: with
  // it gone there is no way into the app at all, and nothing can be recovered by hand on a
  // phone. The password is NOT reset — only the removal is undone.
  if (existing?.is_deleted) {
    if (__DEV__) console.warn('[Seed] admin ' + phone + ' was soft-deleted and is the only account holding that number — reviving it, or the app is unreachable');
    await db.runAsync(
      "UPDATE users SET is_deleted = 0, deleted_at = NULL, role = 'admin', account_level = 'admin' WHERE id = ?",
      [existing.id]
    );
    return;
  }

  if (__DEV__) console.log('[Seed] no admin found for ' + phone + ' — creating one');

  // createUser(name, phone, password, role, businessName, parentId, name_ur, businessType, area)
  // Only the admin. Staff, sub-staff and every entry are created live in the app —
  // no demo people or demo money ship in a real install.
  await createUser('Admin', ADMIN_SEED_PHONE, 'Admin@12345', 'admin', 'admin', undefined, undefined, undefined, undefined, 'Bahawalpur');
};

// seedTestUsers DELETED (2026-10-07). It created a SECOND admin — 'AL-REEF Admin',
// 03339999999 / 'admin123' — by raw SQL that bypassed createUser, and so bypassed the
// password strength rule that account would otherwise have failed (no uppercase). It ran
// in every build, shipped a known weak admin to production, and because it inserted a
// hardcoded id it survived every wipe and re-appeared on the next launch. CLAUDE.md says
// the seed creates ONE admin. Migration v45 retires the row it already created on
// existing devices (soft delete, so anything it authored stays visible).
