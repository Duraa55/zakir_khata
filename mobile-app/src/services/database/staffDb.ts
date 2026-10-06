import { getDatabase } from './db';
import { entryOwner } from './entryScope';
import { StaffRecord } from '../../types/staff.types';
import { writeWithSync } from './syncHelpers';
import { resolveCurrency, DEFAULT_CURRENCY, type CurrencyCode } from '../../utils/currency';

// Staff are created ONLY through managedAccountDb.createStaffMember, which writes the
// login and this staff_record together, linked. There is no profile-without-login path.

export const getStaffRecords = async (viewerId: string, createdBy?: string): Promise<StaffRecord[]> => {
  // The people this account added. `createdBy` opens a staff member's own sub-staff from
  // their profile — downward only, permission-checked like every other drill-down.
  const userId = await entryOwner(viewerId, createdBy);
  const db = await getDatabase();

  const records = await db.getAllAsync<any>(
    `SELECT * FROM staff_records
      WHERE user_id = ?
       AND is_deleted = 0
     ORDER BY created_at DESC`,
    [userId]
  );

  return records.map(r => ({
    ...r,
    document_urls: r.document_urls ? JSON.parse(r.document_urls) : undefined
  }));
};

/** One staff profile, inside the viewer's own tree. The scoping subquery is the shared
 *  hierarchy filter, byte-identical to getStaffRecords above. */
export const getStaffRecordById = async (userId: string, staffId: string): Promise<StaffRecord | null> => {
  const db = await getDatabase();


  const record = await db.getFirstAsync<any>(
    `SELECT * FROM staff_records
      WHERE (user_id = ? OR user_id IN (SELECT id FROM users WHERE parentId = ?))
       AND is_deleted = 0
       AND id = ?`,
    [userId, userId, staffId]
  );

  return record ? { ...record, document_urls: record.document_urls ? JSON.parse(record.document_urls) : undefined } : null;
};

/**
 * The staff_record belonging to THIS login, found through `linked_user_id`.
 *
 * An admin-created staff member owns two rows: the `users` login they sign in with and
 * the `staff_records` profile the admin filled in. The profile carries the photo and the
 * documents, and `user_id` on it is the ADMIN (who created it), so none of the reads above
 * — which scope by `user_id` — ever return it to the staff member themselves. That is why
 * a staff member could not see their own picture.
 *
 * This is the one read keyed on `linked_user_id` instead: strictly the caller's own row,
 * narrower than every other scope, and it needs no permission check because the subject
 * and the viewer are the same person. Returns null for an admin (no profile row) and for
 * a sub-staff record, which has no login to match (`linked_user_id IS NULL`).
 */
export const getOwnStaffProfile = async (userId: string): Promise<StaffRecord | null> => {
  if (!userId) return null;
  const db = await getDatabase();
  const record = await db.getFirstAsync<any>(
    `SELECT * FROM staff_records
      WHERE linked_user_id = ?
       AND is_deleted = 0
     LIMIT 1`,
    [userId]
  );
  return record ? { ...record, document_urls: record.document_urls ? JSON.parse(record.document_urls) : undefined } : null;
};

export const getStaffStats = async (userId: string): Promise<{ total: number; active: number; inactive: number }> => {
  const db = await getDatabase();


  const results = await db.getAllAsync<{ status: string; count: number }>(
    `SELECT status, COUNT(*) as count FROM staff_records 
      WHERE (user_id = ? OR user_id IN (SELECT id FROM users WHERE parentId = ?)) 
       AND is_deleted = 0
     GROUP BY status`,
    [userId, userId]
  );

  let active = 0;
  let inactive = 0;
  
  for (const r of results) {
    if (r.status === 'active') active = r.count;
    if (r.status === 'inactive') inactive = r.count;
  }

  return {
    total: active + inactive,
    active,
    inactive
  };
};

/** The image to show for a staff member: remote if we have it, else the local copy, else nothing (caller draws the initial). Same order as customerPhotoUri. */
export const staffPhotoUri = (s: Pick<StaffRecord, 'photo_local_path' | 'photo_remote_url'> | null | undefined): string | null =>
  s?.photo_remote_url || s?.photo_local_path || null;

/**
 * The avatar for the signed-in account, resolved across BOTH places a photo can live.
 *
 * `users.pictureUrl` is the one the account holder sets for themselves; the admin who
 * created them writes `staff_records.photo_local_path` instead. Own picture wins, so
 * setting one in Settings overrides what the admin chose and nothing is copied between
 * the two columns — each keeps a single owner. Falls back to the admin's photo, then to
 * null so the caller draws the initial, exactly like staffPhotoUri and customerPhotoUri.
 *
 * Both paths point inside this app's documentDirectory, which is shared by every account
 * on the device, so the file resolves for the staff member and the admin alike.
 */
export const accountPhotoUri = (
  pictureUrl: string | null | undefined,
  ownProfile: Pick<StaffRecord, 'photo_local_path' | 'photo_remote_url'> | null | undefined
): string | null => pictureUrl || staffPhotoUri(ownProfile);

/** Stores the durable document paths (from persistStaffDocument) on a staff record. */
export const updateStaffDocuments = async (
  staffId: string,
  userId: string,
  documentUrls: string[]
): Promise<void> => {
  const now = new Date().toISOString();
  await writeWithSync({
    tableName: 'staff_records',
    recordId: staffId,
    operation: 'update',
    data: {
      // Same JSON shape getStaffRecords parses back out.
      document_urls: documentUrls.length ? JSON.stringify(documentUrls) : null,
      updated_at: now
    },
    firestorePath: `users/${userId}/staff_records/${staffId}`,
    userId
  });
};

/** Stores the durable photo path (from persistStaffPhoto) on a staff record. */
export const updateStaffPhoto = async (
  staffId: string,
  userId: string,
  photoLocalPath: string | null
): Promise<void> => {
  const now = new Date().toISOString();
  await writeWithSync({
    tableName: 'staff_records',
    recordId: staffId,
    operation: 'update',
    data: {
      photo_local_path: photoLocalPath,
      updated_at: now
    },
    firestorePath: `users/${userId}/staff_records/${staffId}`,
    userId
  });
};

export const updateStaffSalary = async (
  staffId: string,
  userId: string,
  monthlySalary: number
): Promise<void> => {
  const now = new Date().toISOString();
  await writeWithSync({
    tableName: 'staff_records',
    recordId: staffId,
    operation: 'update',
    data: {
      monthly_salary: monthlySalary,
      updated_at: now
    },
    firestorePath: `users/${userId}/staff_records/${staffId}`,
    userId
  });
};

/**
 * The default currency of the LOGIN a staff profile belongs to.
 *
 * It lives on `users.default_currency`, not on the staff_record, because it belongs to
 * the account that records entries — a profile with no `linked_user_id` records none,
 * so it has no currency and the caller should not offer to change one. PKR is returned
 * for that case and for any unrecognised stored value, since resolveCurrency is total.
 */
export const getAccountCurrency = async (linkedUserId?: string | null): Promise<CurrencyCode> => {
  if (!linkedUserId) return DEFAULT_CURRENCY;
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ default_currency: string | null }>(
    'SELECT default_currency FROM users WHERE id = ?', [linkedUserId]
  );
  return resolveCurrency(row?.default_currency).code;
};
