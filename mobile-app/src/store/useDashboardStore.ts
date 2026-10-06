import { create } from 'zustand';
import { calculatePendingPayments } from '../services/database/billDb';
import { getBalanceSummary } from '../services/database/transactionDb';
import { getCashBalanceSummary } from '../services/database/cashbookDb';
import type { CurrencyTotal } from '../utils/currencyTotals';

// Only what AdminDashboard actually renders. It used to carry nine metrics and a
// recent-activity list; six of them were computed on every focus and thrown away,
// including a `monthlyProfit` that subtracted expenses from sales — a figure no screen
// showed. (That one also could not be computed across currencies; grouped totals would
// make it possible now, but no screen asked for it, so it stays removed.)
interface DashboardMetrics {
  cashInDrawer: number;
  /**
   * Khata: what customers owe. Khata has no per-entry picker — an entry is in the
   * owning account's default currency (decided 2026-10-03), so this is one figure.
   */
  totalLena: number;
  /**
   * Unpaid bill dues, ONE FIGURE PER CURRENCY. This used to be a flat cross-currency
   * SUM that screens were told to read only as a boolean; it is grouped now, so it is a
   * real figure again and may be displayed.
   */
  pendingPayments: CurrencyTotal[];
}

interface DashboardState {
  metrics: DashboardMetrics;
  loading: boolean;
  refreshDashboard: (userId: string) => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  metrics: {
    cashInDrawer: 0,
    totalLena: 0,
    pendingPayments: [],
  },
  loading: true,

  refreshDashboard: async (userId: string) => {
    set({ loading: true });
    try {
      const [cashSummary, khataSummary, pendingPayments] = await Promise.all([
        getCashBalanceSummary(userId),
        getBalanceSummary(userId),
        calculatePendingPayments(userId),
      ]);

      set({
        metrics: {
          cashInDrawer: cashSummary.cashBalance,
          totalLena: khataSummary.totalLena,
          pendingPayments,
        },
        loading: false,
      });
    } catch (error) {
      if (__DEV__) console.error('Failed to refresh dashboard metrics:', error);
      set({ loading: false });
    }
  },
}));
