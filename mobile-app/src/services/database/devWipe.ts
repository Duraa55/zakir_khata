import { withWriteTransaction } from './writeTransaction';

/**
 * DEV-ONLY TESTING TOOL — not a user-facing feature and not part of normal app flow,
 * where nothing is ever hard-deleted.
 *
 * Hard-deletes every non-admin login and every staff profile (with their salary and
 * attendance rows), so unified Add Staff can be tested from a clean slate. Every
 * `role = 'admin'` account is untouched, so admin login keeps working; the seeds also
 * re-create a missing admin on the next launch.
 *
 * Deliberately NOT deleted: book entries recorded by the wiped users. They stay in
 * their tables (no longer visible to anyone, since visibility follows the users tree).
 *
 * Refuses unless __DEV__, and unless the logged-in account is an admin — wiping the
 * account you are logged in as would leave a session pointing at a missing user.
 */
export async function wipeNonAdminStaffForTesting(): Promise<{ users: number; staffRecords: number }> {
  if (!__DEV__) throw new Error('This testing tool is not available in release builds.');
  const { useAuthStore } = await import('../../store/authStore');
  const current = useAuthStore.getState().user;
  if (!current) throw new Error('Please log in as an admin first.');

  return withWriteTransaction(async db => {
    const me = await db.getFirstAsync<{ role: string }>('SELECT role FROM users WHERE id = ? AND is_deleted = 0', [current.id]);
    if (me?.role !== 'admin') throw new Error('Only an admin can run the staff wipe.');

    const staffRecords = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM staff_records'))?.n ?? 0;
    const users = (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role != 'admin'"))?.n ?? 0;

    // Children first: foreign keys are not enforced, so nothing cascades on its own.
    await db.runAsync('DELETE FROM staff_salary_transactions');
    await db.runAsync('DELETE FROM staff_attendance');
    await db.runAsync('DELETE FROM staff_records');
    await db.runAsync("DELETE FROM users WHERE role != 'admin'");
    return { users, staffRecords };
  });
}

/** What the sub-staff wipe removed, per table, so nothing goes silently. */
export interface SubStaffWipeResult {
  /** Sub-staff logins deleted. */
  logins: number;
  /** staff_records that KEPT their data and became no-login sub-staff records. */
  unlinkedRecords: number;
  /** Book rows deleted, by table. Only tables with a non-zero count appear. */
  entries: Record<string, number>;
}

// Every table that records WHO authored a row, with the column that names them. Sub-staff
// could write in any of these while they still had logins.
const AUTHORED_BY: ReadonlyArray<readonly [table: string, column: string]> = [
  ['transactions', 'userId'],
  ['cashbook', 'userId'],
  ['expenses', 'user_id'],
  ['bills', 'user_id'],
  ['stock_items', 'user_id'],
  ['stock_movements', 'user_id'],
  ['customers', 'user_id'],
  ['suppliers', 'user_id'],
  ['purchase_orders', 'user_id'],
  ['purchase_invoices', 'user_id'],
  ['purchase_returns', 'user_id'],
  ['supplier_payments', 'user_id'],
  ['staff_salary_transactions', 'user_id'],
  ['salary_month_closings', 'user_id'],
  ['reminders', 'user_id'],
  ['activities', 'user_id'],
  ['user_settings', 'user_id'],
  ['staff_records', 'user_id'],
];

/**
 * DEV-ONLY TESTING TOOL — removes the sub-staff LEVEL, which no longer exists.
 *
 * Sub-staff are records now, not accounts (admin → staff is the whole tree). This deletes
 * their logins and the book rows they authored, which the owner confirmed are throwaway
 * test data.
 *
 * What it does NOT do, deliberately:
 *   - staff_records that pointed at a deleted login are KEPT and simply unlinked
 *     (linked_user_id = NULL). That IS the new model: a sub-staff is a record with no
 *     login. Their salary history hangs off staff_id and survives untouched.
 *   - entry_audit is never touched. It is append-only, enforced by a trigger that aborts
 *     any DELETE, and a deleted author does not un-happen the edit they made.
 *   - admin and staff logins are untouched; only account_level = 'substaff' is matched.
 *
 * Identified by account_level, NOT by role — both levels share role = 'staff'.
 * Soft-deleted sub-staff rows are included: they are still logins that must not exist.
 *
 * Refuses unless __DEV__, and unless the logged-in account is an admin.
 */
export async function wipeSubStaffLoginsForTesting(): Promise<SubStaffWipeResult> {
  if (!__DEV__) throw new Error('This testing tool is not available in release builds.');
  const { useAuthStore } = await import('../../store/authStore');
  const current = useAuthStore.getState().user;
  if (!current) throw new Error('Please log in as an admin first.');

  return withWriteTransaction(async db => {
    const me = await db.getFirstAsync<{ role: string }>(
      'SELECT role FROM users WHERE id = ? AND is_deleted = 0', [current.id]
    );
    if (me?.role !== 'admin') throw new Error('Only an admin can run the sub-staff wipe.');

    const rows = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM users WHERE account_level = 'substaff'"
    );
    const ids = rows.map(r => r.id);
    if (ids.length === 0) return { logins: 0, unlinkedRecords: 0, entries: {} };

    // Built from the row count, never from user input — these ids come from our own query.
    const marks = ids.map(() => '?').join(',');

    // Their profiles become no-login sub-staff records rather than disappearing.
    const unlinked = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM staff_records WHERE linked_user_id IN (${marks})`, ids
    );
    await db.runAsync(
      `UPDATE staff_records SET linked_user_id = NULL, updated_at = ? WHERE linked_user_id IN (${marks})`,
      [new Date().toISOString(), ...ids]
    );

    const entries: Record<string, number> = {};
    for (const [table, column] of AUTHORED_BY) {
      const n = (await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} IN (${marks})`, ids
      ))?.n ?? 0;
      if (n === 0) continue;
      entries[table] = n;
      await db.runAsync(`DELETE FROM ${table} WHERE ${column} IN (${marks})`, ids);
    }

    // Line tables have no author of their own — they belong to a parent that is gone by now.
    for (const [table, fk, parent] of [
      ['bill_items', 'bill_id', 'bills'],
      ['purchase_order_items', 'po_id', 'purchase_orders'],
      ['purchase_invoice_items', 'invoice_id', 'purchase_invoices'],
      ['purchase_return_items', 'return_id', 'purchase_returns'],
    ] as const) {
      const n = (await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${fk} NOT IN (SELECT id FROM ${parent})`
      ))?.n ?? 0;
      if (n === 0) continue;
      entries[table] = n;
      await db.runAsync(`DELETE FROM ${table} WHERE ${fk} NOT IN (SELECT id FROM ${parent})`);
    }

    await db.runAsync(`DELETE FROM users WHERE id IN (${marks})`, ids);

    return { logins: ids.length, unlinkedRecords: unlinked?.n ?? 0, entries };
  });
}
