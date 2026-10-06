import { getDatabase } from './db';
import { writeWithSync, writeRowWithSyncIn, afterSyncedWrite } from './syncHelpers';
import { withWriteTransaction } from './writeTransaction';
import { generateId, nowISO } from './queryHelpers';
import { addStockMovement, addStockMovementIn, getStockItemsByUserId } from './stockDb';
import { keysetClause, keysetParams, nextCursorOf, PageCursor } from './pagination';
import { parseDateValue, todayDate } from '../../utils/dates';
import {
  PurchaseOrder, PurchaseOrderItem,
  PurchaseInvoice, PurchaseInvoiceItem,
  PurchaseReturn, PurchaseReturnItem,
  PurchaseSummary, POStatus, InvoiceStatus
} from '../../types/purchase.types';
import { resolveCurrency, type CurrencyCode } from '../../utils/currency';
import { totalsFrom, type CurrencyTotal } from '../../utils/currencyTotals';

/**
 * The currency to store when the caller named none: this ACCOUNT's default, not a
 * hardcoded PKR. The form always sends the chip's value, so this is the safety net for
 * any other caller — and getting it wrong would silently label an AED shop's document
 * as rupees. resolveCurrency is total, so a pre-v41 row still reads as PKR.
 */
const accountDefaultCurrency = async (
  db: Awaited<ReturnType<typeof getDatabase>>, userId: string
): Promise<CurrencyCode> => {
  const row = await db.getFirstAsync<{ default_currency: string | null }>(
    'SELECT default_currency FROM users WHERE id = ?', [userId]
  );
  return resolveCurrency(row?.default_currency).code;
};

export type {
  PurchaseOrder, PurchaseOrderItem,
  PurchaseInvoice, PurchaseInvoiceItem,
  PurchaseReturn, PurchaseReturnItem,
  PurchaseSummary
};

// ─── Purchase Orders ──────────────────────────────────────────────────────────

