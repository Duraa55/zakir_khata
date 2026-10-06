import { getDatabase } from './db';
import { assertAllowedUpdateFields } from './updateFields';
import { writeWithSync, writeRowWithSyncIn, afterSyncedWrite } from './syncHelpers';
import { withWriteTransaction } from './writeTransaction';
import { generateId, nowISO, todayDate } from './queryHelpers';
import { Supplier, SupplierPayment, SupplierLedgerEntry } from '../../types/supplier.types';

export type { Supplier, SupplierPayment, SupplierLedgerEntry };

// ─── Supplier CRUD ────────────────────────────────────────────────────────────

export const addSupplier = async (
  userId: string,
  name: string,
  phone?: string,
  business_name?: string,
  address?: string,
  email?: string,
  city?: string,
  notes?: string
): Promise<string> => {
  const id = generateId('supp');
  const now = nowISO();

  const data = {
    id, user_id: userId, name,
    phone: phone || null,
    business_name: business_name || null,
    address: address || null,
    email: email || null,
    city: city || null,
    notes: notes || null,
    created_at: now, updated_at: now, is_deleted: 0
  };

  await writeWithSync({
    tableName: 'suppliers',
    recordId: id,
    operation: 'create',
    data,
    firestorePath: `users/${userId}/suppliers/${id}`,
    userId
  });

  return id;
};

export const getSuppliers = async (userId: string): Promise<Supplier[]> => {
  const db = await getDatabase();
  return db.getAllAsync<Supplier>(
    `SELECT s.*,
       COALESCE((
         SELECT SUM(pi.balance_due) FROM purchase_invoices pi
         WHERE pi.supplier_id = s.id AND pi.status != 'paid' AND pi.is_deleted = 0
       ), 0) as outstanding_balance
     FROM suppliers s
     WHERE s.user_id = ? AND s.is_deleted = 0
     ORDER BY s.name ASC`,
    [userId]
  );
};

export const getSupplierById = async (id: string): Promise<Supplier | null> => {
  const db = await getDatabase();
  const result = await db.getFirstAsync<Supplier>(
    `SELECT s.*,
       COALESCE((
         SELECT SUM(pi.balance_due) FROM purchase_invoices pi
         WHERE pi.supplier_id = s.id AND pi.status != 'paid' AND pi.is_deleted = 0
       ), 0) as outstanding_balance
     FROM suppliers s WHERE s.id = ? AND s.is_deleted = 0 LIMIT 1`,
    [id]
  );
  return result ?? null;
};

export const updateSupplier = async (
  id: string,
  userId: string,
  updates: Partial<Pick<Supplier, 'name' | 'phone' | 'business_name' | 'address' | 'email' | 'city' | 'notes'>>
): Promise<void> => {
  assertAllowedUpdateFields(updates, ["name","phone","business_name","address","email","city","notes"]);
  if (Object.keys(updates).length === 0) return;
  const now = nowISO();
  await writeWithSync({
    tableName: 'suppliers',
    recordId: id,
    operation: 'update',
    data: { ...updates, updated_at: now },
    firestorePath: `users/${userId}/suppliers/${id}`,
    userId
  });
};

export const deleteSupplier = async (id: string, userId: string): Promise<void> => {
  const now = nowISO();
  await writeWithSync({
    tableName: 'suppliers',
    recordId: id,
    operation: 'delete',
    data: { is_deleted: 1, deleted_at: now },
    firestorePath: `users/${userId}/suppliers/${id}`,
    userId
  });
};

// ─── Supplier Payments ────────────────────────────────────────────────────────

/**
 * Record a payment to a supplier — ALL-OR-NOTHING. The amount is whole paisa above
 * zero; when it is against an invoice it can be no more than that invoice's balance,
 * and the payment row and the invoice's paid/balance/status are written in one
 * transaction (a failure part way used to leave a payment with no effect on the bill).
 */
