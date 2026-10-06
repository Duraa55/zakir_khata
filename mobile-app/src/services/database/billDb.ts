import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from './db';
import { assertAllowedUpdateFields } from './updateFields';
import { Bill, BillItem } from '../../types/bill.types';
import { writeWithSync, writeRowWithSyncIn, afterSyncedWrite } from './syncHelpers';
import { withWriteTransaction } from './writeTransaction';
import { addStockMovementIn } from './stockDb';
import { keysetClause, keysetParams, nextCursorOf, PageCursor } from './pagination';
import { parseDateValue, toDateValue, todayDate } from '../../utils/dates';
import { entryOwner } from './entryScope';
import { resolveCurrency, type CurrencyCode } from '../../utils/currency';
import { totalsFrom, type CurrencyTotal } from '../../utils/currencyTotals';
import { accountCurrencyOf } from './accountCurrency';
import { matchCustomerByName } from './customerDb';

/**
 * "No customer chosen." `bills.customer_id` is NOT NULL, so a bill with nobody on
 * record carries this sentinel rather than null, and every read already treats it as
 * a walk-in. Defined here because the data layer now decides when it applies.
 */
export const WALK_IN_CUSTOMER_ID = 'walk_in';

export const createBill = async (
  bill: Omit<Bill, 'id' | 'bill_no' | 'created_at' | 'synced' | 'is_deleted'> & { bill_no?: number },
  items: Omit<BillItem, 'id' | 'bill_id' | 'is_deleted'>[]
): Promise<Bill> => {
  const db = await getDatabase();
  const id = `bill_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = new Date().toISOString();

  let newBillNo = bill.bill_no;
  if (!newBillNo) {
    newBillNo = 1;
    const maxRow = await db.getFirstAsync<{ max_no: number }>(
      'SELECT MAX(bill_no) as max_no FROM bills WHERE user_id = ?',
      [bill.user_id]
    );
    if (maxRow && maxRow.max_no) {
      newBillNo = maxRow.max_no + 1;
    }
  }

  const attachments = bill.attachment_urls ? JSON.stringify(bill.attachment_urls) : null;

  // The figures decide: paid is what was received (nothing by default), due is what is
  // left, and the status is read off them — it is never chosen, so it cannot disagree.
  const paid = Math.max(0, Math.round(Number(bill.paid) || 0));
  const total = Math.round(Number(bill.total) || 0);
  if (paid > total) throw new Error('Paid cannot be more than the bill total.');
  const due = total - paid;

  // The form sends the chip's value; any other caller falls back to this ACCOUNT's
  // default, never a hardcoded PKR — that would label a Dubai shop's bill as rupees.
  const currencyRow = await db.getFirstAsync<{ default_currency: string | null }>(
    'SELECT default_currency FROM users WHERE id = ?', [bill.user_id]
  );
  const currency = bill.currency
    ? resolveCurrency(bill.currency).code
    : resolveCurrency(currencyRow?.default_currency).code;

  // A bill names its customer two ways: picked from the saved list, which arrives as a
  // real id, or TYPED. A typed name was filed as the walk-in sentinel even when that
  // exact customer was on record, so the bill never reached their ledger and the Bill
  // Book and the Khata disagreed about whether they existed — the same class of fault
  // as a stale balance. Resolve it through the rule khata entries already use
  // (customerDb.matchCustomerByName): link on exactly one live match, stay unlinked
  // when the name is new or ambiguous. Nothing is created here; a brand-new name is
  // confirmed with the user on the form, not invented by the write.
  const chosen = bill.customer_id && bill.customer_id !== WALK_IN_CUSTOMER_ID ? bill.customer_id : null;
  const customer_id = chosen
    ?? (await matchCustomerByName(bill.user_id, bill.party_name ?? '', db)).id
    ?? WALK_IN_CUSTOMER_ID;

  const billData = {
    ...bill,
    customer_id,
    currency,
    paid,
    due,
    status: (paid >= total && total > 0 ? 'paid' : paid === 0 ? 'unpaid' : 'partial') as Bill['status'],
    id,
    bill_no: newBillNo,
    attachment_urls: attachments,
    voice_note_url: bill.voice_note_url || null,
    is_draft: bill.is_draft || 0,
    is_hold: bill.is_hold || 0,
    payment_method: bill.payment_method || 'cash',
    is_deleted: 0,
    deleted_at: null
  };

  await writeWithSync({
    tableName: 'bills',
    recordId: id,
    operation: 'create',
    data: billData,
    firestorePath: `users/${bill.user_id}/bills/${id}`,
    userId: bill.user_id
  });

  const savedItems: BillItem[] = [];
  for (const item of items) {
    const itemId = `billitem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const itemData = {
      ...item,
      id: itemId,
      bill_id: id,
      returned_quantity: 0,
      is_deleted: 0
    };
    await writeWithSync({
      tableName: 'bill_items',
      recordId: itemId,
      operation: 'create',
      data: itemData,
      firestorePath: `users/${bill.user_id}/bills/${id}/items/${itemId}`,
      userId: bill.user_id
    });
    savedItems.push(itemData as BillItem);
  }

  return {
    ...bill,
    id,
    bill_no: newBillNo,
    items: savedItems,
    attachment_urls: bill.attachment_urls,
    is_draft: billData.is_draft as 0 | 1,
    is_hold: billData.is_hold as 0 | 1,
    payment_method: billData.payment_method,
    created_at: now,
    updated_at: now,
    synced: 0,
    is_deleted: 0
  };
};

