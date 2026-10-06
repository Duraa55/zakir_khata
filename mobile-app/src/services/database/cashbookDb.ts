import { getDatabase } from './db';
import { assertAllowedUpdateFields } from './updateFields';
import { CashEntry } from '../../types';
import { writeWithSync } from './syncHelpers';
import { todayDate, parseDateValue } from '../../utils/dates';
import { keysetClause, keysetParams, nextCursorOf, PageCursor } from './pagination';
import { assertCanViewEntriesOf } from './entryScope';

/** Staff entries drill-down: only rows this login created (see entryScope.ts). */
export type CreatorOption = { createdBy?: string };

/**
 * OWN-ONLY BOOK. Every account's Cash Book holds exactly the rows it created —
 * an admin's book does not include their staff's entries, and no total merges
 * two people. The only way to see someone else's cash is the drill-down
 * (Staff Book → staff → Entries), which passes `createdBy` and is permission-
 * checked downward-only by assertCanViewEntriesOf.
 */
const cashOwner = async (viewerId: string, createdBy?: string): Promise<string> => {
  if (createdBy) {
    await assertCanViewEntriesOf(viewerId, createdBy);
    return createdBy;
  }
  return viewerId;
};

/**
 * A live row. Deletion has written BOTH spellings over time: the generic soft delete
 * sets `is_deleted`, so a query that read only `isDeleted` kept showing — and
 * totalling — deleted cash entries. Read-side only: no stored row is rewritten.
 */
const CASH_LIVE = 'isDeleted = 0 AND COALESCE(is_deleted, 0) = 0';

/** Only the person who wrote an entry may edit or delete it — never a parent. */
const assertOwnCashEntry = async (id: string, userId: string): Promise<void> => {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ userId: string }>('SELECT userId FROM cashbook WHERE id = ?', [id]);
  if (!row) throw new Error('Entry not found.');
  if (!userId || row.userId !== userId) throw new Error('You can only change your own entries.');
};

export type CashHistoryFilter = {
  /** Drill-down: only entries this login created. Permission is checked by the caller-facing functions. */
  createdBy?: string;
  startDate?: string;
  endDate?: string;
  direction?: 'all' | 'in' | 'out';
  search?: string;
};

/** Per-calendar-day subtotal of the filtered set, for the history list's day headers. */
export type CashDayTotal = { day: string; cashIn: number; cashOut: number; entryCount: number };

/**
 * THE one predicate for Cash History: the rows, the headline summary and the
 * per-day subtotals all come from here, so none of them can disagree.
 */
const cashHistoryWhere = (ownerId: string, filter: CashHistoryFilter) => {
  for (const date of [filter.startDate, filter.endDate]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseDateValue(date))) {
      throw new Error('Invalid date range.');
    }
  }
  if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) throw new Error('From date must not be after To date.');
  if (filter.direction && !['all', 'in', 'out'].includes(filter.direction)) throw new Error('Invalid cash direction.');
  let where = `userId = ? AND ${CASH_LIVE}`;
  const params: (string | number)[] = [ownerId];
  if (filter.startDate || filter.endDate) {
    where += ' AND date(date) BETWEEN date(?) AND date(?)';
    params.push(filter.startDate || '0001-01-01', filter.endDate || '9999-12-31');
  }
  if (filter.direction && filter.direction !== 'all') {
    where += ' AND direction = ?';
    params.push(filter.direction);
  }
  const search = filter.search?.trim();
  if (search) {
    // Literal substring search: %, _ and quotes are text, never SQL wildcards.
    where += " AND instr(lower(COALESCE(description, '')), ?) > 0";
    params.push(search.toLowerCase());
  }
  return { where, params };
};

/**
 * One predicate for both rows and whole-result paisa aggregates.
 *
 * Paging: pass `after` (the cursor from the previous page) to get the next
 * `limit` rows in the same `date DESC, createdAt DESC, id DESC` order. The cursor
 * clause is applied to the ROWS query ONLY — cashSummary always covers the whole
 * filtered set, whichever page this is. `limit/offset` remain for existing callers.
 */
