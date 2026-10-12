import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * WHERE PULL HAS READ TO, and what it has refused — per account, per table (`sync_pull`,
 * v52; the counters are v53).
 *
 * Plain numbers and strings, no Firebase import, so the harness can run it. The Firestore
 * `Timestamp` is taken apart into seconds and nanoseconds here and rebuilt in the Firebase
 * half; collapsing it into one number would round away the ordering the cursor exists to
 * preserve.
 *
 * THE CURSOR IS A PAIR: the server timestamp AND the document's full path. The batch
 * uploader commits up to 500 documents at once and a batch gives every one of them the SAME
 * write time, so resuming after a bare timestamp would skip whatever shared it. The query
 * orders on (syncedAt, __name__) and resumes after both — and in a COLLECTION-GROUP query
 * the `__name__` cursor value is the FULL DOCUMENT PATH, not the bare id, which is why that
 * is what is stored.
 *
 * NULL IS NOT THE EPOCH. No row, or a NULL timestamp, means "nothing pulled yet", and the
 * query then starts at the first document rather than after one.
 */

export type PullCursor = {
  seconds: number;
  nanos: number;
  /** The full document path — `users/{localId}/bills/{id}` — as a collection-group cursor needs. */
  path: string;
};

/** What one table's pull did, for the Sync Centre and for the next run's cursor. */
export type PullTally = {
  applied: number;
  dropped: number;
  keptOut: number;
};

export const readCursor = async (
  db: SQLiteDatabase,
  accountLocalId: string,
  table: string
): Promise<PullCursor | null> => {
  const row = await db.getFirstAsync<{ cursor_seconds: number | null; cursor_nanos: number | null; cursor_doc_id: string | null }>(
    'SELECT cursor_seconds, cursor_nanos, cursor_doc_id FROM sync_pull WHERE account_local_id = ? AND table_name = ?',
    [accountLocalId, table]
  );
  if (!row || row.cursor_seconds === null || !row.cursor_doc_id) return null;
  return { seconds: row.cursor_seconds, nanos: row.cursor_nanos ?? 0, path: row.cursor_doc_id };
};

/**
 * Move the cursor and add to the counters.
 *
 * THE COUNTERS ACCUMULATE, THE CURSOR REPLACES. A kept-out row is a thing the owner should
 * be able to see after the fact, so the number survives the run that produced it; the
 * cursor is only ever "where we are now".
 *
 * The cursor may be omitted — a run that returned nothing must not move it, and a run that
 * refused everything still moves it, because the known set was complete before it started
 * and one permanently unknown owner must not block a collection for ever (CLAUDE.md).
 */
export const advanceCursor = async (
  db: SQLiteDatabase,
  accountLocalId: string,
  table: string,
  cursor: PullCursor | null,
  tally: PullTally
): Promise<void> => {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO sync_pull (account_local_id, table_name, cursor_seconds, cursor_nanos, cursor_doc_id,
                            applied, dropped, kept_out, last_pulled_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_local_id, table_name) DO UPDATE SET
       cursor_seconds = COALESCE(excluded.cursor_seconds, sync_pull.cursor_seconds),
       cursor_nanos   = COALESCE(excluded.cursor_nanos,   sync_pull.cursor_nanos),
       cursor_doc_id  = COALESCE(excluded.cursor_doc_id,  sync_pull.cursor_doc_id),
       applied  = sync_pull.applied  + excluded.applied,
       dropped  = sync_pull.dropped  + excluded.dropped,
       kept_out = sync_pull.kept_out + excluded.kept_out,
       last_pulled_at = excluded.last_pulled_at,
       updated_at = excluded.updated_at`,
    [accountLocalId, table, cursor?.seconds ?? null, cursor?.nanos ?? null, cursor?.path ?? null,
     tally.applied, tally.dropped, tally.keptOut, now, now]
  );
};

export type PullTotals = PullTally & { lastPulledAt: string | null };

/**
 * The whole account's pull figures — what the Sync Centre shows.
 *
 * `keptOut` is the one that earns its place on screen: those are REMOTE CHANGES THIS DEVICE
 * REFUSED, each because this phone had unsent work of its own or because an audited entry
 * disagreed. Dropped documents are not shown beside them: a dropped document is someone
 * else's or a forgery, and nothing was lost by refusing it.
 */
export const pullTotals = async (db: SQLiteDatabase, accountLocalId: string): Promise<PullTotals> => {
  const row = await db.getFirstAsync<{ applied: number; dropped: number; kept_out: number; last_pulled_at: string | null }>(
    `SELECT COALESCE(SUM(applied), 0) AS applied,
            COALESCE(SUM(dropped), 0) AS dropped,
            COALESCE(SUM(kept_out), 0) AS kept_out,
            MAX(last_pulled_at) AS last_pulled_at
       FROM sync_pull WHERE account_local_id = ?`,
    [accountLocalId]
  );
  return {
    applied: row?.applied ?? 0,
    dropped: row?.dropped ?? 0,
    keptOut: row?.kept_out ?? 0,
    lastPulledAt: row?.last_pulled_at ?? null,
  };
};

/** Forget the counters once the owner has seen them. The CURSOR is left exactly where it is. */
export const clearPullCounters = async (db: SQLiteDatabase, accountLocalId: string): Promise<void> => {
  await db.runAsync(
    'UPDATE sync_pull SET applied = 0, dropped = 0, kept_out = 0 WHERE account_local_id = ?',
    [accountLocalId]
  );
};
