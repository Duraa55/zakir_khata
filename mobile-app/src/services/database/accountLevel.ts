/**
 * accountLevel — the explicit account level.
 *
 * THE TREE IS TWO LEVELS: admin → staff. Nothing sits below a staff member. Sub-staff
 * are `staff_records` rows with no login (see CLAUDE.md); they have no users row, so
 * they have no level.
 *
 * Until v32 the level was DERIVED by walking parentId depth, so `role === 'staff'`
 * matched every level and a wrong parentId silently promoted someone. `users.role`
 * carries a CHECK constraint that SQLite cannot alter, and changing its values would
 * have flipped every tested permission check at once — so the level lives in its own
 * column instead.
 *
 * ⚠ SCOPE RULE: account_level is for ROLE CHECKS ONLY. Data visibility continues to
 * flow through parentId via queryHelpers.userScope(). Never use this value to scope
 * a query.
 *
 * Pure module — no database import, so it is safe for db.ts to use during migration.
 */

/**
 * 'substaff' is LEGACY. No live path can produce it any more — only the v32 backfill
 * below, which reads databases written before the level was retired. It stays in the
 * type (and in the column's CHECK constraint) so that migration keeps classifying old
 * rows exactly as it always did; see classifyAccountLevel.
 */
export type AccountLevel = 'admin' | 'staff' | 'substaff';

export interface LevelNode {
  id: string;
  role: string;
  parentId?: string | null;
}

/** Why a node was classified the way it was — reported by the v32 backfill. */
export type LevelReason =
  | 'admin'
  | 'root-staff'        // role=staff with no parent (legacy self-registration)
  | 'child-of-admin'
  | 'child-of-staff'
  | 'dangling-parent'   // parent row missing (pre-v31 hard delete)
  | 'depth-exceeded'    // chain deeper than the 3-level model
  | 'cycle';

const MAX_WALK = 8;

/**
 * ⚠ HISTORY, NOT LIVE LOGIC. Called ONLY by the v32 backfill in db.ts, which runs on a
 * database written before sub-staff were retired. It still knows three levels ON PURPOSE:
 * a database that genuinely contains a three-deep tree must be classified the way it was
 * when those rows were written. Collapsing this to two levels would PROMOTE every former
 * sub-staff to staff during an upgrade — handing them permissions they never had, and
 * hiding them from the sub-staff wipe, which matches on account_level = 'substaff'.
 * Leave it alone. New accounts never reach this function.
 *
 * The level is decided by the PARENT alone:
 *   admin role            -> admin
 *   no parent             -> staff   (root of its own tree)
 *   parent is an admin    -> staff
 *   parent is staff-level -> substaff
 *   parent missing        -> substaff (most restrictive; never promotes anyone)
 */
export function classifyAccountLevel(
  node: LevelNode,
  lookup: (id: string) => LevelNode | undefined
): { level: AccountLevel; reason: LevelReason } {
  if (node.role === 'admin') return { level: 'admin', reason: 'admin' };
  if (!node.parentId) return { level: 'staff', reason: 'root-staff' };

  const parent = lookup(node.parentId);
  if (!parent) return { level: 'substaff', reason: 'dangling-parent' };
  if (parent.role === 'admin') return { level: 'staff', reason: 'child-of-admin' };

  // Parent is staff-level, so this node is a sub-staff regardless of what sits
  // above. Keep walking only to report cycles and over-deep chains.
  const seen = new Set<string>([node.id, parent.id]);
  let cursor: LevelNode | undefined = parent;
  for (let hop = 0; hop < MAX_WALK; hop++) {
    if (!cursor.parentId) return { level: 'substaff', reason: 'child-of-staff' };
    if (seen.has(cursor.parentId)) return { level: 'substaff', reason: 'cycle' };
    seen.add(cursor.parentId);
    cursor = lookup(cursor.parentId);
    if (!cursor) return { level: 'substaff', reason: 'child-of-staff' };
    if (cursor.role === 'admin') {
      return { level: 'substaff', reason: hop > 0 ? 'depth-exceeded' : 'child-of-staff' };
    }
  }
  return { level: 'substaff', reason: 'depth-exceeded' };
}

/** The level a node MUST have, given its role and its parent's level. */
export function expectedAccountLevel(
  role: string,
  parentLevel: AccountLevel | null | undefined,
  hasParent: boolean
): AccountLevel {
  if (role === 'admin') return 'admin';
  if (!hasParent) return 'staff';
  return parentLevel === 'admin' ? 'staff' : 'substaff';
}

/**
 * Throws when role / parent / level disagree. Never silently corrects — an
 * inconsistent combination is a bug in the caller, not something to paper over.
 *
 * Two levels only. An account below staff is refused outright: sub-staff are records,
 * not logins, so nothing may create one.
 */
export function assertConsistentLevel(params: {
  role: string;
  parentId?: string | null;
  parentLevel?: AccountLevel | null;
  level: AccountLevel;
}): void {
  const { role, parentId, parentLevel, level } = params;

  if (level === 'substaff') {
    throw new Error('Sub-staff no longer have logins. Add them as a staff record instead.');
  }

  if (level === 'admin') {
    if (role !== 'admin') throw new Error('Account level "admin" requires role "admin".');
    if (parentId) throw new Error('An admin account cannot have a parent.');
    return;
  }

  if (role !== 'staff') {
    throw new Error(`Account level "${level}" requires role "staff", got "${role}".`);
  }

  // staff: directly under an admin, or the root of its own tree.
  if (parentId && parentLevel !== 'admin') {
    throw new Error('A staff account must sit directly under an admin.');
  }
}
