import { getDatabase } from './db';
import { Transaction } from '../../types';
import { writeWithSync } from './syncHelpers';
import { parseDateValue, todayDate } from '../../utils/dates';
import { keysetClause, keysetParams, nextCursorOf, PageCursor } from './pagination';
import { entryOwner } from './entryScope';
import { matchCustomerByName } from './customerDb';

export type KhataFilter = {
  startDate?: string;
  endDate?: string;
  type?: 'all' | 'lena' | 'dena';
  search?: string;
  /** Staff Book drill-down: read this person's khata (permission-checked, read-only). */
  createdBy?: string;
};

/** Per-calendar-day subtotal of the filtered ledger, for the Khata list's day headers. */
export type KhataDayTotal = { day: string; lena: number; dena: number; entryCount: number };

/**
 * THE one predicate for the Khata list: rows, the Lena/Dena/Net summary and the
 * per-day subtotals are all built from here, so none of them can disagree.
 * Own-only: `ownerId` is the viewer, or the drill-down target after entryOwner's check.
 */
const khataWhere = (ownerId: string, filter: KhataFilter) => {
  for (const date of [filter.startDate, filter.endDate]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseDateValue(date))) {
      throw new Error('Invalid date range.');
    }
  }
  if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) throw new Error('From date must not be after To date.');
  if (filter.type && !['all', 'lena', 'dena'].includes(filter.type)) throw new Error('Invalid transaction type.');
  let where = `userId = ? AND isDeleted = 0`;
  const params: (string | number)[] = [ownerId];
  if (filter.startDate || filter.endDate) {
    where += ' AND date(date) BETWEEN date(?) AND date(?)';
    params.push(filter.startDate || '0001-01-01', filter.endDate || '9999-12-31');
  }
  if (filter.type && filter.type !== 'all') {
    where += ' AND type = ?';
    params.push(filter.type);
  }
  if (filter.search) {
    // Literal substring search: %, _ and quotes are text, never SQL wildcards.
    where += " AND (instr(lower(COALESCE(partyName, '')), ?) > 0 OR instr(lower(COALESCE(notes, '')), ?) > 0)";
    params.push(filter.search.toLowerCase(), filter.search.toLowerCase());
  }
  return { where, params };
};

const KHATA_KEYS = { date: 'date', createdAt: 'createdAt', id: 'id' } as const;

/**
 * One predicate for both rows and whole-result paisa aggregates.
 *
 * Paging: pass `after` (the previous page's cursor) for the next `limit` rows in
 * `date DESC, createdAt DESC, id DESC` order. The cursor is applied to the ROWS
 * query ONLY — balanceSummary always covers the whole filtered set, so Total Lena /
 * Dena / Net never depend on how many pages are loaded. `limit/offset` remain for
 * existing callers.
 */