export const createPurchaseOrder = async (
  userId: string,
  supplierId: string,
  items: Omit<PurchaseOrderItem, 'id' | 'po_id' | 'received_qty' | 'is_deleted'>[],
  orderDate: string,
  expectedDate?: string,
  notes?: string,
  /** What the form's chip was set to. Unknown or absent resolves to PKR. */
  currency?: CurrencyCode
): Promise<PurchaseOrder> => {
  const db = await getDatabase();
  const id = generateId('po');
  const now = nowISO();

  // Auto-increment PO number per user
  const maxRow = await db.getFirstAsync<{ max_no: number }>(
    'SELECT MAX(po_number) as max_no FROM purchase_orders WHERE user_id = ?',
    [userId]
  );
  const po_number = (maxRow?.max_no ?? 0) + 1;
  const total = items.reduce((s, i) => s + i.line_total, 0);

  const data = {
    id, user_id: userId, supplier_id: supplierId,
    po_number, status: 'draft' as POStatus,
    order_date: orderDate,
    expected_date: expectedDate || null,
    notes: notes || null,
    total, received_total: 0,
    currency: currency ? resolveCurrency(currency).code : await accountDefaultCurrency(db, userId),
    is_deleted: 0, deleted_at: null,
  };

  await writeWithSync({
    tableName: 'purchase_orders',
    recordId: id,
    operation: 'create',
    data,
    firestorePath: `users/${userId}/purchase_orders/${id}`,
    userId
  });

  // Insert items
  for (const item of items) {
    const itemId = generateId('poi');
    const itemData = { ...item, id: itemId, po_id: id, received_qty: 0, is_deleted: 0 };
    await db.runAsync(
      `INSERT INTO purchase_order_items (id, po_id, stock_item_id, item_name, quantity, unit_cost, line_total, received_qty, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [itemId, id, item.stock_item_id || null, item.item_name, item.quantity, item.unit_cost, item.line_total]
    );
  }

  const savedItems = items.map((i, idx) => ({ ...i, id: `poi_${idx}`, po_id: id, received_qty: 0, is_deleted: 0 as const }));
  return { ...data, items: savedItems, created_at: now, updated_at: now, synced: 0 } as PurchaseOrder;
};

export const getPurchaseOrders = async (userId: string, status?: POStatus): Promise<PurchaseOrder[]> => {
  const db = await getDatabase();
  let query = `
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.user_id = ? AND po.is_deleted = 0
  `;
  const params: any[] = [userId];
  if (status) { query += ' AND po.status = ?'; params.push(status); }
  query += ' ORDER BY po.created_at DESC';
  return db.getAllAsync<PurchaseOrder>(query, params);
};

export type PurchaseFilter = { startDate?: string; endDate?: string; status?: string };
/**
 * A day's purchases. `total` and `settled` are ONE FIGURE PER CURRENCY — adding AED to
 * PKR means nothing, so the aggregate groups by currency in SQL. A single-currency day
 * has exactly one entry each and renders as it always did.
 */
export type PurchaseDayTotal = { day: string; count: number; total: CurrencyTotal[]; settled: CurrencyTotal[] };

/** Fold `day, currency` rows into one stacked total per day. Grouping is SQL's. */
const foldDays = (
  rows: { day: string; currency?: string | null; count?: number; total?: number; settled?: number }[],
  base: CurrencyCode,
): PurchaseDayTotal[] => {
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  return [...byDay.entries()].map(([day, group]) => ({
    day,
    count: group.reduce((n, r) => n + Number(r.count ?? 0), 0),
    total: totalsFrom(group, 'total', base),
    settled: totalsFrom(group, 'settled', base),
  }));
};

const assertRange = (f: PurchaseFilter) => {
  for (const date of [f.startDate, f.endDate]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseDateValue(date))) throw new Error('Invalid date range.');
  }
  if (f.startDate && f.endDate && f.startDate > f.endDate) throw new Error('From date must not be after To date.');
};

/** THE one predicate for the Orders tab: rows, header count and day subtotals. */
const orderWhere = (userId: string, filter: PurchaseFilter) => {
  assertRange(filter);
  let where = 'po.user_id = ? AND po.is_deleted = 0';
  const params: any[] = [userId];
  if (filter.startDate || filter.endDate) { where += ' AND date(po.order_date) BETWEEN date(?) AND date(?)'; params.push(filter.startDate || '0001-01-01', filter.endDate || '9999-12-31'); }
  if (filter.status) { where += ' AND po.status = ?'; params.push(filter.status); }
  return { where, params };
};
const ORDER_KEYS = { date: 'po.order_date', createdAt: 'po.created_at', id: 'po.id' } as const;

/**
 * Orders for a range, paged (keyset on order_date, created_at, id — rows only); the
 * summary is a SQL aggregate over the whole filtered set.
 */
export const getFilteredPurchaseOrders = async (userId: string, filter: PurchaseFilter = {}, limit = -1, after?: PageCursor | null) => {
  const { where, params } = orderWhere(userId, filter);
  const db = await getDatabase();
  const rowsWhere = after ? `${where} AND ${keysetClause(ORDER_KEYS)}` : where;
  const rowsParams = after ? [...params, ...keysetParams(after)] : params;
  const rows = await db.getAllAsync<PurchaseOrder>(
    `SELECT po.*, s.name as supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${rowsWhere} ORDER BY po.order_date DESC, po.created_at DESC, po.id DESC LIMIT ?`, [...rowsParams, limit]
  );
  // COUNT only. The money columns here were summed ACROSS currencies and no screen ever
  // rendered them — the tab label shows the count. A flat SUM nothing displays is just a
  // wrong number waiting to be used; the day headers and the tiles are the real totals.
  const summary = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM purchase_orders po WHERE ${where}`, params
  );
  return { rows, summary: summary ?? { count: 0 }, nextCursor: nextCursorOf(rows, limit, { date: 'order_date', createdAt: 'created_at', id: 'id' }) };
};

export const getPurchaseOrderDayTotals = async (userId: string, filter: PurchaseFilter = {}): Promise<PurchaseDayTotal[]> => {
  const { where, params } = orderWhere(userId, filter);
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ day: string; currency: string | null; count: number; total: number; settled: number }>(
    `SELECT date(po.order_date) AS day, po.currency AS currency, COUNT(*) AS count, COALESCE(SUM(po.total), 0) AS total, COALESCE(SUM(po.received_total), 0) AS settled
       FROM purchase_orders po WHERE ${where} GROUP BY date(po.order_date), po.currency ORDER BY day DESC`, params
  );
  return foldDays(rows, await accountDefaultCurrency(db, userId));
};

