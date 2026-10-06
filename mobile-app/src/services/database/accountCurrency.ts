import { getDatabase } from './db';
import { resolveCurrency, type CurrencyCode } from '../../utils/currency';

/**
 * The account's OWN currency — the base every stacked total is ordered around and the
 * only currency in which a derived figure (profit, margin, cost) is meaningful.
 *
 * This used to be copied privately into billDb and expenseDb. The reports layer needed
 * it too, and a third copy is how the three drift apart, so there is now exactly one.
 * `resolveCurrency` is total: a null, legacy or unknown value resolves to PKR rather
 * than throwing or printing "undefined" beside a figure.
 */
export const accountCurrencyOf = async (
  db: Awaited<ReturnType<typeof getDatabase>>,
  userId: string,
): Promise<CurrencyCode> => {
  const row = await db.getFirstAsync<{ default_currency: string | null }>(
    'SELECT default_currency FROM users WHERE id = ?',
    [userId],
  );
  return resolveCurrency(row?.default_currency).code;
};

/** The same lookup for a caller that does not already hold a database handle. */
export const accountCurrencyFor = async (userId: string): Promise<CurrencyCode> =>
  accountCurrencyOf(await getDatabase(), userId);
