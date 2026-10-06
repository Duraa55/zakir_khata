import { getDatabase } from './db';

/**
 * Staff entries drill-down — WHO may look at WHOSE entries.
 *
 * Two filters, kept apart on purpose:
 *   permission — the target is inside the viewer's own tree (checked HERE, and the
 *                book query's userScope() still intersects with the viewer's tree);
 *   selection  — only rows the target created: one extra `AND <col> = ?`.
 *
 * userScope() and its inline copies are never edited; the selection is appended
 * after them. The viewer's id stays the id every query is scoped and CNIC-redacted
 * by — the target is only ever the extra selection.
 *
 * Downward only, and the tree is two levels: an admin sees their own staff. Sideways
 * (a sibling) and upward (a parent) are REFUSED with an error, not silently answered
 * with nothing. Removed (soft-deleted) people are deliberately NOT excluded, so a
 * former staff member's history stays viewable.
 */
export async function assertCanViewEntriesOf(viewerId: string, targetUserId: string): Promise<void> {
  if (!viewerId || !targetUserId || viewerId === targetUserId) {
    throw new Error('You can only view entries of your own team.');
  }
  const db = await getDatabase();
  const target = await db.getFirstAsync<{ parentId: string | null }>(
    'SELECT parentId FROM users WHERE id = ?', [targetUserId]
  );
  if (target?.parentId !== viewerId) throw new Error('You can only view entries of your own team.');
}

/**
 * WHOSE rows a book query reads. Every account is its own business (own-only books):
 * normally the viewer's own id. With `createdBy` (the Staff Book drill-down) it is that
 * person's id — but only after the downward-only permission check passes.
 * Callers filter on `<author column> = ?` with the returned id and nothing else.
 */
export async function entryOwner(viewerId: string, createdBy?: string | null): Promise<string> {
  if (createdBy) {
    await assertCanViewEntriesOf(viewerId, createdBy);
    return createdBy;
  }
  return viewerId;
}

/** The selection clause for a creator column, or nothing when not drilling down. */
export const creatorClause = (column: string, createdBy?: string): { sql: string; params: string[] } =>
  createdBy ? { sql: ` AND ${column} = ?`, params: [createdBy] } : { sql: '', params: [] };
