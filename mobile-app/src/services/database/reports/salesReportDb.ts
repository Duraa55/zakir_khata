import { getDatabase } from '../db';
import { DateRangeFilter, buildReportQuery, postedBill } from './types';
import { accountCurrencyOf } from '../accountCurrency';
import { totalsFrom, type CurrencyTotal } from '../../../utils/currencyTotals';

/**
 * Sales never collapse to one number. `bills.currency` exists (v41), so a range that
 * holds a PKR bill and an AED bill has TWO sales figures, not their sum — adding them
 * produced "Rs. 48,000" for Rs 45,000 + AED 3,000, understating sales by ~83%.
 *
 * `totalBills` stays a plain count: counting bills is currency-free.
 */
export type SalesSummary = {
  totalSales: CurrencyTotal[];
  totalBills: number;
  /** Per currency: that currency's sales divided by ITS OWN bill count, never a blend. */
  averageBillValue: CurrencyTotal[];
  salesGrowthPct: number;
};

export type SalesTrendData = {
  date: string;
  total: CurrencyTotal[];
  count: number;
};

export const getSalesReportSummary = async (
  userId: string,
  filters: DateRangeFilter
): Promise<SalesSummary> => {
  const db = await getDatabase();
  const { whereClause, params } = buildReportQuery(userId, 'bill_date', filters);

  // One row per currency. The grouping is SQL's, over the WHOLE filtered set.
  const rows = await db.getAllAsync<{ currency: string | null; totalSales: number; billCount: number }>(
    `SELECT currency,
            COALESCE(SUM(total), 0) as totalSales,
            COUNT(id) as billCount
       FROM bills
      WHERE ${whereClause}${postedBill()}
      GROUP BY currency`,
    params
  );

  const base = await accountCurrencyOf(db, userId);
  // The average is computed PER ROW before folding, so each currency is divided by its
  // own count. Dividing a stacked total by a blended count would be the same bug again.
  const averageRows = rows.map(r => ({
    currency: r.currency,
    avg: Number(r.billCount) > 0 ? Math.round(Number(r.totalSales) / Number(r.billCount)) : 0,
  }));

  return {
    totalSales: totalsFrom(rows, 'totalSales', base),
    totalBills: rows.reduce((n, r) => n + Number(r.billCount ?? 0), 0),
    averageBillValue: totalsFrom(averageRows, 'avg', base),
    salesGrowthPct: 0, // Calculated dynamically based on previous period
  };
};

export const getSalesTrend = async (
  userId: string,
  filters: DateRangeFilter,
  groupBy: 'day' | 'week' | 'month' = 'day'
): Promise<SalesTrendData[]> => {
  const db = await getDatabase();
  const { whereClause, params } = buildReportQuery(userId, 'bill_date', filters);

  let dateGroupFormat = "date(bill_date)";
  if (groupBy === 'month') {
    dateGroupFormat = "strftime('%Y-%m', bill_date)";
  } else if (groupBy === 'week') {
    dateGroupFormat = "strftime('%Y-%W', bill_date)";
  }

  const rows = await db.getAllAsync<{ date: string; currency: string | null; total: number; count: number }>(
    `SELECT ${dateGroupFormat} as date,
            currency,
            COALESCE(SUM(total), 0) as total,
            COUNT(id) as count
       FROM bills
      WHERE ${whereClause}${postedBill()}
      GROUP BY ${dateGroupFormat}, currency
      ORDER BY ${dateGroupFormat} ASC`,
    params
  );

  const base = await accountCurrencyOf(db, userId);
  // Fold the per-currency rows back into one entry per period, preserving the SQL order.
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  return [...byDate.entries()].map(([date, group]) => ({
    date,
    total: totalsFrom(group, 'total', base),
    count: group.reduce((n, r) => n + Number(r.count ?? 0), 0),
  }));
};
