import { internationalPhone } from './phone';

/**
 * The four currencies this app supports. Step 1 of the multi-currency plan approved
 * 28-Sep-2026: this table and the money layer only — no picker reads it yet.
 *
 * THE LIST IS CLOSED. `minorUnits` is not a free parameter: every amount in this
 * codebase is an integer in a currency's minor unit and the converters hardcode a
 * divisor of 100 (`rupeesToPaisa`, `paisaToRupees`, `paisaToRupeesString`). A
 * currency with 1000 minor units — KWD, BHD, OMR, JOD, TND — would store and display
 * 10x wrong everywhere at once. Adding one is a real piece of work, not a line here.
 * See CLAUDE.md, "Money is INTEGER PAISA everywhere".
 */
export type CurrencyCode = 'PKR' | 'AED' | 'USD' | 'CNY';

export interface Currency {
  code: CurrencyCode;
  /**
   * Written immediately before the figure. ASCII only — these strings reach bill
   * PDFs, CSV exports and an i18n parity test that rejects non-ASCII money. That
   * rules out the '¥' glyph for CNY, which also renders inconsistently in the
   * print-to-PDF path.
   */
  prefix: string;
  /**
   * Digit grouping, pinned per currency so a figure never follows the UI language.
   * NOTE: all four group Western-style ("1,254,000"). 'en-PK' does NOT produce
   * lakh/crore grouping — only 'en-IN' does. Kept distinct so changing one
   * currency's grouping later does not touch the others.
   */
  locale: string;
  /** Minor units per major unit. 100 for every currency here, by construction. */
  minorUnits: 100;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  PKR: { code: 'PKR', prefix: 'Rs. ', locale: 'en-PK', minorUnits: 100 },
  AED: { code: 'AED', prefix: 'AED ', locale: 'en-AE', minorUnits: 100 },
  USD: { code: 'USD', prefix: 'USD ', locale: 'en-US', minorUnits: 100 },
  CNY: { code: 'CNY', prefix: 'CNY ', locale: 'en-US', minorUnits: 100 },
};

/** Every row written before step 2, and every unrecognised value, is this. */
export const DEFAULT_CURRENCY: CurrencyCode = 'PKR';

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export const isCurrencyCode = (value: unknown): value is CurrencyCode =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value);

/**
 * Resolve anything to a currency. Deliberately total: a null column on a legacy row,
 * a code from a future version, or a stray argument (`values.map(formatCurrency)`
 * passes the array index as the second argument) all fall back to PKR rather than
 * throwing or printing "undefined" beside a figure.
 */
export const resolveCurrency = (code?: unknown): Currency =>
  isCurrencyCode(code) ? CURRENCIES[code] : CURRENCIES[DEFAULT_CURRENCY];

/**
 * The account's own currency as it appears inside a field LABEL — "Rs.", "AED", "USD".
 *
 * For the forms with NO picker, where the entry is denominated in the account default
 * by decision (khata, cashbook) or carries no currency column at all (stock prices, a
 * staff salary). Those labels used to read "(Rs.)" in every account, so a Dubai shop
 * was told to type rupees into a field that stores dirhams. Pass the account's
 * `default_currency`; `resolveCurrency` is total, so a missing one reads as PKR exactly
 * as it always did.
 *
 * It is the same `prefix` the figures themselves are formatted with, trimmed — one
 * source, so a label can never name a different currency from the amount beside it.
 * ASCII by construction, which the English/Urdu money parity test requires.
 */
export const accountCurrencyLabel = (code?: unknown): string => resolveCurrency(code).prefix.trim();

/**
 * Dial code → the currency to SUGGEST for a new account, approved 28-Sep-2026.
 *
 * Longest prefix first: '971' must be tested before '92' (neither is a prefix of the
 * other, but order documents the intent), and '1' last, since every other code would
 * otherwise still match correctly while '1' is the broadest.
 *
 * '+1' is the whole North American Numbering Plan, so a Canadian or Caribbean number
 * suggests USD. That is an ACCEPTED limitation: the currency is only ever a suggestion
 * the admin can change before saving and afterwards. See CLAUDE.md.
 *
 * Anything unlisted — Saudi '+966', Kuwait '+965' (excluded: 1000 minor units) — falls
 * back to PKR with the picker shown, exactly as specified.
 */
const DIAL_CODE_CURRENCY: ReadonlyArray<readonly [string, CurrencyCode]> = [
  ['971', 'AED'],
  ['92', 'PKR'],
  ['86', 'CNY'],
  ['1', 'USD'],
];

/**
 * The currency to pre-select for an account with this phone number. A SUGGESTION, never
 * a lock — a person with a Pakistani number working in Dubai must not be stuck on PKR.
 *
 * Reads the country from `internationalPhone`, so it is correct for every shape the
 * field accepts ('+971…', '00971…', '0971…', '971…'). Where that helper cannot resolve
 * a country — a half-typed field, or a foreign number whose code plus national part is
 * exactly 10 digits — the answer is PKR, which is the specified fallback anyway.
 */
export const currencyFromPhone = (raw?: string | null): CurrencyCode => {
  const digits = internationalPhone(raw);
  if (!digits) return DEFAULT_CURRENCY;
  for (const [dial, code] of DIAL_CODE_CURRENCY) {
    if (digits.startsWith(dial)) return code;
  }
  return DEFAULT_CURRENCY;
};
