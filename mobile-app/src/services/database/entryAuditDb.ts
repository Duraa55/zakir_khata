import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from './db';
import { withWriteTransaction } from './writeTransaction';

export type ValueKind = 'money_paisa' | 'date' | 'text' | 'number' | 'boolean';
export interface EntryAuditRow {
  id: string; change_group_id: string; book_table: string; entry_id: string;
  entry_owner_id: string; field_name: string; value_kind: ValueKind;
  old_value_json: string; new_value_json: string;
  actor_id: string; actor_name: string; changed_at: string; action: 'edited' | 'deleted';
}
type Person = { id: string; name: string; role: string; parentId: string | null; is_deleted: number };
type RecordRow = Record<string, string | number | null>;
type BookConfig = {
  owner: string; deleted: string; deletedAt: string; fields: Record<string, ValueKind>;
  timestamps: string[]; syncState: RecordRow; deletionAliases?: Record<string, 'flag' | 'date'>;
  /**
   * Columns written WITH an audited edit but never audited themselves, because they are
   * derived from the edit rather than chosen by the person making it — the same standing
   * as `timestamps` and `syncState` below.
   *
   * This exists so a derived column does not have to be added to `fields` to be kept in
   * step. A column in `fields` is a column any caller may set and every change to it
   * appears in the entry's visible history; an opaque id belongs in neither.
   *
   * `row` is the record as it will be AFTER the edit. Runs inside the same transaction,
   * on the same connection, before the row is written and enqueued.
   */
  derive?: (db: SQLiteDatabase, row: RecordRow, changed: Set<string>) => Promise<RecordRow>;
};
// Enroll other books only when their data-layer rollout is ready.
const books: Record<string, BookConfig> = {
  transactions: {
    owner: 'userId', deleted: 'isDeleted', deletedAt: 'deletedAt',
    timestamps: ['updatedAt', 'updated_at'], syncState: { synced: 0, syncStatus: 'pending' },
    deletionAliases: { is_deleted: 'flag', deleted_at: 'date' },
    fields: { partyName: 'text', amount_paisa: 'money_paisa', type: 'text', notes: 'text', date: 'date' },
    // Renaming the party re-links the entry, by the SAME rule createTransaction and
    // createBill use. An entry edited ONTO a real customer used to stay name-keyed and
    // never appear in their ledger; one edited AWAY from them kept claiming to be
    // theirs. Dynamically imported because customerDb reaches this module through
    // syncHelpers' isAuditedBook — a static import here is a cycle (same reason
    // currentActor imports the auth store this way).
    derive: async (db, row, changed): Promise<RecordRow> => {
      if (!changed.has('partyName')) return {};
      const { matchCustomerByName } = await import('./customerDb');
      const { id } = await matchCustomerByName(String(row.userId), String(row.partyName ?? ''), db);
      return { customer_id: id };
    },
  },
};
export const isAuditedBook = (table: string): boolean => Object.prototype.hasOwnProperty.call(books, table);
const configFor = (table: string): BookConfig => {
  if (!isAuditedBook(table)) throw new Error('This book is not enabled for entry history yet.');
  return books[table];
};
const newId = (prefix: string) => prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2);

async function currentActor(db: SQLiteDatabase): Promise<Person> {
  // Identity comes from the session; role, access and name are re-read from SQLite.
  const { useAuthStore } = await import('../../store/authStore');
  const session = useAuthStore.getState();
  if (!session.isAuthenticated || !session.user) throw new Error('Please log in to continue.');
  const actor = await db.getFirstAsync<Person>('SELECT id, name, role, parentId, is_deleted FROM users WHERE id = ?', [session.user.id]);
  if (!actor || actor.is_deleted) throw new Error('Your account no longer has access.');
  return actor;
}

