import {
  collectionGroup, query, where, orderBy, startAfter, limit, getDocs, documentId, Timestamp,
} from 'firebase/firestore';
import { IS_FIREBASE_CONFIGURED, getFirestoreDB } from './firebaseConfig';
import { currentFirebaseUid } from './firebaseAuth';
import { bootstrapTeamFromCloud } from './firebaseTeam';
import { getDatabase } from '../database/db';
import { SYNCED_AT_FIELD } from '../database/syncAuthorisation';
import { leafCollectionOf } from '../database/syncPaths';
import { backfillOrder } from '../database/syncBackfill';
import { knownAudience } from '../database/pullAudience';
import { applyDocuments, type TablePullResult } from '../database/pullApply';
import { readCursor, advanceCursor, type PullCursor } from '../database/pullCursor';
import { processSyncQueue } from '../syncProcessor';

/**
 * PULL — the Firebase half: 23 collection-group queries, a cursor per table, and a gate.
 *
 * ONE QUERY PER TABLE, over the COLLECTION GROUP. A flat collection lives under its
 * AUTHOR's local id (`users/{staffLocalId}/bills`), so reading a whole team one query at a
 * time is only possible across the group — and a collection-group query supplies no
 * ancestry, which is why each leaf has its own read block in firestore.rules. Every query
 * carries `array-contains` on `visibleTo`: the rules REJECT a query they cannot prove rather
 * than filtering it, so a query without it fails whole.
 *
 * THE GATE, AND WHY IT IS CHECKED EVERY RUN. The audience filter can only refuse what it
 * cannot recognise, so its known set must be COMPLETE before any cursor moves — a cursor
 * that advances past a dropped document loses it for ever, and no later pull asks again. So
 * every run bootstraps the team first and REFUSES TO PULL AT ALL unless that came back
 * complete. Not once at login: the case this exists for is a member whose uid exists (so
 * they can upload) but whose profile this device cannot read (so it cannot learn the uid),
 * and that can become true between two logins.
 *
 * Given the gate, the cursor then advances over EVERY document a query returned, accepted or
 * dropped. Advancing only over accepted ones is the other trap: a single document with a
 * permanently unknown owner would block its collection for ever.
 *
 * PUSH DRAINS FIRST. Pulling onto unsent local work would be deciding a conflict by
 * accident; sending first means the server holds this device's own version before anything
 * comes back, and whatever is still queued afterwards is kept out and counted.
 *
 * PARENTS BEFORE CHILDREN within a run (`backfillOrder`), so a bill's lines do not arrive
 * before the bill. Across runs they still can — each table has its own cursor — and foreign
 * keys are off, so such a line waits as an orphan row until its parent lands rather than
 * failing.
 */

/** Documents per query. Small enough that a page is cheap to re-fetch, large enough to drain. */
const PAGE_SIZE = 200;

export type PullRefusal =
  | { status: 'skipped'; reason: 'not-configured' | 'no-firebase-identity' | 'offline' }
  /**
   * THE GATE. The team is not fully known, so a pull would drop documents it cannot
   * recognise and advance its cursors past them. `unresolved` names who is missing.
   */
  | { status: 'blocked'; reason: 'team-incomplete'; unresolved: string[] }
  | { status: 'failed'; code: string };

export type PullReport = {
  status: 'done';
  tables: TablePullResult[];
  applied: number;
  dropped: number;
  keptOut: number;
  /** True when a table filled its page, so there is more waiting and another run should follow. */
  more: boolean;
};

export type PullResult = PullReport | PullRefusal;

/** A dry run: the same queries, nothing written and no cursor moved. */
export type PullPlan =
  | { status: 'plan'; tables: { table: string; documents: number }[]; total: number }
  | PullRefusal;

const asTimestamp = (cursor: PullCursor): Timestamp => new Timestamp(cursor.seconds, cursor.nanos);

/**
 * Everything a run needs before it may touch a cursor: who we are, who our team is, and
 * whether that answer is complete.
 */
const prepare = async (viewerLocalId: string, drain: boolean): Promise<
  | { ok: true; uid: string; known: ReadonlySet<string>; db: Awaited<ReturnType<typeof getDatabase>> }
  | { ok: false; refusal: PullRefusal }
> => {
  if (!IS_FIREBASE_CONFIGURED) return { ok: false, refusal: { status: 'skipped', reason: 'not-configured' } };
  const uid = await currentFirebaseUid();
  if (!uid) return { ok: false, refusal: { status: 'skipped', reason: 'no-firebase-identity' } };

  // THE TEAM, FIRST AND EVERY TIME. Its own failures are reported as the gate closing,
  // because "could not tell who the team is" and "the team is incomplete" have the same
  // consequence for a cursor.
  const team = await bootstrapTeamFromCloud(viewerLocalId);
  if (team.status !== 'done') {
    return { ok: false, refusal: { status: 'blocked', reason: 'team-incomplete', unresolved: [team.status] } };
  }
  if (!team.complete) {
    const unresolved = team.unresolved.map(u => u.localId + ':' + u.reason);
    if (__DEV__) console.warn('[Pull] blocked, the team is incomplete: ' + unresolved.join(', '));
    return { ok: false, refusal: { status: 'blocked', reason: 'team-incomplete', unresolved } };
  }

  const db = await getDatabase();
  // PUSH FIRST. Not awaited for its result — it reports nothing this needs — but awaited so
  // the queue has drained before anything is read back.
  if (drain) {
    try { await processSyncQueue(); } catch { /* a failed push leaves rows queued; they are kept out below */ }
  }

  const known = await knownAudience(db, viewerLocalId);
  return { ok: true, uid, known, db };
};