const BILL_UPDATE_FIELDS = ["bill_no","customer_id","party_name","party_name_ur","party_phone","bill_date","subtotal","discount_pct","discount_amount","tax_amount","total","paid","due","status","payment_method","is_draft","is_hold","notes","attachment_urls","voice_note_url"];
const BILL_ITEM_UPDATE_FIELDS = ["item_id","item_name","quantity","returned_quantity","unit_price","line_total"];

type BillUpdates = Partial<Pick<Bill, 'bill_no' | 'customer_id' | 'party_name' | 'party_name_ur' | 'party_phone' | 'bill_date' | 'subtotal' | 'discount_pct' | 'discount_amount' | 'tax_amount' | 'total' | 'paid' | 'due' | 'status' | 'payment_method' | 'is_draft' | 'is_hold' | 'notes' | 'attachment_urls' | 'voice_note_url'>>;
type BillItemUpdates = Partial<Pick<BillItem, 'item_id' | 'item_name' | 'quantity' | 'returned_quantity' | 'unit_price' | 'line_total'>>;

/**
 * Only the bill's own author may change it or its lines — never a parent, never a
 * sibling. The same rule as Cash: seeing a staff member's bill is not editing it.
 */
const assertOwnBillIn = async (db: SQLiteDatabase, billId: string, userId: string): Promise<any> => {
  const bill = await db.getFirstAsync<any>('SELECT * FROM bills WHERE id = ? AND is_deleted = 0', [billId]);
  if (!bill) throw new Error('Bill not found.');
  if (!userId || bill.user_id !== userId) throw new Error('You can only change your own bills.');
  return bill;
};

const assertBillLineIn = async (db: SQLiteDatabase, id: string, billId: string): Promise<void> => {
  const line = await db.getFirstAsync<{ bill_id: string }>('SELECT bill_id FROM bill_items WHERE id = ?', [id]);
  if (!line || line.bill_id !== billId) throw new Error('Bill line not found.');
};

export const updateBill = async (id: string, userId: string, updates: BillUpdates): Promise<void> => {
  assertAllowedUpdateFields(updates, BILL_UPDATE_FIELDS);
  if (Object.keys(updates).length === 0) return;
  await withWriteTransaction(db => updateBillIn(db, id, userId, updates));
  afterSyncedWrite();
};

