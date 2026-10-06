import type { CurrencyCode } from '../utils/currency';
import type { CurrencyTotal } from '../utils/currencyTotals';
/**
 * purchase.types.ts
 * All purchase order, invoice, and return TypeScript types.
 */

export type POStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid';
export type ReturnStatus = 'pending' | 'approved' | 'refunded';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque' | 'online';

// ─── Purchase Order ───────────────────────────────────────────────────────────

export interface PurchaseOrderItem {
  id: string;
  po_id: string;
  stock_item_id?: string | null;
  item_name: string;
  quantity: number;
  unit_cost: number;       // integer paisa
  line_total: number;      // integer paisa (quantity * unit_cost)
  received_qty: number;    // how many were actually received
  is_deleted: number;
}

export interface PurchaseOrder {
  id: string;
  user_id: string;
  supplier_id: string;
  supplier_name?: string;  // joined from suppliers table
  po_number: number;
  status: POStatus;
  order_date: string;
  expected_date?: string | null;
  notes?: string | null;
  total: number;           // integer paisa (sum of line_totals)
  received_total: number;  // integer paisa
  /**
   * The currency this order was ENTERED in (v41). Every figure on it — total,
   * received_total and every line — is in this currency's minor unit. Never
   * converted: the document records what the supplier actually quoted.
   */
  currency: CurrencyCode;
  items?: PurchaseOrderItem[];
  created_at: string;
  updated_at?: string | null;
  synced: number;
  is_deleted: number;
  deleted_at?: string | null;
  firestore_path?: string | null;
}

// ─── Purchase Invoice ─────────────────────────────────────────────────────────

export interface PurchaseInvoiceItem {
  id: string;
  invoice_id: string;
  stock_item_id?: string | null;
  item_name: string;
  quantity: number;
  unit_cost: number;          // integer paisa
  line_total: number;         // integer paisa
  is_deleted: number;
}

export interface PurchaseInvoice {
  id: string;
  user_id: string;
  supplier_id: string;
  supplier_name?: string;  // joined
  po_id?: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date?: string | null;
  subtotal: number;           // integer paisa
  discount_amount: number;    // integer paisa
  tax_amount: number;         // integer paisa
  total: number;              // integer paisa
  amount_paid: number;        // integer paisa
  balance_due: number;
  /** Currency this invoice was ENTERED in (v41). Every figure on it is in this
   *  currency; it is never converted. */
  currency: CurrencyCode;        // integer paisa
  status: InvoiceStatus;
  notes?: string | null;
  items?: PurchaseInvoiceItem[];
  created_at: string;
  updated_at?: string | null;
  synced: number;
  is_deleted: number;
  deleted_at?: string | null;
  firestore_path?: string | null;
}

// ─── Purchase Return ──────────────────────────────────────────────────────────

export interface PurchaseReturnItem {
  id: string;
  return_id: string;
  stock_item_id?: string | null;
  item_name: string;
  quantity: number;
  unit_cost: number;          // integer paisa
  line_total: number;         // integer paisa
}

export interface PurchaseReturn {
  id: string;
  user_id: string;
  invoice_id: string;
  supplier_id: string;
  supplier_name?: string;
  return_date: string;
  reason?: string | null;
  total_refund: number;       // integer paisa
  status: ReturnStatus;
  items?: PurchaseReturnItem[];
  created_at: string;
  updated_at?: string | null;
  synced: number;
  is_deleted: number;
  deleted_at?: string | null;
  firestore_path?: string | null;
}

// ─── Purchase Dashboard Summary ───────────────────────────────────────────────

export interface PurchaseSummary {
  totalOrders: number;
  pendingOrders: number;
  /** Money figures are ONE PER CURRENCY — never summed across them. Counts stay scalars. */
  totalInvoiced: CurrencyTotal[];
  totalOutstanding: CurrencyTotal[];   // balance_due per currency across unpaid invoices
  totalPaidThisMonth: CurrencyTotal[];
}