async function mayAccess(db: SQLiteDatabase, actor: Person, ownerId: string): Promise<boolean> {
  if (actor.id === ownerId) return true;
  // Removed owners must remain in this chain, so their historical entries stay visible.
  const owner = await db.getFirstAsync<Person>('SELECT id, role, parentId FROM users WHERE id = ?', [ownerId]);
  if (!owner || owner.role !== 'staff') return false;
  // Two levels: an admin sees their own staff's history, and nobody sees sideways or
  // upward. A staff member has nobody below them, so they see only their own work.
  return actor.role === 'admin' && owner.parentId === actor.id;
}

/**
 * `write`: every account is its own business — only the AUTHOR may change or delete an
 * entry. Parents (admin → staff → sub-staff) keep READ access to its history for
 * monitoring, via mayAccess, but can never edit it.
 */
async function ownedRecord(db: SQLiteDatabase, table: string, id: string, actor: Person, write = false): Promise<RecordRow> {
  const config = configFor(table);
  // Includes deleted records for ActivityLog history; no normal visibility query changes.
  const record = await db.getFirstAsync<RecordRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  const ownerId = record ? String(record[config.owner]) : '';
  const allowed = !!record && (write ? actor.id === ownerId : await mayAccess(db, actor, ownerId));
  if (!allowed) {
    throw new Error(write && record && await mayAccess(db, actor, ownerId)
      ? 'You do not have permission to change this entry. Only the person who created it can change it.'
      : 'You do not have permission to access or change this entry.');
  }
  return record as RecordRow;
}

