import { create } from 'zustand';
import { Supplier, SupplierPayment, SupplierLedgerEntry } from '../types/supplier.types';
import {
  getSuppliers, getSupplierById, addSupplier, updateSupplier, deleteSupplier,
  addSupplierPayment, getSupplierPayments, getSupplierLedger, getOutstandingPayables
} from '../services/database/supplierDb';

interface SupplierState {
  suppliers: Supplier[];
  selectedSupplier: Supplier | null;
  ledger: SupplierLedgerEntry[];
  payments: SupplierPayment[];
  outstandingPayables: Array<{ supplier_id: string; supplier_name: string; outstanding: number; invoice_count: number }>;
  loading: boolean;
  error: string | null;

  // Actions
  loadSuppliers: (userId: string) => Promise<void>;
  loadSupplierById: (id: string) => Promise<void>;
  loadSupplierLedger: (supplierId: string) => Promise<void>;
  loadOutstandingPayables: (userId: string) => Promise<void>;
  addSupplier: (
    userId: string, name: string, phone?: string, business_name?: string,
    address?: string, email?: string, city?: string, notes?: string
  ) => Promise<string>;
  updateSupplier: (id: string, userId: string, updates: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: string, userId: string) => Promise<void>;
  recordPayment: (
    userId: string, supplierId: string, amount: number, paymentDate: string,
    paymentMethod: SupplierPayment['payment_method'], invoiceId?: string,
    reference?: string, notes?: string
  ) => Promise<SupplierPayment>;
  clearSelected: () => void;
}

export const useSupplierStore = create<SupplierState>((set, get) => ({
  suppliers: [],
  selectedSupplier: null,
  ledger: [],
  payments: [],
  outstandingPayables: [],
  loading: false,
  error: null,

  loadSuppliers: async (userId) => {
    set({ loading: true, error: null });
    try {
      const suppliers = await getSuppliers(userId);
      set({ suppliers, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  loadSupplierById: async (id) => {
    set({ loading: true });
    try {
      const supplier = await getSupplierById(id);
      const payments = await getSupplierPayments(id);
      set({ selectedSupplier: supplier, payments, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  loadSupplierLedger: async (supplierId) => {
    set({ loading: true });
    try {
      const ledger = await getSupplierLedger(supplierId);
      set({ ledger, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  loadOutstandingPayables: async (userId) => {
    set({ loading: true });
    try {
      const outstandingPayables = await getOutstandingPayables(userId);
      set({ outstandingPayables, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  addSupplier: async (userId, name, phone, business_name, address, email, city, notes) => {
    const id = await addSupplier(userId, name, phone, business_name, address, email, city, notes);
    await get().loadSuppliers(userId);
    return id;
  },

  updateSupplier: async (id, userId, updates) => {
    await updateSupplier(id, userId, updates as any);
    await get().loadSuppliers(userId);
  },

  deleteSupplier: async (id, userId) => {
    await deleteSupplier(id, userId);
    set(state => ({ suppliers: state.suppliers.filter(s => s.id !== id) }));
  },

  recordPayment: async (userId, supplierId, amount, paymentDate, paymentMethod, invoiceId, reference, notes) => {
    const payment = await addSupplierPayment(userId, supplierId, amount, paymentDate, paymentMethod, invoiceId, reference, notes);
    // Reload ledger and supplier details
    await Promise.all([
      get().loadSupplierLedger(supplierId),
      get().loadSupplierById(supplierId),
      get().loadSuppliers(userId),
    ]);
    return payment;
  },

  clearSelected: () => set({ selectedSupplier: null, ledger: [], payments: [] }),
}));

// Atomic selectors for performance
export const useSupplierList = () => useSupplierStore(s => s.suppliers);
export const useSelectedSupplier = () => useSupplierStore(s => s.selectedSupplier);
export const useSupplierLedger = () => useSupplierStore(s => s.ledger);
export const useOutstandingPayables = () => useSupplierStore(s => s.outstandingPayables);
export const useSupplierLoading = () => useSupplierStore(s => s.loading);