/** updateBill on a connection already inside a write transaction. */
const updateBillIn = async (db: SQLiteDatabase, id: string, userId: string, updates: BillUpdates): Promise<void> => {
  assertAllowedUpdateFields(updates, BILL_UPDATE_FIELDS);
  if (Object.keys(updates).length === 0) return;
  await assertOwnBillIn(db, id, userId);
  await writeRowWithSyncIn(db, {
    tableName: 'bills',
    recordId: id,
    operation: 'update',
    data: { ...updates, updated_at: new Date().toISOString() },
    firestorePath: `users/${userId}/bills/${id}`,
    userId
  });
};

export const updateBillItem = async (
  id: string,
  billId: string,
  userId: string,
  updates: BillItemUpdates
): Promise<void> => {
  assertAllowedUpdateFields(updates, BILL_ITEM_UPDATE_FIELDS);
  if (Object.keys(updates).length === 0) return;
  await withWriteTransaction(db => updateBillItemIn(db, id, billId, userId, updates));
  afterSyncedWrite();
};

/** updateBillItem on a connection already inside a write transaction. */
const updateBillItemIn = async (
  db: SQLiteDatabase, id: string, billId: string, userId: string, updates: BillItemUpdates
): Promise<void> => {
  assertAllowedUpdateFields(updates, BILL_ITEM_UPDATE_FIELDS);
  if (Object.keys(updates).length === 0) return;
  await assertOwnBillIn(db, billId, userId);
  await assertBillLineIn(db, id, billId);
  await writeRowWithSyncIn(db, {
    tableName: 'bill_items',
    recordId: id,
    operation: 'update',
    data: updates,
    firestorePath: `users/${userId}/bills/${billId}/items/${id}`,
    userId
  });
};

/** One line of an edited bill. `billItemId` present = an existing line; absent = a new one. */
export type BillEditLine = {
  billItemId?: string;
  item_id: string | null;
  item_name: string;
  quantity: number;
  unit_price: number; // integer paisa
};

export type BillEdit = {
  bill_no?: number;
  customer_id: string;
  party_name: string;
  party_phone?: string | null;
  bill_date: string;
  notes?: string | null;
  attachment_urls?: string[] | null;
  /** Integer paisa — used only for a bill with no lines (typed amount). */
  manualTotal?: number;
  /** Integer paisa the customer has paid. Omitted keeps what was already received. */
  paid?: number;
  lines: BillEditLine[];
};

/**
 * Returns items against ONE bill, all-or-nothing: every line's returned_quantity and
 * the stock that comes back are written in a single transaction, so a failure part
 * way through can never leave an item marked returned without its stock (or the
 * reverse). Author-only, like every other change to a bill.
 */
export const returnBillItems = async (
  billId: string,
  userId: string,
  returns: { billItemId: string; qty: number }[]
): Promise<void> => {
  const wanted = returns.filter(r => r.qty !== 0);
  if (wanted.length === 0) throw new Error('Enter a quantity to return.');
  const seen = new Set<string>();
  for (const r of wanted) {
    if (!Number.isInteger(r.qty) || r.qty <= 0) throw new Error('Return quantities must be whole numbers above zero.');
    if (seen.has(r.billItemId)) throw new Error('A bill line appears twice.');
    seen.add(r.billItemId);
  }

  await withWriteTransaction(async db => {
    const bill = await assertOwnBillIn(db, billId, userId);
    for (const r of wanted) {
      const line = await db.getFirstAsync<BillItem>(
        'SELECT * FROM bill_items WHERE id = ? AND bill_id = ? AND is_deleted = 0', [r.billItemId, billId]
      );
      if (!line) throw new Error('Bill line not found.');
      const already = line.returned_quantity || 0;
      const left = line.quantity - already;
      if (r.qty > left) throw new Error(`Cannot return more than ${left} of ${line.item_name}.`);
      await updateBillItemIn(db, line.id, billId, userId, { returned_quantity: already + r.qty });
      // Stock comes back only for a real stock line; a custom line has nothing to restock.
      if (line.item_id) {
        const stock = await db.getFirstAsync<{ id: string }>('SELECT id FROM stock_items WHERE id = ?', [line.item_id]);
        if (stock) {
          await addStockMovementIn(db, {
            item_id: line.item_id,
            change: r.qty,
            reason: 'adjustment',
            date: todayDate(),
            user_id: userId,
            note: `Returned from Bill #${bill.bill_no}`,
          });
        }
      }
    }
  });
  afterSyncedWrite();
};