/** THE one predicate for the Invoices tab. */
const invoiceWhere = (userId: string, filter: PurchaseFilter) => {
  assertRange(filter);
  let where = 'pi.user_id = ? AND pi.is_deleted = 0';
  const params: any[] = [userId];
  if (filter.startDate || filter.endDate) { where += ' AND date(pi.invoice_date) BETWEEN date(?) AND date(?)'; params.push(filter.startDate || '0001-01-01', filter.endDate || '9999-12-31'); }
  if (filter.status) { where += ' AND pi.status = ?'; params.push(filter.status); }
  return { where, params };
};
const INVOICE_KEYS = { date: 'pi.invoice_date', createdAt: 'pi.created_at', id: 'pi.id' } as const;

export const getFilteredPurchaseInvoices = async (userId: string, filter: PurchaseFilter = {}, limit = -1, after?: PageCursor | null) => {
  const { where, params } = invoiceWhere(userId, filter);
  const db = await getDatabase();
  const rowsWhere = after ? `${where} AND ${keysetClause(INVOICE_KEYS)}` : where;
  const rowsParams = after ? [...params, ...keysetParams(after)] : params;
  const rows = await db.getAllAsync<PurchaseInvoice>(
    `SELECT pi.*, s.name as supplier_name FROM purchase_invoices pi LEFT JOIN suppliers s ON s.id = pi.supplier_id
      WHERE ${rowsWhere} ORDER BY pi.invoice_date DESC, pi.created_at DESC, pi.id DESC LIMIT ?`, [...rowsParams, limit]
  );
  // COUNT only — see the note on the orders query above.
  const summary = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM purchase_invoices pi WHERE ${where}`, params
  );
  return { rows, summary: summary ?? { count: 0 }, nextCursor: nextCursorOf(rows, limit, { date: 'invoice_date', createdAt: 'created_at', id: 'id' }) };
};

export const getPurchaseInvoiceDayTotals = async (userId: string, filter: PurchaseFilter = {}): Promise<PurchaseDayTotal[]> => {
  const { where, params } = invoiceWhere(userId, filter);
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ day: string; currency: string | null; count: number; total: number; settled: number }>(
    `SELECT date(pi.invoice_date) AS day, pi.currency AS currency, COUNT(*) AS count, COALESCE(SUM(pi.total), 0) AS total, COALESCE(SUM(pi.amount_paid), 0) AS settled
       FROM purchase_invoices pi WHERE ${where} GROUP BY date(pi.invoice_date), pi.currency ORDER BY day DESC`, params
  );
  return foldDays(rows, await accountDefaultCurrency(db, userId));
};

export const getPurchaseOrderById = async (id: string): Promise<PurchaseOrder | null> => {
  const db = await getDatabase();
  const po = await db.getFirstAsync<PurchaseOrder>(
    `SELECT po.*, s.name as supplier_name FROM purchase_orders po
     LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ? AND po.is_deleted = 0`,
    [id]
  );
  if (!po) return null;
  const items = await db.getAllAsync<PurchaseOrderItem>(
    'SELECT * FROM purchase_order_items WHERE po_id = ? AND is_deleted = 0',
    [id]
  );
  return { ...po, items };
};

export const updatePurchaseOrderStatus = async (
  id: string, userId: string, status: POStatus
): Promise<void> => {
  const now = nowISO();
  await writeWithSync({
    tableName: 'purchase_orders',
    recordId: id,
    operation: 'update',
    data: { status, updated_at: now },
    firestorePath: `users/${userId}/purchase_orders/${id}`,
    userId
  });
};

/**
 * Mark items as received — ALL-OR-NOTHING. Each quantity must be above zero and no
 * more than what is still outstanding on that order line (you cannot receive more
 * than you ordered); the line, the stock increase and the order's status/total are
 * written in one transaction, so a failure part way leaves the order untouched.
 */
export const receiveGoods = async (
  poId: string,
  userId: string,
  receipts: { itemId: string; stockItemId?: string | null; itemName: string; receivedQty: number; unitCost: number }[]
): Promise<void> => {
  const wanted = receipts.filter(r => r.receivedQty !== 0);
  if (wanted.length === 0) throw new Error('Enter a received quantity for at least one item.');
  for (const r of wanted) {
    if (!(r.receivedQty > 0) || !Number.isFinite(r.receivedQty)) throw new Error(`Invalid quantity for ${r.itemName}.`);
  }
  const now = nowISO();
  await withWriteTransaction(async db => {
    for (const r of wanted) {
      const line = await db.getFirstAsync<{ quantity: number; received_qty: number; stock_item_id: string | null; unit_cost: number }>(
        'SELECT quantity, received_qty, stock_item_id, unit_cost FROM purchase_order_items WHERE id = ? AND po_id = ? AND is_deleted = 0',
        [r.itemId, poId]
      );
      if (!line) throw new Error('Order line not found.');
      const remaining = line.quantity - (line.received_qty || 0);
      if (r.receivedQty > remaining) throw new Error(`Only ${remaining} of ${r.itemName} is still to be received.`);
      await db.runAsync('UPDATE purchase_order_items SET received_qty = received_qty + ? WHERE id = ?', [r.receivedQty, r.itemId]);
      // Stock goes up only for a line linked to a stock item (the line's own link, not the caller's).
      if (line.stock_item_id) {
        await addStockMovementIn(db, {
          item_id: line.stock_item_id,
          change: r.receivedQty,
          reason: 'purchase',
          date: todayDate(), // local day, not UTC
          cost_per_unit: line.unit_cost,
          user_id: userId,
          note: 'Received from PO',
        });
      }
    }
    const tot = await db.getFirstAsync<{ received_total: number; open: number }>(
      `SELECT COALESCE(SUM(received_qty * unit_cost), 0) as received_total,
              SUM(CASE WHEN received_qty < quantity THEN 1 ELSE 0 END) as open
         FROM purchase_order_items WHERE po_id = ? AND is_deleted = 0`,
      [poId]
    );
    const newStatus: POStatus = (tot?.open ?? 0) === 0 ? 'received' : 'partial';
    await db.runAsync(
      'UPDATE purchase_orders SET status = ?, received_total = ?, updated_at = ?, synced = 0 WHERE id = ?',
      [newStatus, Math.round(tot?.received_total ?? 0), now, poId]
    );
  });
};

// ─── Purchase Invoices ────────────────────────────────────────────────────────

export const createPurchaseInvoice = async (
  userId: string,
  supplierId: string,
  items: Omit<PurchaseInvoiceItem, 'id' | 'invoice_id' | 'is_deleted'>[],
  invoiceDate: string,
  opts?: {
    poId?: string;
    invoiceNumber?: string;
    dueDate?: string;
    discountAmount?: number;
    taxAmount?: number;
    notes?: string;
    /** What the form's chip was set to. Unknown or absent resolves to PKR. */
    currency?: CurrencyCode;
  }
): Promise<PurchaseInvoice> => {
  const db = await getDatabase();
  const id = generateId('pinv');
  const now = nowISO();

  // Auto-generate invoice number if not provided
  const maxRow = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM purchase_invoices WHERE user_id = ?',
    [userId]
  );
  const invoiceNumber = opts?.invoiceNumber || `INV-${String((maxRow?.cnt ?? 0) + 1).padStart(4, '0')}`;

  const subtotal = items.reduce((s, i) => s + i.line_total, 0);
  const discountAmount = opts?.discountAmount ?? 0;
  const taxAmount = opts?.taxAmount ?? 0;
  const total = subtotal - discountAmount + taxAmount;
  const balance_due = total;

  const data = {
    id, user_id: userId, supplier_id: supplierId,
    po_id: opts?.poId || null,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: opts?.dueDate || null,
    subtotal, discount_amount: discountAmount, tax_amount: taxAmount,
    total, amount_paid: 0, balance_due,
    status: 'unpaid' as InvoiceStatus,
    notes: opts?.notes || null,
    currency: opts?.currency ? resolveCurrency(opts.currency).code : await accountDefaultCurrency(db, userId),
    is_deleted: 0, deleted_at: null,
  };

  await writeWithSync({
    tableName: 'purchase_invoices',
    recordId: id,
    operation: 'create',
    data,
    firestorePath: `users/${userId}/purchase_invoices/${id}`,
    userId
  });

  // Insert invoice items + update stock
  for (const item of items) {
    const itemId = generateId('piitem');
    await db.runAsync(
      `INSERT INTO purchase_invoice_items (id, invoice_id, stock_item_id, item_name, quantity, unit_cost, line_total, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [itemId, id, item.stock_item_id || null, item.item_name, item.quantity, item.unit_cost, item.line_total]
    );

    // Auto-increase stock
    if (item.stock_item_id) {
      await addStockMovement({
        item_id: item.stock_item_id,
        change: item.quantity,
        reason: 'purchase',
        date: invoiceDate,
        cost_per_unit: item.unit_cost,
        user_id: userId,
        note: `Purchase Invoice ${invoiceNumber}`,
      });
    }
  }

  return { ...data, created_at: now, updated_at: now, synced: 0 } as PurchaseInvoice;
};

