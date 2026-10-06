import { TKey } from './en';

// Categories are STORED in English — reports, exports and old rows all depend on the
// stored spelling, so only the label the user reads changes language. A category we
// have no key for (an old row, a future value) shows its stored spelling unchanged.
const CATEGORY_KEYS: Readonly<Record<string, TKey>> = {
  'Sales': 'catSales',
  'Commission': 'catCommission',
  'Loan Received': 'catLoanReceived',
  'Recovery': 'catRecovery',
  'Investment': 'catInvestment',
  'Other': 'catOther',
  'Purchase': 'catPurchase',
  'Rent': 'catRent',
  'Salary': 'catSalary',
  'Utilities': 'catUtilities',
  'Transport': 'catTransport',
  'Food': 'catFood',
  'Electricity': 'catElectricity',
  'Fuel': 'catFuel',
  'Internet': 'catInternet',
  'Maintenance': 'catMaintenance',
  'Marketing': 'catMarketing',
  'Miscellaneous': 'catMiscellaneous',
  'Electronics': 'catElectronics',
  'Clothing': 'catClothing',
  'Groceries': 'catGroceries',
  'Books': 'catBooks',
  'Hardware': 'catHardware',
};

// Units are stored in English too ('kg', 'piece'); an item may also carry a unit the
// shopkeeper typed themselves, which shows exactly as they typed it.
const UNIT_KEYS: Readonly<Record<string, TKey>> = {
  'kg': 'unitKg',
  'liter': 'unitLiter',
  'piece': 'unitPiece',
  'dozen': 'unitDozen',
  'meter': 'unitMeter',
  'box': 'unitBox',
  'carton': 'unitCarton',
  'pack': 'unitPack',
};

/** Display label for a stored unit. Pass the `t` from useLanguageStore. */
export function unitLabel(t: (key: TKey) => string, value: string | null | undefined): string {
  if (!value) return '';
  const key = UNIT_KEYS[value.toLowerCase()];
  return key ? t(key) : value;
}

// Order and invoice status is stored lowercase in English ('draft', 'sent', …) and read
// by every query; only the badge text changes language.
const STATUS_KEYS: Readonly<Record<string, TKey>> = {
  'draft': 'statusDraft',
  'sent': 'statusSent',
  'partial': 'statusPartial',
  'received': 'statusReceived',
  'cancelled': 'statusCancelled',
  'paid': 'statusPaid',
  'unpaid': 'statusUnpaid',
  'posted': 'statusPosted',
  'pending': 'statusPending',
  'approved': 'statusApproved',
  'refunded': 'statusRefunded',
};

/** Display label for a stored status. Pass the `t` from useLanguageStore. */
export function statusLabel(t: (key: TKey) => string, value: string | null | undefined): string {
  if (!value) return '';
  const key = STATUS_KEYS[value.toLowerCase()];
  return key ? t(key) : value.charAt(0).toUpperCase() + value.slice(1);
}

/** Display label for a stored category value. Pass the `t` from useLanguageStore. */
export function categoryLabel(t: (key: TKey) => string, value: string | null | undefined): string {
  if (!value) return '';
  const key = CATEGORY_KEYS[value];
  return key ? t(key) : value;
}