/** The bill and its live lines, fresh from the database — what the edit form loads. */
export const getBillForEdit = async (billId: string): Promise<Bill | null> => {
  const db = await getDatabase();
  const bill = await db.getFirstAsync<any>('SELECT * FROM bills WHERE id = ? AND is_deleted = 0', [billId]);
  if (!bill) return null;
  await attachBillItems(db, [bill]);
  return bill as Bill;
};

const isPaisa = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Edits ONE existing bill in place — the same id, the same bill number unless the
 * author changes it, and its lines updated rather than re-created. Everything happens
 * in one transaction, so a failure leaves the bill exactly as it was.
 *
 *   lines kept    → updated in place (only the fields that changed)
 *   lines added   → created under the SAME bill
 *   lines removed → soft-deleted (is_deleted = 1); a line with returns cannot go
 *   stock         → one 'adjustment' movement per item for the DIFFERENCE only: raising
 *                   a line from 3 to 5 records −2, removing it puts its stock back.
 *                   The original sale is never re-deducted.
 *   money         → integer paisa; total = lines (or the typed amount) − the bill's
 *                   existing discount + its existing tax; due = total − paid. The
 *                   payment already received is kept; the status follows the figures.
 */
export const saveBillEdit = async (billId: string, userId: string, edit: BillEdit): Promise<void> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(edit.bill_date) || !parseDateValue(edit.bill_date)) throw new Error('Invalid bill date.');

  const seen = new Set<string>();
  for (const l of edit.lines) {
    if (!l.item_name?.trim()) throw new Error('Every line needs an item name.');
    if (typeof l.quantity !== 'number' || !(l.quantity > 0) || !Number.isFinite(l.quantity)) throw new Error(`Invalid quantity for ${l.item_name}.`);
    if (!isPaisa(l.unit_price)) throw new Error(`Invalid price for ${l.item_name}.`);
    if (l.billItemId) {
      if (seen.has(l.billItemId)) throw new Error('A bill line appears twice.');
      seen.add(l.billItemId);
    }
  }

  await withWriteTransaction(async db => {
    const bill = await assertOwnBillIn(db, billId, userId);
    const oldLines = await db.getAllAsync<BillItem>(
      'SELECT * FROM bill_items WHERE bill_id = ? AND is_deleted = 0 ORDER BY rowid', [billId]
    );
    const oldById = new Map(oldLines.map(l => [l.id, l]));
    for (const l of edit.lines) {
      if (l.billItemId && !oldById.has(l.billItemId)) throw new Error('Bill line not found.');
    }

    // Money first, so an invalid total refuses the edit before anything is written.
    const lineTotal = (l: BillEditLine) => Math.round(l.quantity * l.unit_price);
    let subtotal: number;
    if (edit.lines.length > 0) {
      subtotal = edit.lines.reduce((sum, l) => sum + lineTotal(l), 0);
    } else {
      if (!isPaisa(edit.manualTotal) || !edit.manualTotal) throw new Error('Enter an amount or add items.');
      subtotal = edit.manualTotal;
    }
    const total = subtotal - (bill.discount_amount || 0) + (bill.tax_amount || 0);
    if (!(total > 0)) throw new Error('The bill total must be more than zero.');
    if (edit.paid !== undefined && Math.round(edit.paid) > total) throw new Error('Paid cannot be more than the bill total.');
    // What was already received stays with the bill (never more than the new total);
    // due and status are read off the figures.
    const paid = Math.min(edit.paid === undefined ? (bill.paid || 0) : Math.max(0, Math.round(edit.paid)), total);
    const due = total - paid;
    const status = paid >= total ? 'paid' : paid === 0 ? 'unpaid' : 'partial';

    // Removed lines: soft delete — but never a line with returns against it.
    const keptIds = new Set(edit.lines.map(l => l.billItemId).filter(Boolean) as string[]);
    for (const old of oldLines) {
      if (keptIds.has(old.id)) continue;
      if ((old.returned_quantity || 0) > 0) throw new Error(`${old.item_name} has returned items and cannot be removed.`);
      await writeRowWithSyncIn(db, {
        tableName: 'bill_items', recordId: old.id, operation: 'delete', data: {},
        firestorePath: `users/${userId}/bills/${billId}/items/${old.id}`, userId
      });
    }

    // Kept lines: update in place, only what changed. New lines: create under this bill.
    for (const l of edit.lines) {
      const next = { item_id: l.item_id ?? null, item_name: l.item_name.trim(), quantity: l.quantity, unit_price: l.unit_price, line_total: lineTotal(l) };
      if (l.billItemId) {
        const old = oldById.get(l.billItemId)!;
        if (l.quantity < (old.returned_quantity || 0)) {
          throw new Error(`${old.item_name} cannot go below the ${old.returned_quantity} already returned.`);
        }
        const changed: BillItemUpdates = {};
        for (const k of Object.keys(next) as (keyof typeof next)[]) {
          if (((old as any)[k] ?? null) !== next[k]) (changed as any)[k] = next[k];
        }
        await updateBillItemIn(db, l.billItemId, billId, userId, changed);
      } else {
        const itemId = `billitem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        await writeRowWithSyncIn(db, {
          tableName: 'bill_items', recordId: itemId, operation: 'create',
          data: { ...next, id: itemId, bill_id: billId, returned_quantity: 0, is_deleted: 0 },
          firestorePath: `users/${userId}/bills/${billId}/items/${itemId}`, userId
        });
      }
    }

    // The bill row itself, in place.
    const attachments = edit.attachment_urls && edit.attachment_urls.length > 0 ? JSON.stringify(edit.attachment_urls) : null;
    // Re-link on EDIT exactly as on create (see createBill): a bill renamed to a
    // customer who IS on record must reach their ledger, and one renamed away from them
    // must stop claiming to be theirs. Resolved on this transaction's own connection.
    const chosenCustomer = edit.customer_id && edit.customer_id !== WALK_IN_CUSTOMER_ID ? edit.customer_id : null;
    const editedCustomerId = chosenCustomer
      ?? (await matchCustomerByName(userId, edit.party_name ?? '', db)).id
      ?? WALK_IN_CUSTOMER_ID;

    await updateBillIn(db, billId, userId, {
      bill_no: edit.bill_no || bill.bill_no,
      customer_id: editedCustomerId,
      party_name: edit.party_name,
      party_phone: (edit.party_phone ?? null) as any,
      bill_date: edit.bill_date,
      subtotal, total, paid, due, status: status as Bill['status'],
      notes: (edit.notes ?? null) as any,
      attachment_urls: attachments as any,
    });

    // Stock: the difference per item only. Old and new quantities are summed per stock
    // item, so moving a quantity between lines of the same item nets to nothing.
    const qtyBy = (lines: { item_id?: string | null; quantity: number }[]) => {
      const m = new Map<string, number>();
      for (const l of lines) if (l.item_id) m.set(l.item_id, (m.get(l.item_id) || 0) + l.quantity);
      return m;
    };
    const before = qtyBy(oldLines), after = qtyBy(edit.lines);
    const billNo = edit.bill_no || bill.bill_no;
    for (const itemId of new Set([...before.keys(), ...after.keys()])) {
      const sold = (after.get(itemId) || 0) - (before.get(itemId) || 0);
      if (sold === 0) continue;
      const stock = await db.getFirstAsync<{ purchase_price: number; sale_price: number }>(
        'SELECT purchase_price, sale_price FROM stock_items WHERE id = ?', [itemId]
      );
      if (!stock) continue; // the stock item no longer exists — nothing to correct
      const line = edit.lines.find(l => l.item_id === itemId);
      await addStockMovementIn(db, {
        item_id: itemId,
        change: -sold,
        reason: 'adjustment',
        date: todayDate(),
        cost_per_unit: stock.purchase_price,
        sale_price_unit: line ? line.unit_price : stock.sale_price,
        user_id: userId,
        note: `Bill #${billNo} edited`,
      });
    }
  });
  afterSyncedWrite();
};

