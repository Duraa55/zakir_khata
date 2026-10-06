/**
 * queryHelpers.ts
 * Centralized SQL query building utilities to eliminate repeated patterns.
 */

/**
 * Builds a WHERE clause fragment that matches records belonging to a user and their
 * own staff. The tree is two levels (admin -> staff), so there is nothing deeper.
 *
 * Usage:
 *   WHERE ${userScope('userId')} AND isDeleted = 0
 *   params: [...userScopeParams(userId), ...]
 *
 * @param col Column name. Use 'userId' for camelCase tables (transactions, cashbook),
 *            or 'user_id' for snake_case tables (expenses, stock_items, bills, etc.)
 */
export const userScope = (col: 'userId' | 'user_id' = 'user_id'): string =>
  `(${col} = ? OR ${col} IN (SELECT id FROM users WHERE parentId = ?))`;

/**
 * Returns the 2 repeated params required by userScope().
 * Always pass as a spread: [...userScopeParams(userId), ...otherParams]
 */
export const userScopeParams = (userId: string): [string, string] =>
  [userId, userId];

/**
 * Generates a unique ID with a given prefix.
 * Format: {prefix}_{timestamp}_{random}
 * e.g. "txn_1720000000000_abc123def"
 */
export const generateId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

/**
 * Returns current UTC timestamp as ISO string.
 */
export const nowISO = (): string => new Date().toISOString();

/**
 * Today's date in YYYY-MM-DD, in the DEVICE'S LOCAL timezone.
 *
 * This previously used toISOString() — i.e. UTC — while claiming to be local. In
 * PKT (UTC+5) that made the calendar day roll over at 05:00 instead of midnight.
 * Re-exported from utils/dates so there is exactly one implementation.
 */
export { todayDate, localDate } from '../../utils/dates';
