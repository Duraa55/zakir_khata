import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from './db';
import { parseDateValue } from '../../utils/dates';
import { keysetClause, keysetParams, nextCursorOf, PageCursor } from './pagination';
import { StockItem, StockMovement } from '../../types/stock.types';
import { writeWithSync } from './syncHelpers';
import { entryOwner } from './entryScope';

export const createStockItem = async (
  item: Omit<StockItem, 'id' | 'created_at' | 'synced' | 'is_deleted' | 'quantity'>
): Promise<StockItem> => {
  const id = `stock_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = new Date().toISOString();

  const data = {
    ...item,
    id,
    quantity: 0,
    is_deleted: 0,
    deleted_at: null
  };

  await writeWithSync({
    tableName: 'stock_items',
    recordId: id,
    operation: 'create',
    data,
    firestorePath: `users/${item.user_id}/stock_items/${id}`,
    userId: item.user_id
  });

  return {
    ...item,
    id,
    quantity: 0,
    created_at: now,
    updated_at: now,
    synced: 0,
    is_deleted: 0,
    deleted_at: undefined,
  };
};

export const getStockItemsByUserId = async (
  viewerId: string,
  filterLowStock: boolean = false,
  createdBy?: string
): Promise<StockItem[]> => {
  // Own inventory only; `createdBy` is the Staff Book drill-down (permission-checked).
  const userId = await entryOwner(viewerId, createdBy);
  const db = await getDatabase();


  let query = `
    SELECT * FROM stock_items 
    WHERE user_id = ? 
      AND is_deleted = 0
  `;

  if (filterLowStock) {
    query += ' AND quantity < low_stock_threshold';
  }

  query += ' ORDER BY created_at DESC';

  return db.getAllAsync<StockItem>(query, [userId]);
};

/** Every account keeps its own inventory: only the person who added an item may change it. */
const assertOwnStockItemIn = async (db: SQLiteDatabase, itemId: string, userId: string): Promise<void> => {
  const item = await db.getFirstAsync<{ user_id: string }>('SELECT user_id FROM stock_items WHERE id = ? AND is_deleted = 0', [itemId]);
  if (!item) throw new Error('Stock item not found.');
  if (!userId || item.user_id !== userId) throw new Error('You can only change your own stock.');
};

export const deleteStockItem = async (id: string, userId: string): Promise<void> => {
  await assertOwnStockItemIn(await getDatabase(), id, userId);
  await writeWithSync({
    tableName: 'stock_items',
    recordId: id,
    operation: 'delete',
    data: {},
    firestorePath: `users/${userId}/stock_items/${id}`,
    userId
  });
};

/**
 * Records a stock movement (purchase/sale/adjustment) and updates the item's quantity.
 * change > 0 means stock IN, change < 0 means stock OUT.
 */
export const addStockMovement = async (
  movement: Omit<StockMovement, 'id' | 'synced' | 'is_deleted'>
): Promise<StockMovement> => {
  const db = await getDatabase();
  let saved!: StockMovement;
  await db.withTransactionAsync(async () => { saved = await addStockMovementIn(db, movement); });
  return saved;
};

/**
 * The movement row and the item's quantity change, on a connection that is ALREADY
 * inside a transaction (e.g. a bill edit that must correct stock atomically with it).
 */
export const addStockMovementIn = async (
  db: SQLiteDatabase,
  movement: Omit<StockMovement, 'id' | 'synced' | 'is_deleted'>
): Promise<StockMovement> => {
  // A movement changes an item's count, so it must be the item's own account moving it.
  await assertOwnStockItemIn(db, movement.item_id, movement.user_id);
  const id = `mov_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = new Date().toISOString();
  // Insert the movement record
  await db.runAsync(
    `INSERT INTO stock_movements
       (id, item_id, change, reason, date, cost_per_unit, sale_price_unit, user_id, note, synced, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [
      id,
      movement.item_id,
      movement.change,
      movement.reason,
      movement.date,
      movement.cost_per_unit ?? null,
      movement.sale_price_unit ?? null,
      movement.user_id,
      movement.note ?? null,
    ]
  );
  // Update the item's quantity and updated_at
  await db.runAsync(
    `UPDATE stock_items SET quantity = quantity + ?, updated_at = ?, synced = 0 WHERE id = ?`,
    [movement.change, now, movement.item_id]
  );
  return { ...movement, id, synced: 0, is_deleted: 0 };
};

/**
 * What an item has SOLD, all time — SQL aggregates, never summed from loaded rows.
 *
 * Selling value is the price entered on each sale × its units, so months at different
 * prices add up correctly. A customer return reverses its sale: the units go back into
 * stock (the movement itself does that) and their selling value leaves the total here.
 */
export type ItemSales = { soldQty: number; returnedQty: number; netSoldQty: number; soldValue: number; returnedValue: number; netSoldValue: number };

export const getItemSales = async (itemId: string): Promise<ItemSales> => {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ soldQty: number; returnedQty: number; soldValue: number; returnedValue: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN reason = 'sale' THEN -change ELSE 0 END), 0) AS soldQty,
       COALESCE(SUM(CASE WHEN reason = 'customer_return' THEN change ELSE 0 END), 0) AS returnedQty,
       COALESCE(SUM(CASE WHEN reason = 'sale' THEN -change * COALESCE(sale_price_unit, 0) ELSE 0 END), 0) AS soldValue,
       COALESCE(SUM(CASE WHEN reason = 'customer_return' THEN change * COALESCE(sale_price_unit, 0) ELSE 0 END), 0) AS returnedValue
     FROM stock_movements WHERE item_id = ? AND is_deleted = 0`,
    [itemId]
  );
  const soldQty = row?.soldQty ?? 0, returnedQty = row?.returnedQty ?? 0;
  const soldValue = Math.round(row?.soldValue ?? 0), returnedValue = Math.round(row?.returnedValue ?? 0);
  return { soldQty, returnedQty, netSoldQty: soldQty - returnedQty, soldValue, returnedValue, netSoldValue: soldValue - returnedValue };
};

