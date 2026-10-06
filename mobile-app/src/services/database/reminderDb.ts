import { getDatabase } from './db';
import { writeWithSync } from './syncHelpers';
import { todayDate } from '../../utils/dates';

export interface Reminder {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  type: 'payment' | 'rent' | 'utility' | 'low_stock' | 'invoice' | 'backup';
  due_date: string;
  status: 'pending' | 'completed';
  synced: number;
  is_deleted: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export const addReminder = async (
  reminder: Omit<Reminder, 'id' | 'created_at' | 'updated_at' | 'synced' | 'is_deleted' | 'deleted_at' | 'status'>
): Promise<Reminder> => {
  const id = `rem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = new Date().toISOString();

  const data = {
    ...reminder,
    id,
    status: 'pending',
    is_deleted: 0,
    deleted_at: null,
  };

  await writeWithSync({
    tableName: 'reminders',
    recordId: id,
    operation: 'create',
    data,
    firestorePath: `users/${reminder.user_id}/reminders/${id}`,
    userId: reminder.user_id
  });

  return {
    ...data,
    created_at: now,
    updated_at: now,
    synced: 0,
  } as Reminder;
};

export const updateReminderStatus = async (
  id: string,
  userId: string,
  status: 'pending' | 'completed'
): Promise<void> => {
  await writeWithSync({
    tableName: 'reminders',
    recordId: id,
    operation: 'update',
    data: { status },
    firestorePath: `users/${userId}/reminders/${id}`,
    userId
  });
};

export const deleteReminder = async (id: string, userId: string): Promise<void> => {
  await writeWithSync({
    tableName: 'reminders',
    recordId: id,
    operation: 'delete',
    data: { is_deleted: 1 },
    firestorePath: `users/${userId}/reminders/${id}`,
    userId
  });
};

export const getReminders = async (
  userId: string,
  statusFilter?: 'pending' | 'completed'
): Promise<Reminder[]> => {
  const db = await getDatabase();
  
  let query = `
    SELECT * FROM reminders 
    WHERE user_id = ? 
      AND is_deleted = 0
  `;
  const params: any[] = [userId];

  if (statusFilter) {
    query += ' AND status = ?';
    params.push(statusFilter);
  }

  query += ' ORDER BY due_date ASC';

  return db.getAllAsync<Reminder>(query, params);
};

export const getTodayPendingRemindersCount = async (userId: string): Promise<number> => {
  const db = await getDatabase();
  const today = todayDate();

  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM reminders 
     WHERE user_id = ? 
       AND is_deleted = 0
       AND status = 'pending'
       AND date(due_date) <= date(?)`,
    [userId, today]
  );
  
  return result?.count || 0;
};
