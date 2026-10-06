import { getDatabase } from './db';
import { writeWithSync } from './syncHelpers';
import { todayDate } from '../../utils/dates';

export interface StaffAttendance {
  id: string;
  staff_id: string;
  date: string;
  clock_in: string;
  clock_out?: string | null;
  status: 'present' | 'absent' | 'half_day';
  synced: number;
  is_deleted: number;
}

export const clockIn = async (
  userId: string,
  staffId: string,
  status: 'present' | 'absent' | 'half_day' = 'present'
): Promise<string> => {
  const id = `att_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = new Date().toISOString();
  // The LOCAL day (PKT), not the UTC one — before 5 AM the UTC date is still yesterday.
  const date = todayDate();

  const data = {
    id, staff_id: staffId, date, clock_in: now, clock_out: null, status, is_deleted: 0
  };

  await writeWithSync({
    tableName: 'staff_attendance',
    recordId: id,
    operation: 'create',
    data,
    firestorePath: `users/${userId}/attendance/${id}`,
    userId
  });

  return id;
};

export const clockOut = async (
  id: string,
  userId: string
): Promise<void> => {
  const now = new Date().toISOString();
  
  await writeWithSync({
    tableName: 'staff_attendance',
    recordId: id,
    operation: 'update',
    data: { clock_out: now },
    firestorePath: `users/${userId}/attendance/${id}`,
    userId
  });
};

export const getAttendanceForStaff = async (staffId: string): Promise<StaffAttendance[]> => {
  const db = await getDatabase();
  return db.getAllAsync<StaffAttendance>(
    'SELECT * FROM staff_attendance WHERE staff_id = ? AND is_deleted = 0 ORDER BY date DESC, clock_in DESC',
    [staffId]
  );
};

export const getTodayAttendanceForUser = async (userId: string): Promise<StaffAttendance[]> => {
  const db = await getDatabase();
  const today = todayDate();
  return db.getAllAsync<StaffAttendance>(
    `SELECT a.* FROM staff_attendance a
     JOIN staff_records s ON a.staff_id = s.id
     WHERE s.user_id = ? AND a.date = ? AND a.is_deleted = 0
     ORDER BY a.clock_in DESC`,
    [userId, today]
  );
};