/** The same figures for every item of one account, for the Stock Book list. */
export const getSalesByItem = async (viewerId: string, createdBy?: string): Promise<Record<string, ItemSales>> => {
  const userId = await entryOwner(viewerId, createdBy);
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ item_id: string; soldQty: number; returnedQty: number; soldValue: number; returnedValue: number }>(
    `SELECT sm.item_id AS item_id,
       COALESCE(SUM(CASE WHEN sm.reason = 'sale' THEN -sm.change ELSE 0 END), 0) AS soldQty,
       COALESCE(SUM(CASE WHEN sm.reason = 'customer_return' THEN sm.change ELSE 0 END), 0) AS returnedQty,
       COALESCE(SUM(CASE WHEN sm.reason = 'sale' THEN -sm.change * COALESCE(sm.sale_price_unit, 0) ELSE 0 END), 0) AS soldValue,
       COALESCE(SUM(CASE WHEN sm.reason = 'customer_return' THEN sm.change * COALESCE(sm.sale_price_unit, 0) ELSE 0 END), 0) AS returnedValue
     FROM stock_movements sm
     JOIN stock_items si ON si.id = sm.item_id
    WHERE si.user_id = ? AND sm.is_deleted = 0 AND si.is_deleted = 0
    GROUP BY sm.item_id`,
    [userId]
  );
  const out: Record<string, ItemSales> = {};
  for (const r of rows) {
    const soldValue = Math.round(r.soldValue), returnedValue = Math.round(r.returnedValue);
    out[r.item_id] = {
      soldQty: r.soldQty, returnedQty: r.returnedQty, netSoldQty: r.soldQty - r.returnedQty,
      soldValue, returnedValue, netSoldValue: soldValue - returnedValue,
    };
  }
  return out;
};

/**
 * Fetches all movements for a given stock item, ordered newest first.
 */
export const getMovementsByItemId = async (itemId: string): Promise<StockMovement[]> => {
  const db = await getDatabase();
  return db.getAllAsync<StockMovement>(
    `SELECT * FROM stock_movements WHERE item_id = ? AND is_deleted = 0 ORDER BY date DESC`,
    [itemId]
  );
};

export const calculateTotalStockValue = async (viewerId: string, createdBy?: string): Promise<number> => {
  const userId = await entryOwner(viewerId, createdBy);
  const db = await getDatabase();


  const result = await db.getFirstAsync<{ total: number }>(
    `SELECT SUM(quantity * purchase_price) as total FROM stock_items 
     WHERE user_id = ? 
       AND is_deleted = 0`,
    [userId]
  );
  
  return result?.total || 0;
};

export interface StockReportEntry extends StockMovement {
  item_name_en: string;
  item_name_ur?: string;
  unit: string;
}

export type StockMovementSummary = { entries: number; qty: number; amount: number };
export type StockMovementDayTotal = { day: string; entries: number; qty: number; amount: number };
export type StockMovementFilter = {
  startDate?: string;
  endDate?: string;
  search?: string;
  /** One item only — the per-item view of a stock in / out report. */
  itemId?: string;
};

const MOVEMENT_KEYS = { date: 'm.date', id: 'm.id' } as const;

/**
 * THE one predicate for the Stock IN / OUT reports: rows, the header summary and the
 * day subtotals all come from here. Scoped by the ITEM's owner tree (a parent-owned
 * item moved by anyone else is still theirs). `search` matches the item name in
 * SQL so paged results and totals follow it together.
 */
