import { CURRENCY_CODES, DEFAULT_CURRENCY, resolveCurrency, type CurrencyCode } from './currency';

/**
 * A total that may span currencies: ONE figure per currency, never one summed figure.
 *
 * Adding AED to PKR produces a number that means nothing, so no total in this app is
 * allowed to do it. Every aggregate groups by currency in SQL and arrives here as one
 * row per currency; a single-currency range therefore yields exactly one entry and
 * renders exactly as it did before multi-currency existed.
 */
export type CurrencyTotal = { currency: CurrencyCode; amount: number };

/** One SQL row from a `GROUP BY ... currency` aggregate, before ordering. */
export type CurrencyTotalRow = { currency?: string | null } & Record<string, unknown>;

/**
 * Fold grouped SQL rows into ordered totals for ONE named column.
 *
 * Order is fixed and does not depend on what the rows happened to contain: the account
 * default first, then the rest alphabetically by code. A list whose order shifted
 * between renders would make two screenshots of the same day look like different data.
 *
 * Rows with a zero (or missing) amount are dropped, so a day that only ever held rupees
 * never grows a second line reading "USD 0". If every row is zero the result is a single
 * zero in the account's own currency, because a total of nothing still has to render.
 */
export const totalsFrom = (
  rows: CurrencyTotalRow[],
  column: string,
  accountCurrency: CurrencyCode = DEFAULT_CURRENCY,
): CurrencyTotal[] => {
  const byCode = new Map<CurrencyCode, number>();
  for (const row of rows) {
    const code = resolveCurrency(row.currency).code;
    const amount = Number(row[column] ?? 0);
    if (!Number.isFinite(amount)) continue;
    byCode.set(code, (byCode.get(code) ?? 0) + amount);
  }
  const base = resolveCurrency(accountCurrency).code;
  const ordered = [...byCode.entries()]
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => (a === base ? -1 : b === base ? 1 : a.localeCompare(b)))
    .map(([currency, amount]) => ({ currency, amount }));
  return ordered.length ? ordered : [{ currency: base, amount: 0 }];
};

/** True when a total spans more than one currency — the only case that renders taller. */
export const isMixed = (totals: CurrencyTotal[]): boolean => totals.length > 1;

/**
 * The single figure a caller may still treat as a scalar — ONLY valid when the total is
 * not mixed. Returns null when it is, so a caller cannot silently print one currency's
 * figure as if it were the whole thing. Never add these together.
 */
export const soleTotal = (totals: CurrencyTotal[]): CurrencyTotal | null =>
  totals.length === 1 ? totals[0] : null;

/** Sort key helper for tests and exports: the canonical order of every supported code. */
export const orderedCodes = (accountCurrency: CurrencyCode = DEFAULT_CURRENCY): CurrencyCode[] => {
  const base = resolveCurrency(accountCurrency).code;
  return [base, ...CURRENCY_CODES.filter(c => c !== base).sort()];
};

/**
 * A stacked total as text, one line per currency, in the order `totalsFrom` fixed.
 *
 * `join` is the line separator: '<br/>' for a PDF cell, '\n' for plain text. An export
 * must reconcile with the screen for the same filters, so it shows the SAME lines —
 * it never collapses them into one figure and never converts between them.
 */
export const stackedTotalText = (
  totals: CurrencyTotal[],
  format: (amount: number, currency: CurrencyCode) => string,
  join = '<br/>',
): string => totals.map(t => format(t.amount, t.currency)).join(join);
