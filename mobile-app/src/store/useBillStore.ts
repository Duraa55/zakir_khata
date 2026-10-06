import { create } from 'zustand';
import { Bill, BillItem } from '../types/bill.types';
import { localDate } from '../utils/dates';
import { PAGE_SIZE, PageCursor } from '../services/database/pagination';
import type { CurrencyTotal } from '../utils/currencyTotals';
import {
  getFilteredBills,
  getBillDayTotals,
  BillDayTotal,
  billMatchesFilter,
  BillFilter,
  createBill,
  saveBillEdit,
  returnBillItems,
  BillEdit,
} from '../services/database/billDb';

/** First and last day of the LOCAL current month, as YYYY-MM-DD. */
const thisMonth = () => {
  const now = new Date();
  return {
    startDate: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

/** Every figure is ONE PER CURRENCY — never summed across them. See currencyTotals.ts. */
export type BillSummary = { billCount: number; totalBilled: CurrencyTotal[]; totalPaid: CurrencyTotal[]; totalDue: CurrencyTotal[] };

interface BillStore {
  /** The pages loaded so far (keyset, PAGE_SIZE at a time). */
  bills: Bill[];
  loading: boolean;
  loadingMore: boolean;
  /** Cursor for the next page; null once the last page is loaded. */
  cursor: PageCursor | null;
  /** Whose bills are loaded: undefined = own; an id = the Staff Book drill-down (never kept in `filter`). */
  viewingId?: string;
  /** Per-day SQL subtotals for the whole filtered set, keyed by YYYY-MM-DD. */
  dayTotals: Record<string, BillDayTotal>;
  error: string | null;
  /** SQL aggregates over the WHOLE filtered set — never a sum of the loaded page. */
  summary: BillSummary;
  /** Alias of summary.totalBilled, kept so existing callers read the filtered figure. */
  /** One figure PER CURRENCY — never summed across them. */
  monthlySales: CurrencyTotal[];
  filter: BillFilter;

  fetchBills: (userId: string, filter?: BillFilter, viewingId?: string) => Promise<void>;
  loadMoreBills: (userId: string) => Promise<void>;
  setFilter: (userId: string, filter: BillFilter, viewingId?: string) => Promise<void>;
  addBill: (
    bill: Omit<Bill, 'id' | 'bill_no' | 'created_at' | 'synced' | 'is_deleted'> & { bill_no?: number },
    items: Omit<BillItem, 'id' | 'bill_id' | 'is_deleted'>[]
  ) => Promise<{ bill: Bill; inActiveFilter: boolean }>;
  /** Edits an existing bill IN PLACE (same id, lines updated not re-created) and refreshes the list. */
  editBill: (billId: string, userId: string, edit: BillEdit) => Promise<{ inActiveFilter: boolean }>;
  /** Returns items against a bill in ONE transaction (lines + stock), then refreshes. */
  returnItems: (billId: string, userId: string, returns: { billItemId: string; qty: number }[]) => Promise<void>;
  updateBillRecord: (id: string, userId: string, updates: Partial<Bill>) => Promise<void>;
  updateBillItemRecord: (id: string, billId: string, userId: string, updates: Partial<BillItem>) => Promise<void>;
  loadMonthlySales: (userId: string) => Promise<void>;
}

const EMPTY_SUMMARY: BillSummary = { billCount: 0, totalBilled: [], totalPaid: [], totalDue: [] };

export const useBillStore = create<BillStore>((set, get) => ({
  bills: [],
  loading: false,
  loadingMore: false,
  cursor: null,
  dayTotals: {},
  error: null,
  summary: EMPTY_SUMMARY,
  monthlySales: [],
  // Default: this month's POSTED bills — what the screen used to show by accident.
  // Unlike the old silent range, the control displays it and the user can change it.
  filter: { status: 'posted', ...thisMonth() },

  fetchBills: async (userId: string, filter?: BillFilter, viewingId?: string) => {
    set({ loading: true, error: null, cursor: null, viewingId });
    const { createdBy: _ignored, ...active } = filter ?? get().filter;
    const query: BillFilter = viewingId ? { ...active, createdBy: viewingId } : active;
    try {
      // Page 1, the headline summary and the per-day subtotals share ONE WHERE clause.
      // The summary and day totals are whole-set SQL aggregates; only the rows page.
      const [{ bills, billSummary, nextCursor }, days] = await Promise.all([
        getFilteredBills(userId, query, PAGE_SIZE),
        getBillDayTotals(userId, query),
      ]);
      set({
        bills,
        cursor: nextCursor,
        dayTotals: Object.fromEntries(days.map(d => [d.day, d])),
        summary: billSummary,
        monthlySales: billSummary.totalBilled,
        filter: active,
        loading: false,
      });
    } catch (err: any) {
      if (__DEV__) console.error('[Bill] fetch failed:', err);
      set({ error: err?.message || 'Failed to fetch bills', loading: false });
    }
  },

  // Next page only — strictly after the last loaded bill. Totals are NOT refetched.
  loadMoreBills: async (userId: string) => {
    const { cursor, loadingMore, loading, filter, viewingId } = get();
    if (!cursor || loadingMore || loading) return;
    set({ loadingMore: true });
    try {
      const query: BillFilter = viewingId ? { ...filter, createdBy: viewingId } : filter;
      const { bills, nextCursor } = await getFilteredBills(userId, query, PAGE_SIZE, 0, cursor);
      set(state => ({ bills: [...state.bills, ...bills], cursor: nextCursor, loadingMore: false }));
    } catch (err: any) {
      if (__DEV__) console.error('[Bill] load more failed:', err);
      set({ loadingMore: false });
    }
  },

  setFilter: async (userId: string, filter: BillFilter, viewingId?: string) => {
    const { createdBy: _ignored, ...clean } = filter;
    set({ filter: clean });
    await get().fetchBills(userId, clean, viewingId);
  },

  addBill: async (bill, items) => {
    try {
      const newBill = await createBill(bill, items);
      const active = get().filter;
      const inActiveFilter = billMatchesFilter(newBill, active);
      // Re-read instead of prepending: a bill dated outside the active range must
      // not appear to have saved into a view it does not belong to. The caller is
      // told so it can say where the bill actually went.
      await get().fetchBills(bill.user_id, active);
      return { bill: newBill, inActiveFilter };
    } catch (err) {
      if (__DEV__) console.error('[Bill] create failed:', err);
      throw err;
    }
  },

  editBill: async (billId, userId, edit) => {
    await saveBillEdit(billId, userId, edit);
    const active = get().filter;
    await get().fetchBills(userId, active);
    return { inActiveFilter: billMatchesFilter({ bill_date: edit.bill_date, is_draft: 0, is_hold: 0 }, active) };
  },

  returnItems: async (billId, userId, returns) => {
    await returnBillItems(billId, userId, returns);
    await get().fetchBills(userId, get().filter);
  },

  updateBillRecord: async (id, userId, updates) => {
    try {
      const { updateBill } = require('../services/database/billDb');
      await updateBill(id, userId, updates);
      set(state => ({
        bills: state.bills.map(b => b.id === id ? { ...b, ...updates } : b)
      }));
    } catch (err) {
      if (__DEV__) console.error(err);
      throw err;
    }
  },

  updateBillItemRecord: async (id, billId, userId, updates) => {
    try {
      const { updateBillItem } = require('../services/database/billDb');
      await updateBillItem(id, billId, userId, updates);
      set(state => ({
        bills: state.bills.map(b => b.id === billId ? {
          ...b,
          items: (b.items || []).map(i => i.id === id ? { ...i, ...updates } : i)
        } : b)
      }));
    } catch (err) {
      if (__DEV__) console.error(err);
      throw err;
    }
  },

  /**
   * Retained so existing callers keep working. The headline now always comes from
   * the same filtered query as the list, so this is just a refresh.
   */
  loadMonthlySales: async (userId: string) => {
    await get().fetchBills(userId);
  },
}));
