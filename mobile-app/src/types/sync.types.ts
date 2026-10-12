export interface SyncQueueItem {
  id: string;
  table_name: string;
  record_id: string;
  operation: 'create' | 'update' | 'delete';
  payload: string;              // JSON string
  firestore_path: string;
  retry_count: number;
  last_attempt_at?: string;
  status: 'pending' | 'syncing' | 'failed' | 'completed';
  error_message?: string;
  created_at: string;
}

export interface SyncStore {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  lastSyncedAt: string | null;
  isSyncing: boolean;
  /**
   * Remote changes the LAST PULL refused — because this device had unsent work of its own,
   * or an audited entry disagreed. Shown in the Sync Centre: a silently refused edit is
   * what gets rediscovered weeks later as "sync is broken". The durable per-table figures
   * live in `sync_pull` (pullCursor.pullTotals); this is the last run's number.
   */
  keptOutCount: number;
  /** The team is not fully known, so pull refused to run rather than drop and advance past. */
  pullBlocked: boolean;

  setOnlineStatus: (status: boolean) => void;
  setPendingCount: (count: number) => void;
  incrementPendingCount: () => void;
  processSyncQueue: () => Promise<void>;
  batchProcessSyncQueue: () => Promise<void>;
  pullRemoteChanges: (userId: string) => Promise<void>;
  retryFailedItems: () => Promise<void>;
  getFailedItems: () => Promise<SyncQueueItem[]>;
}

export interface WriteOptions {
  tableName: string;
  recordId: string;
  operation: 'create' | 'update' | 'delete';
  data: Record<string, any>;
  firestorePath: string;
  userId: string;
}
