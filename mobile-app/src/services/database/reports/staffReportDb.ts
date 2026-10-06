import { getDatabase } from '../db';
import { DateRangeFilter } from './types';
import { accountCurrencyOf } from '../accountCurrency';
import { totalsFrom, type CurrencyTotal } from '../../../utils/currencyTotals';

export type StaffPerformance = {
  staffId: string;
  staffName: string;
  /** Stacked: one figure per currency this person sold in, never their sum. */
  salesGenerated: CurrencyTotal[];
  billsCreated: number;
  expensesAdded: number;
  activitiesCount: number;
};

/**
 * The people who report DIRECTLY to this account (admin → staff; nothing sits below staff),
 * with what they actually recorded in the range: bills and sales (posted bills only),
 * expenses, and activity. Counts come from the rows themselves — bills and expenses
 * carry who made them — not from guessing at activity-log wording, which matched
 * nothing. Removed people are kept so their history stays visible.
 */
export const getStaffPerformance = async (
  userId: string,
  filters: DateRangeFilter
): Promise<StaffPerformance[]> => {
  const db = await getDatabase();
  const from = filters.startDate || '0001-01-01';
  const to = filters.endDate || '9999-12-31';
  const posted = "COALESCE(b.is_draft, 0) = 0 AND COALESCE(b.is_hold, 0) = 0";

  // The roster: one row per person, with counts only. Counts are currency-free, so this
  // is also the ORDER — it used to be `ORDER BY salesGenerated DESC`, which ranked people
  // by a sum across currencies and so put an AED seller below a smaller PKR one.
  const people = await db.getAllAsync<{
    staffId: string; staffName: string; billsCreated: number; expensesAdded: number; activitiesCount: number;
  }>(
    `SELECT u.id AS staffId, u.name AS staffName,
            (SELECT COUNT(*) FROM bills b WHERE b.user_id = u.id AND b.is_deleted = 0 AND ${posted} AND date(b.bill_date) BETWEEN date(?) AND date(?)) AS billsCreated,
            (SELECT COUNT(*) FROM expenses e WHERE e.user_id = u.id AND e.is_deleted = 0 AND date(e.expense_date) BETWEEN date(?) AND date(?)) AS expensesAdded,
            (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id AND date(a.timestamp) BETWEEN date(?) AND date(?)) AS activitiesCount
       FROM users u
      WHERE u.parentId = ?
      ORDER BY billsCreated DESC, u.name ASC`,
    [from, to, from, to, from, to, userId]
  );

  // Sales per person PER CURRENCY, in one query rather than one per person.
  const salesRows = await db.getAllAsync<{ staffId: string; currency: string | null; sales: number }>(
    `SELECT b.user_id AS staffId, b.currency AS currency, COALESCE(SUM(b.total), 0) AS sales
       FROM bills b
       JOIN users u ON u.id = b.user_id
      WHERE u.parentId = ? AND b.is_deleted = 0 AND ${posted}
        AND date(b.bill_date) BETWEEN date(?) AND date(?)
      GROUP BY b.user_id, b.currency`,
    [userId, from, to]
  );

  const base = await accountCurrencyOf(db, userId);
  const byStaff = new Map<string, typeof salesRows>();
  for (const r of salesRows) byStaff.set(r.staffId, [...(byStaff.get(r.staffId) ?? []), r]);

  return people.map(p => ({
    ...p,
    salesGenerated: totalsFrom(byStaff.get(p.staffId) ?? [], 'sales', base),
  }));
};

export type StaffAttendanceSummary = {
  staffId: string;
  staffName: string;
  daysPresent: number;
  daysAbsent: number;
  daysHalfDay: number;
};

/**
 * Attendance for the direct team only, same rule as the performance report. Dates are
 * bound in the order the SQL uses them (they used to land in the user-id slots).
 */
export const getStaffAttendanceSummary = async (
  userId: string,
  filters: DateRangeFilter
): Promise<StaffAttendanceSummary[]> => {
  const db = await getDatabase();
  const from = filters.startDate || '0001-01-01';
  const to = filters.endDate || '9999-12-31';
  return db.getAllAsync<StaffAttendanceSummary>(
    `SELECT s.id AS staffId, s.name_en AS staffName,
            COALESCE(SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END), 0) AS daysPresent,
            COALESCE(SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END), 0) AS daysAbsent,
            COALESCE(SUM(CASE WHEN a.status = 'half_day' THEN 1 ELSE 0 END), 0) AS daysHalfDay
       FROM staff_records s
       LEFT JOIN staff_attendance a
              ON a.staff_id = s.id AND COALESCE(a.is_deleted, 0) = 0 AND date(a.date) BETWEEN date(?) AND date(?)
      WHERE s.is_deleted = 0
        AND (s.linked_user_id IN (SELECT id FROM users WHERE parentId = ?)
             OR (s.linked_user_id IS NULL AND s.user_id = ?))
      GROUP BY s.id, s.name_en
      ORDER BY s.name_en ASC`,
    [from, to, userId, userId]
  );
};
