import type { SQLiteDatabase } from 'expo-sqlite';
import { withWriteTransaction } from './writeTransaction';
import { syncPayloadFor, afterSyncedWrite } from './syncHelpers';
import { SYNC_PATHS, pathForRow, authorLocalIdForRow, leafCollectionOf, tableForLeafCollection } from './syncPaths';

/**
 * THE INITIAL UPLOAD PATH. Without it, sync is push-only for rows written FROM NOW ON.
 *
 * `sync_queue` only ever gains a row when something is written (`writeRowWithSyncIn` step 2)
 * and migration v44 emptied it, so every customer, bill and khata entry that already exists
 * will never upload — nothing will touch it again. A second device would sign in to a
 * half-empty app and it would look exactly like pull being broken. This is the hard
 * prerequisite recorded in CLAUDE.md, and pull cannot be judged without it.
 *
 * WHAT IT IS AND IS NOT. Not a migration: it must be re-runnable, and it must survive being
 * killed half way and RESUME rather than restart. It writes nothing but `sync_queue` rows and
 * its own cursor — no book row is touched, so a failed run can never corrupt data.
 *
 * SIX DECISIONS, each of which would otherwise make it quietly half-work:
 *
 *   1. EVERY LIVE ROW, REGARDLESS OF `synced`. The Firestore `users` collection was deleted
 *      on 2026-10-11, so any `synced = 1` from before that is a lie: it claims a document
 *      that no longer exists. `setDoc(..., { merge: true })` is idempotent, so re-sending
 *      costs one upload and removes a whole class of silent half-work.
 *   2. ONLY ROWS AUTHORED BY THIS ACCOUNT, and only once it has a `firebase_uid`. The
 *      uploader offers a row only when `authorisation.ownerId` equals the signed-in uid, so
 *      queueing a staff member's rows here would park them pending forever and leave the Sync
 *      Centre showing a count that can never reach zero. Their own backfill runs when they
 *      log in, under their own cursor.
 *   3. PARENTS BEFORE CHILDREN, so a bill's lines never reach Firestore before the bill.
 *   4. SOFT-DELETED ROWS INCLUDED. `entry_audit` references entry ids, so skipping deleted
 *      entries would leave the Activity Log on a second device showing history for rows that
 *      are not there. Correctness over volume (owner, 2026-10-11).
 *   5. PAYLOADS THROUGH `syncPayloadFor`, exactly as a live write does, or the first backfill
 *      would ship every customer's CNIC.
 *   6. ROWS THE LIVE PATH HAS ALREADY QUEUED ARE SKIPPED, so running this does not double the
 *      queue for anything written since the last run.
 *
 * THE CURSOR IS AN `id`, NOT A ROWID. Ordering by `id` is stable across a table REBUILD —
 * v37 and v43 both rebuild `staff_records`, and a rebuild renumbers rowids, which would make
 * a rowid cursor silently skip or repeat rows. Lexicographic id order is not creation order,
 * but it is total and it does not move.
 */

/** Columns that exist to track the local row and have no place in a document. */
const LOCAL_BOOKKEEPING = ['synced', 'firestore_path'] as const;

export type TablePlan = {
  table: string;
  /** Rows in the table, soft-deleted included. */
  rows: number;
  /** Rows this run would enqueue. */
  enqueue: number;
  /** Already waiting in sync_queue from a live write — left alone. */
  alreadyQueued: number;
  /** Authored by someone else, or by an account with no Firebase identity yet. */
  otherAuthor: number;
  /** A path could not be built: a missing parent, or a missing parent key. */
  noPath: number;
  /** Rows already past the cursor from an earlier run. */
  done: number;
};

export type BackfillPlan = {
  accountLocalId: string;
  /** False when the account has never signed in to Firebase; nothing can be enqueued yet. */
  hasFirebaseIdentity: boolean;
  /** In dependency order — the order a run would process them. */
  tables: TablePlan[];
  totalEnqueue: number;
};

/**
 * The table whose documents a given table's documents live UNDER, or null for a flat one.
 * Both kinds of dependency count: an author resolved through a parent row, and a path nested
 * under a parent document.
 */
const parentTableOf = (table: string): string | null => {
  const spec = SYNC_PATHS[table];
  if (!spec) return null;
  if (spec.author.kind === 'parent') return spec.author.parentTable;
  if (spec.segments.length > 1) return tableForLeafCollection(spec.segments[0]);
  return null;
};

/**
 * Tables in an order where every parent precedes its children. Kahn, with the remainder
 * appended rather than dropped: a cycle must not silently lose a table from the backfill.
 */