export const getPurchaseInvoices = async (userId: string, status?: InvoiceStatus): Promise<PurchaseInvoice[]> => {
  const db = await getDatabase();
  let query = `
    SELECT pi.*, s.name as supplier_name
    FROM purchase_invoices pi
    LEFT JOIN suppliers s ON s.id = pi.supplier_id
    WHERE pi.user_id = ? AND pi.is_deleted = 0
  `;
  const params: any[] = [userId];
  if (status) { query += ' AND pi.status = ?'; params.push(status); }
  query += ' ORDER BY pi.invoice_date DESC';
  return db.getAllAsync<PurchaseInvoice>(query, params);
};

export const getPurchaseInvoiceById = async (id: string): Promise<PurchaseInvoice | null> => {
  const db = await getDatabase();
  const inv = await db.getFirstAsync<PurchaseInvoice>(
    `SELECT pi.*, s.name as supplier_name FROM purchase_invoices pi
     LEFT JOIN suppliers s ON s.id = pi.supplier_id WHERE pi.id = ? AND pi.is_deleted = 0`,
    [id]
  );
  if (!inv) return null;
  const items = await db.getAllAsync<PurchaseInvoiceItem>(
    'SELECT * FROM purchase_invoice_items WHERE invoice_id = ? AND is_deleted = 0',
    [id]
  );
  return { ...inv, items };
};

