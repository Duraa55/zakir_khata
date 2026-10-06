import { getDatabase } from './db';
import { assertAllowedUpdateFields } from './updateFields';
import { writeWithSync } from './syncHelpers';
import { entryOwner } from './entryScope';
import {
  normalizeCnic, normalizeEmail, normalizePhone, normalizeText,
} from '../../utils/contactValidation';

export interface Customer {
  id: string;
  user_id: string;
  name: string;
  phone?: string | null;
  notes?: string | null;
  /** v34. Durable copy under FileSystem.documentDirectory — never the picker's cache URI. */
  photo_local_path?: string | null;
  /** v34. Stays null until Firebase Storage upload is wired (sync deferred). */
  photo_remote_url?: string | null;
  email?: string | null;
  /** v34. National ID, 00000-0000000-0. Local only: never logged, never synced. */
  cnic?: string | null;
  address?: string | null;
  city?: string | null;
  created_at: string;
  updated_at?: string | null;
  synced?: number;
  is_deleted?: number;
}

export type CustomerInput = Partial<Pick<Customer,
  'name' | 'phone' | 'notes' | 'photo_local_path' | 'photo_remote_url' | 'email' | 'cnic' | 'address' | 'city'>>;

const EDITABLE_FIELDS = ['name', 'phone', 'notes', 'photo_local_path', 'photo_remote_url', 'email', 'cnic', 'address', 'city'] as const;

/**
 * Least access for national-ID data: the owner and the staff who runs a branch may
 * see a customer's CNIC; a sub-staff recording a sale may not. Enforced where the
 * value is READ (every customer query below redacts it) and mirrored on writes (a
 * sub-staff can neither set nor wipe it), not merely hidden in the UI.
 * Uses account_level (v32), the explicit level — never parentId depth.
 */
/**
 * ⚠ CONSTANT-TRUE UNDER THE TWO-LEVEL TREE — kept on purpose, not dead code.
 *
 * This existed to keep the CNIC away from sub-staff. Sub-staff no longer have logins, so
 * every account that can reach it is an admin or a staff member and the answer is always
 * yes. It is KEPT, with its call sites intact, because it is the named boundary for who
 * may read a national ID number: if a third level ever returns, the rule belongs here and
 * nowhere else. Deleting a named security check is how it gets rebuilt wrong later.
 *
 * It still returns false for an account that does not exist or has been removed.
 */
export const canViewCnic = async (userId: string): Promise<boolean> => {
  const db = await getDatabase();
  const viewer = await db.getFirstAsync<{ role: string; account_level: string | null }>(
    'SELECT role, account_level FROM users WHERE id = ? AND is_deleted = 0', [userId]
  );
  if (!viewer) return false;
  return viewer.role === 'admin' || viewer.account_level === 'admin' || viewer.account_level === 'staff';
};

const redactCnic = async <T extends { cnic?: string | null } | null>(userId: string, rows: T[]): Promise<T[]> => {
  if (rows.every(r => !r || r.cnic == null)) return rows;
  if (await canViewCnic(userId)) return rows;
  return rows.map(r => (r ? { ...r, cnic: null } : r));
};

/** The image to show for a customer: remote if we have it, else the local copy, else nothing (caller draws the initial). */
export const customerPhotoUri = (c: Pick<Customer, 'photo_local_path' | 'photo_remote_url'> | null | undefined): string | null =>
  c?.photo_remote_url || c?.photo_local_path || null;

/**
 * One validation for every add/edit path. Only name is required; every other
 * field is optional but, once entered, must be well-formed. Returns the
 * normalised values to persist. Throws a message ready for an Alert.
 */
export const normalizeCustomerInput = (input: CustomerInput, { requireName }: { requireName: boolean }): CustomerInput => {
  const out: CustomerInput = {};
  if (input.name !== undefined || requireName) {
    const name = normalizeText(input.name);
    if (!name) throw new Error('Please enter customer name');
    out.name = name;
  }
  if (input.phone !== undefined) out.phone = normalizePhone(input.phone);
  if (input.email !== undefined) out.email = normalizeEmail(input.email);
  if (input.cnic !== undefined) out.cnic = normalizeCnic(input.cnic);
  if (input.address !== undefined) out.address = normalizeText(input.address);
  if (input.city !== undefined) out.city = normalizeText(input.city);
  if (input.notes !== undefined) out.notes = normalizeText(input.notes);
  if (input.photo_local_path !== undefined) out.photo_local_path = normalizeText(input.photo_local_path);
  if (input.photo_remote_url !== undefined) out.photo_remote_url = normalizeText(input.photo_remote_url);
  return out;
};

