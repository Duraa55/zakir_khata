export interface ActivityLog {
  id: string;
  user_id: string;
  user_name: string;
  action: 'create' | 'update' | 'delete' | 'login' | 'mark_attendance';
  entity_type: 'cash' | 'stock' | 'bill' | 'staff' | 'expense' | 'auth' | 'supplier';
  entity_id?: string;
  description: string;
  amount?: number;
  visible_to: string[]; // array of user ids who can view this
  timestamp: string; // ISO String
}
