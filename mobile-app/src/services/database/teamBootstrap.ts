import type { SQLiteDatabase } from 'expo-sqlite';
import { assertConsistentLevel } from './accountLevel';

/**
 * THE TEAM BOOTSTRAP — the local half. How a device learns WHO ITS TEAM IS, before pull.
 *
 * `users` is in `LOCAL_ONLY_TABLES` and always will be: a users row holds a password hash,
 * and its id is the path key every other document is addressed by. So a device knows only
 * the accounts it created or adopted. On a second device that has just adopted an identity
 * that is exactly ONE row — and the audience filter (`pullAudience.knownAudience`) would
 * then admit documents from that one uid and drop every staff member's book.
 *
 * DROPPING IS NOT A RECOVERABLE STATE, which is why this runs first. A cursor must never
 * advance past a document it dropped (CLAUDE.md, and the two-pass bootstrap that loses data
 * silently): pass one would advance the `bills` cursor past a staff member's bills it had
 * just refused, and no later pull would ever ask for them again. So the filter's inputs have
 * to be complete BEFORE pull runs at all and before any cursor moves — hence a bootstrap
 * that is a single cursor-free query rather than a pull pass of its own.
 *
 * NOT A SECOND-DEVICE-ONLY STEP. `users.firebase_uid` is written by `firebaseAuth` for the
 * account that just signed in ON THIS DEVICE, so even the ORIGINAL device — which has every
 * staff row — holds NULL for all of them. Its known set is just as short, and its pull would
 * drop just as much. Both devices need this.
 *
 * ── STRUCTURE IS LOCAL, IDENTITY IS REMOTE ───────────────────────────────────────────────
 *
 * The one rule worth remembering here. WHERE a member sits in the tree is decided by this
 * device and never read off a cloud document: `parentId` is forced to the viewer, the role
 * and level are forced to staff, and the business name is taken from the viewer's own row.
 * Only the person's identity — their name, phone, photo, currency — comes from the profile
 * they published. A document that claims `parentId: <someone else>` or `role: 'admin'` is
 * therefore filed as the viewer's own staff member anyway, because the claim is never read.
 *
 * The structural rule itself is `accountLevel.assertConsistentLevel`, the same function
 * account creation uses, not a second copy of it. It is what refuses a bootstrap under a
 * viewer who is not an admin.
 *
 * ── AND IT NEVER REWRITES AN IDENTITY ────────────────────────────────────────────────────
 *
 * This only ever CREATES a row for a local id it has none for, or fills in a `firebase_uid`
 * that is missing. It never re-points a row that already carries a different uid, never
 * merges over a row holding the same phone, never touches the viewer's own row, and never
 * writes a password hash onto an existing account — the mistake that would lock someone out
 * of their own device. Every refusal is reported with a reason and nothing is written.
 *
 * Deliberately free of any Firebase import, for the same reason `accountAdoption.ts` is: the
 * test harness cannot load the Firebase packages, so anything beside them can only be
 * asserted as source text, and the rules about which rows may be rewritten matter far too
 * much for that. The Firebase half is `services/firebase/firebaseTeam.ts`.
 */

/**
 * A HASH NO PASSWORD CAN PRODUCE. `verifyStoredHash` refuses anything that does not start
 * with its scheme prefix, so a materialised row cannot answer a login however it is typed.
 *
 * That is the intended state: this device holds no credential for that person. Their own
 * device derives a hash from the password they prove against Firebase; this one has nothing
 * to derive it from, and inventing a hash here would be inventing a login.
 */
export const NO_LOGIN_HASH = '';

/** The identity fields a team member's own profile document carries. No credential. */
export type TeamMemberIdentity = {
  /** The SHARED local id, taken from `linked_user_id` on a staff_records document the viewer authored. */
  localId: string;
  /** Their Firebase uid — `ownerId` on their own profile document, which only they can have written. */
  firebaseUid: string;
  name: string;
  name_ur: string | null;
  phone: string;
  area: string | null;
  businessType: string | null;
  pictureUrl: string | null;
  default_currency: string | null;
  createdAt: string | null;
  /**
   * The VIEWER'S OWN staff_records row says this person has been dismissed
   * (`removeStaffAccess` marks the record inactive and soft-deletes the login). A created
   * row mirrors that, so the two devices agree.
   *
   * They stay in the audience set either way — see `pullAudience.knownAudience`. Their
   * entries must remain visible (non-negotiable rule 4), and on a device that has never
   * pulled them this is the only way their history can arrive at all.
   */
  removed: boolean;
};

export type RefusalReason =
  /** The viewer's own row. Rewriting it is how a device loses its own login. */
  | 'self'
  | 'no-id'
  | 'no-uid'
  | 'no-phone'
  /** The row already maps to a DIFFERENT Firebase identity. Never re-pointed. */
  | 'uid-mismatch'
  /** Another local account already claims that uid (`users.firebase_uid` is UNIQUE). */
  | 'uid-claimed'
  /** Another local account already holds that phone. Never merged — see accountAdoption. */
  | 'phone-claimed'
  /** The viewer cannot have staff beneath them: not an admin, or no live row at all. */
  | 'inconsistent-level';

export type MemberOutcome =
  | { status: 'created'; localId: string }
  /** The row existed with no uid — the ordinary case on the account's ORIGINAL device. */
  | { status: 'mapped'; localId: string }
  | { status: 'already'; localId: string }
  | { status: 'refused'; localId: string; reason: RefusalReason };

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