export const addCustomer = async (
  customer: CustomerInput & { user_id: string }
): Promise<Customer> => {
  const { user_id, ...fields } = customer;
  const clean = normalizeCustomerInput(fields, { requireName: true });
  if (clean.cnic != null && !(await canViewCnic(user_id))) throw new Error('Only the owner or branch staff can record a CNIC.');
  const id = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = new Date().toISOString();

  const data = {
    ...clean,
    user_id,
    id,
    is_deleted: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now
  };

  await writeWithSync({
    tableName: 'customers',
    recordId: id,
    operation: 'create',
    data,
    firestorePath: `users/${user_id}/customers/${id}`,
    userId: user_id
  });

  return { ...data, name: clean.name as string, synced: 0 } as Customer;
};

export const updateCustomer = async (
  id: string,
  userId: string,
  updates: CustomerInput
): Promise<void> => {
  assertAllowedUpdateFields(updates, [...EDITABLE_FIELDS]);
  // Every account is its own business: only the person who added a customer may edit it.
  const db = await getDatabase();
  const owner = await db.getFirstAsync<{ user_id: string }>('SELECT user_id FROM customers WHERE id = ? AND is_deleted = 0', [id]);
  if (!owner) throw new Error('Customer not found.');
  if (!userId || owner.user_id !== userId) throw new Error('You can only change your own customers.');
  const clean = normalizeCustomerInput(updates, { requireName: false });
  if ('cnic' in clean && !(await canViewCnic(userId))) {
    // A sub-staff never sees the CNIC, so their edit form cannot carry it: setting
    // one is refused, and a blank must not silently wipe the stored value.
    if (clean.cnic != null) throw new Error('Only the owner or branch staff can record a CNIC.');
    delete clean.cnic;
  }
  if (Object.keys(clean).length === 0) return;
  const now = new Date().toISOString();

  await writeWithSync({
    tableName: 'customers',
    recordId: id,
    operation: 'update',
    data: { ...clean, updated_at: now },
    firestorePath: `users/${userId}/customers/${id}`,
    userId,
  });
};

export const getCustomerById = async (userId: string, id: string, createdBy?: string): Promise<Customer | null> => {
  const ownerId = await entryOwner(userId, createdBy);
  const db = await getDatabase();
  // Redaction follows the VIEWER (a sub-staff never sees a CNIC), ownership the owner.
  const [result] = await redactCnic(userId, [await db.getFirstAsync<Customer>(
    `SELECT * FROM customers
      WHERE user_id = ?
       AND id = ?
       AND is_deleted = 0
     LIMIT 1`,
    [ownerId, id]
  )]);
  return result ?? null;
};

/**
 * The ONE live customer carrying this name, for DISPLAY (photo, phone, CNIC beside a
 * ledger). Null when the name is unknown OR shared by two customers.
 *
 * It used to be `LIMIT 1` on an untrimmed exact match, so with two customers named
 * "Bilal" it returned whichever row SQLite reached first: the Customer Detail screen
 * showed one Bilal's photo, phone and CNIC above the OTHER Bilal's ledger, and nothing
 * on screen said which. That is the guess `matchCustomerByName` exists to refuse, so
 * this now goes through it — a shared name shows no contact details instead of someone
 * else's. Every caller already renders this null-safely.
 */
export const getCustomerByName = async (userId: string, name: string, createdBy?: string): Promise<Customer | null> => {
  const ownerId = await entryOwner(userId, createdBy);
  const db = await getDatabase();
  // Permission-checked owner, because this is a READ (the Staff Book drill-down).
  const { id } = await matchCustomerByName(ownerId, name, db);
  if (!id) return null;
  // Redaction follows the VIEWER, ownership the owner — as in getCustomerById.
  const [result] = await redactCnic(userId, [await db.getFirstAsync<Customer>(
    `SELECT * FROM customers
      WHERE user_id = ?
       AND id = ?
       AND is_deleted = 0
     LIMIT 1`,
    [ownerId, id]
  )]);
  return result ?? null;
};

/**
 * How many of this owner's live customers carry `partyName`, and the one to LINK to.
 *
 * This is the single rule for attaching a new entry to a customer record, shared by
 * khata entries (`createTransaction`) and bills (`createBill`). Both books resolving a
 * typed name through the same function is the point: two screens disagreeing about
 * whether a customer exists is how a bill ends up filed as a walk-in while that exact
 * person sits in the Khata with a ledger it never reaches.
 *
 * Same rule as the v42 backfill, and deliberately so: link only when EXACTLY ONE live
 * customer carries the name. Two customers sharing a name is ambiguous, and guessing
 * would file money on the wrong person's ledger — the entry stays name-keyed instead,
 * which still displays correctly (check 132).
 *
 * NOT `getCustomerByName`: that one takes the FIRST of two matches, which is the guess
 * this must never make, and it reads a whole row for display rather than deciding a link.
 *
 * WRITES pass the AUTHOR, never `entryOwner` — every book write in this app is
 * author-only, so an entry can only ever link to a customer of the account writing it.
 * A READ may pass the permission-checked owner instead (see `getCustomerByName`).
 */
