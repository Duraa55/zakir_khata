import { create } from 'zustand';
import { PAGE_SIZE, PageCursor } from '../services/database/pagination';
import { thisMonthRange } from '../utils/dates';
import {
  PurchaseOrder, PurchaseOrderItem, PurchaseInvoice,
  PurchaseReturn, PurchaseSummary, POStatus, InvoiceStatus
} from '../types/purchase.types';
import {
  createPurchaseOrder, getPurchaseOrders, getPurchaseOrderById,
  getFilteredPurchaseOrders, getPurchaseOrderDayTotals, getFilteredPurchaseInvoices, getPurchaseInvoiceDayTotals,
  PurchaseFilter, PurchaseDayTotal,
  updatePurchaseOrderStatus, receiveGoods,
  createPurchaseInvoice, getPurchaseInvoices, getPurchaseInvoiceById,
  getPurchaseInvoicesBySupplier, createPurchaseReturn,
  getPurchaseSummary
} from '../services/database/purchaseDb';
import { entryOwner } from '../services/database/entryScope';
import type { CurrencyCode } from '../utils/currency';

export type PurchaseListState = {
  rows: any[];
  /** COUNT only — the money totals live in dayTotals and the summary tiles. */
  summary: { count: number };
  dayTotals: Record<string, PurchaseDayTotal>;
  cursor: PageCursor | null;
  loadingMore: boolean;
};
const EMPTY_LIST: PurchaseListState = { rows: [], summary: { count: 0 }, dayTotals: {}, cursor: null, loadingMore: false };

interface PurchaseState {
  orders: PurchaseOrder[];
  invoices: PurchaseInvoice[];
  /** Range the Purchase Book shows (this month by default); shared by both tabs. */
  filter: PurchaseFilter;
  /** Paged, SQL-summarised lists for the two tabs. */
  orderList: PurchaseListState;
  invoiceList: PurchaseListState;
  setFilter: (userId: string, filter: PurchaseFilter) => Promise<void>;
  /** `viewingId`: the Staff Book drill-down (read-only). Omitted = the viewer's own purchases. */
  loadLists: (userId: string, viewingId?: string) => Promise<void>;
  /** Whose purchases are loaded (undefined = own). Set by every loadLists call. */
  viewingId?: string;
  loadMore: (userId: string, tab: 'orders' | 'invoices') => Promise<void>;
  selectedOrder: PurchaseOrder | null;
  selectedInvoice: PurchaseInvoice | null;
  summary: PurchaseSummary | null;
  loading: boolean;
  error: string | null;

  loadOrders: (userId: string, status?: POStatus) => Promise<void>;
  loadInvoices: (userId: string, status?: InvoiceStatus) => Promise<void>;
  loadOrderById: (id: string) => Promise<void>;
  loadInvoiceById: (id: string) => Promise<void>;
  loadSummary: (userId: string, viewingId?: string) => Promise<void>;
  loadInvoicesBySupplier: (supplierId: string) => Promise<void>;

  createOrder: (
    userId: string, supplierId: string,
    items: Omit<PurchaseOrderItem, 'id' | 'po_id' | 'received_qty' | 'is_deleted'>[],
    orderDate: string, expectedDate?: string, notes?: string, currency?: CurrencyCode
  ) => Promise<PurchaseOrder>;

  updateOrderStatus: (id: string, userId: string, status: POStatus) => Promise<void>;

  receiveGoods: (
    poId: string, userId: string,
    receipts: { itemId: string; stockItemId?: string | null; itemName: string; receivedQty: number; unitCost: number }[]
  ) => Promise<void>;

  createInvoice: (
    userId: string, supplierId: string,
    items: Omit<import('../types/purchase.types').PurchaseInvoiceItem, 'id' | 'invoice_id' | 'is_deleted'>[],
    invoiceDate: string,
    opts?: { poId?: string; invoiceNumber?: string; dueDate?: string; discountAmount?: number; taxAmount?: number; notes?: string; currency?: CurrencyCode }
  ) => Promise<PurchaseInvoice>;

  createReturn: (
    userId: string, invoiceId: string, supplierId: string,
    items: Omit<import('../types/purchase.types').PurchaseReturnItem, 'id' | 'return_id'>[],
    returnDate: string, reason?: string
  ) => Promise<PurchaseReturn>;

  clearSelected: () => void;
}

