export interface StockItem {
  id: string;
  user_id: string;
  name_en: string;
  name_ur?: string;
  category: string;
  unit: string;
  quantity: number;
  purchase_price: number;      // integer paisa
  sale_price: number;          // integer paisa
  barcode?: string;
  picture_url?: string;
  location?: string;
  low_stock_threshold: number;
  created_at: string;
  updated_at?: string;
  synced: 0 | 1;
  is_deleted: 0 | 1;
  deleted_at?: string;
}

export interface StockMovement {
  id: string;
  item_id: string;
  change: number; // +ve for in, -ve for out
  reason: 'purchase' | 'sale' | 'adjustment' | 'customer_return';
  date: string; // ISO format
  cost_per_unit?: number;      // integer paisa
  sale_price_unit?: number;    // integer paisa
  user_id: string;
  note?: string;
  synced: 0 | 1;
  is_deleted: 0 | 1;
}