export const backfillOrder = (): string[] => {
  const pending = new Set(Object.keys(SYNC_PATHS).filter(t => !SYNC_PATHS[t].pending));
  const ordered: string[] = [];
  let moved = true;
  while (pending.size && moved) {
    moved = false;
    for (const table of [...pending].sort()) {
      const parent = parentTableOf(table);
      if (parent && parent !== table && pending.has(parent)) continue;
      ordered.push(table);
      pending.delete(table);
      moved = true;
    }
  }
  return [...ordered, ...[...pending].sort()];
};

const firebaseUidOf = async (db: SQLiteDatabase, localId: string): Promise<string | null> => {
  const row = await db.getFirstAsync<{ firebase_uid: string | null }>(
    'SELECT firebase_uid FROM users WHERE id = ? AND is_deleted = 0', [localId]
  );
  return row?.firebase_uid || null;
};

const cursorFor = async (db: SQLiteDatabase, accountLocalId: string, table: string): Promise<string> => {
  const row = await db.getFirstAsync<{ last_id: string | null }>(
    'SELECT last_id FROM sync_backfill WHERE account_local_id = ? AND table_name = ?',
    [accountLocalId, table]
  );
  return row?.last_id ?? '';
};

/** One row's verdict, shared by the plan and the run so the two can never disagree. */
type Verdict =
  | { kind: 'enqueue'; path: string; payload: Record<string, any> }
  | { kind: 'alreadyQueued' }
  | { kind: 'otherAuthor' }
  | { kind: 'noPath' };

const verdictFor = async (
  db: SQLiteDatabase,
  table: string,
  row: Record<string, any>,
  accountLocalId: string
): Promise<Verdict> => {
  const author = await authorLocalIdForRow(db, table, row);
  if (author !== accountLocalId) return { kind: 'otherAuthor' };

  const waiting = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM sync_queue WHERE table_name = ? AND record_id = ? LIMIT 1", [table, row.id]
  );
  if (waiting) return { kind: 'alreadyQueued' };

  // The row's own stored path first — it is what the live write used — and only then rebuilt.
  // A stored path is trusted for its SHAPE but not for its author: the author is re-derived
  // above, so a row that moved accounts cannot be filed under the old one.
  const stored = typeof row.firestore_path === 'string' && row.firestore_path.split('/').length % 2 === 0
    ? row.firestore_path
    : null;
  const path = stored ?? await pathForRow(db, table, row);
  if (!path) return { kind: 'noPath' };

  const payload = { ...syncPayloadFor(table, row) };
  for (const column of LOCAL_BOOKKEEPING) delete payload[column];
  return { kind: 'enqueue', path, payload };
};

/**
 * WHAT A RUN WOULD DO, writing nothing. Tens of thousands of rows appearing in the queue at
 * once is something the owner asked to see coming, and it is also the only way to tell
 * "nothing to do" apart from "nothing happened".
 */
