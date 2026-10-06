export interface StaffRecord {
  id: string;
  user_id: string;
  /**
   * v36. The login (users.id) this profile belongs to. NULL for rows created before
   * unified Add Staff, and for a SUB-STAFF record, which has no login at all.
   */
  linked_user_id?: string | null;
  name_en: string;
  name_ur?: string;
  /**
   * Optional since v43. With a login this is the normalised login phone (the username);
   * for a sub-staff record it is contact details that may simply not be known.
   */
  phone?: string | null;
  email?: string;
  role: string;
  joining_date: string; // ISO format
  area: string;
  /** Optional since v37. */
  business_type?: string | null;
  address?: string;
  picture_url?: string;
  /** v35. Durable copy under FileSystem.documentDirectory/staff_photos — never the picker's cache URI. */
  photo_local_path?: string | null;
  /** v35. Stays NULL until Firebase Storage upload is wired. */
  photo_remote_url?: string | null;
  document_urls?: string[];
  status: 'active' | 'inactive';
  monthly_salary?: number;     // integer paisa (0 = not set)
  created_at: string;
  updated_at?: string;
  synced: 0 | 1;
  is_deleted: 0 | 1;
  deleted_at?: string;
}
