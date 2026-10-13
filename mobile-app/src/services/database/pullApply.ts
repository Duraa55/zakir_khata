import type { SQLiteDatabase } from 'expo-sqlite';
import { SYNC_PATHS } from './syncPaths';
import { columnForPayloadField, columnValueForPayloadField } from './syncHelpers';
import { acceptable, ownerMatchesAuthor } from './pullAudience';
import { SYNCED_AT_FIELD } from './syncAuthorisation';
import { isAuditedBook, assertAuditedRemoteUnchanged } from './entryAuditDb';

/**
 * PULL, THE LOCAL HALF: what a remote document is allowed to do to this database.
 *
 * Every decision that could lose or corrupt local data lives here, and here is free of any
 * Firebase import so the harness can LOAD AND RUN it rather than read its source. The
 * Firebase half (`services/firebase/firebasePull.ts`) only fetches documents and hands them
 * over one table at a time.
 *
 * THE CHOKE POINT IS THIS MODULE. `applyDocument` is the single place a pulled document can
 * enter SQLite, and it refuses before it writes:
 *
 *   * THE AUDIENCE FILTER FIRST (`pullAudience.acceptable`). The read rule admits a document
 *     because the caller is in its `visibleTo`, and `visibleTo` is written by whoever
 *     AUTHORED it — so a stranger can forge one naming you. Nothing else in the pipeline can
 *     refuse that, and the rules cannot. See CLAUDE.md, "AUDIENCE INJECTION".
 *   * AND THEN THAT IT LANDS IN THE RIGHT BOOK (`ownerMatchesAuthor`): `ownerId` is a
 *     Firebase uid, the author column holds a LOCAL id, and the two must resolve to one
 *     account or the row is filed under somebody else's name.
 *   * A COLUMN WHITELIST FROM `PRAGMA table_info`. Not tidiness: the service this replaced
 *     interpolated REMOTE KEYS straight into its SQL, so a document could name its own
 *     columns — and anything else it liked.
 *   * LOCAL UNSENT WORK WINS. A row with a `sync_queue` entry is skipped whole, never
 *     merged field by field: a half-merged row is a number nobody wrote.
 *
 * WHAT IT IS NOT: it does not decide WHICH documents to ask for, it keeps no cursor, and it
 * never enqueues anything. A pulled row is `synced = 1` by definition — it came from the
 * server — and queueing it would send it straight back.
 */

/** Document fields that are transport, not data. None of them is ever a column. */
const TRANSPORT_FIELDS: readonly string[] = ['ownerId', 'visibleTo', SYNCED_AT_FIELD];

/** Local bookkeeping a document must never be able to set. */
const LOCAL_ONLY_COLUMNS: readonly string[] = ['synced', 'firestore_path'];

/**
 * THE DELETE FLAGS, AND WHY THIS IS NOT A DETAIL (found in a real document, 2026-10-12).
 *
 * `cashbook` and `transactions` carry BOTH spellings as columns — `isDeleted`/`deletedAt`
 * from the original schema and `is_deleted`/`deleted_at` from the migration that added them
 * to every table — and an uploaded document therefore carries both. A soft delete writes
 * only the snake_case pair, so the document that comes back DISAGREES WITH ITSELF:
 *
 *     is_deleted: true,  deleted_at: "2026-10-12T19:29:22.685Z"
 *     isDeleted:  0,     deletedAt:  null
 *
 * A whitelist that copies fields onto columns would write both, and the entry would arrive
 * on the second phone LOOKING ALIVE — because the Khata reads `isDeleted` and nothing else
 * (`transactionDb`), so the stale half is the half it believes. A deletion that silently
 * does not apply is the worst shape of sync bug: the owner deleted it, the app agreed, and
 * the row is back.
 *
 * So the flags are not copied, they are DERIVED and then written to EVERY delete column the
 * table actually has:
 *
 *   * a document is deleted if EITHER spelling says so — truthiness over spelling;
 *   * `deleted_at` is whichever spelling carries a value;
 *   * the answer is written to all four columns when all four exist, so no read can pick a
 *     stale half, whichever spelling that query happens to filter on.
 *
 * The column list comes from `PRAGMA table_info`, never from a table-keyed map here: a map
 * is what goes stale the day a table gains a spelling.
 */
const DELETED_COLUMNS: readonly string[] = ['is_deleted', 'isDeleted'];
const DELETED_AT_COLUMNS: readonly string[] = ['deleted_at', 'deletedAt'];

/** Firestore booleans, SQLite integers, and a document that says "1" or "true". */
const truthy = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true';

export type ApplyOutcome =
  | { status: 'written'; id: string }
  /** Insert-only table, and this document is already here. */
  | { status: 'present'; id: string }
  | { status: 'dropped'; id: string; reason: DropReason }
  | { status: 'keptOut'; id: string; reason: KeptOutReason };

