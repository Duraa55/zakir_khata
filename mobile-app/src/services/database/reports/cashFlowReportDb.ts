import { getDatabase } from '../db';
import { DateRangeFilter } from './types';

export type CashFlowSummary = {
  openingCash: number;
  cashIn: number;
  cashOut: number;
  closingCash: number;
  netCashFlow: number;
};

export const getCashFlowSummary = async (
  userId: string,
  filters: DateRangeFilter
): Promise<CashFlowSummary> => {
  const db = await getDatabase();
  // OWN-ONLY, on the columns cashbook really has (userId / isDeleted — it has no
  // user_id, so the shared report builder never matched a row). Same owner and the
  // same live-row predicate as the Cash Book, so the report equals the book.
  const whereClauseWithoutDates = 'userId = ? AND isDeleted = 0 AND COALESCE(is_deleted, 0) = 0';
  let whereClause = whereClauseWithoutDates;
  const params: string[] = [userId];
  if (filters.startDate) { whereClause += ' AND date(date) >= date(?)'; params.push(filters.startDate); }
  if (filters.endDate) { whereClause += ' AND date(date) <= date(?)'; params.push(filters.endDate); }

  // 1. Opening Cash (All cash up to the startDate)
  let openingCash = 0;
  if (filters.startDate) {
    const startQuery = `
      SELECT 
        SUM(CASE WHEN direction = 'in' THEN amount_paisa ELSE 0 END) -
        SUM(CASE WHEN direction = 'out' THEN amount_paisa ELSE 0 END) as balance
      FROM cashbook
      WHERE ${whereClauseWithoutDates} AND date(date) < date(?)
    `;
    const startRes = await db.getFirstAsync<{ balance: number }>(startQuery, [userId, filters.startDate]);
    openingCash = startRes?.balance || 0;
  } else {
    // If no start date, opening cash is 0
    openingCash = 0;
  }

  // 2. Cash In / Out during period
  const flowQuery = `
    SELECT 
      SUM(CASE WHEN direction = 'in' THEN amount_paisa ELSE 0 END) as cashIn,
      SUM(CASE WHEN direction = 'out' THEN amount_paisa ELSE 0 END) as cashOut
    FROM cashbook
    WHERE ${whereClause}
  `;
  const flowRes = await db.getFirstAsync<{ cashIn: number; cashOut: number }>(flowQuery, params);
  
  const cashIn = flowRes?.cashIn || 0;
  const cashOut = flowRes?.cashOut || 0;
  const netCashFlow = cashIn - cashOut;
  const closingCash = openingCash + netCashFlow;

  return {
    openingCash,
    cashIn,
    cashOut,
    netCashFlow,
    closingCash
  };
};