export type BillFilter = {
  startDate?: string;
  endDate?: string;
  /** 'posted' = neither draft nor hold, matching the screen's default tab. */
  status?: 'all' | 'posted' | 'drafts' | 'holds';
  search?: string;
  /** Staff Book drill-down: read this person's bills (permission-checked, read-only). */
  createdBy?: string;
};

/** Per-calendar-day subtotal of the filtered bills, for the Bill Book's day headers. */
/**
 * A day's bills. Each figure is ONE PER CURRENCY — adding AED to PKR means nothing, so
 * the aggregate groups by currency in SQL and never collapses to a scalar. A
 * single-currency day has exactly one entry per figure and renders as it always did.
 */
export type BillDayTotal = {
  day: string; billCount: number;
  totalBilled: CurrencyTotal[]; totalPaid: CurrencyTotal[]; totalDue: CurrencyTotal[];
};

/** THE one predicate for the Bill Book: rows, headline summary and day subtotals. */
const billWhere = (userId: string, filter: BillFilter) => {
  for (const date of [filter.startDate, filter.endDate]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseDateValue(date))) {
      throw new Error('Invalid date range.');
    }
  }
  if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) throw new Error('From date must not be after To date.');
  if (filter.status && !['all', 'posted', 'drafts', 'holds'].includes(filter.status)) throw new Error('Invalid bill status.');

  let where = `user_id = ? AND is_deleted = 0`;
  const params: (string | number)[] = [userId];
  if (filter.startDate || filter.endDate) {
    where += ' AND date(bill_date) BETWEEN date(?) AND date(?)';
    params.push(filter.startDate || '0001-01-01', filter.endDate || '9999-12-31');
  }
  if (filter.status === 'drafts') where += ' AND is_draft = 1';
  else if (filter.status === 'holds') where += ' AND is_hold = 1';
  else if (filter.status === 'posted') where += ' AND COALESCE(is_draft, 0) = 0 AND COALESCE(is_hold, 0) = 0';

  const search = filter.search?.trim();
  if (search) {
    // Literal substring search: %, _ and quotes are text, never SQL wildcards.
    where += ` AND (instr(lower(COALESCE(party_name, '')), ?) > 0
                 OR instr(COALESCE(party_phone, ''), ?) > 0
                 OR instr(COALESCE(CAST(bill_no AS TEXT), ''), ?) > 0)`;
    params.push(search.toLowerCase(), search, search);
  }
  return { where, params };
};

