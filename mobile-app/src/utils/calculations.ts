import { formatDisplayDate } from './dates';
import { Transaction, CashEntry, CalculationResults } from '../types';
import { CURRENCIES, CurrencyCode, resolveCurrency } from './currency';

/** @deprecated The prefix is per-currency now. Read CURRENCIES[code].prefix. */
export const CURRENCY_PREFIX = CURRENCIES.PKR.prefix;

// All input values are in paisa. Returns paisa.
export const calculateTotalLena = (transactions: Transaction[]): number =>
  transactions.filter(t => t.type === 'lena').reduce((s, t) => s + t.amount_paisa, 0);

export const calculateTotalDena = (transactions: Transaction[]): number =>
  transactions.filter(t => t.type === 'dena').reduce((s, t) => s + t.amount_paisa, 0);

export const calculateNetBalance = (transactions: Transaction[]): number =>
  calculateTotalLena(transactions) - calculateTotalDena(transactions);

export const calculateCashIn = (cashBook: CashEntry[]): number =>
  cashBook.filter(e => e.direction === 'in').reduce((s, e) => s + e.amount_paisa, 0);

export const calculateCashOut = (cashBook: CashEntry[]): number =>
  cashBook.filter(e => e.direction === 'out').reduce((s, e) => s + e.amount_paisa, 0);

export const calculateCashBalance = (cashBook: CashEntry[]): number =>
  calculateCashIn(cashBook) - calculateCashOut(cashBook);

export const calculateAllMetrics = (
  transactions: Transaction[],
  cashBook: CashEntry[]
): CalculationResults => ({
  totalLena: calculateTotalLena(transactions),
  totalDena: calculateTotalDena(transactions),
  netBalance: calculateNetBalance(transactions),
  cashInTotal: calculateCashIn(cashBook),
  cashOutTotal: calculateCashOut(cashBook),
  cashBalance: calculateCashBalance(cashBook),
});

export const calculateStaffBalance = (transactions: Transaction[]): number =>
  calculateNetBalance(transactions);

// Accepts an integer in the currency's MINOR unit (paisa, fils, cents) and displays
// the major unit. `currency` is whatever the row stored; an unknown or missing value
// resolves to PKR, so every call site written before multi-currency is unchanged.
export const formatCurrency = (amountPaisa: number, currency?: CurrencyCode | string | null): string => {
  const { prefix, locale, minorUnits } = resolveCurrency(currency);
  const major = Math.abs(amountPaisa) / minorUnits;
  return `${prefix}${major.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

/**
 * Display form for a stored date. Tolerates legacy rows: full ISO timestamps render
 * as their local calendar day, and malformed values (e.g. "2026-99-99" typed before
 * the date picker existed) render as-is rather than as "Invalid Date" or a throw.
 */
export const formatDate = (dateString: string): string => formatDisplayDate(dateString);

// Converts a user-entered rupee string ("150.50", "1,25,400") to integer paisa (15050).
// Returns null unless the WHOLE string is a positive amount with at most two decimals.
// (parseFloat alone read only the leading digits, so a pasted "5000Atta" saved Rs. 5,000
// and "1.2.3" saved Rs. 1.20.)
export const rupeesToPaisa = (input: string): number | null => {
  const trimmed = input.trim().replace(/,/g, '');
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(trimmed)) return null;
  const val = Number(trimmed);
  if (!Number.isFinite(val) || val <= 0 || val > 99_999_999) return null;
  return Math.round(val * 100);
};

// formatCurrency drops the sign (screens colour a figure instead). Anything that can
// go negative — net profit, net cash flow, a khata balance — and every exported file,
// where there is no colour to carry it, must keep the minus: "−Rs. 2,500".
export const formatSignedCurrency = (amountPaisa: number, currency?: CurrencyCode | string | null): string =>
  `${amountPaisa < 0 ? '−' : ''}${formatCurrency(amountPaisa, currency)}`;

// Charts plot plain numbers, so their data points need rupees. This is the ONE place
// that conversion happens for them — no screen should hand-divide by 100. Anything shown
// as text still goes through formatCurrency.
export const paisaToRupees = (paisa: number): number => paisa / 100;

// Short chart-axis label in South Asian units: 950, 12k, 1.2L, 3.4Cr. Axis labels sit in
// a narrow gutter; a full "1,25,000" would be cut off.
export const compactRupees = (rupees: number): string => {
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? '−' : '';
  const trim = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''));
  if (abs >= 1e7) return `${sign}${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}k`;
  return `${sign}${Math.round(abs)}`;
};

// Converts stored paisa integer back to a display string for input fields ("150.50").
export const paisaToRupeesString = (paisa: number): string => {
  const rupees = paisa / 100;
  return rupees % 1 === 0 ? rupees.toString() : rupees.toFixed(2);
};