export const planBackfill = async (db: SQLiteDatabase, accountLocalId: string): Promise<BackfillPlan> => {
  const uid = await firebaseUidOf(db, accountLocalId);
  const tables: TablePlan[] = [];

  for (const table of backfillOrder()) {
    const plan: TablePlan = { table, rows: 0, enqueue: 0, alreadyQueued: 0, otherAuthor: 0, noPath: 0, done: 0 };
    const total = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`);
    plan.rows = total?.c ?? 0;
    if (uid) {
      const cursor = await cursorFor(db, accountLocalId, table);
      const rows = await db.getAllAsync<Record<string, any>>(
        `SELECT * FROM ${table} WHERE id > ? ORDER BY id`, [cursor]
      );
      plan.done = plan.rows - rows.length;
      for (const row of rows) {
        const verdict = await verdictFor(db, table, row, accountLocalId);
        if (verdict.kind === 'enqueue') plan.enqueue++;
        else plan[verdict.kind]++;
      }
    }
    tables.push(plan);
  }

  return {
    accountLocalId,
    hasFirebaseIdentity: !!uid,
    tables,
    totalEnqueue: tables.reduce((sum, t) => sum + t.enqueue, 0),
  };
};

/**
 * The plan, printed. Dev-only and read-only — it exists so the size of a run is seen BEFORE
 * it happens rather than discovered as a five-figure pending count.
 *
 * Tables with nothing to do are left out: the useful signal is what WOULD move.
 */
export const logBackfillPlan = async (db: SQLiteDatabase, accountLocalId: string): Promise<BackfillPlan> => {
  const plan = await planBackfill(db, accountLocalId);

  // Built as ONE string and logged once. A console call inside the loop would sit under a
  // `for` rather than under an `if (__DEV__)`, and check 114 — which walks all of src for
  // exactly this — reads that as a log outside __DEV__, correctly.
  const lines = plan.hasFirebaseIdentity
    ? ['[Backfill] would enqueue ' + plan.totalEnqueue + ' rows for ' + accountLocalId]
      .concat(plan.tables
        .filter(t => t.enqueue || t.alreadyQueued || t.noPath)
        .map(t => '[Backfill]   ' + t.table.padEnd(26)
          + ' enqueue=' + t.enqueue
          + ' rows=' + t.rows
          + (t.done ? ' alreadyDone=' + t.done : '')
          + (t.alreadyQueued ? ' alreadyQueued=' + t.alreadyQueued : '')
          + (t.otherAuthor ? ' otherAuthor=' + t.otherAuthor : '')
          // A row with no path is the one line here worth chasing: it means a missing parent
          // or a missing parent key, not simply somebody else's data.
          + (t.noPath ? ' NO PATH=' + t.noPath : '')))
    : ['[Backfill] ' + accountLocalId + ' has no Firebase identity yet — nothing can upload until the next online login'];

  if (__DEV__) console.log(lines.join('\n'));
  return plan;
};

export type BackfillResult = { enqueued: number; tablesCompleted: number; stoppedEarly: boolean };

/**
 * Enqueue the backlog, one chunk per transaction.
 *
 * THE RESUME GUARANTEE IS THE TRANSACTION BOUNDARY: each chunk's queue rows and the cursor
 * that covers them commit together, so a process killed between chunks resumes at exactly the
 * row after the last one it queued. Never re-queues, never skips.
 *
 * `maxRows` stops a run early without losing the cursor, which is what makes it safe to call
 * from a screen the user can leave.
 */
export const runBackfill = async (
  db: SQLiteDatabase,
  accountLocalId: string,
  options: { chunkSize?: number; maxRows?: number } = {}
): Promise<BackfillResult> => {
  const chunkSize = Math.max(1, options.chunkSize ?? 200);
  const budget = options.maxRows ?? Infinity;
  const uid = await firebaseUidOf(db, accountLocalId);
  // No Firebase identity: nothing could be authorised, and the cursor must NOT move — the
  // rows are perfectly good and belong to the run that happens after the next login.
  if (!uid) return { enqueued: 0, tablesCompleted: 0, stoppedEarly: true };

  let enqueued = 0;
  let tablesCompleted = 0;
  let stoppedEarly = false;

  for (const table of backfillOrder()) {
    for (;;) {
      if (enqueued >= budget) { stoppedEarly = true; break; }
      const cursor = await cursorFor(db, accountLocalId, table);
      const rows = await db.getAllAsync<Record<string, any>>(
        `SELECT * FROM ${table} WHERE id > ? ORDER BY id LIMIT ?`, [cursor, chunkSize]
      );
      if (!rows.length) { tablesCompleted++; break; }

      // Verdicts are computed BEFORE the transaction opens. withWriteTransaction serialises
      // on one queue, so doing the parent lookups inside it would be the same connection
      // asking itself for rows it has already locked.
      const toQueue: Array<{ row: Record<string, any>; path: string; payload: Record<string, any> }> = [];
      for (const row of rows) {
        const verdict = await verdictFor(db, table, row, accountLocalId);
        if (verdict.kind === 'enqueue') toQueue.push({ row, path: verdict.path, payload: verdict.payload });
      }
      const lastId = String(rows[rows.length - 1].id);

      await withWriteTransaction(async inner => {
        for (const item of toQueue) {
          await inner.runAsync(
            `INSERT INTO sync_queue (id, table_name, record_id, operation, payload, firestore_path, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
            [
              `sync_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
              table, String(item.row.id), 'create',
              JSON.stringify(item.payload), item.path, new Date().toISOString(),
            ]
          );
        }
        // The cursor commits WITH the rows it covers. This single fact is the whole resume
        // story: there is no window in which rows are queued and the cursor has not moved,
        // or the cursor has moved and the rows were never queued.
        await inner.runAsync(
          `INSERT INTO sync_backfill (account_local_id, table_name, last_id, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(account_local_id, table_name) DO UPDATE SET last_id = excluded.last_id, updated_at = excluded.updated_at`,
          [accountLocalId, table, lastId, new Date().toISOString()]
        );
      });

      enqueued += toQueue.length;
    }
    if (stoppedEarly) break;
  }

  // One nudge for the whole run, after everything has committed. Per chunk it would start a
  // fresh upload pass against a queue still being filled.
  if (enqueued) afterSyncedWrite();
  return { enqueued, tablesCompleted, stoppedEarly };
};