const BILL_KEYS = { date: 'bill_date', createdAt: 'created_at', id: 'id' } as const;

/** Items for a set of bills in ONE query per chunk (was one query per bill). */
const attachBillItems = async (db: Awaited<ReturnType<typeof getDatabase>>, bills: any[]) => {
  for (const b of bills) {
    if (b.attachment_urls && typeof b.attachment_urls === 'string') b.attachment_urls = JSON.parse(b.attachment_urls);
    b.items = [];
  }
  const byId = new Map<string, any>(bills.map(b => [b.id, b]));
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const items = await db.getAllAsync<BillItem>(
      `SELECT * FROM bill_items WHERE is_deleted = 0 AND bill_id IN (${chunk.map(() => '?').join(',')}) ORDER BY rowid`, chunk
    );
    for (const it of items) byId.get(it.bill_id)?.items.push(it);
  }
};

/**
 * One predicate for both rows and whole-result paisa aggregates.
 *
 * Paging: pass `after` for the next `limit` bills in `bill_date DESC, created_at
 * DESC, id DESC` order. The cursor is applied to the ROWS query ONLY — billSummary
 * always covers the whole filtered set. Items are fetched with one IN (…) query per
 * page, not one query per bill.
 */
export const getFilteredBills = async (
  userId: string, filter: BillFilter = {}, limit = -1, offset = 0, after?: PageCursor | null
) => {
  const { where, params } = billWhere(await entryOwner(userId, filter.createdBy), filter);
  const db = await getDatabase();
  const rowsWhere = after ? `${where} AND ${keysetClause(BILL_KEYS)}` : where;
  const rowsParams = after ? [...params, ...keysetParams(after)] : params;
  const bills = await db.getAllAsync<any>(
    `SELECT * FROM bills WHERE ${rowsWhere} ORDER BY bill_date DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...rowsParams, limit, offset]
  );
  await attachBillItems(db, bills);

  // total/paid/due are integer paisa (v29), summed by SQL over the WHOLE filtered
  // set — never from the returned page, so the headline cannot drift from the list.
  // GROUPED BY CURRENCY in SQL, over the WHOLE filtered set — never from the returned
  // page, and never summed across currencies.
  const summaryRows = await db.getAllAsync<{ currency: string | null; billCount: number; totalBilled: number; totalPaid: number; totalDue: number }>(
    `SELECT currency, COUNT(*) as billCount,
            COALESCE(SUM(total), 0) as totalBilled,
            COALESCE(SUM(paid), 0) as totalPaid,
            COALESCE(SUM(due), 0) as totalDue
       FROM bills WHERE ${where} GROUP BY currency`, params
  );
  const base = await accountCurrencyOf(db, userId);
  const billCount = summaryRows.reduce((n, r) => n + Number(r.billCount ?? 0), 0);
  return {
    bills: bills as Bill[],
    billSummary: {
      billCount,
      totalBilled: totalsFrom(summaryRows, 'totalBilled', base),
      totalPaid: totalsFrom(summaryRows, 'totalPaid', base),
      totalDue: totalsFrom(summaryRows, 'totalDue', base),
    },
    nextCursor: nextCursorOf(bills, limit, BILL_KEYS),
  };
};

/**
 * Every calendar day in the filtered set with its own SQL subtotal — ONE query per
 * filter change, never per page, never a sum of loaded rows.
 */
export const getBillDayTotals = async (userId: string, filter: BillFilter = {}): Promise<BillDayTotal[]> => {
  const { where, params } = billWhere(await entryOwner(userId, filter.createdBy), filter);
  const db = await getDatabase();
  // One row per day PER CURRENCY, folded into stacked totals. The grouping is SQL's.
  const rows = await db.getAllAsync<{ day: string; currency: string | null; billCount: number; totalBilled: number; totalPaid: number; totalDue: number }>(
    `SELECT date(bill_date) AS day, currency, COUNT(*) AS billCount,
            COALESCE(SUM(total), 0) AS totalBilled, COALESCE(SUM(paid), 0) AS totalPaid, COALESCE(SUM(due), 0) AS totalDue
       FROM bills WHERE ${where}
      GROUP BY date(bill_date), currency
      ORDER BY day DESC`, params
  );
  const base = await accountCurrencyOf(db, userId);
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  return [...byDay.entries()].map(([day, group]) => ({
    day,
    billCount: group.reduce((n, r) => n + Number(r.billCount ?? 0), 0),
    totalBilled: totalsFrom(group, 'totalBilled', base),
    totalPaid: totalsFrom(group, 'totalPaid', base),
    totalDue: totalsFrom(group, 'totalDue', base),
  }));
};

/** True when a bill would appear under the given filter — used to tell the user
 *  when a backdated bill saved outside the range they are looking at. */
export const billMatchesFilter = (bill: Pick<Bill, 'bill_date' | 'is_draft' | 'is_hold'>, filter: BillFilter = {}): boolean => {
  const day = toDateValue(bill.bill_date as string);
  if (!day) return false;
  if (filter.startDate && day < filter.startDate) return false;
  if (filter.endDate && day > filter.endDate) return false;
  if (filter.status === 'drafts') return bill.is_draft === 1;
  if (filter.status === 'holds') return bill.is_hold === 1;
  if (filter.status === 'posted') return bill.is_draft !== 1 && bill.is_hold !== 1;
  return true;
};

/**
 * Posted bills that still have money due — the Reminders screen's invoice list, in SQL.
 * (It used to load every bill with all its lines and filter in JavaScript, drafts and
 * holds included.) Newest-due first is the caller's choice; this returns by bill date.
 */
export const getUnpaidBills = async (userId: string): Promise<Pick<Bill, 'id' | 'user_id' | 'bill_no' | 'party_name' | 'party_phone' | 'bill_date' | 'total' | 'due' | 'created_at'>[]> => {
  const db = await getDatabase();
  return db.getAllAsync<any>(
    `SELECT id, user_id, bill_no, party_name, party_phone, bill_date, total, due, created_at
       FROM bills
      WHERE user_id = ? AND is_deleted = 0
        AND COALESCE(is_draft, 0) = 0 AND COALESCE(is_hold, 0) = 0 AND due > 0
      ORDER BY bill_date ASC, created_at ASC`,
    [userId]
  );
};

export const getBillsByUserId = async (
  userId: string,
  startDate?: string,
  endDate?: string
): Promise<Bill[]> => {
  const db = await getDatabase();

  let query = `
    SELECT * FROM bills 
    WHERE user_id = ? 
      AND is_deleted = 0
  `;
  const params: any[] = [userId];

  if (startDate && endDate) {
    query += ' AND date(bill_date) BETWEEN date(?) AND date(?)';
    params.push(startDate, endDate);
  }

  query += ' ORDER BY created_at DESC';

  const bills = await db.getAllAsync<any>(query, params);
  // Items in one IN (…) query per chunk, same as getFilteredBills — not one per bill.
  await attachBillItems(db, bills);

  return bills as Bill[];
};

// calculateMonthlySales, calculateTodaySales and getTodayBillsCount lived here. They were
// called only by the dashboard store, which never rendered them, so they went with it.
// Grouped-by-currency totals exist now (see getFilteredBills / getBillDayTotals); these
// were not brought back because no screen shows them.
/**
 * What customers still owe on bills, ONE FIGURE PER CURRENCY.
 *
 * This used to be a flat `SUM(due)` that added AED to PKR, which is why the dashboard
 * carried a comment telling readers never to render it. It is grouped now, so it is a
 * real figure again and safe to show.
 */
export const calculatePendingPayments = async (userId: string): Promise<CurrencyTotal[]> => {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ currency: string | null; total: number }>(
    `SELECT currency, COALESCE(SUM(due), 0) as total FROM bills
      WHERE user_id = ?
       AND is_deleted = 0
       AND due > 0
      GROUP BY currency`,
    [userId]
  );
  return totalsFrom(rows, 'total', await accountCurrencyOf(db, userId));
};

export const deleteBill = async (id: string, userId: string): Promise<void> => {
  const db = await getDatabase();
  await assertOwnBillIn(db, id, userId);
  await writeWithSync({
    tableName: 'bills',
    recordId: id,
    operation: 'delete',
    data: {},
    firestorePath: `users/${userId}/bills/${id}`,
    userId
  });
};
