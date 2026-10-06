import type { CurrencyCode } from '../utils/currency';
export interface BillItem {
  id: string;
  bill_id: string;
  item_id?: string;
  item_name: string;
  quantity: number;
  returned_quantity?: number;
  unit_price: number;          // integer paisa
  line_total: number;          // integer paisa
  is_deleted: 0 | 1;
}

export interface Bill {
  id: string;
  user_id: string;
  bill_no: number;
  customer_id: string;
  party_name: string;
  party_name_ur?: string;
  party_phone?: string;
  bill_date: string; // ISO
  items: BillItem[];
  subtotal: number;            // integer paisa
  discount_pct: number;        // percentage — NOT money, never converted
  discount_amount?: number;    // integer paisa
  tax_amount: number;          // integer paisa
  total: number;               // integer paisa
  /**
   * Currency this bill was ENTERED in (v41). Subtotal, total, paid, due and every line
   * are in this currency's minor unit, and the printed invoice prints it. Never converted.
   */
  currency?: CurrencyCode;
  paid: number;                // integer paisa
  due: number;                 // integer paisa
  status: 'paid' | 'unpaid' | 'partial' | 'draft' | 'hold';
  payment_method?: string; // 'cash', 'khata', 'bank', or JSON array of methods
  is_draft?: 0 | 1;
  is_hold?: 0 | 1;
  notes?: string;
  attachment_urls?: string[];
  voice_note_url?: string;
  created_at: string;
  updated_at?: string;
  synced: 0 | 1;
  is_deleted: 0 | 1;
  deleted_at?: string;
}
