import { getDatabase } from './db';
import { createUser, hashPassword } from './userDb';

export const seedDatabase = async (): Promise<void> => {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM users WHERE phone = ?', ['03000000000']);
  if ((row?.count ?? 0) > 0) return;

  // createUser(name, phone, password, role, businessName, parentId, name_ur, businessType, area)
  // Only the admin. Staff, sub-staff and every entry are created live in the app —
  // no demo people or demo money ship in a real install.
  await createUser('Admin', '03000000000', 'Admin@12345', 'admin', 'admin', undefined, undefined, undefined, undefined, 'Bahawalpur');
};

// Seed test admin account on first app launch
export async function seedTestUsers() {
  const db = await getDatabase();
  
  // Check if test admin already exists
  const existing = await db.getFirstAsync(
    'SELECT * FROM users WHERE phone = ?',
    ['03339999999']
  );
  
  if (!existing) {
    // Create test admin
    await db.runAsync(
      `INSERT INTO users (id, name, phone, passwordHash, role, account_level, businessName, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'test-admin-001',
        'AL-REEF Admin',
        '03339999999',
        await hashPassword('admin123'),
        'admin',
        'admin',
        'AL-REEF',
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );
  }
}
