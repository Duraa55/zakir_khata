import { getDatabase } from '../db';
import { DateRangeFilter, buildReportQuery, buildTransactionReportQuery, postedBill } from './types';
import { accountCurrencyOf } from '../accountCurrency';
import { orderedCodes } from '../../../utils/currencyTotals';
import { resolveCurrency, type CurrencyCode } from '../../../utils/currency';

/**
 * Within ONE currency these are plain numbers, which is the whole point of grouping:
 * a row only ever appears inside its own currency's list, so nothing here can be
 * compared against a figure denominated in something else.
 */
export type CustomerPerformance = {
  customerId: string;
  customerName: string;
  totalPurchases: number;
  totalPaid: number;
  totalDue: number;
  lastActive: string;
};

/**
 * Top buyers, ranked SEPARATELY PER CURRENCY.
 *
 * Ranking is a comparison, and Rs 45,000 against AED 3,000 is not a comparison this app
 * can make — there are no exchange rates anywhere in it, by design. The old query did
 * `SUM(total) ... ORDER BY totalPurchases DESC` across every currency at once, so an
 * AED 3,000 customer (≈ Rs 230,000) sorted BELOW a Rs 45,000 one and printed as
 * "Rs. 3,000". Both the figure and the order were wrong.
 *
 * One ranked list per currency keeps every comparison inside a single currency, invents
 * no order, and loses nothing: a single-currency account gets exactly one group holding
 * exactly the list it saw before. `limit` is per currency — asked "who are my top
 * buyers", someone running two books wants the top of each.
 */
export type CustomerPerformanceGroup = {
  currency: CurrencyCode;
  rows: CustomerPerformance[];
};

export const getCustomerPerformance = async (
  userId: string,
  filters: DateRangeFilter,
  orderBy: 'totalPurchases' | 'totalDue' = 'totalPurchases',
  limit: number = 10
): Promise<CustomerPerformanceGroup[]> => {
  const db = await getDatabase();
  const { whereClause, params } = buildReportQuery(userId, 'bill_date', filters);

  // The aggregate AND the per-currency top-N are both SQL: a business with thousands of
  // customers must not load them all to take ten. ROW_NUMBER partitions by currency, so
  // the ordering never spans two of them.
  const query = `
    WITH agg AS (
      SELECT customer_id as customerId,
             party_name as customerName,
             currency,
             COALESCE(SUM(total), 0) as totalPurchases,
             COALESCE(SUM(paid), 0) as totalPaid,
             COALESCE(SUM(due), 0) as totalDue,
             MAX(bill_date) as lastActive
        FROM bills
       WHERE ${whereClause}${postedBill()}
       GROUP BY customer_id, party_name, currency
    ), ranked AS (
      SELECT agg.*,
             ROW_NUMBER() OVER (PARTITION BY currency ORDER BY ${orderBy} DESC, customerName ASC) as rn
        FROM agg
    )
    SELECT customerId, customerName, currency, totalPurchases, totalPaid, totalDue, lastActive
      FROM ranked
     WHERE rn <= ${limit}
     ORDER BY rn ASC
  `;

  const rows = await db.getAllAsync<CustomerPerformance & { currency: string | null }>(query, params);

  // Group order is the same rule every stacked total uses — account default first, then
  // alphabetical — so the report never reshuffles its sections between renders.
  const base = await accountCurrencyOf(db, userId);
  const byCode = new Map<CurrencyCode, CustomerPerformance[]>();
  for (const { currency, ...row } of rows) {
    const code = resolveCurrency(currency).code;
    byCode.set(code, [...(byCode.get(code) ?? []), row]);
  }
  return orderedCodes(base)
    .filter(code => byCode.has(code))
    .map(currency => ({ currency, rows: byCode.get(currency)! }));
};

export type KhataSummary = {
  partyName: string;
  totalLena: number;
  totalDena: number;
  netBalance: number;
};

/**
 * Khata has NO currency column and never will without being asked: an entry is
 * denominated in the owning account's `users.default_currency` (decided 2026-10-03).
 * One account therefore means one currency here, so this ranking is a comparison
 * between like and like and stays a single list.
 */
export const getKhataSummary = async (
  userId: string,
  filters: DateRangeFilter,
  typeFilter: 'lena' | 'dena' | 'all' = 'all',
  limit: number = 10
): Promise<KhataSummary[]> => {
  const db = await getDatabase();
  const { whereClause, params } = buildTransactionReportQuery(userId, 'date', filters);

  const query = `
    SELECT
      partyName,
      SUM(CASE WHEN type = 'lena' THEN amount_paisa ELSE 0 END) as totalLena,
      SUM(CASE WHEN type = 'dena' THEN amount_paisa ELSE 0 END) as totalDena
    FROM transactions
    WHERE ${whereClause}
    GROUP BY partyName
    ${typeFilter === 'lena' ? 'HAVING totalLena > totalDena' : typeFilter === 'dena' ? 'HAVING totalDena > totalLena' : ''}
    ORDER BY ABS(SUM(CASE WHEN type = 'lena' THEN amount_paisa ELSE 0 END) - SUM(CASE WHEN type = 'dena' THEN amount_paisa ELSE 0 END)) DESC
    LIMIT ${limit}
  `;

  const results = await db.getAllAsync<{ partyName: string; totalLena: number; totalDena: number }>(query, params);

  return results.map(r => ({
    partyName: r.partyName,
    totalLena: r.totalLena,
    totalDena: r.totalDena,
    netBalance: r.totalLena - r.totalDena
  }));
};