export const addSupplierPayment = async (
  userId: string,
  supplierId: string,
  amount: number,
  paymentDate: string,
  paymentMethod: SupplierPayment['payment_method'] = 'cash',
  invoiceId?: string,
  reference?: string,
  notes?: string
): Promise<SupplierPayment> => {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Enter an amount above zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error('Invalid payment date.');
  const id = generateId('spay');
  const now = nowISO();

  const data: SupplierPayment = {
    id,
    user_id: userId,
    supplier_id: supplierId,
    invoice_id: invoiceId || null,
    amount,
    payment_date: paymentDate,
    payment_method: paymentMethod,
    reference: reference || null,
    notes: notes || null,
    created_at: now,
    updated_at: now,
    synced: 0,
    is_deleted: 0,
    deleted_at: null,
    firestore_path: `users/${userId}/supplier_payments/${id}`,
  };

  await withWriteTransaction(async db => {
    const supplier = await db.getFirstAsync<{ id: string }>('SELECT id FROM suppliers WHERE id = ? AND is_deleted = 0', [supplierId]);
    if (!supplier) throw new Error('Supplier not found.');
    let inv: { total: number; amount_paid: number } | null = null;
    if (invoiceId) {
      inv = await db.getFirstAsync<{ total: number; amount_paid: number }>(
        'SELECT total, amount_paid FROM purchase_invoices WHERE id = ? AND supplier_id = ? AND is_deleted = 0 LIMIT 1',
        [invoiceId, supplierId]
      );
      if (!inv) throw new Error('Invoice not found.');
      const balance = Math.max(0, inv.total - (inv.amount_paid || 0));
      if (amount > balance) throw new Error('The payment is more than the balance due on this invoice.');
    }

    await writeRowWithSyncIn(db, {
      tableName: 'supplier_payments',
      recordId: id,
      operation: 'create',
      data,
      firestorePath: `users/${userId}/supplier_payments/${id}`,
      userId
    });

    if (invoiceId && inv) {
      const newPaid = (inv.amount_paid || 0) + amount;
      const newBalance = Math.max(0, inv.total - newPaid);
      const newStatus = newBalance <= 0 ? 'paid' : 'partial';
      await db.runAsync(
        `UPDATE purchase_invoices SET amount_paid = ?, balance_due = ?, status = ?, updated_at = ?, synced = 0 WHERE id = ?`,
        [newPaid, newBalance, newStatus, now, invoiceId]
      );
    }
  });
  afterSyncedWrite();

  return data;
};

export const getSupplierPayments = async (supplierId: string): Promise<SupplierPayment[]> => {
  const db = await getDatabase();
  return db.getAllAsync<SupplierPayment>(
    `SELECT * FROM supplier_payments WHERE supplier_id = ? AND is_deleted = 0 ORDER BY payment_date DESC`,
    [supplierId]
  );
};

// ─── Supplier Ledger ──────────────────────────────────────────────────────────

/** Returns a unified chronological ledger for a supplier: invoices (debit) + payments (credit) */
export const getSupplierLedger = async (supplierId: string): Promise<SupplierLedgerEntry[]> => {
  const db = await getDatabase();

  const invoices = await db.getAllAsync<any>(
    `SELECT id, invoice_date as date, 'invoice' as type,
       'Invoice #' || invoice_number as label,
       total as amount, 0 as credit, invoice_number as ref
     FROM purchase_invoices
     WHERE supplier_id = ? AND is_deleted = 0`,
    [supplierId]
  );

  const payments = await db.getAllAsync<any>(
    `SELECT id, payment_date as date, 'payment' as type,
       'Payment' as label,
       0 as amount, amount as credit, id as ref
     FROM supplier_payments
     WHERE supplier_id = ? AND is_deleted = 0`,
    [supplierId]
  );

  const returns = await db.getAllAsync<any>(
    `SELECT id, return_date as date, 'return' as type,
       'Purchase Return' as label,
       0 as amount, total_refund as credit, id as ref
     FROM purchase_returns
     WHERE supplier_id = ? AND is_deleted = 0`,
    [supplierId]
  );

  const all = [...invoices, ...payments, ...returns]
    .sort((a, b) => a.date.localeCompare(b.date));

  // Compute running balance
  let balance = 0;
  return all.map(row => {
    balance += row.amount - row.credit;
    return {
      id: row.id,
      date: row.date,
      type: row.type,
      label: row.label,
      amount: row.amount,
      credit: row.credit,
      balance,
      reference_id: row.ref,
    } as SupplierLedgerEntry;
  });
};

// ─── Outstanding Payables ─────────────────────────────────────────────────────

export const getOutstandingPayables = async (userId: string): Promise<Array<{
  supplier_id: string;
  supplier_name: string;
  outstanding: number;
  invoice_count: number;
}>> => {
  const db = await getDatabase();
  return db.getAllAsync(
    `SELECT s.id as supplier_id, s.name as supplier_name,
       SUM(pi.balance_due) as outstanding,
       COUNT(pi.id) as invoice_count
     FROM suppliers s
     INNER JOIN purchase_invoices pi ON pi.supplier_id = s.id
     WHERE s.user_id = ? AND s.is_deleted = 0
       AND pi.status != 'paid' AND pi.is_deleted = 0
     GROUP BY s.id
     ORDER BY outstanding DESC`,
    [userId]
  );
};
