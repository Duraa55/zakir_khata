import { getDatabase } from '../db';
import { DateRangeFilter, buildReportQuery, postedBill } from './types';
import { accountCurrencyOf } from '../accountCurrency';
import { totalsFrom, soleTotal, type CurrencyTotal } from '../../../utils/currencyTotals';
import type { CurrencyCode } from '../../../utils/currency';

/**
 * Profit is a SUBTRACTION, and subtraction across currencies is meaningless without a
 * rate this app deliberately does not have. So the components are always stacked per
 * currency, and the derived figures are only produced when the whole period sits in
 * ONE currency and that currency is the account's own.
 *
 * Both halves of that test matter:
 *  - one currency, because AED revenue minus PKR expenses is not a number;
 *  - the account's own, because COGS comes from `stock_items.purchase_price`, which has
 *    NO currency column and is therefore denominated in the account default. Charging a
 *    PKR cost against AED revenue is the same error wearing a different hat.
 *
 * When `profitAvailable` is false the screen shows the components and says why, rather
 * than printing a confident wrong number.
 */
export type ProfitLossSummary = {
  totalRevenue: CurrencyTotal[];
  totalCOGS: CurrencyTotal[];
  totalExpenses: CurrencyTotal[];
  /** True only when revenue, COGS and expenses all sit in the account's own currency. */
  profitAvailable: boolean;
  /** The currency the derived figures are in — null whenever `profitAvailable` is false. */
  profitCurrency: CurrencyCode | null;
  /** Null unless `profitAvailable`. Never render these without checking that flag. */
  grossProfit: number | null;
  netProfit: number | null;
  profitMarginPct: number | null;
};

/** The one figure a derived calculation may use: present, single, and the account's own. */
const scalarIn = (totals: CurrencyTotal[], base: CurrencyCode): number | null => {
  const only = soleTotal(totals);
  return only && only.currency === base ? only.amount : null;
};

export const getProfitLossSummary = async (
  userId: string,
  filters: DateRangeFilter
): Promise<ProfitLossSummary> => {
  const db = await getDatabase();
  const base = await accountCurrencyOf(db, userId);

  // 1. Revenue from bills, per currency.
  const billQuery = buildReportQuery(userId, 'bill_date', filters);
  const revenueRows = await db.getAllAsync<{ currency: string | null; revenue: number }>(
    `SELECT currency, COALESCE(SUM(total), 0) as revenue
       FROM bills WHERE ${billQuery.whereClause}${postedBill()}
      GROUP BY currency`,
    billQuery.params
  );
  // Goods that came back are not a sale: their value leaves revenue and their cost
  // leaves COGS, so profit is what was actually kept. A line inherits its bill's
  // currency, so the returns net off WITHIN each currency, never across.
  const retQuery = buildReportQuery(userId, 'b.bill_date', filters, 'b');
  const returnedRows = await db.getAllAsync<{ currency: string | null; returned: number }>(
    `SELECT b.currency as currency,
            COALESCE(SUM(COALESCE(bi.returned_quantity, 0) * bi.unit_price), 0) as returned
       FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
      WHERE ${retQuery.whereClause} AND bi.is_deleted = 0${postedBill('b')}
      GROUP BY b.currency`,
    retQuery.params
  );
  const netRevenueRows = [
    ...revenueRows.map(r => ({ currency: r.currency, net: Number(r.revenue ?? 0) })),
    ...returnedRows.map(r => ({ currency: r.currency, net: -Number(r.returned ?? 0) })),
  ];

  // 2. COGS from bill items mapped to stock items. Grouped by the BILL's currency so a
  //    mixed period is visibly mixed; the figure is only ever used when it is not.
  const cogsQuery = buildReportQuery(userId, 'b.bill_date', filters, 'b');
  const cogsRows = await db.getAllAsync<{ currency: string | null; cogs: number }>(
    `SELECT b.currency as currency,
            COALESCE(SUM((bi.quantity - COALESCE(bi.returned_quantity, 0)) * s.purchase_price), 0) as cogs
       FROM bill_items bi
       JOIN bills b ON b.id = bi.bill_id
       JOIN stock_items s ON s.id = bi.item_id
      WHERE ${cogsQuery.whereClause} AND bi.is_deleted = 0${postedBill('b')}
      GROUP BY b.currency`,
    cogsQuery.params
  );

  // 3. Expenses, per currency (expenses.currency exists since v41).
  const expQuery = buildReportQuery(userId, 'expense_date', filters);
  const expRows = await db.getAllAsync<{ currency: string | null; total: number }>(
    `SELECT currency, COALESCE(SUM(amount), 0) as total
       FROM expenses WHERE ${expQuery.whereClause}
      GROUP BY currency`,
    expQuery.params
  );

  const totalRevenue = totalsFrom(netRevenueRows, 'net', base);
  const totalCOGS = totalsFrom(cogsRows, 'cogs', base);
  const totalExpenses = totalsFrom(expRows, 'total', base);

  const revenue = scalarIn(totalRevenue, base);
  const cogs = scalarIn(totalCOGS, base);
  const expenses = scalarIn(totalExpenses, base);
  const profitAvailable = revenue !== null && cogs !== null && expenses !== null;

  if (!profitAvailable) {
    return {
      totalRevenue, totalCOGS, totalExpenses,
      profitAvailable: false, profitCurrency: null,
      grossProfit: null, netProfit: null, profitMarginPct: null,
    };
  }

  const grossProfit = revenue! - cogs!;
  const netProfit = grossProfit - expenses!;
  return {
    totalRevenue, totalCOGS, totalExpenses,
    profitAvailable: true,
    profitCurrency: base,
    grossProfit,
    netProfit,
    profitMarginPct: revenue! > 0 ? (netProfit / revenue!) * 100 : 0,
  };
};

/**
 * Gross profit per day. Same rule: a day is only given a profit when every bill that
 * day is in the account's own currency, because the cost side has no currency at all.
 * A mixed day reports `profit: null` and the chart leaves a gap rather than a lie.
 */
export const getProfitTrend = async (
  userId: string,
  filters: DateRangeFilter
): Promise<{ date: string; profit: number | null }[]> => {
  const db = await getDatabase();
  const base = await accountCurrencyOf(db, userId);
  // Per day PER CURRENCY: the day's posted bill totals minus the cost of what was kept.
  // The bill total is taken ONCE per bill — joining lines first multiplied it by the
  // line count.
  const query = buildReportQuery(userId, 'b.bill_date', filters, 'b');
  const sql = `
    SELECT
      date(b.bill_date) as date,
      b.currency as currency,
      SUM(b.total
          - COALESCE((SELECT SUM(COALESCE(bi.returned_quantity, 0) * bi.unit_price) FROM bill_items bi WHERE bi.bill_id = b.id AND bi.is_deleted = 0), 0)
          - COALESCE((SELECT SUM((bi.quantity - COALESCE(bi.returned_quantity, 0)) * s.purchase_price)
                        FROM bill_items bi JOIN stock_items s ON s.id = bi.item_id
                       WHERE bi.bill_id = b.id AND bi.is_deleted = 0), 0)) as profit
    FROM bills b
    WHERE ${query.whereClause}${postedBill('b')}
    GROUP BY date(b.bill_date), b.currency
    ORDER BY date(b.bill_date) ASC
  `;

  const rows = await db.getAllAsync<{ date: string; currency: string | null; profit: number }>(sql, query.params);
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  return [...byDate.entries()].map(([date, group]) => ({
    date,
    profit: scalarIn(totalsFrom(group, 'profit', base), base),
  }));
};
