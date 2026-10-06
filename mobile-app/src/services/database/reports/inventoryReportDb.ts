import { getDatabase } from '../db';
import { postedBill } from './types';
import { accountCurrencyOf } from '../accountCurrency';
import { orderedCodes } from '../../../utils/currencyTotals';
import { resolveCurrency, type CurrencyCode } from '../../../utils/currency';

export type InventorySummary = {
  totalItems: number;
  totalValue: number;       // quantity * purchase_price
  totalSellingValue: number; // quantity * sale_price
  expectedProfit: number;
  lowStockCount: number;
  outOfStockCount: number;
};

export const getInventorySummary = async (
  userId: string
): Promise<InventorySummary> => {
  const db = await getDatabase();
  
  // Note: Inventory represents current state, not historical, so no date filters are applied for this summary.
  const query = `
    SELECT 
      COUNT(id) as totalItems,
      SUM(quantity * purchase_price) as totalValue,
      SUM(quantity * sale_price) as totalSellingValue,
      SUM(CASE WHEN quantity < low_stock_threshold AND quantity > 0 THEN 1 ELSE 0 END) as lowStockCount,
      SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END) as outOfStockCount
    FROM stock_items
    WHERE user_id = ? 
      AND is_deleted = 0
  `;
  const params = [userId];

  const result = await db.getFirstAsync<{
    totalItems: number;
    totalValue: number;
    totalSellingValue: number;
    lowStockCount: number;
    outOfStockCount: number;
  }>(query, params);

  const totalValue = result?.totalValue || 0;
  const totalSellingValue = result?.totalSellingValue || 0;
  const expectedProfit = totalSellingValue - totalValue;

  return {
    totalItems: result?.totalItems || 0,
    totalValue,
    totalSellingValue,
    expectedProfit,
    lowStockCount: result?.lowStockCount || 0,
    outOfStockCount: result?.outOfStockCount || 0,
  };
};

export type ProductPerformance = {
  itemId: string;
  itemName: string;
  quantitySold: number;
  /** In this group's currency — a bill line inherits its bill's currency. */
  revenue: number;
  /**
   * Null outside the account's own currency. Profit subtracts
   * `stock_items.purchase_price`, which has NO currency column and is therefore in the
   * account default; charging a PKR cost against an AED sale is not a profit.
   */
  profit: number | null;
};

/**
 * Best sellers, ranked SEPARATELY PER CURRENCY. Ranking by revenue across currencies
 * compares numbers that have no common unit, so each currency gets its own ordered
 * list. A single-currency account sees exactly one group and the list it always saw.
 */
export type ProductPerformanceGroup = {
  currency: CurrencyCode;
  rows: ProductPerformance[];
};

export const getProductPerformance = async (
  userId: string,
  startDate?: string,
  endDate?: string,
  orderBy: 'revenue' | 'profit' | 'quantitySold' = 'revenue',
  orderDir: 'DESC' | 'ASC' = 'DESC',
  limit: number = 10
): Promise<ProductPerformanceGroup[]> => {
  const db = await getDatabase();

  let dateFilter = '';
  const params: any[] = [userId];

  if (startDate) {
    dateFilter += ` AND date(b.bill_date) >= date(?)`;
    params.push(startDate);
  }
  if (endDate) {
    dateFilter += ` AND date(b.bill_date) <= date(?)`;
    params.push(endDate);
  }

  // Aggregate and rank in SQL, PARTITIONED BY the bill's currency so the ordering never
  // spans two of them, and so a big catalogue is not loaded just to take ten rows.
  const query = `
    WITH agg AS (
      SELECT
        s.id as itemId,
        s.name_en as itemName,
        b.currency as currency,
        SUM(bi.quantity - COALESCE(bi.returned_quantity, 0)) as quantitySold,
        SUM((bi.quantity - COALESCE(bi.returned_quantity, 0)) * bi.unit_price) as revenue,
        SUM((bi.quantity - COALESCE(bi.returned_quantity, 0)) * (bi.unit_price - s.purchase_price)) as profit
      FROM bill_items bi
      JOIN bills b ON b.id = bi.bill_id
      JOIN stock_items s ON s.id = bi.item_id
      WHERE s.user_id = ?
        AND b.is_deleted = 0 AND bi.is_deleted = 0 AND s.is_deleted = 0${postedBill('b')}
        ${dateFilter}
      GROUP BY s.id, s.name_en, b.currency
    ), ranked AS (
      SELECT agg.*,
             ROW_NUMBER() OVER (PARTITION BY currency ORDER BY ${orderBy} ${orderDir}, itemName ASC) as rn
        FROM agg
    )
    SELECT itemId, itemName, currency, quantitySold, revenue, profit
      FROM ranked
     WHERE rn <= ${limit}
     ORDER BY rn ASC
  `;

  const rows = await db.getAllAsync<ProductPerformance & { currency: string | null }>(query, params);

  const base = await accountCurrencyOf(db, userId);
  const byCode = new Map<CurrencyCode, ProductPerformance[]>();
  for (const { currency, ...row } of rows) {
    const code = resolveCurrency(currency).code;
    // Cost has no currency, so profit is only a profit in the account's own currency.
    const kept: ProductPerformance = { ...row, profit: code === base ? row.profit : null };
    byCode.set(code, [...(byCode.get(code) ?? []), kept]);
  }
  return orderedCodes(base)
    .filter(code => byCode.has(code))
    .map(currency => ({ currency, rows: byCode.get(currency)! }));
};
