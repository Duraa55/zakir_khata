import type { CurrencyCode } from '../utils/currency';
export type UserRole = 'admin' | 'staff';

export interface User {
  id: string;
  name: string;
  name_ur?: string;
  phone: string;
  role: UserRole;
  businessName?: string;
  businessType?: string;
  area?: string;
  pictureUrl?: string;
  parentId?: string;
  /** Currency this account's new entries default to. Suggested from the login phone. */
  defaultCurrency?: CurrencyCode;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  token: string | null;
  issuedAt: number | null;
}

export type TransactionType = 'lena' | 'dena';

// amount_paisa: integer paisa (1 Rs = 100 paisa). Never store floats for money.
export interface Transaction {
  id: string;
  userId: string;
  partyName: string;
  amount_paisa: number;
  type: TransactionType;
  date: string;
  notes?: string;
  syncStatus: 'pending' | 'synced';
  isDeleted: number;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CashDirection = 'in' | 'out';

// amount_paisa: integer paisa (1 Rs = 100 paisa). Never store floats for money.
export interface CashEntry {
  id: string;
  userId: string;
  description: string;
  amount_paisa: number;
  direction: CashDirection;
  date: string;
  syncStatus: 'pending' | 'synced';
  isDeleted: number;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  attachment_url?: string | null;
  category?: string | null;
  note?: string | null;
}

// Expense type is defined in expense.types.ts (snake_case fields matching the DB schema).
// Re-exported here for convenience.
export type { Expense } from './expense.types';

// All values are in paisa.
export interface CalculationResults {
  totalLena: number;
  totalDena: number;
  netBalance: number;
  cashInTotal: number;
  cashOutTotal: number;
  cashBalance: number;
  expenseTotal?: number;
}

export * from './stock.types';
export * from './bill.types';
export * from './staff.types';
export * from './expense.types';
export * from './activity.types';