/** Refused because the document has no business being here at all. */
export type DropReason =
  /** `ownerId` is not this viewer's or a descendant's: a forgery, or another business. */
  | 'unknown-owner'
  /** `ownerId` and the author column name different accounts. */
  | 'owner-mismatch'
  | 'no-id'
  | 'id-mismatch'
  | 'not-synced-table'
  /**
   * A document that cannot make a row: it does not carry some column the table requires.
   * Refused rather than invented — a NOT NULL column filled with a guess is a number nobody
   * wrote. It only ever applies to a row this device does not already have; an UPDATE of an
   * existing row touches only the columns the document did carry.
   */
  | 'incomplete';

/** Refused to protect something local. COUNTED AND SHOWN — never silent. */
export type KeptOutReason =
  /** This device has an unsent change to that row. Local work wins. */
  | 'local-pending'
  /** An audited book: the remote entry differs and has no verified history here. */
  | 'audit-conflict';

export type TablePullResult = {
  table: string;
  written: number;
  present: number;
  dropped: number;
  keptOut: number;
};

const columnsOf = async (db: SQLiteDatabase, table: string): Promise<Set<string>> => {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(cols.map(c => c.name));
};

/**
 * The document, as columns this table actually has.
 *
 * Exported for the tests, and because it is the part worth reading on its own: everything
 * about shape and spelling is decided here, and nothing about permission.
 */
export const rowFromDocument = (
  table: string,
  doc: Record<string, unknown>,
  columns: ReadonlySet<string>
): Record<string, unknown> => {
  const row: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(doc)) {
    if (TRANSPORT_FIELDS.includes(field)) continue;
    if (LOCAL_ONLY_COLUMNS.includes(field)) continue;
    // The delete flags are derived below, from both spellings at once.
    if (DELETED_COLUMNS.includes(field) || DELETED_AT_COLUMNS.includes(field)) continue;

    // A reshaped field goes back to its column under its own name — activities.visible_to
    // travels as `activityAudience`, a real array, and must not be confused with the
    // `visibleTo` of Firebase uids that the rules test.
    const renamed = columnForPayloadField(table, field);
    if (renamed) {
      if (columns.has(renamed)) row[renamed] = columnValueForPayloadField(value);
      continue;
    }
    // ANYTHING THE TABLE DOES NOT HAVE IS DISCARDED. A document cannot name a column.
    if (!columns.has(field)) continue;
    row[field] = typeof value === 'boolean' ? (value ? 1 : 0) : value as never;
  }

  // ── THE DELETE FLAGS, DERIVED (see the comment above) ───────────────────────────────
  const deleted = DELETED_COLUMNS.some(field => truthy(doc[field]));
  const stamp = DELETED_AT_COLUMNS.map(field => doc[field]).find(v => typeof v === 'string' && v) ?? null;
  for (const column of DELETED_COLUMNS) if (columns.has(column)) row[column] = deleted ? 1 : 0;
  for (const column of DELETED_AT_COLUMNS) if (columns.has(column)) row[column] = deleted ? stamp : null;

  // A pulled row IS synced: it came from the server. Queueing it would send it back.
  //
  // BOTH bookkeeping columns, and `syncStatus` is not cosmetic. A document carries no
  // syncStatus, so the column would take its schema DEFAULT of 'pending' — and a pulled
  // row would read as outstanding local work on the receiving phone. That is how device 2
  // came to re-upload, as a raw whole row, every entry it had just pulled from device 1,
  // undoing a deletion in the process (CLAUDE.md, 2026-10-13). A document that arrives
  // from the server is synced by definition, in whichever column a table spells it.
  if (columns.has('synced')) row.synced = 1;
  if (columns.has('syncStatus')) row.syncStatus = 'synced';
  return row;
};

/**
 * Let one document into the database, or refuse it and say why.
 *
 * `known` is the audience set from `pullAudience.knownAudience`, which the caller must have
 * built BEFORE any cursor moved — an incomplete set turns this into a silent data loss, which
 * is why the Firebase half gates on the team bootstrap being complete.
 */
