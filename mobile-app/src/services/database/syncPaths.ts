import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * THE ONE MAP from a local table to the Firestore path its documents live at.
 *
 * It exists because the mapping used to live as 28 inline template literals scattered
 * across the db services, with no list anywhere. That is how `stock_movements` came to be
 * written by raw SQL with no path at all and nobody noticed: there was nothing to notice it
 * against. Push, the backfill and pull all read this map, so a table can no longer be wired
 * on one side and forgotten on the other.
 *
 * THE PATH KEY IS THE AUTHOR'S LOCAL ID, not their Firebase uid — per-uid paths break the
 * product, because an owner must read a staff member's books and those live under the staff
 * member's own identity. Authorisation rides on `ownerId` / `visibleTo` stamped onto the
 * document by `syncAuthorisation.ts`, which reads the author straight back off this path. So
 * the author this map resolves IS what the security rules end up enforcing: get it wrong and
 * a row is either refused or filed under the wrong account.
 *
 * TWO THINGS THE SCHEMA WILL NOT LET YOU GUESS, both pinned by check 152:
 *
 *   * `transactions` and `cashbook` name their author column `userId`; every other table
 *     uses `user_id`. (`syncHelpers.writeRowWithSyncIn` keeps the same two on camelCase.)
 *   * `bill_items`, the three purchase item tables and `staff_attendance` have NO author
 *     column at all. Theirs is resolved through the parent document, which is why this is an
 *     async lookup and not a property read.
 *
 * SEGMENT COUNT IS ALWAYS ODD. `users` + author + segments + id must be even for Firestore to
 * address a document, so an even-length shape would produce a path that cannot be written.
 */

/** Where a row's author — the `users/{…}` path key — comes from. */
export type AuthorSource =
  | { readonly kind: 'column'; readonly column: string }
  /** No author column on the row: read it off the parent document's row. */
  | { readonly kind: 'parent'; readonly fk: string; readonly parentTable: string; readonly parentColumn: string };

export type SyncPathSpec = {
  /** Segments AFTER `users/{authorLocalId}` and before the document id. `{col}` takes a parent id off the row. */
  readonly segments: readonly string[];
  readonly author: AuthorSource;
  /**
   * In the contract, but nothing enqueues it yet. Check 152 asserts a pending table has NO
   * path literal in src and a live one HAS at least one, so wiring push must clear the flag in
   * the same change rather than leaving the map describing something that is not true.
   */
  readonly pending?: true;
};

const col = (column: string): AuthorSource => ({ kind: 'column', column });
const via = (fk: string, parentTable: string, parentColumn = 'user_id'): AuthorSource =>
  ({ kind: 'parent', fk, parentTable, parentColumn });

export const SYNC_PATHS: Readonly<Record<string, SyncPathSpec>> = {
  // ── Flat: one collection per account ───────────────────────────────────────────────────
  activities:        { segments: ['activities'],        author: col('user_id') },
  bills:             { segments: ['bills'],             author: col('user_id') },
  cashbook:          { segments: ['cashbook'],          author: col('userId') },
  customers:         { segments: ['customers'],         author: col('user_id') },
  expenses:          { segments: ['expenses'],          author: col('user_id') },
  purchase_invoices: { segments: ['purchase_invoices'], author: col('user_id') },
  purchase_orders:   { segments: ['purchase_orders'],   author: col('user_id') },
  purchase_returns:  { segments: ['purchase_returns'],  author: col('user_id') },
  reminders:         { segments: ['reminders'],         author: col('user_id') },
  staff_records:     { segments: ['staff_records'],     author: col('user_id') },
  stock_items:       { segments: ['stock_items'],       author: col('user_id') },
  supplier_payments: { segments: ['supplier_payments'], author: col('user_id') },
  suppliers:         { segments: ['suppliers'],         author: col('user_id') },
  transactions:      { segments: ['transactions'],      author: col('userId') },

  /**
   * The author is the ENTRY's owner, not the actor who made the edit — `entry_owner_id`, set
   * by `entryAuditDb.mutateAuditedEntry`. A parent keeps read-only history of a staff
   * member's edits, so filing an audit row under the actor would move it into another book.
   */
  entry_audit:       { segments: ['entry_audit'],       author: col('entry_owner_id') },

  /**
   * The collection is `attendance` while the table is `staff_attendance` — one of four name
   * mismatches this map exists to carry. The row holds only `staff_id`, so the author is the
   * account owning that staff record. The live code takes the author from the CALLER instead,
   * which agrees in every reachable flow and is moot today: `StaffAttendance` has no navigate
   * call, so there are no rows (see CLAUDE.md).
   */
  staff_attendance:  { segments: ['attendance'],        author: via('staff_id', 'staff_records') },

  // ── Nested under their parent document ────────────────────────────────────────────────
  bill_items:                { segments: ['bills', '{bill_id}', 'items'],                   author: via('bill_id', 'bills') },
  staff_salary_transactions: { segments: ['staff_records', '{staff_id}', 'salary'],          author: col('user_id') },
  salary_month_closings:     { segments: ['staff_records', '{staff_id}', 'salary_closings'], author: col('user_id') },

  // ── Wired on 2026-10-11 (push coverage step) ─────────────────────────────────────────
  /**
   * Flat, not nested under `stock_items/{id}/movements`: the movement ledger is read per
   * account and per date across every item, which a flat collection answers in one query and
   * a nested one cannot.
   */
  stock_movements:        { segments: ['stock_movements'], author: col('user_id') },

  /**
   * Each purchase child gets its OWN leaf name instead of reusing `items`. Pull reaches a
   * nested collection with a collection-group query, which names the leaf and nothing else —
   * so four tables sharing `items` would come back as one undifferentiated stream with no way
   * to tell which table a document belongs to. `bill_items` keeps `items` because documents
   * already exist there and a rename would orphan them.
   */
  purchase_invoice_items: { segments: ['purchase_invoices', '{invoice_id}', 'invoice_items'], author: via('invoice_id', 'purchase_invoices') },
  purchase_order_items:   { segments: ['purchase_orders', '{po_id}', 'order_items'],          author: via('po_id', 'purchase_orders') },
  purchase_return_items:  { segments: ['purchase_returns', '{return_id}', 'return_items'],    author: via('return_id', 'purchase_returns') },

  // ── Still NOT wired, deliberately ────────────────────────────────────────────────────
  /**
   * Built and tested, no UI, no rows. It already writes a `firestore_path` by raw SQL
   * (`dayClosingDb.ts`) while enqueuing nothing, so it has a document shape and no push.
   * Parked beside Attendance by the owner on 2026-10-11 — listed here rather than left out,
   * so it cannot be rediscovered later as a missing step.
   */
  day_closings:           { segments: ['day_closings'], author: col('user_id'), pending: true },
};