/** One table's query, resumed from its cursor. */
const pageFor = (
  firestore: ReturnType<typeof getFirestoreDB>,
  leaf: string,
  uid: string,
  cursor: PullCursor | null
) => {
  const clauses = [
    where('visibleTo', 'array-contains', uid),
    orderBy(SYNCED_AT_FIELD),
    // The tie-break. A batch commit stamps up to 500 documents with the SAME write time, so
    // resuming on the timestamp alone would skip whatever shared it with the cursor.
    orderBy(documentId()),
  ];
  return cursor
    ? query(collectionGroup(firestore, leaf), ...clauses, startAfter(asTimestamp(cursor), cursor.path), limit(PAGE_SIZE))
    : query(collectionGroup(firestore, leaf), ...clauses, limit(PAGE_SIZE));
};

/**
 * Pull everything waiting for this account.
 *
 * Safe to call repeatedly: each table resumes from its own cursor, and `more` says whether a
 * page filled up and another run is worth making.
 */
export const pullRemoteChanges = async (viewerLocalId: string): Promise<PullResult> => {
  const ready = await prepare(viewerLocalId, true);
  if (!ready.ok) return ready.refusal;
  const { uid, known, db } = ready;

  try {
    const firestore = getFirestoreDB();
    const tables: TablePullResult[] = [];
    let more = false;

    for (const table of backfillOrder()) {
      const leaf = leafCollectionOf(table);
      if (!leaf) continue;
      let cursor = await readCursor(db, viewerLocalId, table);
      const snapshot = await getDocs(pageFor(firestore, leaf, uid, cursor));
      if (snapshot.empty) continue;

      const documents = snapshot.docs.map(d => ({ id: d.id, data: d.data() as Record<string, unknown>, path: d.ref.path }));
      const result = await applyDocuments(db, table, documents, known);

      // THE CURSOR MOVES OVER EVERYTHING THE QUERY RETURNED — including what was dropped and
      // what was kept out. The gate above is what makes that safe; see the module comment.
      const last = snapshot.docs[snapshot.docs.length - 1];
      const stamp = last.get(SYNCED_AT_FIELD);
      cursor = stamp instanceof Timestamp
        ? { seconds: stamp.seconds, nanos: stamp.nanoseconds, path: last.ref.path }
        : cursor;
      await advanceCursor(db, viewerLocalId, table, cursor, {
        applied: result.written, dropped: result.dropped, keptOut: result.keptOut,
      });

      tables.push(result);
      if (snapshot.size >= PAGE_SIZE) more = true;
    }

    const report: PullReport = {
      status: 'done',
      tables,
      applied: tables.reduce((n, t) => n + t.written, 0),
      dropped: tables.reduce((n, t) => n + t.dropped, 0),
      keptOut: tables.reduce((n, t) => n + t.keptOut, 0),
      more,
    };
    if (__DEV__) {
      console.log('[Pull] ' + report.status + ' applied=' + report.applied
        + ' dropped=' + report.dropped + ' keptOut=' + report.keptOut + ' more=' + report.more + '\n'
        + report.tables.filter(t => t.written || t.dropped || t.keptOut || t.present)
            .map(t => '[Pull]   ' + t.table.padEnd(26) + ' applied=' + t.written
              + (t.present ? ' already=' + t.present : '')
              + (t.dropped ? ' DROPPED=' + t.dropped : '')
              + (t.keptOut ? ' KEPT OUT=' + t.keptOut : '')).join('\n'));
    }
    return report;
  } catch (err: any) {
    // Offline, a missing index, or a refused query. Nothing was half-applied: each document
    // is written on its own, and a cursor only moves with the page it covers.
    if (__DEV__) console.warn('[Pull] failed:', err?.code || err?.message);
    return { status: 'failed', code: err?.code || err?.message || 'pull-failed' };
  }
};

/**
 * WHAT A RUN WOULD BRING DOWN, writing nothing and moving no cursor.
 *
 * It costs the same reads as a real run — a document has to be fetched to be counted — so it
 * is dev-only, exactly like the backfill's dry run. The point is the same: the size of a run
 * is seen before it happens, and "nothing to do" is told apart from "nothing happened".
 */
export const planPull = async (viewerLocalId: string): Promise<PullPlan> => {
  const ready = await prepare(viewerLocalId, false);
  if (!ready.ok) return ready.refusal;
  const { uid, db } = ready;

  try {
    const firestore = getFirestoreDB();
    const tables: { table: string; documents: number }[] = [];
    for (const table of backfillOrder()) {
      const leaf = leafCollectionOf(table);
      if (!leaf) continue;
      const cursor = await readCursor(db, viewerLocalId, table);
      const snapshot = await getDocs(pageFor(firestore, leaf, uid, cursor));
      if (snapshot.size) tables.push({ table, documents: snapshot.size });
    }
    return { status: 'plan', tables, total: tables.reduce((n, t) => n + t.documents, 0) };
  } catch (err: any) {
    if (__DEV__) console.warn('[Pull] plan failed:', err?.code || err?.message);
    return { status: 'failed', code: err?.code || err?.message || 'pull-plan-failed' };
  }
};