const movementWhere = (userId: string, direction: 'in' | 'out', filter: StockMovementFilter) => {
  const { startDate, endDate } = filter;
  for (const date of [startDate, endDate]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseDateValue(date))) {
      throw new Error('Invalid date range.');
    }
  }
  if (startDate && endDate && startDate > endDate) throw new Error('From date must not be after To date.');
  let where = `${direction === 'in' ? 'm.change > 0' : 'm.change < 0'} AND m.is_deleted = 0 AND i.is_deleted = 0
    AND i.user_id = ?`;
  const params: any[] = [userId];
  if (startDate) { where += ' AND date(m.date) >= date(?)'; params.push(startDate); }
  if (endDate) { where += ' AND date(m.date) <= date(?)'; params.push(endDate); }
  const search = filter.search?.trim().toLowerCase();
  if (search) {
    // Literal substring search on either name, never SQL wildcards.
    where += " AND (instr(lower(COALESCE(i.name_en, '')), ?) > 0 OR instr(lower(COALESCE(i.name_ur, '')), ?) > 0)";
    params.push(search, search);
  }
  if (filter.itemId) { where += ' AND m.item_id = ?'; params.push(filter.itemId); }
  const rate = direction === 'in' ? 'COALESCE(m.cost_per_unit, 0)' : 'COALESCE(m.sale_price_unit, m.cost_per_unit, 0)';
  return { where, params, rate };
};

/**
 * The Stock IN / Stock OUT report: one movement per row.
 *   IN  amount = qty × cost_per_unit
 *   OUT amount = qty × (sale_price_unit, else cost_per_unit)   — exactly the screens' maths
 * `after` pages the ROWS only (keyset on date, id — movements have no creation
 * timestamp); the summary is a SQL aggregate over the whole filtered set.
 * Money columns are integer paisa.
 */
export const getStockMovementReport = async (
  userId: string,
  direction: 'in' | 'out',
  startDate?: string,
  endDate?: string,
  limit = -1,
  after?: PageCursor | null,
  search?: string,
  itemId?: string
): Promise<{ rows: StockReportEntry[]; summary: StockMovementSummary; nextCursor: PageCursor | null }> => {
  const { where, params, rate } = movementWhere(userId, direction, { startDate, endDate, search, itemId });
  const db = await getDatabase();
  const rowsWhere = after ? `${where} AND ${keysetClause(MOVEMENT_KEYS)}` : where;
  const rowsParams = after ? [...params, ...keysetParams(after, MOVEMENT_KEYS)] : params;
  const rows = await db.getAllAsync<StockReportEntry>(
    `SELECT m.*, i.name_en as item_name_en, i.name_ur as item_name_ur, i.unit
       FROM stock_movements m
       JOIN stock_items i ON m.item_id = i.id
      WHERE ${rowsWhere}
      ORDER BY m.date DESC, m.id DESC LIMIT ?`, [...rowsParams, limit]
  );
  const summary = await db.getFirstAsync<StockMovementSummary>(
    `SELECT COUNT(*) AS entries,
            COALESCE(SUM(ABS(m.change)), 0) AS qty,
            COALESCE(SUM(ABS(m.change) * ${rate}), 0) AS amount
       FROM stock_movements m
       JOIN stock_items i ON m.item_id = i.id
      WHERE ${where}`, params
  );
  return { rows, summary: summary ?? { entries: 0, qty: 0, amount: 0 }, nextCursor: nextCursorOf(rows, limit, { date: 'date', id: 'id' }) };
};

/**
 * The report's ITEMS: one row per stock item that moved in this direction and range,
 * with that item's own SQL totals. ONE grouped query — never a query per item.
 *
 * Paged by name (the cursor is the last row's name + id, a unique pair), so a shop with
 * hundreds of items loads a page at a time. The list's own header stays the whole-set
 * aggregate from getStockMovementReport, so it never depends on how many pages are open.
 * Items with NO movement in the range are not rows here: this reports what moved.
 */
export type StockItemReportRow = {
  item_id: string; name_en: string; name_ur: string | null; unit: string;
  entries: number; qty: number; amount: number;
};
export type ItemCursor = { name: string; id: string };

