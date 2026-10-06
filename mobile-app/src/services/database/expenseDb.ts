import { getDatabase } from './db';
import { Expense } from '../../types/expense.types';
import { writeWithSync } from './syncHelpers';
import { assertAllowedUpdateFields } from './updateFields';
import { entryOwner } from './entryScope';
import { keysetClause, keysetParams, nextCursorOf, PageCursor } from './pagination';
import { parseDateValue, localDate } from '../../utils/dates';
import { resolveCurrency, type CurrencyCode } from '../../utils/currency';
import { totalsFrom, type CurrencyTotal } from '../../utils/currencyTotals';
import { accountCurrencyOf } from './accountCurrency';

export type ExpenseFilter = {
  startDate?: string;
  endDate?: string;
  category?: string;
  search?: string;
  /** Staff Book drill-down: read this person's expenses (permission-checked, read-only). */
  createdBy?: string;
};

/** Per-calendar-day subtotal of the filtered expenses, for the Expense Book's day headers. */
/**
 * A day's expenses. `totalExpense` is ONE FIGURE PER CURRENCY — adding AED to PKR
 * produces a meaningless number, so the aggregate groups by currency in SQL and this
 * never collapses to a scalar. A single-currency day has exactly one entry.
 */
export type ExpenseDayTotal = { day: string; totalExpense: CurrencyTotal[]; entryCount: number };

/**
 * THE one predicate for the Expense Book: rows, headline total and day subtotals.
 * Own-only: an account reads the expenses it recorded — nobody else's. `ownerId` is
 * the viewer, or the drill-down target after entryOwner's permission check.
 */
const expenseWhere = (ownerId: string, filter: ExpenseFilter) => {
  for (const date of [filter.startDate, filter.endDate]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseDateValue(date))) {
      throw new Error('Invalid date range.');
    }
  }
  if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) throw new Error('From date must not be after To date.');
  let where = 'user_id = ? AND is_deleted = 0';
  const params: (string | number)[] = [ownerId];
  if (filter.startDate || filter.endDate) {
    where += ' AND date(expense_date) BETWEEN date(?) AND date(?)';
    params.push(filter.startDate || '0001-01-01', filter.endDate || '9999-12-31');
  }
  const category = filter.category?.trim();
  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  const search = filter.search?.trim();
  if (search) {
    // Literal substring search: %, _ and quotes are text, never SQL wildcards.
    where += ` AND (instr(lower(COALESCE(description, '')), ?) > 0
                 OR instr(lower(COALESCE(note, '')), ?) > 0
                 OR instr(lower(COALESCE(category, '')), ?) > 0)`;
    const needle = search.toLowerCase();
    params.push(needle, needle, needle);
  }
  return { where, params };
};

const EXPENSE_KEYS = { date: 'expense_date', createdAt: 'created_at', id: 'id' } as const;

/**
 * One predicate for both rows and whole-result paisa aggregates. `after` pages the
 * ROWS only; the total always covers the whole filtered set.
 */