export const applyDocument = async (
  db: SQLiteDatabase,
  table: string,
  docId: string,
  doc: Record<string, unknown>,
  known: ReadonlySet<string>,
  options: { path?: string } = {}
): Promise<ApplyOutcome> => {
  const spec = SYNC_PATHS[table];
  if (!spec || spec.pending) return { status: 'dropped', id: docId, reason: 'not-synced-table' };

  // ── PERMISSION, BEFORE SHAPE ────────────────────────────────────────────────────────
  if (!acceptable(doc, known)) return { status: 'dropped', id: docId, reason: 'unknown-owner' };
  if (!(await ownerMatchesAuthor(db, table, doc))) return { status: 'dropped', id: docId, reason: 'owner-mismatch' };

  const id = typeof doc.id === 'string' && doc.id ? doc.id : null;
  if (!id) return { status: 'dropped', id: docId, reason: 'no-id' };
  // The row's own id must be the document's id, or the two stores disagree about what this
  // record is called and every later update would address a different row.
  if (id !== docId) return { status: 'dropped', id: docId, reason: 'id-mismatch' };

  // ── LOCAL UNSENT WORK WINS, WHOLE ───────────────────────────────────────────────────
  // `syncing` counts too: that row is mid-flight, and overwriting it would upload the
  // server's own copy back as if it were an edit.
  const waiting = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM sync_queue WHERE table_name = ? AND record_id = ? AND status IN ('pending','failed','syncing') LIMIT 1",
    [table, id]
  );
  if (waiting) return { status: 'keptOut', id, reason: 'local-pending' };

  const columns = await columnsOf(db, table);
  const row = rowFromDocument(table, doc, columns);
  if (options.path && columns.has('firestore_path')) row.firestore_path = options.path;
  if (!Object.keys(row).length) return { status: 'dropped', id, reason: 'not-synced-table' };
  row.id = id;

  // ── ENTRY HISTORY IS INSERT-ONLY, AND ITS TRIGGER MEANS IT ──────────────────────────
  // `entry_audit_no_update` and `entry_audit_no_replace` RAISE(ABORT), which aborts an
  // `INSERT OR IGNORE` and an `INSERT OR REPLACE` just the same — so the only safe shape is
  // to look first and then insert. An audit row never changes, so there is nothing to merge.
  if (table === 'entry_audit') {
    const exists = await db.getFirstAsync<{ id: string }>('SELECT id FROM entry_audit WHERE id = ? LIMIT 1', [id]);
    if (exists) return { status: 'present', id };
    const keys = Object.keys(row);
    await db.runAsync(
      `INSERT INTO entry_audit (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map(k => row[k] as never)
    );
    return { status: 'written', id };
  }

  // ── AN AUDITED BOOK REFUSES A REMOTE EDIT IT HAS NO HISTORY FOR ─────────────────────
  // Khata entries carry verified history; a remote change arriving without it would rewrite
  // money with no audit trail. `assertAuditedRemoteUnchanged` THROWS, and that must never
  // take the run down with it — one conflicted entry is one kept-out row, not a failed pull.
  //
  // THE DELETE FLAGS ARE JUDGED SEPARATELY, AND THAT IS DELIBERATE. They are part of what
  // that guard compares, so a remote DELETION of a khata entry read as a conflict and was
  // kept out — which means the entry the owner deleted on one phone stayed alive on the
  // other for ever. Refusing a deletion is worse than applying one:
  //
  //   * a soft delete is not a money rewrite — no audited FIELD moves, and the guard still
  //     refuses any document that changes one;
  //   * the deletion's own `entry_audit` rows sync on their own and arrive insert-only, so
  //     the history is not lost by applying the flags;
  //   * and nobody outside the entry's own account can send these flags at all: the audience
  //     filter above admits only this viewer's team, `ownerMatchesAuthor` pins the document
  //     to that account's book, and the create/update rules compare `ownerId` to the caller.
  if (isAuditedBook(table)) {
    const withoutDeleteFlags = { ...doc };
    for (const field of [...DELETED_COLUMNS, ...DELETED_AT_COLUMNS]) delete withoutDeleteFlags[field];
    try {
      await assertAuditedRemoteUnchanged(db, table, id, withoutDeleteFlags);
    } catch {
      return { status: 'keptOut', id, reason: 'audit-conflict' };
    }
  }

  // ── UPDATE AN EXISTING ROW, INSERT A NEW ONE — NOT A BLIND UPSERT ───────────────────
  // `INSERT ... ON CONFLICT(id) DO UPDATE` reads well and is wrong here: SQLite builds the
  // candidate row BEFORE it notices the conflict, so a NOT NULL column the document does not
  // carry fails the whole statement even when the row already exists and the update would
  // never have touched that column. A soft delete is exactly that kind of document.
  //
  // So: an update writes only what arrived, and an insert that cannot satisfy the table is
  // REFUSED and counted rather than filled in with guesses.
  const keys = Object.keys(row);
  const existing = await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`, [id]);
  if (existing) {
    const sets = keys.filter(k => k !== 'id');
    if (!sets.length) return { status: 'present', id };
    await db.runAsync(
      `UPDATE ${table} SET ${sets.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...sets.map(k => row[k] as never), id]
    );
    return { status: 'written', id };
  }
  try {
    await db.runAsync(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map(k => row[k] as never)
    );
  } catch (err: any) {
    if (__DEV__) console.warn('[Pull] ' + table + '/' + id + ' could not be created: ' + err?.message);
    return { status: 'dropped', id, reason: 'incomplete' };
  }
  return { status: 'written', id };
};

/**
 * One table's worth of documents. Counted rather than aggregated into a boolean: the Sync
 * Centre shows what was KEPT OUT, because a silently refused edit is what gets rediscovered
 * three weeks later as "sync is broken".
 */
export const applyDocuments = async (
  db: SQLiteDatabase,
  table: string,
  documents: readonly { id: string; data: Record<string, unknown>; path?: string }[],
  known: ReadonlySet<string>
): Promise<TablePullResult> => {
  const result: TablePullResult = { table, written: 0, present: 0, dropped: 0, keptOut: 0 };
  for (const document of documents) {
    const outcome = await applyDocument(db, table, document.id, document.data, known, { path: document.path });
    if (outcome.status === 'written') result.written++;
    else if (outcome.status === 'present') result.present++;
    else if (outcome.status === 'dropped') result.dropped++;
    else result.keptOut++;
  }
  return result;
};