export const getFilteredKhata = async (
  userId: string, filter: KhataFilter = {}, limit = -1, offset = 0, after?: PageCursor | null
) => {
  const { where, params } = khataWhere(await entryOwner(userId, filter.createdBy), filter);
  const db = await getDatabase();
  const rowsWhere = after ? `${where} AND ${keysetClause(KHATA_KEYS)}` : where;
  const rowsParams = after ? [...params, ...keysetParams(after)] : params;
  const transactions = await db.getAllAsync<Transaction>(
    `SELECT * FROM transactions WHERE ${rowsWhere} ORDER BY date DESC, createdAt DESC, id DESC LIMIT ? OFFSET ?`,
    [...rowsParams, limit, offset]
  );
  const summary = await db.getFirstAsync<{ totalLena: number; totalDena: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'lena' THEN amount_paisa ELSE 0 END), 0) as totalLena,
      COALESCE(SUM(CASE WHEN type = 'dena' THEN amount_paisa ELSE 0 END), 0) as totalDena
     FROM transactions WHERE ${where}`, params
  );
  const { totalLena = 0, totalDena = 0 } = summary || {};
  return {
    transactions,
    balanceSummary: { totalLena, totalDena, netBalance: totalLena - totalDena },
    nextCursor: nextCursorOf(transactions, limit, KHATA_KEYS),
  };
};

/**
 * Every calendar day in the filtered ledger with its own SQL subtotal — ONE query per
 * filter change, never per page, never a sum of loaded rows. Keyed by date(date) so
 * legacy timestamp rows fall on their day.
 */
export const getKhataDayTotals = async (userId: string, filter: KhataFilter = {}): Promise<KhataDayTotal[]> => {
  const { where, params } = khataWhere(await entryOwner(userId, filter.createdBy), filter);
  const db = await getDatabase();
  return db.getAllAsync<KhataDayTotal>(
    `SELECT date(date) AS day,
            COALESCE(SUM(CASE WHEN type = 'lena' THEN amount_paisa ELSE 0 END), 0) AS lena,
            COALESCE(SUM(CASE WHEN type = 'dena' THEN amount_paisa ELSE 0 END), 0) AS dena,
            COUNT(*) AS entryCount
       FROM transactions WHERE ${where}
      GROUP BY date(date)
      ORDER BY day DESC`, params
  );
};

export type { Transaction };

export const createTransaction = async (
  userId: string,
  partyName: string,
  amount_paisa: number,
  type: 'lena' | 'dena',
  notes?: string,
  date?: string,
  partyNameUr?: string
): Promise<Transaction> => {
  const id = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = new Date().toISOString();
  const transactionDate = date || todayDate(); // local day, not UTC

  // Attach to the customer record NOW, so a later rename keeps this entry. Without
  // this the v42 backfill would only ever help rows that predate it.
  const db = await getDatabase();
  // customerDb.matchCustomerByName is now the ONE place this rule lives — createBill
  // resolves a typed name through the same call, so the two books cannot disagree
  // about whether a customer exists.
  const { id: customer_id } = await matchCustomerByName(userId, partyName, db);

  const data = {
    id, userId, partyName, party_name_ur: partyNameUr ?? null, amount_paisa, type,
    customer_id,
    notes: notes ?? null, date: transactionDate, isDeleted: 0, deletedAt: null
  };

  await writeWithSync({
    tableName: 'transactions',
    recordId: id,
    operation: 'create',
    data,
    firestorePath: `users/${userId}/transactions/${id}`,
    userId
  });

  return { ...data, syncStatus: 'pending', synced: 0, createdAt: now, updatedAt: now } as any;
};

export const getTransactionById = async (id: string): Promise<Transaction | null> => {
  const db = await getDatabase();
  const result = await db.getFirstAsync<Transaction>(
    'SELECT * FROM transactions WHERE id = ? AND isDeleted = 0 LIMIT 1',
    [id]
  );
  return result ?? null;
};

export const getTransactionsByUserId = async (
  userId: string,
  limit = 50,
  offset = 0
): Promise<Transaction[]> => {
  const db = await getDatabase();

  return db.getAllAsync<Transaction>(
    `SELECT * FROM transactions 
      WHERE userId = ? 
       AND isDeleted = 0 
     ORDER BY date DESC, createdAt DESC 
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
};

export const getAllTransactions = async (): Promise<Transaction[]> => {
  const db = await getDatabase();
  return db.getAllAsync<Transaction>(
    'SELECT * FROM transactions WHERE isDeleted = 0 ORDER BY date DESC, createdAt DESC'
  );
};

// Returns paisa totals per type for a user. Correct even for >50 rows.
export const getBalanceSummary = async (
  userId: string
): Promise<{ totalLena: number; totalDena: number }> => {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ type: string; total: number }>(
    `SELECT type, SUM(amount_paisa) as total
     FROM transactions
      WHERE userId = ? AND isDeleted = 0
     GROUP BY type`,
    [userId]
  );
  let totalLena = 0;
  let totalDena = 0;
  for (const r of rows) {
    if (r.type === 'lena') totalLena = r.total;
    else if (r.type === 'dena') totalDena = r.total;
  }
  return { totalLena, totalDena };
};