export const getPurchaseInvoicesBySupplier = async (supplierId: string): Promise<PurchaseInvoice[]> => {
  const db = await getDatabase();
  return db.getAllAsync<PurchaseInvoice>(
    `SELECT pi.*, s.name as supplier_name FROM purchase_invoices pi
     LEFT JOIN suppliers s ON s.id = pi.supplier_id
     WHERE pi.supplier_id = ? AND pi.is_deleted = 0
     ORDER BY pi.invoice_date DESC`,
    [supplierId]
  );
};

// ─── Purchase Returns ─────────────────────────────────────────────────────────

/**
 * Return goods to a supplier against ONE invoice — ALL-OR-NOTHING. Each item's
 * quantity must be above zero and, together with earlier returns on the same invoice,
 * no more than was invoiced (the same goods cannot be returned twice). Line totals are
 * computed here in whole paisa; the return, its lines and the stock decrease are one
 * transaction.
 */
export const createPurchaseReturn = async (
  userId: string,
  invoiceId: string,
  supplierId: string,
  items: Omit<PurchaseReturnItem, 'id' | 'return_id'>[],
  returnDate: string,
  reason?: string
): Promise<PurchaseReturn> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate) || !parseDateValue(returnDate)) throw new Error('Invalid return date.');
  if (items.length === 0) throw new Error('Select at least one item to return.');
  for (const i of items) {
    if (!(i.quantity > 0) || !Number.isFinite(i.quantity)) throw new Error(`Invalid quantity for ${i.item_name}.`);
  }
  const id = generateId('pret');
  const now = nowISO();
  const lines = items.map(i => ({ ...i, line_total: Math.round(i.quantity * i.unit_cost) }));
  const totalRefund = lines.reduce((sum, i) => sum + i.line_total, 0);
  const data = {
    id, user_id: userId, invoice_id: invoiceId, supplier_id: supplierId,
    return_date: returnDate, reason: reason || null,
    total_refund: totalRefund, status: 'pending' as const,
    is_deleted: 0, deleted_at: null,
  };

  await withWriteTransaction(async db => {
    const invoice = await db.getFirstAsync<{ id: string }>('SELECT id FROM purchase_invoices WHERE id = ? AND is_deleted = 0', [invoiceId]);
    if (!invoice) throw new Error('Invoice not found.');
    // Invoiced vs already returned, per item (matched by stock item when linked, else by name).
    for (const i of lines) {
      const key = i.stock_item_id ? 'stock_item_id = ?' : '(stock_item_id IS NULL AND item_name = ?)';
      const keyVal = i.stock_item_id || i.item_name;
      const invoiced = await db.getFirstAsync<{ q: number }>(
        `SELECT COALESCE(SUM(quantity), 0) as q FROM purchase_invoice_items WHERE invoice_id = ? AND is_deleted = 0 AND ${key}`,
        [invoiceId, keyVal]
      );
      const returned = await db.getFirstAsync<{ q: number }>(
        `SELECT COALESCE(SUM(ri.quantity), 0) as q FROM purchase_return_items ri
           JOIN purchase_returns r ON r.id = ri.return_id
          WHERE r.invoice_id = ? AND r.is_deleted = 0 AND ${key.replace(/stock_item_id/g, 'ri.stock_item_id').replace('item_name', 'ri.item_name')}`,
        [invoiceId, keyVal]
      );
      const left = (invoiced?.q ?? 0) - (returned?.q ?? 0);
      if (i.quantity > left) throw new Error(`Only ${left} of ${i.item_name} can still be returned on this invoice.`);
    }

    await writeRowWithSyncIn(db, {
      tableName: 'purchase_returns', recordId: id, operation: 'create', data,
      firestorePath: `users/${userId}/purchase_returns/${id}`, userId
    });
    for (const item of lines) {
      await db.runAsync(
        `INSERT INTO purchase_return_items (id, return_id, stock_item_id, item_name, quantity, unit_cost, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [generateId('pritem'), id, item.stock_item_id || null, item.item_name, item.quantity, item.unit_cost, item.line_total]
      );
      if (item.stock_item_id) {
        await addStockMovementIn(db, {
          item_id: item.stock_item_id,
          change: -item.quantity,
          reason: 'adjustment',
          date: returnDate,
          cost_per_unit: item.unit_cost,
          user_id: userId,
          note: 'Purchase return',
        });
      }
    }
  });
  afterSyncedWrite();

  return { ...data, created_at: now, updated_at: now, synced: 0 } as PurchaseReturn;
};

export const getPurchaseReturnsByInvoice = async (invoiceId: string): Promise<PurchaseReturn[]> => {
  const db = await getDatabase();
  return db.getAllAsync<PurchaseReturn>(
    'SELECT * FROM purchase_returns WHERE invoice_id = ? AND is_deleted = 0 ORDER BY return_date DESC',
    [invoiceId]
  );
};

// ─── Dashboard Summary ────────────────────────────────────────────────────────

export const getPurchaseSummary = async (userId: string): Promise<PurchaseSummary> => {
  const db = await getDatabase();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const [ordersRow, invoicesRow, paidRow] = await Promise.all([
    db.getFirstAsync<{ total: number; pending: number }>(
      `SELECT COUNT(*) as total,
         SUM(CASE WHEN status IN ('draft','sent','partial') THEN 1 ELSE 0 END) as pending
       FROM purchase_orders WHERE user_id = ? AND is_deleted = 0`,
      [userId]
    ),
    db.getAllAsync<{ currency: string | null; total_invoiced: number; total_outstanding: number }>(
      `SELECT currency, COALESCE(SUM(total), 0) as total_invoiced,
         COALESCE(SUM(balance_due), 0) as total_outstanding
       FROM purchase_invoices WHERE user_id = ? AND is_deleted = 0 GROUP BY currency`,
      [userId]
    ),
    // A supplier payment settles an invoice, so it is in THAT invoice's currency —
    // supplier_payments has no column of its own and must not grow one that could drift.
    db.getAllAsync<{ currency: string | null; paid_this_month: number }>(
      `SELECT pi.currency AS currency, COALESCE(SUM(sp.amount), 0) as paid_this_month
       FROM supplier_payments sp
       LEFT JOIN purchase_invoices pi ON pi.id = sp.invoice_id
       WHERE sp.user_id = ? AND sp.is_deleted = 0 AND sp.payment_date >= ?
       GROUP BY pi.currency`,
      [userId, monthStart]
    ),
  ]);

  const base = await accountDefaultCurrency(db, userId);
  return {
    totalOrders: ordersRow?.total ?? 0,
    pendingOrders: ordersRow?.pending ?? 0,
    totalInvoiced: totalsFrom(invoicesRow, 'total_invoiced', base),
    totalOutstanding: totalsFrom(invoicesRow, 'total_outstanding', base),
    totalPaidThisMonth: totalsFrom(paidRow, 'paid_this_month', base),
  };
};
