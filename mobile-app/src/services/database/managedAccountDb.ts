import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from './db';
import { withWriteTransaction } from './writeTransaction';
import { writeRowWithSyncIn, afterSyncedWrite } from './syncHelpers';
import { createUser, accountPasswordProblem } from './userDb';
import type { User } from '../../types';
import type { StaffRecord } from '../../types/staff.types';
import { resolveCurrency, isCurrencyCode, type CurrencyCode } from '../../utils/currency';

type Manager = User & { is_deleted: number };
async function currentManager(db: SQLiteDatabase): Promise<Manager> {
  const { useAuthStore } = await import('../../store/authStore');
  const { user, isAuthenticated } = useAuthStore.getState();
  if (!isAuthenticated || !user) throw new Error('Please log in to manage accounts.');
  const actor = await db.getFirstAsync<Manager>('SELECT * FROM users WHERE id = ? AND is_deleted = 0', [user.id]);
  if (!actor) throw new Error('Your account no longer has access.');
  return actor;
}
// Two levels: only an admin creates LOGINS. A staff member adds sub-staff as RECORDS
// (staff_records with no linked_user_id), which is not an account and never comes here.
function canCreateLogins(actor: Manager): boolean {
  return actor.role === 'admin';
}
/**
 * Whether THIS caller's Add Staff makes a login or a record. Deliberately not a
 * parameter: if the caller could ask for a login, a staff member's form could ask too.
 */
async function adminIsAdding(): Promise<boolean> {
  const db = await getDatabase();
  return canCreateLogins(await currentManager(db));
}
// The strength rule lives in userDb so password change uses the very same one.
export { accountPasswordProblem } from './userDb';

type AccountInput = {
  name: string; phone: string; password: string;
  name_ur?: string; businessType?: string; area?: string;
  /** Suggested from the phone by the form; unknown or absent resolves to PKR. */
  default_currency?: CurrencyCode;
};

/**
 * The account rules — depth, branch and strength — on a connection already inside a
 * write transaction. The ONE implementation behind both createManagedAccount and
 * createStaffMember, so the rules cannot drift between them.
 */
async function createManagedAccountIn(db: SQLiteDatabase, input: AccountInput): Promise<User> {
  const problem = accountPasswordProblem(input.password);
  if (problem) throw new Error(problem);
  if (!input.name.trim() || !input.phone.trim()) throw new Error('Please enter a name and phone number.');
  const actor = await currentManager(db);
  if (!canCreateLogins(actor)) throw new Error('Only the owner can create accounts.');
  // Every login an admin creates is a staff account directly under them. There is no
  // deeper level to choose, so there is no account type and no parent to pick.
  // createUser rejects any role/level/parent combination that disagrees, and never
  // accepts role or ownership from a spread payload.
  return createUser(
    input.name.trim(), input.phone.trim(), input.password,
    'staff', 'staff',
    actor.businessName, actor.id,
    input.name_ur?.trim() || undefined, input.businessType?.trim() || undefined, input.area?.trim() || undefined,
    undefined, input.default_currency
  );
}

/** Login-only account creation — the rules primitive; Staff Book uses createStaffMember. */
export async function createManagedAccount(input: AccountInput): Promise<User> {
  // Checked before the transaction too, so a weak password never waits on the write queue.
  const problem = accountPasswordProblem(input.password);
  if (problem) throw new Error(problem);
  return withWriteTransaction(db => createManagedAccountIn(db, input));
}

/**
 * Whether the logged-in account may add someone to the Staff Book. An admin adds a staff
 * member WITH a login; a staff member adds a sub-staff RECORD with none. Who may create a
 * login is a separate, stricter question — canCreateLogins above.
 */
export async function canCreateStaff(): Promise<boolean> {
  const db = await getDatabase();
  try {
    const actor = await currentManager(db);
    return actor.role === 'admin' || actor.role === 'staff';
  } catch {
    return false;
  }
}

export interface NewStaffInput {
  name_en: string;
  name_ur?: string;
  /**
   * Contact number AND login username when an admin adds a staff member — the app
   * authenticates by phone. OPTIONAL for a sub-staff record, which has no login and
   * therefore no username; the column is nullable since v43.
   */
  phone?: string;
  /** Required for a login. Ignored for a sub-staff record, which cannot log in. */
  password?: string;
  /** Job title (e.g. "Driver") — NOT users.role, which is the permission level. */
  role: string;
  joining_date: string;
  area: string;
  /** Optional since v37 — the column is nullable. */
  business_type?: string;
  email?: string;
  address?: string;
  document_urls?: string[];
  /** integer paisa; 0 = not set */
  monthly_salary?: number;
  /**
   * Currency this account's entries default to. The form suggests it from the phone
   * (currencyFromPhone) and the admin may change it before saving. Omitted or unknown
   * resolves to PKR in createUser, so an older caller keeps working unchanged.
   */
  default_currency?: CurrencyCode;
}

