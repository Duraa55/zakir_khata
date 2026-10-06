import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from './db';
import { withWriteTransaction } from './writeTransaction';
import { writeRowWithSyncIn, afterSyncedWrite } from './syncHelpers';

/**
 * Salary months, closed the way cash days are closed (day_closings, v33).
 *
 * Closing a month SNAPSHOTS it: the salary that applied, what was paid, what was left
 * and — the point of the whole thing — the advance carried out of it. The next month's
 * due opens at `salary − advance`, so an overpayment is worked off instead of vanishing.
 *
 * Nothing is locked. A payment can still land in a closed month; the month is then
 * `drifted` and can be closed again, which appends a new snapshot rather than
 * overwriting the old one.
 *
 * Every figure here is a SQL aggregate over the whole set — never summed from the rows
 * a screen has loaded — and every amount is integer paisa.
 */
export interface SalaryMonthClosing {
  id: string;
  user_id: string;
  staff_id: string;
  month: string;              // 'YYYY-MM'
  closed_at: string;
  closed_by: string;
  closed_by_name: string;
  salary_paisa: number;
  opening_advance_paisa: number;
  paid_paisa: number;
  due_paisa: number;
  remaining_paisa: number;
  carry_advance_paisa: number;
  note?: string | null;
}

export interface SalaryMonthState {
  month: string;
  /** The staff member's salary for this month, in paisa. */
  salaryPaisa: number;
  /** Advance carried in from the most recent closed month before this one. */
  openingAdvancePaisa: number;
  /** Which month that advance came from, for the "advance from Sep applied" line. */
  advanceFromMonth: string | null;
  /** salary − opening advance, floored at zero: an advance bigger than a month zeroes it. */
  duePaisa: number;
  /** Net paid inside this month (cash out − cash in). */
  paidPaisa: number;
  /** What is still owed for this month. */
  remainingPaisa: number;
  /** Paid beyond the due — shown as "Extra paid". Zero when none. */
  extraPaidPaisa: number;
  /** What this month hands to the next: unused advance + anything overpaid here. */
  carryAdvancePaisa: number;
  /** Latest snapshot for this month, or null when it was never closed. */
  latestClosing: SalaryMonthClosing | null;
  /** True when the live figures no longer match that snapshot. */
  drifted: boolean;
}

type Actor = { id: string; name: string; role: string; account_level: string | null; is_deleted: number };

async function currentActor(db: SQLiteDatabase): Promise<Actor> {
  const { useAuthStore } = await import('../../store/authStore');
  const session = useAuthStore.getState();
  if (!session.isAuthenticated || !session.user) throw new Error('Please log in to continue.');
  const actor = await db.getFirstAsync<Actor>(
    'SELECT id, name, role, account_level, is_deleted FROM users WHERE id = ?',
    [session.user.id]
  );
  if (!actor || actor.is_deleted) throw new Error('Your account no longer has access.');
  return actor;
}

/**
 * Closing a salary month is a supervisory act, so it matches who may close a day:
 * the owner, or the staff member who runs the branch. (The level below staff is retired;
 * the gate is kept as the named boundary should it ever return.) It records payments but does
 * not sign a month off. Uses account_level (v32), never parentId depth.
 */
export const mayCloseSalaryMonth = (actor: Pick<Actor, 'role' | 'account_level'>): boolean =>
  actor.role === 'admin' || actor.account_level === 'admin' || actor.account_level === 'staff';

/** 'YYYY-MM' + 1 month. */
export const nextMonthKey = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

const rowToClosing = (r: any): SalaryMonthClosing | null => (r ? { ...r } : null);