export const updateTransaction = async (
  id: string,
  userId: string,
  updates: Partial<Pick<Transaction, 'partyName' | 'amount_paisa' | 'type' | 'notes' | 'date'>>
): Promise<void> => {
  // Renaming the party RE-LINKS the entry to its customer, but NOT from here: khata is
  // an AUDITED book, and `customer_id` is derived, not something a caller may set. The
  // audit engine recomputes it alongside the edit (entryAuditDb's `derive`), so the
  // whitelist of editable fields stays exactly as narrow as it was.
  await writeWithSync({
    tableName: 'transactions',
    recordId: id,
    operation: 'update',
    data: updates,
    firestorePath: `users/${userId}/transactions/${id}`,
    userId
  });
};

export const deleteTransaction = async (id: string, userId: string): Promise<void> => {
  await writeWithSync({
    tableName: 'transactions',
    recordId: id,
    operation: 'delete',
    data: {},
    firestorePath: `users/${userId}/transactions/${id}`,
    userId
  });
};

export const getPendingSyncTransactions = async (): Promise<Transaction[]> => {
  const db = await getDatabase();
  return db.getAllAsync<Transaction>(
    "SELECT * FROM transactions WHERE syncStatus = 'pending' AND isDeleted = 0 ORDER BY createdAt ASC"
  );
};

/** One row of the customer list: a real customer, or a legacy name with no record. */
export type PartyBalance = {
  /** NULL for a legacy entry that never matched a customer — see migration v42. */
  customerId: string | null;
  partyName: string;
  totalLena: number;
  totalDena: number;
  netBalance: number;
  phone?: string | null;
  notes?: string | null;
  lastTransactionDate?: string | null;
};

/** Keyset position in the customer list: ordered by name, then id to break ties. */
export type PartyCursor = { partyName: string; customerId: string };

/**
 * ONE key per party, used on both sides of the join.
 *
 * A linked entry keys on its customer id; an unlinked one keys on its name. Collapsing
 * both into a single column matters for SPEED, not tidiness: joining on
 * `(id = id) OR (name = name)` cannot use an index, so SQLite scans every transaction
 * once per party. On a book with a few thousand entries that is millions of row
 * comparisons and the query effectively hangs — it stalled the test suite past ten
 * minutes. An equality join on one key, against a pre-aggregated table, is linear.
 */
const PARTY_KEY = "COALESCE(customer_id, 'n:' || TRIM(partyName))";

/** The aggregate, computed ONCE per party before anything is joined to it. */
const SCOPED_AGG = `
  SELECT ${PARTY_KEY} AS k,
         COALESCE(SUM(CASE WHEN type = 'lena' THEN amount_paisa ELSE 0 END), 0) AS lena,
         COALESCE(SUM(CASE WHEN type = 'dena' THEN amount_paisa ELSE 0 END), 0) AS dena,
         MAX(date) AS lastDate
    FROM transactions
   WHERE userId = ? AND isDeleted = 0
   GROUP BY k
`;

/**
 * Every party: a real customer, plus any legacy name that never matched one. A customer
 * appears even with no transactions at all, which is what makes a newly added customer
 * show up in Khata immediately, at zero.
 */
const PARTIES = `
  SELECT c.id AS k, c.id AS customerId, TRIM(c.name) AS partyName, c.phone AS phone, c.notes AS notes
    FROM customers c
   WHERE c.user_id = ? AND c.is_deleted = 0
  UNION ALL
  SELECT DISTINCT 'n:' || TRIM(t.partyName), NULL, TRIM(t.partyName), NULL, NULL
    FROM transactions t
   WHERE t.userId = ? AND t.isDeleted = 0 AND t.customer_id IS NULL
`;

