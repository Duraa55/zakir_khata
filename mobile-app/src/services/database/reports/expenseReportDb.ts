import { getDatabase } from '../db';
import { DateRangeFilter, buildReportQuery } from './types';
import { accountCurrencyOf } from '../accountCurrency';
import { totalsFrom, orderedCodes, type CurrencyTotal } from '../../../utils/currencyTotals';
import { resolveCurrency, type CurrencyCode } from '../../../utils/currency';

/** Inside one currency group these are plain numbers, and the share is of THAT currency. */
export type ExpenseCategorySummary = {
  category: string;
  total: number;
  percentage: number;
};

/**
 * `expenses.currency` exists (v41), so the category breakdown is per currency: the
 * ranking and the percentages are both comparisons, and neither crosses a currency.
 * A share of a mixed total would be a share of a number that means nothing.
 */
export type ExpenseCategoryGroup = {
  currency: CurrencyCode;
  total: number;
  categories: ExpenseCategorySummary[];
};

export const getExpenseSummary = async (
  userId: string,
  filters: DateRangeFilter
): Promise<{ totalExpenses: CurrencyTotal[]; byCurrency: ExpenseCategoryGroup[] }> => {
  const db = await getDatabase();
  const { whereClause, params } = buildReportQuery(userId, 'expense_date', filters);
  const base = await accountCurrencyOf(db, userId);

  const rows = await db.getAllAsync<{ currency: string | null; category: string; total: number }>(
    `SELECT currency,
            COALESCE(category, 'Uncategorized') as category,
            COALESCE(SUM(amount), 0) as total
       FROM expenses
      WHERE ${whereClause}
      GROUP BY currency, COALESCE(category, 'Uncategorized')
      ORDER BY total DESC`,
    params
  );

  const byCode = new Map<CurrencyCode, { category: string; total: number }[]>();
  for (const r of rows) {
    const code = resolveCurrency(r.currency).code;
    byCode.set(code, [...(byCode.get(code) ?? []), { category: r.category, total: Number(r.total ?? 0) }]);
  }

  const byCurrency = orderedCodes(base)
    .filter(code => byCode.has(code))
    .map(currency => {
      const categories = byCode.get(currency)!;
      const total = categories.reduce((n, c) => n + c.total, 0);
      return {
        currency,
        total,
        categories: categories.map(c => ({
          category: c.category,
          total: c.total,
          percentage: total > 0 ? (c.total / total) * 100 : 0,
        })),
      };
    });

  return { totalExpenses: totalsFrom(rows, 'total', base), byCurrency };
};

export const getExpenseTrend = async (
  userId: string,
  filters: DateRangeFilter
): Promise<{ date: string; total: CurrencyTotal[] }[]> => {
  const db = await getDatabase();
  const { whereClause, params } = buildReportQuery(userId, 'expense_date', filters);
  const base = await accountCurrencyOf(db, userId);

  const rows = await db.getAllAsync<{ date: string; currency: string | null; total: number }>(
    `SELECT strftime('%Y-%m', expense_date) as date,
            currency,
            COALESCE(SUM(amount), 0) as total
       FROM expenses
      WHERE ${whereClause}
      GROUP BY strftime('%Y-%m', expense_date), currency
      ORDER BY date ASC`,
    params
  );

  const byDate = new Map<string, typeof rows>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  return [...byDate.entries()].map(([date, group]) => ({ date, total: totalsFrom(group, 'total', base) }));
};