export const getFilteredExpenses = async (
  userId: string, filter: ExpenseFilter = {}, limit = -1, offset = 0, after?: PageCursor | null
) => {
  const { where, params } = expenseWhere(await entryOwner(userId, filter.createdBy), filter);
  const db = await getDatabase();
  const rowsWhere = after ? `${where} AND ${keysetClause(EXPENSE_KEYS)}` : where;
  const rowsParams = after ? [...params, ...keysetParams(after)] : params;
  const expenses = await db.getAllAsync<Expense>(
    `SELECT * FROM expenses WHERE ${rowsWhere} ORDER BY expense_date DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...rowsParams, limit, offset]
  );
  // amount is integer paisa (v29). Summed by SQL over the WHOLE filtered set, never
  // from the returned page, so the total cannot drift from the list.
  // GROUPED BY CURRENCY in SQL, over the WHOLE filtered set — never from the returned
  // page, and never summed across currencies.
  const summaryRows = await db.getAllAsync<{ currency: string | null; totalExpense: number }>(
    `SELECT currency, COALESCE(SUM(amount), 0) as totalExpense FROM expenses WHERE ${where} GROUP BY currency`, params
  );
  return {
    expenses,
    expenseSummary: { totalExpense: totalsFrom(summaryRows, 'totalExpense', await accountCurrencyOf(db, userId)) },
    nextCursor: nextCursorOf(expenses, limit, EXPENSE_KEYS),
  };
};

/** Every calendar day in the filtered set with its SQL subtotal — one query per filter change. */
export const getExpenseDayTotals = async (userId: string, filter: ExpenseFilter = {}): Promise<ExpenseDayTotal[]> => {
  const { where, params } = expenseWhere(await entryOwner(userId, filter.createdBy), filter);
  const db = await getDatabase();
  // One row per day PER CURRENCY, folded into one stacked total per day. The grouping
  // is SQL's; JavaScript only orders the lines.
  const rows = await db.getAllAsync<{ day: string; currency: string | null; totalExpense: number; entryCount: number }>(
    `SELECT date(expense_date) AS day, currency, COALESCE(SUM(amount), 0) AS totalExpense, COUNT(*) AS entryCount
       FROM expenses WHERE ${where}
      GROUP BY date(expense_date), currency
      ORDER BY day DESC`, params
  );
  const base = await accountCurrencyOf(db, userId);
  const byDay = new Map<string, { day: string; currency: string | null; totalExpense: number; entryCount: number }[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  return [...byDay.entries()].map(([day, group]) => ({
    day,
    totalExpense: totalsFrom(group, 'totalExpense', base),
    entryCount: group.reduce((n, r) => n + Number(r.entryCount ?? 0), 0),
  }));
};

export const addExpenseRecord = async (
  expense: Omit<Expense, 'id' | 'created_at' | 'synced' | 'is_deleted'>
): Promise<Expense> => {
  const id = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = new Date().toISOString();

  // The form sends the chip's value; any other caller falls back to this ACCOUNT's
  // default rather than a hardcoded PKR, which would label a Dubai shop's expense
  // as rupees. resolveCurrency is total, so a pre-v41 account still reads as PKR.
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ default_currency: string | null }>(
    'SELECT default_currency FROM users WHERE id = ?', [expense.user_id]
  );
  const data = {
    ...expense,
    currency: expense.currency
      ? resolveCurrency(expense.currency).code
      : resolveCurrency(row?.default_currency).code,
    id,
    is_deleted: 0,
    deleted_at: null
  };

  await writeWithSync({
    tableName: 'expenses',
    recordId: id,
    operation: 'create',
    data,
    firestorePath: `users/${expense.user_id}/expenses/${id}`,
    userId: expense.user_id
  });

  return {
    ...expense,
    id,
    created_at: now,
    updated_at: now,
    synced: 0
  } as Expense;
};

export const getExpensesByMonth = async (userId: string, targetDate: Date): Promise<Expense[]> => {
  const db = await getDatabase();


  // Local month, not UTC: in PKT, toISOString() on the 1st before 05:00 returns
  // the PREVIOUS month, which silently reported the wrong month's expenses.
  const monthStr = localDate(targetDate).slice(0, 7); // YYYY-MM

  try {
    const records = await db.getAllAsync<any>(
      `SELECT * FROM expenses 
        WHERE user_id = ?
        
         AND is_deleted = 0
         AND strftime('%Y-%m', expense_date) = ?
       ORDER BY expense_date DESC, created_at DESC`,
      [userId, monthStr]
    );
    return records as Expense[];
  } catch (err) {
    if (__DEV__) console.warn('getExpensesByMonth skipped (migration pending)', err);
    return [];
  }
};

// getMonthlyExpenseTotal and calculateTodayExpenses lived here. They were called only by the
// dashboard store, which never rendered them, so they went with it. Grouped-by-currency
// totals exist now (see getFilteredExpenses / getExpenseDayTotals); these were not brought
// back because no screen shows them.
export const getExpensesByUserId = async (
  userId: string,
  limit = 50,
  offset = 0
): Promise<Expense[]> => {
  const db = await getDatabase();


  try {
    const records = await db.getAllAsync<any>(
      `SELECT * FROM expenses 
        WHERE user_id = ?
        
         AND is_deleted = 0
       ORDER BY expense_date DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );
    return records as Expense[];
  } catch (err) {
    if (__DEV__) console.warn('getExpensesByUserId skipped (migration pending)', err);
    return [];
  }
};

