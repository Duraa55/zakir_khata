import { create } from 'zustand';
import { StaffRecord } from '../types/staff.types';
import { 
  getStaffRecords, 
  getStaffStats 
} from '../services/database/staffDb';
import { createStaffMember, NewStaffInput } from '../services/database/managedAccountDb';

interface StaffStore {
  staff: StaffRecord[];
  loading: boolean;
  error: string | null;
  stats: { total: number; active: number; inactive: number };

  fetchStaff: (userId: string) => Promise<void>;
/**
   * Creates the staff member's login AND their staff_record together, linked.
   * Resolves to the created record, so the caller has its id (e.g. to file the staff photo under it).
   */
  addStaff: (input: NewStaffInput) => Promise<StaffRecord>;
  loadStats: (userId: string) => Promise<void>;
}

export const useStaffStore = create<StaffStore>((set) => ({
  staff: [],
  loading: false,
  error: null,
  stats: { total: 0, active: 0, inactive: 0 },

  fetchStaff: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const staff = await getStaffRecords(userId);
      set({ staff, loading: false });
    } catch (err) {
      if (__DEV__) console.error(err);
      set({ error: 'Failed to fetch staff', loading: false });
    }
  },

  addStaff: async (input) => {
    try {
      const { staff: newStaff } = await createStaffMember(input);
      set(state => ({ staff: [newStaff, ...state.staff] }));
      return newStaff;
    } catch (err) {
      if (__DEV__) console.error(err);
      throw err;
    }
  },

  loadStats: async (userId: string) => {
    try {
      const stats = await getStaffStats(userId);
      set({ stats });
    } catch (err) {
      if (__DEV__) console.error(err);
    }
  }
}));
