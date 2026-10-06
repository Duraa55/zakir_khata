import type { SQLiteDatabase } from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import { persistAttachment, isDurable, AttachmentKind } from '../../utils/durableFile';

/**
 * One-time repair for attachments saved BEFORE durableFile existed, when the picker's
 * cache path was stored as-is. Run by migration v39, on a connection that is already
 * inside its transaction.
 *
 *   - already in permanent storage  → left alone
 *   - still in the cache, file there → copied to permanent storage, row repointed
 *   - file already gone              → row and its original path kept EXACTLY as they
 *                                      are, and the loss recorded in lost_attachments
 *
 * No row is ever deleted. Re-running is a no-op: repaired paths are durable and are
 * skipped, and a loss is recorded once (unique on table, record and path).
 *
 * Paths are never logged — a filename can carry a customer's name or number.
 */

type Target = { table: string; column: string; kind: AttachmentKind; list: boolean };

/** Every column that stores a picked file. `list` columns hold a JSON array of paths. */
export const ATTACHMENT_TARGETS: readonly Target[] = [
  { table: 'cashbook', column: 'attachment_url', kind: 'cash', list: false },
  { table: 'bills', column: 'attachment_urls', kind: 'bill', list: true },
  { table: 'expenses', column: 'receipt_url', kind: 'expense', list: false },
  { table: 'stock_items', column: 'picture_url', kind: 'item', list: false },
  { table: 'users', column: 'pictureUrl', kind: 'profile', list: false },
];

/** What the old Add Staff placeholder invented instead of picking a file — no file behind it. */
export const PLACEHOLDER_STAFF_DOC = /^doc_\d+\.pdf$/;

export interface RepairReport { copied: number; lost: number; placeholdersRemoved: number }

const isRemote = (path: string) => /^https?:\/\//i.test(path);

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await FileSystem.getInfoAsync(path)).exists;
  } catch {
    // A malformed or unreadable path is, for our purposes, a file that is gone.
    return false;
  }
}

async function recordLoss(db: SQLiteDatabase, table: string, recordId: string, path: string): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO lost_attachments (id, table_name, record_id, original_path, detected_at)
     VALUES (?, ?, ?, ?, ?)`,
    [`lost_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, table, recordId, path, new Date().toISOString()]
  );
}

async function columnExists(db: SQLiteDatabase, table: string, column: string): Promise<boolean> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === column);
}

export async function repairAttachmentsIn(db: SQLiteDatabase): Promise<RepairReport> {
  const report: RepairReport = { copied: 0, lost: 0, placeholdersRemoved: 0 };

  for (const t of ATTACHMENT_TARGETS) {
    // An older database may predate a column; there is nothing to repair there.
    if (!await columnExists(db, t.table, t.column)) continue;
    const rows = await db.getAllAsync<{ id: string; value: string }>(
      `SELECT id, ${t.column} AS value FROM ${t.table} WHERE ${t.column} IS NOT NULL AND ${t.column} != ''`
    );

    for (const row of rows) {
      let paths: string[];
      if (t.list) {
        try {
          const parsed = JSON.parse(row.value);
          if (!Array.isArray(parsed)) continue;
          paths = parsed.filter((p: unknown): p is string => typeof p === 'string');
        } catch {
          continue; // Not JSON we wrote — leave it exactly as it is.
        }
      } else {
        paths = [row.value];
      }

      let changed = false;
      const next: string[] = [];
      for (const path of paths) {
        if (isDurable(path) || isRemote(path)) { next.push(path); continue; }
        if (await fileExists(path)) {
          next.push(await persistAttachment(t.kind, path));
          report.copied++;
          changed = true;
        } else {
          next.push(path); // kept, never dropped: the row still says what was attached
          await recordLoss(db, t.table, row.id, path);
          report.lost++;
        }
      }

      if (changed) {
        // Device-local repair: the path means something only on this phone, so it is
        // not queued for sync (the cloud never held a usable copy of these files).
        await db.runAsync(
          `UPDATE ${t.table} SET ${t.column} = ? WHERE id = ?`,
          [t.list ? JSON.stringify(next) : next[0], row.id]
        );
      }
    }
  }

  // The old Add Staff placeholder stored invented names like "doc_1726….pdf". Remove only
  // those entries; every real document, and every staff row, stays.
  if (await columnExists(db, 'staff_records', 'document_urls')) {
    const staff = await db.getAllAsync<{ id: string; docs: string }>(
      `SELECT id, document_urls AS docs FROM staff_records WHERE document_urls IS NOT NULL AND document_urls != ''`
    );
    for (const s of staff) {
      let docs: unknown;
      try { docs = JSON.parse(s.docs); } catch { continue; }
      if (!Array.isArray(docs)) continue;
      const kept = docs.filter(d => !(typeof d === 'string' && PLACEHOLDER_STAFF_DOC.test(d)));
      if (kept.length === docs.length) continue;
      report.placeholdersRemoved += docs.length - kept.length;
      await db.runAsync(
        'UPDATE staff_records SET document_urls = ? WHERE id = ?',
        [kept.length ? JSON.stringify(kept) : null, s.id]
      );
    }
  }

  return report;
}