function validateField(table: string, field: string, value: unknown, kind: ValueKind): void {
  if (kind === 'money_paisa' && (!Number.isSafeInteger(value) || Number(value) <= 0)) throw new Error('Amount must be a positive whole number of paisa.');
  if (kind === 'text' && typeof value !== 'string' && !(field === 'notes' && value === null)) throw new Error('Invalid ' + field + '.');
  if (field === 'partyName' && !String(value).trim()) throw new Error('Please enter a party name.');
  if (table === 'transactions' && field === 'type' && value !== 'lena' && value !== 'dena') throw new Error('Invalid transaction type.');
  if (kind === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error('Date must be a valid YYYY-MM-DD date.');
}

async function enqueue(db: SQLiteDatabase, table: string, id: string, operation: string, data: object, path: string, now: string): Promise<void> {
  await db.runAsync(`INSERT INTO sync_queue (id, table_name, record_id, operation, payload, firestore_path, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`, [newId('sync'), table, id, operation, JSON.stringify(data), path, now]);
}

export async function mutateAuditedEntry(table: string, id: string, action: 'edited' | 'deleted', updates: Record<string, unknown> = {}): Promise<void> {
  const config = configFor(table);
  let queued = false;
  await withWriteTransaction(async db => {
    const actor = await currentActor(db);
    const record = await ownedRecord(db, table, id, actor, true);
    if (record[config.deleted] || record.is_deleted) throw new Error('This entry has been deleted. Its history is still available in Activity Log.');
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('Invalid entry changes.');
    const now = new Date().toISOString();
    const group = newId('change');
    const ownerId = String(record[config.owner]);
    const changes: Array<{ field: string; kind: ValueKind; oldValue: string | number | null; newValue: string | number | null }> = [];
    if (action === 'deleted') {
      changes.push({ field: config.deleted, kind: 'boolean', oldValue: record[config.deleted] ?? 0, newValue: 1 });
    } else {
      for (const [field, value] of Object.entries(updates)) {
        if (!Object.prototype.hasOwnProperty.call(config.fields, field)) throw new Error('This field cannot be changed: ' + field);
        const kind = config.fields[field];
        validateField(table, field, value, kind);
        if (record[field] !== value) changes.push({ field, kind, oldValue: record[field] ?? null, newValue: value as string | number | null });
      }
    }
    if (!changes.length) return;
    for (const change of changes) {
      const audit: EntryAuditRow = {
        id: newId('audit'), change_group_id: group, book_table: table, entry_id: id, entry_owner_id: ownerId,
        field_name: change.field, value_kind: change.kind,
        old_value_json: JSON.stringify(change.oldValue), new_value_json: JSON.stringify(change.newValue),
        actor_id: actor.id, actor_name: actor.name, changed_at: now, action,
      };
      const keys = Object.keys(audit);
      await db.runAsync(`INSERT INTO entry_audit (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(audit));
      await enqueue(db, 'entry_audit', audit.id, 'create', audit, `users/${ownerId}/entry_audit/${audit.id}`, now);
    }
    const payload: RecordRow = Object.fromEntries(changes.map(c => [c.field, c.newValue]));
    if (action === 'deleted') {
      payload[config.deletedAt] = now;
      for (const [field, kind] of Object.entries(config.deletionAliases || {})) payload[field] = kind === 'flag' ? 1 : now;
    }
    for (const field of config.timestamps) payload[field] = now;
    // Derived columns last among the record's own fields, so they see the edited values
    // and cannot be overwritten by them. Never audited: see BookConfig.derive.
    if (config.derive && action !== 'deleted') {
      Object.assign(payload, await config.derive(db, { ...record, ...payload }, new Set(changes.map(c => c.field))));
    }
    Object.assign(payload, config.syncState);
    payload.firestore_path = `users/${ownerId}/${table}/${id}`;
    await db.runAsync(`UPDATE ${table} SET ${Object.keys(payload).map(k => k + ' = ?').join(',')} WHERE id = ?`, [...Object.values(payload), id]);
    // Soft deletion is an update remotely too; this never deletes a document.
    await enqueue(db, table, id, 'update', { ...record, ...payload }, String(payload.firestore_path), now);
    queued = true;
  });
  // Network is after commit; a network failure must not turn a saved edit into an error.
  if (queued) {
    try {
      const { useSyncStore } = await import('../../store/useSyncStore');
      const sync = useSyncStore.getState();
      if (sync.isOnline) void sync.processSyncQueue().catch(() => undefined);
      else sync.incrementPendingCount();
    } catch (error) { if (__DEV__) console.warn('Entry saved; sync will retry later.', error); }
  }
}

export async function getEntryHistory(table: string, id: string): Promise<{ entry: RecordRow; rows: EntryAuditRow[] }> {
  const db = await getDatabase();
  const actor = await currentActor(db);
  const entry = await ownedRecord(db, table, id, actor);
  const rows = await db.getAllAsync<EntryAuditRow>('SELECT * FROM entry_audit WHERE book_table = ? AND entry_id = ? ORDER BY changed_at, rowid', [table, id]);
  return { entry, rows };
}

export async function getVisibleEntryAudit(): Promise<EntryAuditRow[]> {
  const db = await getDatabase();
  const actor = await currentActor(db);
  const visible: EntryAuditRow[] = [];
  for (const [table, config] of Object.entries(books)) {
    const rows = await db.getAllAsync<EntryAuditRow & { stored_owner: string }>(`SELECT a.*, e.${config.owner} AS stored_owner FROM entry_audit a
      JOIN ${table} e ON e.id = a.entry_id WHERE a.book_table = ? ORDER BY a.changed_at DESC, a.rowid DESC`, [table]);
    const access = new Map<string, boolean>();
    for (const row of rows) {
      if (!access.has(row.stored_owner)) access.set(row.stored_owner, await mayAccess(db, actor, row.stored_owner));
      if (access.get(row.stored_owner)) visible.push(row);
    }
  }
  return visible.sort((a, b) => b.changed_at.localeCompare(a.changed_at));
}

// Remote imports cannot overwrite existing entries without verified remote history.
export async function assertAuditedRemoteUnchanged(db: SQLiteDatabase, table: string, id: string, remote: Record<string, unknown>): Promise<void> {
  const config = configFor(table);
  const local = await db.getFirstAsync<RecordRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!local) return;
  for (const field of [config.owner, ...Object.keys(config.fields), 'party_name_ur', config.deleted, config.deletedAt, 'is_deleted', 'deleted_at']) {
    if (Object.prototype.hasOwnProperty.call(remote, field) && remote[field] !== local[field]) {
      throw new Error('Khata sync conflict: remote changes require verified entry history. Local entry was kept.');
    }
  }
}