/** The balance a search types against, as a figure rather than digits. */
const typedPaisaOf = (search: string): number | null => {
  const bare = search.toLowerCase().split('rs.').join('').split('rs').join('')
    .split(',').join('').split(' ').join('');
  if (bare === '') return null;
  const n = Number(bare);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
};

/** Search arms shared by the list and its header, so the two can never disagree. */
const searchSql = (search: string, typedPaisa: number | null) => {
  if (!search) return '';
  const arms = ["partyName LIKE ? ESCAPE '!'", "COALESCE(phone,'') LIKE ? ESCAPE '!'"];
  if (typedPaisa !== null) arms.push('ABS(totalLena - totalDena) = ?');
  return ' AND (' + arms.join(' OR ') + ')';
};
const searchParams = (search: string, typedPaisa: number | null) => {
  if (!search) return [];
  const like = '%' + search.replace(/[!%_]/g, m => '!' + m) + '%';
  return typedPaisa !== null ? [like, like, typedPaisa] : [like, like];
};

/**
 * The customer list with balances — every aggregate computed in SQL over the whole
 * matching set, and paged, because a shop can have hundreds of customers.
 *
 * It previously loaded every party and every customer with no limit and merged them in
 * JavaScript, and the screen then filtered that loaded array to search. Both are gone.
 */
export const getPartyBalances = async (
  viewerId: string,
  opts: { search?: string; limit?: number; after?: PartyCursor | null } = {},
  createdBy?: string
): Promise<{ rows: PartyBalance[]; nextCursor: PartyCursor | null }> => {
  const userId = await entryOwner(viewerId, createdBy);
  const db = await getDatabase();
  const limit = opts.limit ?? -1;
  const search = (opts.search ?? '').trim();
  const typedPaisa = typedPaisaOf(search);

  const keyset = opts.after
    ? " AND (partyName > ? OR (partyName = ? AND COALESCE(customerId,'') > ?))"
    : '';

  const sql = `
    WITH agg AS (${SCOPED_AGG}), parties AS (${PARTIES}),
    joined AS (
      SELECT p.customerId AS customerId, p.partyName AS partyName, p.phone AS phone, p.notes AS notes,
             COALESCE(a.lena, 0) AS totalLena, COALESCE(a.dena, 0) AS totalDena,
             a.lastDate AS lastTransactionDate
        FROM parties p
        LEFT JOIN agg a ON a.k = p.k
    )
    SELECT * FROM joined
     WHERE 1 = 1${searchSql(search, typedPaisa)}${keyset}
     ORDER BY partyName ASC, COALESCE(customerId,'') ASC
     LIMIT ?
  `;

  const params: any[] = [userId, userId, userId, ...searchParams(search, typedPaisa)];
  if (opts.after) params.push(opts.after.partyName, opts.after.partyName, opts.after.customerId);
  params.push(limit);

  const rows = await db.getAllAsync<any>(sql, params);
  const out: PartyBalance[] = rows.map(r => ({
    customerId: r.customerId ?? null,
    partyName: r.partyName,
    totalLena: r.totalLena,
    totalDena: r.totalDena,
    netBalance: r.totalLena - r.totalDena,
    phone: r.phone ?? null,
    notes: r.notes ?? null,
    lastTransactionDate: r.lastTransactionDate ?? null,
  }));
  const last = out[out.length - 1];
  const full = limit > 0 && out.length === limit;
  return {
    rows: out,
    nextCursor: full && last ? { partyName: last.partyName, customerId: last.customerId ?? '' } : null,
  };
};

/**
 * The grand totals for the customer list: everything owed to the shop, and everything
 * the shop owes, across every customer.
 *
 * All-time and ONE SQL aggregate over the whole matching set — never a sum of the rows
 * the list happens to have paged in. Takes the same `search` as getPartyBalances, so
 * the header always describes exactly the list beneath it.
 *
 * No date range, deliberately: a balance is a balance, and someone who last paid in
 * June still owes what they owe.
 */