export const getStockMovementItems = async (
  userId: string,
  direction: 'in' | 'out',
  filter: StockMovementFilter = {},
  limit = -1,
  after?: ItemCursor | null
): Promise<{ rows: StockItemReportRow[]; nextCursor: ItemCursor | null }> => {
  const { where, params, rate } = movementWhere(userId, direction, filter);
  const db = await getDatabase();
  const paged = after ? `${where} AND (lower(i.name_en) > ? OR (lower(i.name_en) = ? AND m.item_id > ?))` : where;
  const pagedParams = after ? [...params, after.name.toLowerCase(), after.name.toLowerCase(), after.id] : params;
  const rows = await db.getAllAsync<StockItemReportRow>(
    `SELECT m.item_id AS item_id, i.name_en AS name_en, i.name_ur AS name_ur, i.unit AS unit,
            COUNT(*) AS entries,
            COALESCE(SUM(ABS(m.change)), 0) AS qty,
            COALESCE(SUM(ABS(m.change) * ${rate}), 0) AS amount
       FROM stock_movements m
       JOIN stock_items i ON m.item_id = i.id
      WHERE ${paged}
      GROUP BY m.item_id
      ORDER BY lower(i.name_en) ASC, m.item_id ASC
      LIMIT ?`,
    [...pagedParams, limit]
  );
  const last = rows[rows.length - 1];
  return {
    rows: rows.map(r => ({ ...r, amount: Math.round(r.amount) })),
    nextCursor: limit > 0 && rows.length === limit && last ? { name: last.name_en, id: last.item_id } : null,
  };
};

/** Every calendar day in the filtered report with its SQL subtotal — one query per filter change. */
export const getStockMovementDayTotals = async (
  userId: string, direction: 'in' | 'out', startDate?: string, endDate?: string, search?: string
): Promise<StockMovementDayTotal[]> => {
  const { where, params, rate } = movementWhere(userId, direction, { startDate, endDate, search });
  const db = await getDatabase();
  return db.getAllAsync<StockMovementDayTotal>(
    `SELECT date(m.date) AS day, COUNT(*) AS entries,
            COALESCE(SUM(ABS(m.change)), 0) AS qty,
            COALESCE(SUM(ABS(m.change) * ${rate}), 0) AS amount
       FROM stock_movements m
       JOIN stock_items i ON m.item_id = i.id
      WHERE ${where}
      GROUP BY date(m.date)
      ORDER BY day DESC`, params
  );
};

export const getStockInReport = async (userId: string, startDate?: string, endDate?: string): Promise<StockReportEntry[]> =>
  (await getStockMovementReport(userId, 'in', startDate, endDate)).rows;

export const getStockOutReport = async (userId: string, startDate?: string, endDate?: string): Promise<StockReportEntry[]> =>
  (await getStockMovementReport(userId, 'out', startDate, endDate)).rows;

/** Months (YYYY-MM) in which an item moved — for the item screen's month pills. */
export const getItemMovementMonths = async (itemId: string): Promise<string[]> => {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ month: string }>(
    `SELECT DISTINCT strftime('%Y-%m', date) AS month FROM stock_movements
      WHERE item_id = ? AND is_deleted = 0 AND strftime('%Y-%m', date) IS NOT NULL ORDER BY month`, [itemId]
  );
  return rows.map(r => r.month).filter(Boolean);
};

/**
 * One item's movements for one month (or all months), paged, with the month's
 * In / Out quantities as a SQL aggregate — the month is filtered in SQL, not by
 * loading every month and filtering in JS.
 */
export const getItemMovements = async (
  itemId: string, month: string | 'ALL', limit = -1, after?: PageCursor | null
): Promise<{ rows: StockMovement[]; summary: { totalIn: number; totalOut: number; count: number }; nextCursor: PageCursor | null }> => {
  if (month !== 'ALL' && !/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid month.');
  let where = 'item_id = ? AND is_deleted = 0';
  const params: any[] = [itemId];
  if (month !== 'ALL') { where += " AND strftime('%Y-%m', date) = ?"; params.push(month); }
  const db = await getDatabase();
  const keys = { date: 'date', id: 'id' } as const;
  const rowsWhere = after ? `${where} AND ${keysetClause(keys)}` : where;
  const rowsParams = after ? [...params, ...keysetParams(after, keys)] : params;
  const rows = await db.getAllAsync<StockMovement>(
    `SELECT * FROM stock_movements WHERE ${rowsWhere} ORDER BY date DESC, id DESC LIMIT ?`, [...rowsParams, limit]
  );
  const summary = await db.getFirstAsync<{ totalIn: number; totalOut: number; count: number }>(
    `SELECT COALESCE(SUM(CASE WHEN change > 0 THEN change ELSE 0 END), 0) AS totalIn,
            COALESCE(SUM(CASE WHEN change < 0 THEN -change ELSE 0 END), 0) AS totalOut,
            COUNT(*) AS count
       FROM stock_movements WHERE ${where}`, params
  );
  return { rows, summary: summary ?? { totalIn: 0, totalOut: 0, count: 0 }, nextCursor: nextCursorOf(rows, limit, keys) };
};