/**
 * Make one team member known to this device, or refuse and say why.
 *
 * Idempotent: the second call returns `already` and writes nothing. Each member stands
 * alone, so a run killed half way leaves the members it reached in place and the rest are
 * picked up next time — there is no cursor to lose and nothing to resume.
 */
export const applyTeamMember = async (
  db: SQLiteDatabase,
  viewerLocalId: string,
  member: TeamMemberIdentity
): Promise<MemberOutcome> => {
  const localId = text(member?.localId);
  const uid = text(member?.firebaseUid);
  if (!localId) return { status: 'refused', localId: '', reason: 'no-id' };
  // THE VIEWER'S OWN ROW IS NEVER TOUCHED. It holds the only password hash this device has
  // for the person using it, and this function has no password to put back.
  if (localId === viewerLocalId) return { status: 'refused', localId, reason: 'self' };
  if (!uid) return { status: 'refused', localId, reason: 'no-uid' };

  const viewer = await db.getFirstAsync<{ account_level: string | null; businessName: string | null }>(
    'SELECT account_level, businessName FROM users WHERE id = ? AND is_deleted = 0', [viewerLocalId]
  );
  if (!viewer) return { status: 'refused', localId, reason: 'inconsistent-level' };
  try {
    // The SHARED rule, not a copy of it: a staff account sits directly under an admin, and
    // nothing sits below a staff member. This is what refuses the whole bootstrap when the
    // viewer is not an admin, rather than inventing a level that the tree does not allow.
    assertConsistentLevel({
      role: 'staff',
      parentId: viewerLocalId,
      parentLevel: (viewer.account_level ?? null) as 'admin' | 'staff' | 'substaff' | null,
      level: 'staff',
    });
  } catch {
    return { status: 'refused', localId, reason: 'inconsistent-level' };
  }

  const existing = await db.getFirstAsync<{ id: string; firebase_uid: string | null }>(
    'SELECT id, firebase_uid FROM users WHERE id = ?', [localId]
  );
  const claimant = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM users WHERE firebase_uid = ? LIMIT 1', [uid]
  );
  if (claimant && claimant.id !== localId) return { status: 'refused', localId, reason: 'uid-claimed' };

  if (existing) {
    if (existing.firebase_uid === uid) return { status: 'already', localId };
    // A row that already maps to another identity is NOT re-pointed. Sharing or swapping a
    // uid would let one person's documents pass the rules — and this filter — as another's.
    if (text(existing.firebase_uid)) return { status: 'refused', localId, reason: 'uid-mismatch' };
    // The ONLY column this branch writes. Everything else about an existing account — its
    // name, its hash, where it sits, whether it was removed — is already this device's own
    // knowledge and is left exactly as it is.
    await db.runAsync(
      "UPDATE users SET firebase_uid = ? WHERE id = ? AND (firebase_uid IS NULL OR firebase_uid = '')",
      [uid, localId]
    );
    if (__DEV__) console.log('[Team] mapped ' + localId + ' to its Firebase identity');
    return { status: 'mapped', localId };
  }

  const phone = text(member.phone);
  if (!phone) return { status: 'refused', localId, reason: 'no-phone' };
  const phoneOwner = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM users WHERE phone = ? LIMIT 1', [phone]
  );
  // A real local account on that number under a different id is a conflict for the owner to
  // resolve, exactly as in adoption. Merging is the one outcome worse than refusing.
  if (phoneOwner) return { status: 'refused', localId, reason: 'phone-claimed' };

  const now = new Date().toISOString();
  try {
    await db.runAsync(
      `INSERT INTO users (id, name, name_ur, phone, passwordHash, role, account_level,
         businessName, businessType, area, pictureUrl, parentId, firebase_uid,
         createdAt, updatedAt, is_deleted, deleted_at, default_currency)
       VALUES (?, ?, ?, ?, ?, 'staff', 'staff', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [localId, member.name || localId, member.name_ur ?? null, phone, NO_LOGIN_HASH,
       // The business is the VIEWER'S, read locally — the same value createManagedAccount
       // copies off the actor — never whatever a document says it is.
       viewer.businessName ?? null, member.businessType ?? null, member.area ?? null,
       member.pictureUrl ?? null, viewerLocalId, uid,
       member.createdAt ?? now, now,
       member.removed ? 1 : 0, member.removed ? now : null,
       member.default_currency ?? null]
    );
  } catch (err: any) {
    // The two UNIQUE indexes, lost between the checks above and this insert. Reported, never
    // retried as an UPDATE: whatever holds that phone or uid is a row this function did not
    // write and may not rewrite.
    if (__DEV__) console.warn('[Team] could not create ' + localId + ':', err?.message);
    return { status: 'refused', localId, reason: /firebase_uid/.test(err?.message || '') ? 'uid-claimed' : 'phone-claimed' };
  }
  if (__DEV__) console.log('[Team] created ' + localId + (member.removed ? ' (removed)' : ''));
  return { status: 'created', localId };
};

/** The whole team, in order. One member's refusal never stops the next. */
export const applyTeamMembers = async (
  db: SQLiteDatabase,
  viewerLocalId: string,
  members: readonly TeamMemberIdentity[]
): Promise<MemberOutcome[]> => {
  const outcomes: MemberOutcome[] = [];
  for (const member of members) outcomes.push(await applyTeamMember(db, viewerLocalId, member));
  return outcomes;
};