export const getFilteredCashHistory = async (
  userId: string, filter: CashHistoryFilter = {}, limit = -1, offset = 0, after?: PageCursor | null
) => {
  const { where, params } = cashHistoryWhere(await cashOwner(userId, filter.createdBy), filter);
  const db = await getDatabase();
  const rowsWhere = after ? `${where} AND ${keysetClause(CASH_KEYS)}` : where;
  const rowsParams = after ? [...params, ...keysetParams(after)] : params;
  const entries = await db.getAllAsync<CashEntry>(
    `SELECT * FROM cashbook WHERE ${rowsWhere} ORDER BY date DESC, createdAt DESC, id DESC LIMIT ? OFFSET ?`,
    [...rowsParams, limit, offset]
  );
  const summary = await db.getFirstAsync<{ cashIn: number; cashOut: number }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_paisa ELSE 0 END), 0) as cashIn,
      COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_paisa ELSE 0 END), 0) as cashOut
     FROM cashbook WHERE ${where}`, params
  );
  const { cashIn = 0, cashOut = 0 } = summary || {};
  return {
    entries,
    cashSummary: { cashIn, cashOut, cashBalance: cashIn - cashOut },
    nextCursor: nextCursorOf(entries, limit, CASH_KEYS),
  };
};
const CASH_KEYS = { date: 'date', createdAt: 'createdAt', id: 'id' } as const;

/**
 * Every calendar day in the filtered set with its own SQL subtotal — ONE query per
 * filter change (≤ 366 rows a year), never per page and never a sum of loaded rows.
 * A day header therefore shows the day's whole figure even while only some of its
 * rows are on screen. Keyed by date(date) so legacy timestamp rows fall on their day.
 */
export const getCashHistoryDayTotals = async (userId: string, filter: CashHistoryFilter = {}): Promise<CashDayTotal[]> => {
  const { where, params } = cashHistoryWhere(await cashOwner(userId, filter.createdBy), filter);
  const db = await getDatabase();
  return db.getAllAsync<CashDayTotal>(
    `SELECT date(date) AS day,
            COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_paisa ELSE 0 END), 0) AS cashIn,
            COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_paisa ELSE 0 END), 0) AS cashOut,
            COUNT(*) AS entryCount
       FROM cashbook WHERE ${where}
      GROUP BY date(date)
      ORDER BY day DESC`, params
  );
};

export type { CashEntry };

export const createCashEntry = async (
  userId: string,
  description: string,
  amount_paisa: number,
  direction: 'in' | 'out',
  date?: string,
  attachment_url?: string | null,
  category?: string | null,
  note?: string | null
): Promise<CashEntry> => {
  const id = `cash_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = new Date().toISOString();
  const entryDate = date || todayDate(); // local day, not UTC

  const data = {
    id, userId, description, amount_paisa, direction, date: entryDate,
    isDeleted: 0, deletedAt: null, attachment_url: attachment_url || null,
    category: category || null, note: note || null
  };

  await writeWithSync({
    tableName: 'cashbook',
    recordId: id,
    operation: 'create',
    data,
    firestorePath: `users/${userId}/cashbook/${id}`,
    userId
  });

  return { ...data, syncStatus: 'pending', synced: 0, createdAt: now, updatedAt: now } as any;
};

export const getCashEntryById = async (id: string): Promise<CashEntry | null> => {
  const db = await getDatabase();
  const result = await db.getFirstAsync<CashEntry>(
    `SELECT * FROM cashbook WHERE id = ? AND ${CASH_LIVE} LIMIT 1`,
    [id]
  );
  return result ?? null;
};

