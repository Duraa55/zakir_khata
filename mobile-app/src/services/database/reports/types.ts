export type DateRangeFilter = {
  startDate?: string;
  endDate?: string;
};

/**
 * A bill that counts as a SALE: posted, not a draft and not on hold — the same rule
 * as the Bill Book's headline. Reports used to add drafts and holds to sales.
 * `alias` qualifies the columns when the query joins other tables ("b" → b.is_draft).
 */
export const postedBill = (alias = ''): string => {
  const a = alias ? alias + '.' : '';
  return ` AND COALESCE(${a}is_draft, 0) = 0 AND COALESCE(${a}is_hold, 0) = 0`;
};

// Common utility to generate SQL where clause for dates and user hierarchy.
// `alias` qualifies user_id / is_deleted for a joined query — without it a join with
// bill_items or stock_items (which have the same columns) failed as "ambiguous".
export const buildReportQuery = (
  userId: string,
  dateColumn: string,
  filters: DateRangeFilter,
  alias = ''
): { whereClause: string; params: any[] } => {
  const a = alias ? alias + '.' : '';
  let whereClause = `
    ${a}user_id = ?
    AND ${a}is_deleted = 0
  `;
  const params: any[] = [userId];

  if (filters.startDate) {
    whereClause += ` AND date(${dateColumn}) >= date(?)`;
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    whereClause += ` AND date(${dateColumn}) <= date(?)`;
    params.push(filters.endDate);
  }

  return { whereClause, params };
};

export const buildTransactionReportQuery = (
  userId: string,
  dateColumn: string,
  filters: DateRangeFilter
): { whereClause: string; params: any[] } => {
  let whereClause = `
    userId = ? 
    AND isDeleted = 0
  `;
  const params: any[] = [userId];

  if (filters.startDate) {
    whereClause += ` AND date(${dateColumn}) >= date(?)`;
    params.push(filters.startDate);
  }
  
  if (filters.endDate) {
    whereClause += ` AND date(${dateColumn}) <= date(?)`;
    params.push(filters.endDate);
  }

  return { whereClause, params };
};