export type CustomerNameMatch = {
  /** The customer to link to, or null when the name is new OR ambiguous. */
  id: string | null;
  /** Live customers carrying the name, counted up to 2 ("2" means two or more). */
  matches: number;
};

export const matchCustomerByName = async (
  userId: string,
  partyName: string,
  /** Pass the handle a write already holds; omit it from UI code. */
  existing?: Awaited<ReturnType<typeof getDatabase>>
): Promise<CustomerNameMatch> => {
  const db = existing ?? (await getDatabase());
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM customers
      WHERE user_id = ? AND is_deleted = 0 AND TRIM(name) = TRIM(?)
      LIMIT 2`,
    [userId, partyName]
  );
  return { id: rows.length === 1 ? rows[0].id : null, matches: rows.length };
};

export type CustomerCursor = { name: string; id: string };

/**
 * Customers matching `query` (name or phone, literal substring, case-insensitive),
 * alphabetically, `limit` at a time. `after` is the last row of the previous page,
 * so typing narrows via SQL and a long list never has to be loaded whole. The
 * count covers the WHOLE match, not the page. CNIC is redacted exactly as in every
 * other read. Used by the Customer Book and by the Add Transaction / Create Bill
 * pickers — the hottest path in the app — so the initial load is bounded too.
 */
export const searchCustomers = async (
  userId: string, query = '', limit = 50, after?: CustomerCursor | null, createdBy?: string
): Promise<{ rows: Customer[]; total: number; nextCursor: CustomerCursor | null }> => {
  // Own-only; `createdBy` is the Staff Book drill-down (permission-checked, read-only).
  const ownerId = await entryOwner(userId, createdBy);
  const db = await getDatabase();
  let where = `user_id = ?
       AND is_deleted = 0`;
  const params: any[] = [ownerId];
  const needle = query.trim().toLowerCase();
  if (needle) {
    // Literal substring on name or phone — %, _ and quotes are text, never wildcards.
    where += " AND (instr(lower(COALESCE(name, '')), ?) > 0 OR instr(COALESCE(phone, ''), ?) > 0)";
    params.push(needle, needle);
  }
  const rowsWhere = after ? `${where} AND (lower(name) > ? OR (lower(name) = ? AND id > ?))` : where;
  const rowsParams = after ? [...params, after.name.toLowerCase(), after.name.toLowerCase(), after.id] : params;
  const rows = await redactCnic(userId, await db.getAllAsync<Customer>(
    `SELECT * FROM customers WHERE ${rowsWhere} ORDER BY lower(name) ASC, id ASC LIMIT ?`, [...rowsParams, limit]
  ));
  const count = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM customers WHERE ${where}`, params);
  const last = rows[rows.length - 1];
  return { rows, total: count?.n ?? 0, nextCursor: limit > 0 && rows.length === limit && last ? { name: last.name, id: last.id } : null };
};

export const getCustomers = async (userId: string): Promise<Customer[]> => {
  const db = await getDatabase();
  return redactCnic(userId, await db.getAllAsync<Customer>(
    `SELECT * FROM customers
      WHERE user_id = ?
       AND is_deleted = 0
     ORDER BY created_at DESC`,
    [userId]
  ));
};

export const autoSeedCustomersFromTransactions = async (userId: string): Promise<void> => {
  const db = await getDatabase();

  // Get all unique partyNames from transactions that belong to this user's realm
  const txParties = await db.getAllAsync<{ partyName: string }>(
    `SELECT DISTINCT partyName FROM transactions
     WHERE userId = ?
      AND isDeleted = 0
      AND partyName IS NOT NULL
      AND partyName != ''`,
    [userId]
  );

  // Get existing customers
  const existingCusts = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM customers
     WHERE user_id = ?
      AND is_deleted = 0`,
    [userId]
  );

  const existingNames = new Set(existingCusts.map(c => c.name.toLowerCase().trim()));
  const missingNames = txParties
    .map(p => p.partyName.trim())
    .filter(name => !existingNames.has(name.toLowerCase()));

  // Create missing customers
  for (const name of missingNames) {
    if (!name) continue;
    await addCustomer({
      user_id: userId,
      name,
    });
  }
};
