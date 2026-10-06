import type { CurrencyCode } from '../utils/currency';
export interface Expense {
  id: string;
  user_id: string;
  amount: number;              // integer paisa (1 Rs = 100 paisa)
  description: string;
  category?: string;
  note?: string;
  receipt_url?: string;
  expense_date: string; // ISO Date String for user-selected date
  created_at: string; // Timestamp of creation
  updated_at?: string;
  synced: 0 | 1;
  is_deleted: 0 | 1;
  deleted_at?: string;
  /** Currency this expense was ENTERED in (v41). Never converted. */
  currency?: CurrencyCode;
}
