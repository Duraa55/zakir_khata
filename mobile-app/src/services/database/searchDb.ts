import { getDatabase } from './db';

export interface SearchResult {
  id: string;
  type: 'customer' | 'khata' | 'bill' | 'product' | 'expense' | 'staff';
  title: string;
  subtitle: string;
  date?: string;
  amount?: number;
  metadata?: any;
}

export const executeGlobalSearch = async (query: string, userId: string): Promise<SearchResult[]> => {
  if (!query || query.trim() === '') return [];
  const db = await getDatabase();
  // Literal search: % and _ typed by the user are characters, not SQL wildcards.
  const searchPattern = `%${query.trim().replace(/[\\%_]/g, c => '\\' + c)}%`;
  
  const results: SearchResult[] = [];

  // Hierarchy filter pattern
  const hierarchyFilter = `user_id = ? AND is_deleted = 0`;
  const transactionHierarchyFilter = `userId = ? AND isDeleted = 0`;

  const params3 = [userId, searchPattern];
  const params4 = [userId, searchPattern, searchPattern];
  const params5 = [userId, searchPattern, searchPattern, searchPattern];

  // 1. Customers — the customers table. (This used to search the USERS table, so it
  // listed the app's own logins as "customers" and never found a real customer.) The
  // The national ID column is never searched or returned.
  const customers = await db.getAllAsync<any>(
    `SELECT id, name, phone, city, created_at FROM customers WHERE ${hierarchyFilter} AND (name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\') LIMIT 10`,
    params4
  );
  customers.forEach(c => results.push({
    id: c.id,
    type: 'customer',
    title: c.name,
    subtitle: [c.phone, c.city].filter(Boolean).join(' • ') || 'Customer',
    date: c.created_at
  }));

  // 2. Khata / Transactions
  const transactions = await db.getAllAsync<any>(
    `SELECT * FROM transactions WHERE ${transactionHierarchyFilter} AND (partyName LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\') LIMIT 10`,
    params4
  );
  transactions.forEach(t => results.push({
    id: t.id,
    type: 'khata',
    title: t.partyName,
    subtitle: t.notes || t.type,
    amount: t.amount_paisa,
    date: t.date,
    metadata: { type: t.type }
  }));

  // 3. Bills
  const bills = await db.getAllAsync<any>(
    `SELECT * FROM bills WHERE ${hierarchyFilter} AND (party_name LIKE ? ESCAPE '\\' OR party_phone LIKE ? ESCAPE '\\') LIMIT 10`,
    params4
  );
  bills.forEach(b => results.push({
    id: b.id,
    type: 'bill',
    title: b.party_name,
    subtitle: b.party_phone || `Bill #${b.bill_no}`,
    amount: b.total,
    date: b.bill_date,
    metadata: { billNo: b.bill_no }
  }));

  // 4. Products / Stock
  const products = await db.getAllAsync<any>(
    `SELECT * FROM stock_items WHERE ${hierarchyFilter} AND (name_en LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\') LIMIT 10`,
    params5
  );
  products.forEach(p => results.push({
    id: p.id,
    type: 'product',
    title: p.name_en,
    subtitle: p.barcode ? `Barcode: ${p.barcode}` : p.category,
    amount: p.sale_price,
    metadata: { quantity: p.quantity }
  }));

  // 5. Expenses
  const expenses = await db.getAllAsync<any>(
    `SELECT * FROM expenses WHERE ${hierarchyFilter} AND (description LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\') LIMIT 10`,
    params4
  );
  expenses.forEach(e => results.push({
    id: e.id,
    type: 'expense',
    title: e.description,
    subtitle: e.note || 'Expense',
    amount: e.amount,
    date: e.expense_date
  }));

  // 6. Staff
  const staff = await db.getAllAsync<any>(
    `SELECT * FROM staff_records WHERE ${hierarchyFilter} AND (name_en LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\') LIMIT 10`,
    params4
  );
  staff.forEach(s => results.push({
    id: s.id,
    type: 'staff',
    title: s.name_en,
    subtitle: s.phone + ` • ${s.role}`,
    date: s.created_at
  }));

  return results;
};