export const usePurchaseStore = create<PurchaseState>((set, get) => ({
  orders: [],
  invoices: [],
  filter: { ...thisMonthRange() },
  orderList: EMPTY_LIST,
  invoiceList: EMPTY_LIST,
  selectedOrder: null,
  selectedInvoice: null,
  summary: null,
  loading: false,
  error: null,

  setFilter: async (userId, filter) => {
    set({ filter });
    await get().loadLists(userId, get().viewingId);
  },

  // Page 1 of both tabs + whole-set summaries + day subtotals, one predicate per tab.
  loadLists: async (viewerId, viewingId) => {
    set({ loading: true, error: null, viewingId });
    const filter = get().filter;
    try {
      // Purchases are own-only; the drill-down reads that person's after the permission check.
      const userId = await entryOwner(viewerId, viewingId);
      const [o, od, i, id] = await Promise.all([
        getFilteredPurchaseOrders(userId, filter, PAGE_SIZE),
        getPurchaseOrderDayTotals(userId, filter),
        getFilteredPurchaseInvoices(userId, filter, PAGE_SIZE),
        getPurchaseInvoiceDayTotals(userId, filter),
      ]);
      set({
        orderList: { rows: o.rows, summary: o.summary, cursor: o.nextCursor, dayTotals: Object.fromEntries(od.map(d => [d.day, d])), loadingMore: false },
        invoiceList: { rows: i.rows, summary: i.summary, cursor: i.nextCursor, dayTotals: Object.fromEntries(id.map(d => [d.day, d])), loadingMore: false },
        loading: false,
      });
    } catch (e: any) { set({ error: e.message, loading: false }); }
  },

  // Next page of one tab, strictly after its last loaded row. Totals are NOT refetched.
  loadMore: async (userId, tab) => {
    const key = tab === 'orders' ? 'orderList' : 'invoiceList';
    const cur = get()[key];
    if (!cur.cursor || cur.loadingMore || get().loading) return;
    set({ [key]: { ...cur, loadingMore: true } } as any);
    try {
      const ownerId = await entryOwner(userId, get().viewingId);
      const page = tab === 'orders'
        ? await getFilteredPurchaseOrders(ownerId, get().filter, PAGE_SIZE, cur.cursor)
        : await getFilteredPurchaseInvoices(ownerId, get().filter, PAGE_SIZE, cur.cursor);
      set(s => ({ [key]: { ...s[key], rows: [...s[key].rows, ...page.rows], cursor: page.nextCursor, loadingMore: false } } as any));
    } catch (e: any) { set(s => ({ [key]: { ...s[key], loadingMore: false }, error: e.message } as any)); }
  },

  loadOrders: async (userId, status) => {
    set({ loading: true, error: null });
    try {
      const orders = await getPurchaseOrders(userId, status);
      set({ orders, loading: false });
    } catch (e: any) { set({ error: e.message, loading: false }); }
  },

  loadInvoices: async (userId, status) => {
    set({ loading: true, error: null });
    try {
      const invoices = await getPurchaseInvoices(userId, status);
      set({ invoices, loading: false });
    } catch (e: any) { set({ error: e.message, loading: false }); }
  },

  loadOrderById: async (id) => {
    set({ loading: true });
    try {
      const order = await getPurchaseOrderById(id);
      set({ selectedOrder: order, loading: false });
    } catch (e: any) { set({ error: e.message, loading: false }); }
  },

  loadInvoiceById: async (id) => {
    set({ loading: true });
    try {
      const invoice = await getPurchaseInvoiceById(id);
      set({ selectedInvoice: invoice, loading: false });
    } catch (e: any) { set({ error: e.message, loading: false }); }
  },

  loadSummary: async (userId, viewingId) => {
    try {
      const summary = await getPurchaseSummary(await entryOwner(userId, viewingId));
      set({ summary });
    } catch (e: any) { set({ error: e.message }); }
  },

  loadInvoicesBySupplier: async (supplierId) => {
    set({ loading: true });
    try {
      const invoices = await getPurchaseInvoicesBySupplier(supplierId);
      set({ invoices, loading: false });
    } catch (e: any) { set({ error: e.message, loading: false }); }
  },

  createOrder: async (userId, supplierId, items, orderDate, expectedDate, notes, currency) => {
    const order = await createPurchaseOrder(userId, supplierId, items, orderDate, expectedDate, notes, currency);
    await get().loadOrders(userId);
    await get().loadSummary(userId);
    return order;
  },

  updateOrderStatus: async (id, userId, status) => {
    await updatePurchaseOrderStatus(id, userId, status);
    set(s => ({ orders: s.orders.map(o => o.id === id ? { ...o, status } : o) }));
    if (get().selectedOrder?.id === id) {
      set(s => ({ selectedOrder: s.selectedOrder ? { ...s.selectedOrder, status } : null }));
    }
  },

  receiveGoods: async (poId, userId, receipts) => {
    await receiveGoods(poId, userId, receipts);
    await get().loadOrderById(poId);
    await get().loadOrders(userId);
  },

  createInvoice: async (userId, supplierId, items, invoiceDate, opts) => {
    const invoice = await createPurchaseInvoice(userId, supplierId, items, invoiceDate, opts);
    await get().loadInvoices(userId);
    await get().loadSummary(userId);
    return invoice;
  },

  createReturn: async (userId, invoiceId, supplierId, items, returnDate, reason) => {
    const ret = await createPurchaseReturn(userId, invoiceId, supplierId, items, returnDate, reason);
    await get().loadInvoiceById(invoiceId);
    return ret;
  },

  clearSelected: () => set({ selectedOrder: null, selectedInvoice: null }),
}));

// Atomic selectors
export const usePurchaseOrders = () => usePurchaseStore(s => s.orders);
export const usePurchaseInvoices = () => usePurchaseStore(s => s.invoices);
export const usePurchaseSummary = () => usePurchaseStore(s => s.summary);
export const useSelectedOrder = () => usePurchaseStore(s => s.selectedOrder);
export const useSelectedInvoice = () => usePurchaseStore(s => s.selectedInvoice);
export const usePurchaseLoading = () => usePurchaseStore(s => s.loading);
