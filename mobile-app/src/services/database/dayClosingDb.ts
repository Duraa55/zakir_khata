import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from './db';
import { withWriteTransaction } from './writeTransaction';
import { parseDateValue, todayDate } from '../../utils/dates';
import { getDayBook, DayTotals } from './cashbookDb';

export interface DayClosing {
  id: string;
  user_id: string;
  business_date: string;
  closed_at: string;
  closed_by: string;
  closed_by_name: string;
  cash_in_paisa: number;
  cash_out_paisa: number;
  closing_balance_paisa: number;
  entry_count: number;
  note?: string | null;
}

/** A closed day plus how far it has moved since — never silently reconciled. */
export interface DayStatus {
  date: string;
  /** Most recent closing, or null when the day was never closed. */
  latest: DayClosing | null;
  /** Every closing for this day, newest first. Re-closing appends rather than overwrites. */
  closings: DayClosing[];
  /** Live totals right now. */
  current: DayTotals;
  /** True when the live totals differ from the latest closing. */
  drifted: boolean;
  canClose: boolean;
}

type Actor = { id: string; name: string; role: string; account_level: string | null; is_deleted: number };

async function currentActor(db: SQLiteDatabase): Promise<Actor> {
  // Identity comes from the session; name and access are re-read from SQLite.
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
 * Closing a day is a supervisory act over a cash drawer, so it belongs to whoever
 * is answerable for that drawer: the owner, or the staff who runs the branch.
 * A sub-staff records entries but does not sign the day off.
 *
 * Uses account_level (v32) — the explicit level — not parentId depth.
 */
/**
 * ⚠ CONSTANT-TRUE UNDER THE TWO-LEVEL TREE — kept on purpose, not dead code.
 *
 * This existed to stop sub-staff closing a day. Sub-staff no longer have logins, so every
 * account reaching it is an admin or a staff member. It is KEPT, with its call site intact,
 * as the named boundary for who may close a day: if a third level ever returns, the rule
 * belongs here and nowhere else.
 */
export const mayCloseDay = (actor: Pick<Actor, 'role' | 'account_level'>): boolean =>
  actor.role === 'admin' || actor.account_level === 'admin' || actor.account_level === 'staff';

const assertDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseDateValue(date)) throw new Error('Invalid date.');
};

/**
 * Records what the day totalled at this moment. Appends — an already-closed day gets
 * a SECOND row, because the sequence of closings is itself history worth keeping.
 * Nothing about the day's entries is touched.
 */
export const closeDay = async (date: string = todayDate(), note?: string): Promise<DayClosing> => {
  assertDate(date);
  if (date > todayDate()) throw new Error('A future day cannot be closed.');

  return withWriteTransaction(async db => {
    const actor = await currentActor(db);
    if (!mayCloseDay(actor)) throw new Error('Only the owner or a staff member can close a day.');

    // Snapshot exactly what this actor's day book shows — same scope, same predicate.
    const { dayTotals } = await getDayBook(actor.id, date);

    const row: DayClosing = {
      id: `close_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      user_id: actor.id,
      business_date: date,
      closed_at: new Date().toISOString(),
      closed_by: actor.id,
      closed_by_name: actor.name,
      cash_in_paisa: dayTotals.cashIn,
      cash_out_paisa: dayTotals.cashOut,
      closing_balance_paisa: dayTotals.net,
      entry_count: dayTotals.entryCount,
      note: note?.trim() || null,
    };

    await db.runAsync(
      `INSERT INTO day_closings
         (id, user_id, business_date, closed_at, closed_by, closed_by_name,
          cash_in_paisa, cash_out_paisa, closing_balance_paisa, entry_count, note, synced, firestore_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [row.id, row.user_id, row.business_date, row.closed_at, row.closed_by, row.closed_by_name,
       row.cash_in_paisa, row.cash_out_paisa, row.closing_balance_paisa, row.entry_count,
       row.note ?? null, `users/${row.user_id}/day_closings/${row.id}`]
    );
    return row;
  });
};

/**
 * This account's own closings for one day. Own-only like the Cash Book it snapshots:
 * a staff member's closing is never compared against the admin's day totals.
 */
export const getDayClosings = async (userId: string, date: string): Promise<DayClosing[]> => {
  assertDate(date);
  const db = await getDatabase();
  return db.getAllAsync<DayClosing>(
    `SELECT * FROM day_closings
      WHERE user_id = ? AND business_date = ?
      ORDER BY closed_at DESC, id DESC`,
    [userId, date]
  );
};

/**
 * Everything the day view needs to be honest about a day: its live totals, whether
 * it was closed, by whom, and whether it has moved since.
 *
 * An unclosed day returns latest = null and drifted = false, so a caller that never
 * closes anything behaves exactly as before this feature existed.
 */
export const getDayStatus = async (userId: string, date: string = todayDate()): Promise<DayStatus> => {
  assertDate(date);
  const db = await getDatabase();
  const [{ dayTotals }, closings, actor] = await Promise.all([
    getDayBook(userId, date),
    getDayClosings(userId, date),
    currentActor(db).catch(() => null),
  ]);
  const latest = closings[0] ?? null;
  const drifted = !!latest && (
    latest.cash_in_paisa !== dayTotals.cashIn ||
    latest.cash_out_paisa !== dayTotals.cashOut ||
    latest.entry_count !== dayTotals.entryCount
  );
  return {
    date,
    latest,
    closings,
    current: dayTotals,
    drifted,
    canClose: !!actor && mayCloseDay(actor) && date <= todayDate(),
  };
};