export const getKhataGrandTotals = async (
  viewerId: string,
  opts: { search?: string } = {},
  createdBy?: string
): Promise<{ totalLena: number; totalDena: number; netBalance: number }> => {
  const userId = await entryOwner(viewerId, createdBy);
  const db = await getDatabase();
  const search = (opts.search ?? '').trim();
  const typedPaisa = typedPaisaOf(search);

  const sql = `
    WITH agg AS (${SCOPED_AGG}), parties AS (${PARTIES}),
    joined AS (
      SELECT p.partyName AS partyName, p.phone AS phone,
             COALESCE(a.lena, 0) AS totalLena, COALESCE(a.dena, 0) AS totalDena
        FROM parties p
        LEFT JOIN agg a ON a.k = p.k
    )
    SELECT COALESCE(SUM(totalLena), 0) AS totalLena, COALESCE(SUM(totalDena), 0) AS totalDena
      FROM joined
     WHERE 1 = 1${searchSql(search, typedPaisa)}
  `;
  const params: any[] = [userId, userId, userId, ...searchParams(search, typedPaisa)];

  const row = await db.getFirstAsync<{ totalLena: number; totalDena: number }>(sql, params);
  const totalLena = row?.totalLena ?? 0;
  const totalDena = row?.totalDena ?? 0;
  return { totalLena, totalDena, netBalance: totalLena - totalDena };
};

export const getTransactionsByParty = async (
  viewerId: string,
  partyName: string,
  createdBy?: string
): Promise<Transaction[]> => {
  const userId = await entryOwner(viewerId, createdBy);
  const db = await getDatabase();
  return db.getAllAsync<Transaction>(
    `SELECT * FROM transactions 
      WHERE userId = ? 
       AND partyName = ? 
       AND isDeleted = 0 
     ORDER BY date DESC, createdAt DESC`,
    [userId, partyName]
  );
};

/**
 * One party's totals as SQL aggregates over the SAME predicate as getTransactionsByParty,
 * so the customer screen's figures never come from summing loaded rows.
 */
export const getPartySummary = async (
  viewerId: string,
  partyName: string,
  createdBy?: string
): Promise<{ totalLena: number; totalDena: number; netBalance: number }> => {
  const userId = await entryOwner(viewerId, createdBy);
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ lena: number; dena: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'lena' THEN amount_paisa ELSE 0 END), 0) AS lena,
            COALESCE(SUM(CASE WHEN type = 'dena' THEN amount_paisa ELSE 0 END), 0) AS dena
       FROM transactions
      WHERE userId = ?
       AND partyName = ?
       AND isDeleted = 0`,
    [userId, partyName]
  );
  const totalLena = row?.lena ?? 0, totalDena = row?.dena ?? 0;
  return { totalLena, totalDena, netBalance: totalLena - totalDena };
};

export const getAllStaffMetricsAggregate = async (adminId: string): Promise<Record<string, { totalLena: number; totalDena: number; netBalance: number }>> => {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ userId: string; type: string; total: number }>(
    `SELECT userId, type, SUM(amount_paisa) as total
     FROM transactions
     WHERE isDeleted = 0
       AND userId IN (SELECT id FROM users WHERE parentId = ?)
     GROUP BY userId, type`,
    [adminId]
  );
  
  const map: Record<string, { totalLena: number; totalDena: number; netBalance: number }> = {};
  for (const r of rows) {
    if (!map[r.userId]) map[r.userId] = { totalLena: 0, totalDena: 0, netBalance: 0 };
    if (r.type === 'lena') map[r.userId].totalLena += r.total;
    else if (r.type === 'dena') map[r.userId].totalDena += r.total;
  }
  
  for (const key in map) {
    map[key].netBalance = map[key].totalLena - map[key].totalDena;
  }
  return map;
};
