import { create } from 'zustand';
import { SyncStore } from '../types/sync.types';
import { processSyncQueue, batchProcessSyncQueue } from '../services/syncProcessor';
import { pullRemoteChanges, type PullResult } from '../services/firebase/firebasePull';

export const useSyncStore = create<SyncStore>((set, get) => ({
  isOnline: true,
  pendingCount: 0,
  failedCount: 0,
  lastSyncedAt: null,
  isSyncing: false,
  keptOutCount: 0,
  pullBlocked: false,

  setOnlineStatus: (status: boolean) => set({ isOnline: status }),
  
  setPendingCount: (count: number) => set({ pendingCount: count }),
  
  incrementPendingCount: () => set((state) => ({ pendingCount: state.pendingCount + 1 })),

  processSyncQueue: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true });
    try {
      await processSyncQueue();
    } finally {
      set({ isSyncing: false });
    }
  },

  batchProcessSyncQueue: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true });
    try {
      await batchProcessSyncQueue();
    } finally {
      set({ isSyncing: false });
    }
  },

  /**
   * Pull, and keep the one number the Sync Centre has to show: how many remote changes this
   * device REFUSED. The pull itself drains the push queue first and gates on the team being
   * fully known — see services/firebase/firebasePull.ts.
   */
  pullRemoteChanges: async (userId: string) => {
    if (get().isSyncing) return;
    set({ isSyncing: true });
    try {
      const result: PullResult = await pullRemoteChanges(userId);
      if (result.status === 'done') {
        set({ keptOutCount: result.keptOut, lastSyncedAt: new Date().toISOString() });
      } else if (result.status === 'blocked') {
        // NOT a silent no-op: the Sync Centre says the team is not fully known, because
        // "nothing came down" and "nothing could safely come down" are different states.
        set({ pullBlocked: true });
      }
    } finally {
      set({ isSyncing: false });
    }
  },

  retryFailedItems: async () => {
    // handled inside processSyncQueue usually, but can be explicit
    await get().processSyncQueue();
  },

  getFailedItems: async () => {
    // placeholder, real implementation accesses SQLite
    return [];
  }
}));