export const getCashEntriesByUserId = async (
  userId: string,
  limit = 50,
  offset = 0
): Promise<CashEntry[]> => {
  const db = await getDatabase();
  return db.getAllAsync<CashEntry>(
    `SELECT * FROM cashbook
      WHERE userId = ? AND ${CASH_LIVE}
     ORDER BY date DESC, createdAt DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
};

export const getAllCashEntries = async (): Promise<CashEntry[]> => {
  const db = await getDatabase();
  return db.getAllAsync<CashEntry>(
    `SELECT * FROM cashbook WHERE ${CASH_LIVE} ORDER BY date DESC, createdAt DESC`
  );
};

// Returns paisa totals per direction for a user.
export const getCashBalanceSummary = async (
  userId: string,
  options: CreatorOption = {}
): Promise<{ cashIn: number; cashOut: number; cashBalance: number }> => {
  const ownerId = await cashOwner(userId, options.createdBy);
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ direction: string; total: number }>(
    `SELECT direction, SUM(amount_paisa) as total
     FROM cashbook
      WHERE userId = ? AND ${CASH_LIVE}
     GROUP BY direction`,
    [ownerId]
  );
  let cashIn = 0;
  let cashOut = 0;
  for (const r of rows) {
    if (r.direction === 'in') cashIn = r.total ?? 0;
    else cashOut = r.total ?? 0;
  }
  return { cashIn, cashOut, cashBalance: cashIn - cashOut };
};

export const updateCashEntry = async (
  id: string,
  userId: string,
  updates: Partial<Pick<CashEntry, 'description' | 'amount_paisa' | 'direction' | 'date' | 'attachment_url' | 'category' | 'note'>>
): Promise<void> => {
  assertAllowedUpdateFields(updates, ["description","amount_paisa","direction","date","attachment_url","category","note"]);
  if (Object.keys(updates).length === 0) return;
  await assertOwnCashEntry(id, userId);
  await writeWithSync({
    tableName: 'cashbook',
    recordId: id,
    operation: 'update',
    data: updates,
    firestorePath: `users/${userId}/cashbook/${id}`,
    userId
  });
};

export const deleteCashEntry = async (id: string, userId: string): Promise<void> => {
  await assertOwnCashEntry(id, userId);
  await writeWithSync({
    tableName: 'cashbook',
    recordId: id,
    operation: 'delete',
    data: {},
    firestorePath: `users/${userId}/cashbook/${id}`,
    userId
  });
};

export const getPendingSyncCashEntries = async (): Promise<CashEntry[]> => {
  const db = await getDatabase();
  return db.getAllAsync<CashEntry>(
    `SELECT * FROM cashbook WHERE syncStatus = 'pending' AND ${CASH_LIVE} ORDER BY createdAt ASC`
  );
};

export type DayTotals = { cashIn: number; cashOut: number; net: number; entryCount: number };

/**
 * The Day Book for ONE calendar day: that day's entries plus its paisa totals.
 *
 * A new day starting "fresh" is a VIEW FILTER ONLY — nothing is deleted, moved or
 * hidden when the date changes. Every past day stays queryable forever by passing
 * its date here.
 *
 * OWN-ONLY, like the whole Cash Book: the day's rows and totals are the viewer's
 * own entries (or, in a drill-down, exactly the target's). The "Cash in Hand"
 * figure beside them uses the same owner, so the two can never disagree.
 *
 * `date(date) = date(?)` rather than string equality: a legacy row holding a full
 * timestamp still matches its calendar day instead of silently disappearing.
 */
export const getDayBook = async (
  userId: string,
  date: string = todayDate(),
  options: CreatorOption = {}
): Promise<{ entries: CashEntry[]; dayTotals: DayTotals }> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseDateValue(date)) {
    throw new Error('Invalid date.');
  }
  const ownerId = await cashOwner(userId, options.createdBy);
  const where = `userId = ? AND ${CASH_LIVE} AND date(date) = date(?)`;
  const params = [ownerId, date];
  const db = await getDatabase();

  const entries = await db.getAllAsync<CashEntry>(
    `SELECT * FROM cashbook WHERE ${where} ORDER BY createdAt DESC, id DESC`,
    params
  );
  // Totals come from SQL over the same predicate, never a JS reduce over the rows.
  const totals = await db.getFirstAsync<{ cashIn: number; cashOut: number; entryCount: number }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_paisa ELSE 0 END), 0) as cashIn,
            COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_paisa ELSE 0 END), 0) as cashOut,
            COUNT(*) as entryCount
       FROM cashbook WHERE ${where}`,
    params
  );
  const { cashIn = 0, cashOut = 0, entryCount = 0 } = totals || {};
  return { entries, dayTotals: { cashIn, cashOut, net: cashIn - cashOut, entryCount } };
};