/** Net paid inside one month: cash out minus cash received back. SQL, whole set. */
async function paidInMonth(db: SQLiteDatabase, staffId: string, month: string): Promise<number> {
  const row = await db.getFirstAsync<{ net: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount ELSE -amount END), 0) AS net
       FROM staff_salary_transactions
      WHERE staff_id = ? AND is_deleted = 0 AND (month = ? OR date LIKE ?)`,
    [staffId, month, `${month}%`]
  );
  return row?.net ?? 0;
}

async function monthStateIn(db: SQLiteDatabase, staffId: string, month: string): Promise<SalaryMonthState> {
  const staff = await db.getFirstAsync<{ monthly_salary: number }>(
    'SELECT monthly_salary FROM staff_records WHERE id = ? AND is_deleted = 0', [staffId]
  );
  const salaryPaisa = staff?.monthly_salary ?? 0;

  // The chain starts at the first CLOSED month: months nobody closed never accrue, so
  // a staff member who joined years before the ledger cannot show phantom arrears.
  const previous = await db.getFirstAsync<any>(
    `SELECT * FROM salary_month_closings
      WHERE staff_id = ? AND is_deleted = 0 AND month < ?
      ORDER BY month DESC, closed_at DESC LIMIT 1`,
    [staffId, month]
  );
  const openingAdvancePaisa = previous?.carry_advance_paisa ?? 0;
  // An advance bigger than this month's salary is only PARTLY used up here; whatever is
  // left must keep travelling, or a large advance would silently evaporate after one month.
  const advanceUsedPaisa = Math.min(openingAdvancePaisa, salaryPaisa);
  const unusedAdvancePaisa = openingAdvancePaisa - advanceUsedPaisa;
  const duePaisa = salaryPaisa - advanceUsedPaisa;
  const paidPaisa = await paidInMonth(db, staffId, month);
  const latest = rowToClosing(await db.getFirstAsync<any>(
    `SELECT * FROM salary_month_closings
      WHERE staff_id = ? AND is_deleted = 0 AND month = ?
      ORDER BY closed_at DESC LIMIT 1`,
    [staffId, month]
  ));

  return {
    month,
    salaryPaisa,
    openingAdvancePaisa,
    advanceFromMonth: openingAdvancePaisa > 0 ? (previous?.month ?? null) : null,
    duePaisa,
    paidPaisa,
    remainingPaisa: Math.max(0, duePaisa - paidPaisa),
    extraPaidPaisa: Math.max(0, paidPaisa - duePaisa),
    // What this month hands on: the part of the old advance it could not absorb, plus
    // anything overpaid inside it.
    carryAdvancePaisa: unusedAdvancePaisa + Math.max(0, paidPaisa - duePaisa),
    latestClosing: latest,
    drifted: !!latest && (latest.paid_paisa !== paidPaisa || latest.salary_paisa !== salaryPaisa),
  };
}

/** The live state of one salary month, including any advance carried into it. */
export const getSalaryMonthState = async (staffId: string, month: string): Promise<SalaryMonthState> => {
  const db = await getDatabase();
  return monthStateIn(db, staffId, month);
};

/** Whether the logged-in account may close this staff member's months. */
export const canCloseSalaryMonthFor = async (staffId: string): Promise<boolean> => {
  const db = await getDatabase();
  try {
    const actor = await currentActor(db);
    if (!mayCloseSalaryMonth(actor)) return false;
    return await inTeam(db, actor, staffId);
  } catch {
    return false;
  }
};

/** The staff member must sit inside the actor's own tree — the rule Remove uses. */
async function inTeam(db: SQLiteDatabase, actor: Actor, staffId: string): Promise<boolean> {
  const rec = await db.getFirstAsync<{ user_id: string; linked_user_id: string | null }>(
    'SELECT user_id, linked_user_id FROM staff_records WHERE id = ? AND is_deleted = 0', [staffId]
  );
  if (!rec) return false;
  const ownerOf = rec.linked_user_id
    ? (await db.getFirstAsync<{ parentId: string | null }>('SELECT parentId FROM users WHERE id = ?', [rec.linked_user_id]))?.parentId
    : rec.user_id;
  if (ownerOf === actor.id) return true;
  if (actor.role !== 'admin' || !ownerOf) return false;
  const mid = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM users WHERE id = ? AND parentId = ? AND role = 'staff'", [ownerOf, actor.id]
  );
  return !!mid;
}

/**
 * Closes one staff member's month and returns the month that follows.
 *
 * Re-closing appends another snapshot, exactly like day closings — the history of what
 * was signed off, and when, is never overwritten.
 */
export const closeSalaryMonth = async (
  staffId: string,
  month: string,
  note?: string
): Promise<{ closing: SalaryMonthClosing; nextMonth: string }> => {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid month.');
  const result = await withWriteTransaction(async db => {
    const actor = await currentActor(db);
    if (!mayCloseSalaryMonth(actor)) throw new Error('Sub-staff cannot close a salary month.');
    if (!await inTeam(db, actor, staffId)) throw new Error('You can only close months for your own team.');

    const nowMonth = new Date().toISOString().slice(0, 7);
    if (month > nowMonth) throw new Error('A future month cannot be closed yet.');

    const state = await monthStateIn(db, staffId, month);
    const owner = await db.getFirstAsync<{ user_id: string }>('SELECT user_id FROM staff_records WHERE id = ?', [staffId]);
    const id = `salclose_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const row = {
      id,
      user_id: owner?.user_id ?? actor.id,
      staff_id: staffId,
      month,
      closed_at: now,
      closed_by: actor.id,
      closed_by_name: actor.name,
      salary_paisa: state.salaryPaisa,
      opening_advance_paisa: state.openingAdvancePaisa,
      paid_paisa: state.paidPaisa,
      due_paisa: state.duePaisa,
      remaining_paisa: state.remainingPaisa,
      carry_advance_paisa: state.carryAdvancePaisa,
      note: note?.trim() || null,
      is_deleted: 0,
      deleted_at: null,
    };
    await writeRowWithSyncIn(db, {
      tableName: 'salary_month_closings',
      recordId: id,
      operation: 'create',
      data: row,
      firestorePath: `users/${row.user_id}/staff_records/${staffId}/salary_closings/${id}`,
      userId: row.user_id,
    });
    return { closing: row as SalaryMonthClosing, nextMonth: nextMonthKey(month) };
  });
  afterSyncedWrite();
  return result;
};

/** Every closing for a staff member, newest first — the audit trail of sign-offs. */
export const getSalaryClosings = async (staffId: string): Promise<SalaryMonthClosing[]> => {
  const db = await getDatabase();
  return db.getAllAsync<SalaryMonthClosing>(
    `SELECT * FROM salary_month_closings
      WHERE staff_id = ? AND is_deleted = 0
      ORDER BY month DESC, closed_at DESC`,
    [staffId]
  );
};