/**
 * Add Staff: ONE save that creates the login and the staff_record together, linked
 * (staff_records.linked_user_id = users.id). Both rows are written in a single
 * transaction — if either fails, neither exists, so there is never a login without a
 * profile or a profile without a login.
 *
 * The level follows from who is adding: an admin adds staff; a staff member adds
 * their own sub-staff. Sub-staff cannot add anyone. The account rules are the same
 * code as createManagedAccount.
 */
export async function createStaffMember(input: NewStaffInput): Promise<{ user: User | null; staff: StaffRecord }> {
  // WHO IS ADDING decides what gets made, and the caller does not choose:
  //
  //   admin -> a STAFF MEMBER with a login (phone is their username, password required)
  //   staff -> their own SUB-STAFF as a RECORD only (no login, no password, phone optional)
  //
  // A sub-staff never installs the app; the record exists so the staff member can record
  // what they pay them. Salary already hangs off staff_records.id, not off a login
  // (staff_salary_transactions FK), so a record-only person has full salary history.
  // Nothing creates a login below staff — assertConsistentLevel refuses it outright.
  const wantsLogin = await adminIsAdding();

  // Checked before the transaction too, so a weak password never waits on the write queue.
  if (wantsLogin) {
    const problem = accountPasswordProblem(input.password ?? '');
    if (problem) throw new Error(problem);
  }
  const required: (readonly [string | undefined, string])[] = [
    [input.name_en, 'name'], [input.role, 'role'],
    [input.joining_date, 'joining date'], [input.area, 'area'],
  ];
  // A phone is the login username, so it is required for a login and only then.
  if (wantsLogin) required.push([input.phone, 'phone number']);
  for (const [value, label] of required) {
    if (!value || !String(value).trim()) throw new Error(`Please enter a ${label}.`);
  }

  const result = await withWriteTransaction(async db => {
    const actor = await currentManager(db);
    const user = wantsLogin
      ? await createManagedAccountIn(db, {
          name: input.name_en, phone: input.phone ?? '', password: input.password ?? '',
          name_ur: input.name_ur, businessType: input.business_type, area: input.area,
          default_currency: input.default_currency,
        })
      : null;

    const id = `staff_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const row = {
      id,
      user_id: actor.id,           // who created it — scoping, same as before
      // NULL for a sub-staff record: there is no login for this profile to belong to.
      linked_user_id: user ? user.id : null,
      name_en: input.name_en.trim(),
      name_ur: input.name_ur?.trim() || null,
      // With a login: the NORMALISED login phone, so the two can never disagree. Without
      // one: whatever was typed, or NULL — contact details, not a username.
      phone: user ? user.phone : (input.phone?.trim() || null),
      email: input.email?.trim() || null,
      role: input.role.trim(),
      joining_date: input.joining_date,
      area: input.area.trim(),
      business_type: input.business_type?.trim() || null,
      address: input.address?.trim() || null,
      document_urls: input.document_urls?.length ? JSON.stringify(input.document_urls) : null,
      status: 'active',
      monthly_salary: input.monthly_salary ?? 0,
      is_deleted: 0,
      deleted_at: null,
    };
    await writeRowWithSyncIn(db, {
      tableName: 'staff_records',
      recordId: id,
      operation: 'create',
      data: row,
      firestorePath: `users/${actor.id}/staff_records/${id}`,
      userId: actor.id,
    });

    const staff: StaffRecord = {
      ...row,
      name_ur: row.name_ur ?? undefined,
      email: row.email ?? undefined,
      address: row.address ?? undefined,
      document_urls: input.document_urls?.length ? input.document_urls : undefined,
      status: 'active',
      deleted_at: undefined,
      created_at: now,
      updated_at: now,
      synced: 0,
      is_deleted: 0,
    };
    return { user, staff };
  });
  afterSyncedWrite();
  return result;
}

/**
 * Remove: takes away the linked login's ACCESS and marks the profile inactive.
 * Nothing is deleted — the user row stays (so every entry they recorded stays
 * visible up the tree) and the staff_record stays (salary history kept).
 *
 * Only inside your own team: an admin can remove their staff and those staff's
 * sub-staff; a staff member can remove only their own sub-staff. Enforced here, not
 * by hiding a button.
 */
/**
 * The staff record `staffRecordId`, if the actor manages it — else an error. The person
 * hangs off `ownerOf`; it must be the actor, or (admin only) one of the actor's own
 * staff. Downward only: never a sibling, never upward. Shared by Remove and Edit so
 * the two can never disagree about who may change whom.
 */
async function managedRecordIn(
  db: SQLiteDatabase,
  actor: { id: string; role: string },
  staffRecordId: string,
  refusal: string
): Promise<{ id: string; user_id: string; linked_user_id: string | null }> {
  const rec = await db.getFirstAsync<{ id: string; user_id: string; linked_user_id: string | null }>(
    'SELECT id, user_id, linked_user_id FROM staff_records WHERE id = ? AND is_deleted = 0', [staffRecordId]
  );
  if (!rec) throw new Error('Staff member not found.');
  const ownerOf = rec.linked_user_id
    ? (await db.getFirstAsync<{ parentId: string | null }>('SELECT parentId FROM users WHERE id = ?', [rec.linked_user_id]))?.parentId
    : rec.user_id;
  let inTeam = ownerOf === actor.id;
  if (!inTeam && actor.role === 'admin' && ownerOf) {
    const mid = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM users WHERE id = ? AND parentId = ? AND role = 'staff'", [ownerOf, actor.id]
    );
    inTeam = !!mid;
  }
  if (!inTeam) throw new Error(refusal);
  return rec;
}

/** The profile fields Edit may change. The phone is the LOGIN, so it is not here. */
export type StaffProfileUpdate = Partial<Pick<StaffRecord,
  'name_en' | 'name_ur' | 'role' | 'area' | 'business_type' | 'email' | 'address' | 'joining_date'>> & {
  /**
   * The account's default currency. It lives on `users`, NOT on staff_records, so it is
   * not in STAFF_PROFILE_FIELDS and is written to the linked login below — the same
   * exception name_en already makes. A profile with no login silently has nowhere to
   * put it, which is correct: a staff_record without linked_user_id records no entries.
   */
  default_currency?: CurrencyCode;
};
const STAFF_PROFILE_FIELDS = ['name_en', 'name_ur', 'role', 'area', 'business_type', 'email', 'address', 'joining_date'] as const;

/**
 * Edit a staff member's profile. Same team rule as Remove (enforced here, not by hiding
 * a button). One transaction: the staff_record and, when the name changes, the linked
 * login's display name — so the Staff Book and everything the login recorded agree.
 */
export async function updateStaffProfile(staffRecordId: string, updates: StaffProfileUpdate): Promise<void> {
  for (const key of Object.keys(updates)) {
    if (key === 'default_currency') continue;
    if (!(STAFF_PROFILE_FIELDS as readonly string[]).includes(key)) throw new Error(`${key} cannot be changed here.`);
  }
  if ('default_currency' in updates && !isCurrencyCode(updates.default_currency)) {
    throw new Error('Choose a supported currency.');
  }
  const clean: Record<string, string | null> = {};
  for (const key of STAFF_PROFILE_FIELDS) {
    if (!(key in updates)) continue;
    const v = (updates as any)[key];
    clean[key] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  if ('name_en' in clean && !clean.name_en) throw new Error('Name is required.');
  if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) throw new Error('Enter a valid email address.');
  if (clean.joining_date && !/^\d{4}-\d{2}-\d{2}$/.test(clean.joining_date)) throw new Error('Invalid joining date.');
  if (Object.keys(clean).length === 0 && !('default_currency' in updates)) return;

  await withWriteTransaction(async db => {
    const actor = await currentManager(db);
    // No level gate: managedRecordIn below is the rule — the record must be in the actor's
    // own team. A staff member may edit their own sub-staff record; another team's is refused.
    const rec = await managedRecordIn(db, actor, staffRecordId, 'You can only edit staff in your own team.');
    const now = new Date().toISOString();
    await writeRowWithSyncIn(db, {
      tableName: 'staff_records',
      recordId: rec.id,
      operation: 'update',
      data: { ...clean, updated_at: now },
      firestorePath: `users/${rec.user_id}/staff_records/${rec.id}`,
      userId: rec.user_id,
    });
    if (clean.name_en && rec.linked_user_id) {
      await db.runAsync('UPDATE users SET name = ?, updatedAt = ? WHERE id = ?', [clean.name_en, now, rec.linked_user_id]);
    }
    if ('default_currency' in updates && rec.linked_user_id) {
      await db.runAsync('UPDATE users SET default_currency = ?, updatedAt = ? WHERE id = ?',
        [resolveCurrency(updates.default_currency).code, now, rec.linked_user_id]);
    }
  });
  afterSyncedWrite();
}

export async function removeStaffAccess(staffRecordId: string): Promise<void> {
  await withWriteTransaction(async db => {
    const actor = await currentManager(db);
    // Same as edit: the team check in managedRecordIn is the rule.
    const rec = await managedRecordIn(db, actor, staffRecordId, 'You can only remove staff from your own team.');

    const now = new Date().toISOString();
    if (rec.linked_user_id) {
      // Same soft delete as userDb.deactivateUser: the row is kept, login is refused.
      await db.runAsync(
        'UPDATE users SET is_deleted = 1, deleted_at = ?, updatedAt = ? WHERE id = ?',
        [now, now, rec.linked_user_id]
      );
    }
    await writeRowWithSyncIn(db, {
      tableName: 'staff_records',
      recordId: rec.id,
      operation: 'update',
      data: { status: 'inactive', updated_at: now },
      firestorePath: `users/${rec.user_id}/staff_records/${rec.id}`,
      userId: rec.user_id,
    });
  });
  afterSyncedWrite();
}