export const getExpenseBalanceSummary = async (
  userId: string
): Promise<{ totalExpense: number }> => {
  const db = await getDatabase();


  const result = await db.getFirstAsync<{ total: number }>(
    `SELECT SUM(amount) as total FROM expenses 
      WHERE user_id = ?
        
       AND is_deleted = 0`,
    [userId]
  );

  return { totalExpense: result?.total || 0 };
};

/** One live expense, fresh from the database (the detail screen re-reads after an edit). */
export const getExpenseById = async (id: string): Promise<Expense | null> => {
  const db = await getDatabase();
  return (await db.getFirstAsync<Expense>('SELECT * FROM expenses WHERE id = ? AND is_deleted = 0', [id])) ?? null;
};

/** Only the person who recorded an expense may change or delete it — never a parent. */
const assertOwnExpense = async (id: string, userId: string): Promise<void> => {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ user_id: string }>('SELECT user_id FROM expenses WHERE id = ? AND is_deleted = 0', [id]);
  if (!row) throw new Error('Expense not found.');
  if (!userId || row.user_id !== userId) throw new Error('You can only change your own expenses.');
};

export type ExpenseUpdate = Partial<Pick<Expense, 'amount' | 'description' | 'category' | 'note' | 'expense_date' | 'receipt_url' | 'currency'>>;

/**
 * Edit an expense in place. amount is integer paisa (> 0); the date is a local
 * YYYY-MM-DD. Fields outside the list are refused, as for every other book.
 */
export const updateExpenseRecord = async (id: string, userId: string, updates: ExpenseUpdate): Promise<void> => {
  assertAllowedUpdateFields(updates, ['amount', 'description', 'category', 'note', 'expense_date', 'receipt_url', 'currency']);
  if (Object.keys(updates).length === 0) return;
  if ('amount' in updates && (!Number.isInteger(updates.amount) || (updates.amount as number) <= 0)) {
    throw new Error('Enter an amount greater than zero.');
  }
  if ('description' in updates && !String(updates.description ?? '').trim()) throw new Error('Please enter a short description.');
  if ('expense_date' in updates && (!/^\d{4}-\d{2}-\d{2}$/.test(String(updates.expense_date)) || !parseDateValue(String(updates.expense_date)))) {
    throw new Error('Invalid date.');
  }
  await assertOwnExpense(id, userId);
  const data: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(updates)) data[k] = typeof v === 'string' ? (v.trim() || null) : (v ?? null);
  // NOT NULL in the schema, and an unsupported code must never reach the column.
  if ('currency' in updates) data.currency = resolveCurrency(updates.currency).code;
  await writeWithSync({
    tableName: 'expenses',
    recordId: id,
    operation: 'update',
    data,
    firestorePath: `users/${userId}/expenses/${id}`,
    userId
  });
};

export const deleteExpenseRecord = async (id: string, userId: string): Promise<void> => {
  await assertOwnExpense(id, userId);
  await writeWithSync({
    tableName: 'expenses',
    recordId: id,
    operation: 'delete',
    data: { id, is_deleted: 1 },
    firestorePath: `users/${userId}/expenses/${id}`,
    userId
  });
};

export async function getPendingSyncExpenses(userId: string) {
  const db = await getDatabase();
  return await db.getAllAsync(
    'SELECT * FROM expenses WHERE user_id = ? AND synced = 0',
    [userId]
  );
}