/**
 * Tables carrying a `firestore_path` column that are deliberately NOT synced. Check 152
 * requires every such table to appear in exactly one of these two lists, so "not in the map"
 * can never again quietly mean "nobody looked".
 */
export const LOCAL_ONLY_TABLES: Readonly<Record<string, string>> = {
  users:
    'a users row holds a password hash (LOCAL_ONLY_FIELDS) and its id is the path key for ' +
    'everything else; device-to-device identity goes through users/{localId}/profile/self',
  user_settings: 'per-device preference, not business data — owner, 2026-10-11',
  sync_queue: 'the outbox itself; uploading it would be circular',
  sync_metadata: 'per-device cursors and counters',
};

export const SYNCED_TABLES: readonly string[] = Object.freeze(Object.keys(SYNC_PATHS).sort());

/** The leaf collection id — what a collection-group query names, and what pull maps back. */
export const leafCollectionOf = (table: string): string | null => {
  const spec = SYNC_PATHS[table];
  return spec ? spec.segments[spec.segments.length - 1] : null;
};

/** True when documents sit under a parent document, so pull needs a collection-group query. */
export const isNested = (table: string): boolean => (SYNC_PATHS[table]?.segments.length ?? 1) > 1;

const BY_LEAF: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.keys(SYNC_PATHS).map(table => [leafCollectionOf(table) as string, table]))
);

/** The table a pulled document belongs to, from its collection id. Null when unknown. */
export const tableForLeafCollection = (leaf: string): string | null => BY_LEAF[leaf] ?? null;

/**
 * The author's LOCAL id for one row, or null when it cannot be resolved. A caller must treat
 * null as "not uploadable yet", never as "upload without an author".
 */
export const authorLocalIdForRow = async (
  db: SQLiteDatabase,
  table: string,
  row: Record<string, any>
): Promise<string | null> => {
  const spec = SYNC_PATHS[table];
  if (!spec) return null;
  const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
  if (spec.author.kind === 'column') return text(row?.[spec.author.column]);

  const fk = text(row?.[spec.author.fk]);
  if (!fk) return null;
  // The table and column names come from the frozen map above, never from a row or a remote
  // document, so interpolating them here cannot carry anything a caller controls.
  const parent = await db.getFirstAsync<{ author: string | null }>(
    'SELECT ' + spec.author.parentColumn + ' AS author FROM ' + spec.author.parentTable + ' WHERE id = ?',
    [fk]
  );
  return text(parent?.author);
};

/** The full document path for one row, or null when anything it needs is missing. */
export const pathForRow = async (
  db: SQLiteDatabase,
  table: string,
  row: Record<string, any>
): Promise<string | null> => {
  const spec = SYNC_PATHS[table];
  if (!spec) return null;
  const id = typeof row?.id === 'string' && row.id ? row.id : null;
  if (!id) return null;
  const author = await authorLocalIdForRow(db, table, row);
  if (!author) return null;

  const middle: string[] = [];
  for (const segment of spec.segments) {
    const placeholder = /^\{(\w+)\}$/.exec(segment);
    if (!placeholder) { middle.push(segment); continue; }
    const parentId = row?.[placeholder[1]];
    if (typeof parentId !== 'string' || !parentId) return null;
    middle.push(parentId);
  }
  return ['users', author, ...middle, id].join('/');
};
