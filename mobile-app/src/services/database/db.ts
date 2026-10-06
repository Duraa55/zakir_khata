import * as SQLite from 'expo-sqlite';
import { classifyAccountLevel, expectedAccountLevel, AccountLevel, LevelNode, LevelReason } from './accountLevel';
import { ENTRY_AUDIT_V31_SQL } from './entryAuditMigration';
import { DAY_CLOSING_V33_SQL } from './dayClosingMigration';
import { repairAttachmentsIn } from './attachmentRepair';
// NOTE: seedTestUsers is called from AppNavigator after getDatabase() to avoid
// a circular dependency (db.ts → userDb.ts → db.ts).

const DB_NAME = 'digikhata_v3.db';

let db: SQLite.SQLiteDatabase | null = null;

export const getDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  if (db) return db;
  if (__DEV__) console.log('[DB] Opening SQLite database...');
  db = await SQLite.openDatabaseAsync(DB_NAME);
  await initializeDatabase(db);
  if (__DEV__) console.log('[DB] Database tables and migrations complete.');
  return db;
};

async function initializeDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync('PRAGMA journal_mode = WAL');

  // Create tables using latest schema. IF NOT EXISTS means existing tables are untouched here;
  // the migration below handles upgrading them.
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ur TEXT,
      phone TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT CHECK(role IN ('admin','staff')) NOT NULL,
      account_level TEXT CHECK(account_level IN ('admin','staff','substaff')), -- explicit staff/sub-staff level (v32); role checks only, never scoping
      businessName TEXT,
      businessType TEXT,
      area TEXT,
      pictureUrl TEXT,
      parentId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (parentId) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      partyName TEXT NOT NULL,
      amount_paisa INTEGER NOT NULL CHECK(amount_paisa > 0),
      type TEXT CHECK(type IN ('lena','dena')) NOT NULL,
      notes TEXT,
      date TEXT NOT NULL,
      syncStatus TEXT CHECK(syncStatus IN ('pending','synced')) DEFAULT 'pending',
      isDeleted INTEGER DEFAULT 0,
      deletedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cashbook (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_paisa INTEGER NOT NULL CHECK(amount_paisa > 0),
      direction TEXT CHECK(direction IN ('in','out')) NOT NULL,
      date TEXT NOT NULL,
      syncStatus TEXT CHECK(syncStatus IN ('pending','synced')) DEFAULT 'pending',
      isDeleted INTEGER DEFAULT 0,
      deletedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      attachment_url TEXT,
      category TEXT,
      note TEXT,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0), -- integer paisa (see migration v29)
      description TEXT NOT NULL,
      note TEXT,
      receipt_url TEXT,
      expense_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      synced INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      firestore_path TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_userId ON transactions(userId);
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_cashbook_userId ON cashbook(userId);
    CREATE INDEX IF NOT EXISTS idx_cashbook_date ON cashbook(date);
    CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at);

    CREATE TABLE IF NOT EXISTS stock_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ur TEXT,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity INTEGER DEFAULT 0,
      purchase_price REAL NOT NULL, -- integer paisa (see migration v29)
      sale_price REAL NOT NULL, -- integer paisa (see migration v29)
      barcode TEXT,
      picture_url TEXT,
      location TEXT,
      low_stock_threshold INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      synced INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      change INTEGER NOT NULL,
      reason TEXT CHECK(reason IN ('purchase','sale','adjustment','customer_return')) NOT NULL,
      date TEXT NOT NULL,
      cost_per_unit REAL, -- integer paisa (see migration v29)
      sale_price_unit REAL, -- integer paisa (see migration v29)
      user_id TEXT NOT NULL,
      note TEXT,
      synced INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      FOREIGN KEY (item_id) REFERENCES stock_items(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_stock_items_user_id ON stock_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_item_id ON stock_movements(item_id);

    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bill_no INTEGER NOT NULL,
      customer_id TEXT NOT NULL,
      party_name TEXT NOT NULL,
      party_phone TEXT,
      bill_date TEXT NOT NULL,
      subtotal REAL NOT NULL, -- integer paisa (see migration v29)
      discount_pct REAL DEFAULT 0, -- percentage, NOT money — never converted
      discount_amount REAL DEFAULT 0, -- integer paisa (see migration v29)
      tax_amount REAL DEFAULT 0, -- integer paisa (see migration v29)
      total REAL NOT NULL, -- integer paisa (see migration v29)
      paid REAL DEFAULT 0, -- integer paisa (see migration v29)
      due REAL NOT NULL, -- integer paisa (see migration v29)
      status TEXT CHECK(status IN ('paid','unpaid','partial')) NOT NULL,
      notes TEXT,
      attachment_urls TEXT,
      voice_note_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      synced INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bill_items (
      id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL,
      item_id TEXT,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL, -- integer paisa (see migration v29)
      line_total REAL NOT NULL, -- integer paisa (see migration v29)
      is_deleted INTEGER DEFAULT 0,
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bills_user_id ON bills(user_id);
    CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(bill_date);
    CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id);

    CREATE TABLE IF NOT EXISTS staff_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ur TEXT,
      phone TEXT NOT NULL, -- relaxed to nullable by migration v43, not here (see v43)
      email TEXT,
      role TEXT NOT NULL,
      joining_date TEXT NOT NULL,
      area TEXT NOT NULL,
      business_type TEXT NOT NULL,
      address TEXT,
      picture_url TEXT,
      document_urls TEXT,
      status TEXT CHECK(status IN ('active','inactive')) DEFAULT 'active',
      monthly_salary REAL DEFAULT 0, -- integer paisa (see migration v29)
      created_at TEXT NOT NULL,
      updated_at TEXT,
      synced INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_staff_user_id ON staff_records(user_id);



    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      description TEXT NOT NULL,
      amount REAL, -- integer paisa (see migration v29)
      visible_to TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp);

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      name_display_mode TEXT DEFAULT 'en',
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'completed')) DEFAULT 'pending',
      synced INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      firestore_path TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      firestore_path TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0,
      last_attempt_at TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      table_name TEXT PRIMARY KEY,
      last_synced_at TEXT,
      last_pulled_at TEXT,
      pending_count INTEGER DEFAULT 0
    );

    -- Also created by migration v38. Listed here as well, like every other table, so a
    -- database whose migration chain stalled still opens with a usable table instead of
    -- failing at "no such table" deep inside the salary screen.
    CREATE TABLE IF NOT EXISTS salary_month_closings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      month TEXT NOT NULL,
      closed_at TEXT NOT NULL,
      closed_by TEXT NOT NULL,
      closed_by_name TEXT NOT NULL,
      salary_paisa INTEGER NOT NULL,
      opening_advance_paisa INTEGER NOT NULL,
      paid_paisa INTEGER NOT NULL,
      due_paisa INTEGER NOT NULL,
      remaining_paisa INTEGER NOT NULL,
      carry_advance_paisa INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      synced INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      firestore_path TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (staff_id) REFERENCES staff_records(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_salary_closing_staff ON salary_month_closings(staff_id, month);
    CREATE INDEX IF NOT EXISTS idx_salary_closing_user ON salary_month_closings(user_id);

    -- Also created by migration v39: an attachment whose file had already vanished from
    -- the picker cache before durable storage existed. The row keeps its path; this
    -- only records the loss.
    CREATE TABLE IF NOT EXISTS lost_attachments (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      original_path TEXT NOT NULL,
      detected_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_lost_attachment_unique
      ON lost_attachments(table_name, record_id, original_path);
  `);

  await runMigrations(database);
  // seedTestUsers() is intentionally NOT called here — it is called in AppNavigator
  // after getDatabase() returns, to avoid circular imports with userDb.ts.
}

async function addColumnIfNotExists(db: SQLite.SQLiteDatabase, table: string, column: string, typeDef: string) {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!cols.some(c => c.name === column)) {
    await db.runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
  }
}

async function runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  try {
    await migrateFrom(database);
  } catch (err: any) {
    // A half-migrated database is the worst outcome: the app keeps running and fails
    // later somewhere unrelated ("no such table: …"). Say which version stalled, and
    // let it surface — never swallow it here.
    const stalled = (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
    const message = `Schema migration stalled at v${stalled}: ${err?.message || err}`;
    if (__DEV__) console.error('[DB]', message);
    throw new Error(message);
  }
}

async function migrateFrom(database: SQLite.SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  if (__DEV__) console.log('[DB] Current schema version:', version);

  if (version < 1) {
    // Check if old schema (has float `amount` column instead of integer `amount_paisa`)
    const txCols = await database.getAllAsync<{ name: string }>('PRAGMA table_info(transactions)');
    const hasOldAmount = txCols.some(c => c.name === 'amount');

    if (hasOldAmount) {
      // Rebuild transactions: float amount → integer amount_paisa, add soft-delete columns
      await database.withTransactionAsync(async () => {
        await database.runAsync(`
          CREATE TABLE transactions_v2 (
            id TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            partyName TEXT NOT NULL,
            amount_paisa INTEGER NOT NULL CHECK(amount_paisa > 0),
            type TEXT CHECK(type IN ('lena','dena')) NOT NULL,
            notes TEXT,
            date TEXT NOT NULL,
            syncStatus TEXT CHECK(syncStatus IN ('pending','synced')) DEFAULT 'pending',
            isDeleted INTEGER DEFAULT 0,
            deletedAt TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
          )
        `);
        await database.runAsync(`
          INSERT INTO transactions_v2
            (id, userId, partyName, amount_paisa, type, notes, date, syncStatus, isDeleted, deletedAt, createdAt, updatedAt)
          SELECT id, userId, partyName, CAST(ROUND(amount * 100) AS INTEGER),
                 type, notes, date, syncStatus, 0, NULL, createdAt, updatedAt
          FROM transactions
        `);
        await database.runAsync('DROP TABLE transactions');
        await database.runAsync('ALTER TABLE transactions_v2 RENAME TO transactions');
        await database.runAsync('CREATE INDEX IF NOT EXISTS idx_transactions_userId ON transactions(userId)');
        await database.runAsync('CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)');

        // Rebuild cashbook
        await database.runAsync(`
          CREATE TABLE cashbook_v2 (
            id TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            description TEXT NOT NULL,
            amount_paisa INTEGER NOT NULL CHECK(amount_paisa > 0),
            direction TEXT CHECK(direction IN ('in','out')) NOT NULL,
            date TEXT NOT NULL,
            syncStatus TEXT CHECK(syncStatus IN ('pending','synced')) DEFAULT 'pending',
            isDeleted INTEGER DEFAULT 0,
            deletedAt TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
          )
        `);
        await database.runAsync(`
          INSERT INTO cashbook_v2
            (id, userId, description, amount_paisa, direction, date, syncStatus, isDeleted, deletedAt, createdAt, updatedAt)
          SELECT id, userId, description, CAST(ROUND(amount * 100) AS INTEGER),
                 direction, date, syncStatus, 0, NULL, createdAt, updatedAt
          FROM cashbook
        `);
        await database.runAsync('DROP TABLE cashbook');
        await database.runAsync('ALTER TABLE cashbook_v2 RENAME TO cashbook');
        await database.runAsync('CREATE INDEX IF NOT EXISTS idx_cashbook_userId ON cashbook(userId)');
        await database.runAsync('CREATE INDEX IF NOT EXISTS idx_cashbook_date ON cashbook(date)');
      });
    }

    await database.execAsync('PRAGMA user_version = 1');
    version = 1;
  }

  if (version < 2) {
    await database.withTransactionAsync(async () => {
      const userCols = await database.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
      const hasParentId = userCols.some(c => c.name === 'parentId');
      if (!hasParentId) {
        await database.runAsync('ALTER TABLE users ADD COLUMN parentId TEXT REFERENCES users(id) ON DELETE SET NULL');
      }
    });
    await database.execAsync('PRAGMA user_version = 2');
    version = 2;
  }

  if (version < 3) {
    await database.withTransactionAsync(async () => {
      await database.runAsync('DROP TABLE IF EXISTS expenses');
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS expenses (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          amount REAL NOT NULL CHECK(amount > 0),
          description TEXT NOT NULL,
          note TEXT,
          receipt_url TEXT,
          expense_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          firestore_path TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at)');
    });
    await database.execAsync('PRAGMA user_version = 3');
    version = 3;
  }

  if (version < 4) {
    await database.withTransactionAsync(async () => {
      const userCols = await database.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
      const colNames = userCols.map(c => c.name);
      if (!colNames.includes('name_ur')) {
        await database.runAsync('ALTER TABLE users ADD COLUMN name_ur TEXT');
      }
      if (!colNames.includes('businessType')) {
        await database.runAsync('ALTER TABLE users ADD COLUMN businessType TEXT');
      }
      if (!colNames.includes('area')) {
        await database.runAsync('ALTER TABLE users ADD COLUMN area TEXT');
      }
      if (!colNames.includes('pictureUrl')) {
        await database.runAsync('ALTER TABLE users ADD COLUMN pictureUrl TEXT');
      }
    });
    await database.execAsync('PRAGMA user_version = 4');
    version = 4;
  }

  if (version < 5) {
    await database.withTransactionAsync(async () => {
      // In case they weren't created yet, create stock tables
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS stock_items (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name_en TEXT NOT NULL,
          name_ur TEXT,
          category TEXT NOT NULL,
          unit TEXT NOT NULL,
          quantity INTEGER DEFAULT 0,
          purchase_price REAL NOT NULL,
          sale_price REAL NOT NULL,
          barcode TEXT,
          picture_url TEXT,
          location TEXT,
          low_stock_threshold INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          change INTEGER NOT NULL,
          reason TEXT CHECK(reason IN ('purchase','sale','adjustment')) NOT NULL,
          date TEXT NOT NULL,
          cost_per_unit REAL,
          sale_price_unit REAL,
          user_id TEXT NOT NULL,
          note TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          FOREIGN KEY (item_id) REFERENCES stock_items(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_stock_items_user_id ON stock_items(user_id)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_stock_movements_item_id ON stock_movements(item_id)');
    });
    await database.execAsync('PRAGMA user_version = 5');
    version = 5;
  }

  if (version < 6) {
    await database.withTransactionAsync(async () => {
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS bills (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          bill_no INTEGER NOT NULL,
          customer_id TEXT NOT NULL,
          party_name TEXT NOT NULL,
          party_phone TEXT,
          bill_date TEXT NOT NULL,
          subtotal REAL NOT NULL,
          discount_pct REAL DEFAULT 0,
          discount_amount REAL DEFAULT 0,
          tax_amount REAL DEFAULT 0,
          total REAL NOT NULL,
          paid REAL DEFAULT 0,
          due REAL NOT NULL,
          status TEXT CHECK(status IN ('paid','unpaid','partial')) NOT NULL,
          notes TEXT,
          attachment_urls TEXT,
          voice_note_url TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS bill_items (
          id TEXT PRIMARY KEY,
          bill_id TEXT NOT NULL,
          item_id TEXT,
          item_name TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          unit_price REAL NOT NULL,
          line_total REAL NOT NULL,
          is_deleted INTEGER DEFAULT 0,
          FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
        )
      `);
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_bills_user_id ON bills(user_id)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(bill_date)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id)');
    });
    await database.execAsync('PRAGMA user_version = 6');
    version = 6;
  }

  if (version < 7) {
    await database.withTransactionAsync(async () => {
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS staff_records (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name_en TEXT NOT NULL,
          name_ur TEXT,
          phone TEXT NOT NULL,
          email TEXT,
          role TEXT NOT NULL,
          joining_date TEXT NOT NULL,
          area TEXT NOT NULL,
          business_type TEXT NOT NULL,
          address TEXT,
          picture_url TEXT,
          document_urls TEXT,
          status TEXT CHECK(status IN ('active','inactive')) DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_staff_user_id ON staff_records(user_id)');
    });
    await database.execAsync('PRAGMA user_version = 7');
    version = 7;
  }

  if (version < 8) {
    await database.withTransactionAsync(async () => {
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS expenses (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          amount REAL NOT NULL CHECK(amount > 0),
          description TEXT NOT NULL,
          note TEXT,
          receipt_url TEXT,
          expense_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          firestore_path TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id)');
      try {
        await database.runAsync('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)');
      } catch (e) {
        if (__DEV__) console.warn('Skipping idx_expenses_date creation in v8; column may not exist yet.');
      }
    });
    await database.execAsync('PRAGMA user_version = 8');
    version = 8;
  }

  if (version < 9) {
    await database.withTransactionAsync(async () => {
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS activities (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          user_name TEXT NOT NULL,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          description TEXT NOT NULL,
          amount REAL,
          visible_to TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp)');
    });
    await database.execAsync('PRAGMA user_version = 9');
    version = 9;
  }

  if (version < 10) {
    await database.withTransactionAsync(async () => {
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS user_settings (
          user_id TEXT PRIMARY KEY,
          name_display_mode TEXT DEFAULT 'en',
          updated_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      const txCols = await database.getAllAsync<{ name: string }>('PRAGMA table_info(transactions)');
      if (!txCols.some(c => c.name === 'party_name_ur')) {
        await database.runAsync('ALTER TABLE transactions ADD COLUMN party_name_ur TEXT');
      }

      const billsCols = await database.getAllAsync<{ name: string }>('PRAGMA table_info(bills)');
      if (!billsCols.some(c => c.name === 'party_name_ur')) {
        await database.runAsync('ALTER TABLE bills ADD COLUMN party_name_ur TEXT');
      }
    });
    await database.execAsync('PRAGMA user_version = 10');
    version = 10;
  }

  if (version < 11) {
    await database.withTransactionAsync(async () => {
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS sync_queue (
          id TEXT PRIMARY KEY,
          table_name TEXT NOT NULL,
          record_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          payload TEXT NOT NULL,
          firestore_path TEXT NOT NULL,
          retry_count INTEGER DEFAULT 0,
          last_attempt_at TEXT,
          status TEXT DEFAULT 'pending',
          error_message TEXT,
          created_at TEXT NOT NULL
        )
      `);
      
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS sync_metadata (
          table_name TEXT PRIMARY KEY,
          last_synced_at TEXT,
          last_pulled_at TEXT,
          pending_count INTEGER DEFAULT 0
        )
      `);

      const tables = [
        'users', 'transactions', 'cashbook', 'stock_items', 'stock_movements',
        'bills', 'bill_items', 'staff_records', 'expenses', 'activities', 'user_settings'
      ];

      for (const table of tables) {
        await addColumnIfNotExists(database, table, 'synced', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, table, 'is_deleted', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, table, 'deleted_at', 'TEXT');
        await addColumnIfNotExists(database, table, 'created_at', "TEXT DEFAULT CURRENT_TIMESTAMP");
        await addColumnIfNotExists(database, table, 'updated_at', 'TEXT');
        await addColumnIfNotExists(database, table, 'firestore_path', 'TEXT');
      }
    });
    await database.execAsync('PRAGMA user_version = 11');
    version = 11;
  }

  if (version < 12) {
    // Ensure expense_date column exists for installs that were created on v3–v7
    // where the expenses table was built without this column.
    await addColumnIfNotExists(database, 'expenses', 'expense_date', 'TEXT');
    await database.runAsync('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)');
    await database.execAsync('PRAGMA user_version = 12');
    version = 12;
  }

  if (version < 13) {
    await database.withTransactionAsync(async () => {
      await database.runAsync('DROP TABLE IF EXISTS expenses');
      await database.runAsync(`
        CREATE TABLE expenses (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          amount REAL NOT NULL CHECK(amount > 0),
          description TEXT NOT NULL,
          note TEXT,
          receipt_url TEXT,
          expense_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          firestore_path TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)');
    });
    await database.execAsync('PRAGMA user_version = 13');
    version = 13;
  }

  if (version < 14) {
    await database.withTransactionAsync(async () => {
      // Sometimes older schema creates stock_items and staff_records without name_en if IF NOT EXISTS triggered wrongly
      await addColumnIfNotExists(database, 'stock_items', 'name_en', 'TEXT NOT NULL DEFAULT ""');
      await addColumnIfNotExists(database, 'staff_records', 'name_en', 'TEXT NOT NULL DEFAULT ""');
    });
    await database.execAsync('PRAGMA user_version = 14');
    version = 14;
  }

  if (version < 15) {
    await database.withTransactionAsync(async () => {
      await database.runAsync(`
        CREATE TABLE IF NOT EXISTS reminders (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL,
          due_date TEXT NOT NULL,
          status TEXT CHECK(status IN ('pending', 'completed')) DEFAULT 'pending',
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status)');
    });
    await database.execAsync('PRAGMA user_version = 15');
    version = 15;
  }

  if (version < 16) {
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'reminders', 'firestore_path', 'TEXT');
    });
    await database.execAsync('PRAGMA user_version = 16');
    version = 16;
  }

  if (version < 17) {
    await database.withTransactionAsync(async () => {
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_users_name ON users(name)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_users_biz ON users(businessName)');
      
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_transactions_party ON transactions(partyName)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_cashbook_desc ON cashbook(description)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_expenses_desc ON expenses(description)');
      
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_stock_name ON stock_items(name_en)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_stock_barcode ON stock_items(barcode)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_bills_party ON bills(party_name)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_staff_name ON staff_records(name_en)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_staff_phone ON staff_records(phone)');
    });
    await database.execAsync('PRAGMA user_version = 17');
    version = 17;
  }

  if (version < 18) {
    await database.withTransactionAsync(async () => {
      // 1. Add Category to Expenses
      await addColumnIfNotExists(database, 'expenses', 'category', 'TEXT');

      // 2. Suppliers Table
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          phone TEXT,
          business_name TEXT,
          address TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);

      // 3. Staff Attendance Table
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS staff_attendance (
          id TEXT PRIMARY KEY,
          staff_id TEXT NOT NULL,
          date TEXT NOT NULL,
          clock_in TEXT NOT NULL,
          clock_out TEXT,
          status TEXT CHECK(status IN ('present','absent','half_day')) NOT NULL,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          FOREIGN KEY (staff_id) REFERENCES staff_records(id) ON DELETE CASCADE
        );
      `);
      
      // Update sync queue failing paths from bug
      await database.execAsync(`
        UPDATE sync_queue SET firestore_path = REPLACE(firestore_path, '/stock/items/', '/stock_items/') WHERE firestore_path LIKE '%/stock/items/%';
        UPDATE sync_queue SET firestore_path = REPLACE(firestore_path, '/staff/records/', '/staff_records/') WHERE firestore_path LIKE '%/staff/records/%';
        UPDATE sync_queue SET firestore_path = REPLACE(firestore_path, '/cash/cashbook/', '/cashbook/') WHERE firestore_path LIKE '%/cash/cashbook/%';
      `);
    });
    await database.execAsync('PRAGMA user_version = 18');
    version = 18;
  }

  if (version < 19) {
    await database.withExclusiveTransactionAsync(async () => {
      // Create Customers table for KhataBook improvements
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          phone TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          firestore_path TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id)');
    });
    await database.execAsync('PRAGMA user_version = 19');
    version = 19;
  }

  if (version < 20) {
    await database.withExclusiveTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'bills', 'is_draft', 'INTEGER DEFAULT 0');
      await addColumnIfNotExists(database, 'bills', 'is_hold', 'INTEGER DEFAULT 0');
      await addColumnIfNotExists(database, 'bills', 'payment_method', "TEXT DEFAULT 'cash'");
      await addColumnIfNotExists(database, 'bill_items', 'returned_quantity', 'REAL DEFAULT 0');
    });
    await database.execAsync('PRAGMA user_version = 20');
    version = 20;
  }

  if (version < 21) {
    await database.withExclusiveTransactionAsync(async () => {
      // Performance Indexes
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_transactions_userId_isDeleted ON transactions(userId, isDeleted)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_cashbook_userId_date ON cashbook(userId, date DESC)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_expenses_userId_date ON expenses(user_id, expense_date DESC)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_stock_items_userId_qty ON stock_items(user_id, quantity)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_bills_userId_date ON bills(user_id, created_at DESC)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id)');
    });
    await database.execAsync('PRAGMA user_version = 21');
    version = 21;
  }

  if (version < 22) {
    await database.withExclusiveTransactionAsync(async () => {
      // Enhance suppliers table with new fields
      await addColumnIfNotExists(database, 'suppliers', 'email', 'TEXT');
      await addColumnIfNotExists(database, 'suppliers', 'city', 'TEXT');
      await addColumnIfNotExists(database, 'suppliers', 'notes', 'TEXT');
      await addColumnIfNotExists(database, 'suppliers', 'firestore_path', 'TEXT');

      // Purchase Orders
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS purchase_orders (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          supplier_id TEXT NOT NULL,
          po_number INTEGER NOT NULL,
          status TEXT CHECK(status IN ('draft','sent','partial','received','cancelled')) DEFAULT 'draft',
          order_date TEXT NOT NULL,
          expected_date TEXT,
          notes TEXT,
          total REAL DEFAULT 0,
          received_total REAL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          firestore_path TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
        );
      `);

      // Purchase Order Items
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS purchase_order_items (
          id TEXT PRIMARY KEY,
          po_id TEXT NOT NULL,
          stock_item_id TEXT,
          item_name TEXT NOT NULL,
          quantity REAL NOT NULL,
          unit_cost REAL NOT NULL,
          line_total REAL NOT NULL,
          received_qty REAL DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
        );
      `);

      // Purchase Invoices
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS purchase_invoices (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          supplier_id TEXT NOT NULL,
          po_id TEXT,
          invoice_number TEXT NOT NULL,
          invoice_date TEXT NOT NULL,
          due_date TEXT,
          subtotal REAL NOT NULL,
          discount_amount REAL DEFAULT 0,
          tax_amount REAL DEFAULT 0,
          total REAL NOT NULL,
          amount_paid REAL DEFAULT 0,
          balance_due REAL NOT NULL,
          status TEXT CHECK(status IN ('unpaid','partial','paid')) DEFAULT 'unpaid',
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          firestore_path TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
        );
      `);

      // Purchase Invoice Items
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS purchase_invoice_items (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL,
          stock_item_id TEXT,
          item_name TEXT NOT NULL,
          quantity REAL NOT NULL,
          unit_cost REAL NOT NULL,
          line_total REAL NOT NULL,
          is_deleted INTEGER DEFAULT 0,
          FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE
        );
      `);

      // Purchase Returns
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS purchase_returns (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          invoice_id TEXT NOT NULL,
          supplier_id TEXT NOT NULL,
          return_date TEXT NOT NULL,
          reason TEXT,
          total_refund REAL NOT NULL,
          status TEXT CHECK(status IN ('pending','approved','refunded')) DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          firestore_path TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE
        );
      `);

      // Purchase Return Items
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS purchase_return_items (
          id TEXT PRIMARY KEY,
          return_id TEXT NOT NULL,
          stock_item_id TEXT,
          item_name TEXT NOT NULL,
          quantity REAL NOT NULL,
          unit_cost REAL NOT NULL,
          line_total REAL NOT NULL,
          FOREIGN KEY (return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE
        );
      `);

      // Supplier Payments
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS supplier_payments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          supplier_id TEXT NOT NULL,
          invoice_id TEXT,
          amount REAL NOT NULL,
          payment_date TEXT NOT NULL,
          payment_method TEXT CHECK(payment_method IN ('cash','bank_transfer','cheque','online')) DEFAULT 'cash',
          reference TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          firestore_path TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
        );
      `);

      // Performance indexes
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_purchase_orders_user ON purchase_orders(user_id, created_at DESC)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_purchase_invoices_user ON purchase_invoices(user_id, created_at DESC)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier ON purchase_invoices(supplier_id)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status ON purchase_invoices(status)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_suppliers_user ON suppliers(user_id)');
    });
    await database.execAsync('PRAGMA user_version = 22');
    version = 22;
  }

  if (version < 23) {
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'cashbook', 'attachment_url', 'TEXT');
    });
    await database.execAsync('PRAGMA user_version = 23');
    version = 23;
  }
  if (version < 24) {
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'bills', 'voice_note_url', 'TEXT');
    });
    await database.execAsync('PRAGMA user_version = 24');
    version = 24;
  }
  if (version < 25) {
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'expenses', 'firestore_path', 'TEXT');
    });
    await database.execAsync('PRAGMA user_version = 25');
    version = 25;
  }
  if (version < 26) {
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'customers', 'firestore_path', 'TEXT');
    });
    await database.execAsync('PRAGMA user_version = 26');
    version = 26;
  }
  if (version < 27) {
    await database.withExclusiveTransactionAsync(async () => {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS staff_salary_transactions (
          id TEXT PRIMARY KEY,
          staff_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          type TEXT NOT NULL,
          amount REAL NOT NULL,
          date TEXT NOT NULL,
          month TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          firestore_path TEXT,
          FOREIGN KEY (staff_id) REFERENCES staff_records(id) ON DELETE CASCADE
        );
      `);
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_staff_salary_staff_id ON staff_salary_transactions(staff_id)');
      await database.runAsync('CREATE INDEX IF NOT EXISTS idx_staff_salary_user_id ON staff_salary_transactions(user_id)');
    });
    await database.execAsync('PRAGMA user_version = 27');
    version = 27;
  }
  if (version < 28) {
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'staff_records', 'monthly_salary', 'REAL DEFAULT 0');
    });
    await database.execAsync('PRAGMA user_version = 28');
    version = 28;
  }

  if (version < 29) {
    // MONEY UNIT UNIFICATION.
    // `transactions.amount_paisa` and `cashbook.amount_paisa` were always integer
    // paisa. Every other money column stored a REAL rupee value, while
    // formatCurrency() always divides by 100 — so those columns displayed 100x too
    // small. Convert them all to integer paisa, in place.
    //
    // In-place UPDATE only: no table rebuild, no rename, every row preserved.
    // PRAGMA user_version is set inside the same transaction as the UPDATEs, so a
    // crash rolls back both and values can never be multiplied twice.
    //
    // Deliberately NOT converted (not money): bills.discount_pct (a percentage),
    // all quantity/received_qty/change/threshold columns, bill_no, po_number.
    // Deliberately NOT converted (already paisa): transactions, cashbook.
    const toPaisa: Array<[string, string[]]> = [
      ['expenses',                 ['amount']],
      ['bills',                    ['subtotal', 'discount_amount', 'tax_amount', 'total', 'paid', 'due']],
      ['bill_items',               ['unit_price', 'line_total']],
      ['stock_items',              ['purchase_price', 'sale_price']],
      ['stock_movements',          ['cost_per_unit', 'sale_price_unit']],
      ['staff_records',            ['monthly_salary']],
      ['staff_salary_transactions',['amount']],
      ['activities',               ['amount']],
      ['purchase_orders',          ['total', 'received_total']],
      ['purchase_order_items',     ['unit_cost', 'line_total']],
      ['purchase_invoices',        ['subtotal', 'discount_amount', 'tax_amount', 'total', 'amount_paid', 'balance_due']],
      ['purchase_invoice_items',   ['unit_cost', 'line_total']],
      ['purchase_returns',         ['total_refund']],
      ['purchase_return_items',    ['unit_cost', 'line_total']],
      ['supplier_payments',        ['amount']],
    ];

    await database.withTransactionAsync(async () => {
      for (const [table, columns] of toPaisa) {
        // Older installs may not have every table yet; skip any that is absent.
        const cols = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
        if (cols.length === 0) continue;
        const present = new Set(cols.map(c => c.name));

        for (const col of columns) {
          if (!present.has(col)) continue;
          await database.runAsync(
            `UPDATE ${table} SET ${col} = CAST(ROUND(${col} * 100) AS INTEGER) WHERE ${col} IS NOT NULL`
          );
        }
      }
      await database.execAsync('PRAGMA user_version = 29');
    });
    version = 29;
  }

  if (version < 30) {
    // CASH BOOK: give `category` and `note` real columns.
    // The UI has always collected both, but cashbook had nowhere to put them:
    // category was silently dropped on create (and threw "no such column" on
    // update), while note was concatenated into `description` as "desc — note"
    // and split back on " — " — which lost text whenever a description itself
    // contained " — ". Mirrors the `expenses` table (description/note/category).
    //
    // Existing rows keep their `description` exactly as-is and get NULL for the
    // new columns. Old " — " descriptions are deliberately NOT back-parsed:
    // splitting them would itself lose data.
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'cashbook', 'category', 'TEXT');
      await addColumnIfNotExists(database, 'cashbook', 'note', 'TEXT');
      await database.execAsync('PRAGMA user_version = 30');
    });
    version = 30;
  }

  if (version < 31) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(ENTRY_AUDIT_V31_SQL);
      await database.execAsync('PRAGMA user_version = 31');
    });
    version = 31;
  }

  if (version < 32) {
    // Make the staff / sub-staff level EXPLICIT instead of derived from parentId depth.
    //
    // Backfill preserves every existing permission — nobody is promoted. In
    // particular a row whose parent no longer exists (possible only from the
    // pre-v31 hard delete) becomes 'substaff', matching what it can already do.
    //
    // ⚠ account_level is for ROLE CHECKS ONLY. Visibility still flows through
    // parentId via queryHelpers.userScope(), which is untouched by this migration.
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(
        database, 'users', 'account_level',
        "TEXT CHECK(account_level IN ('admin','staff','substaff'))"
      );

      const rows = await database.getAllAsync<LevelNode>('SELECT id, role, parentId FROM users');
      const source = new Map(rows.map(r => [r.id, r]));
      const counts: Partial<Record<LevelReason, number>> = {};

      for (const row of rows) {
        const { level, reason } = classifyAccountLevel(row, id => source.get(id));
        counts[reason] = (counts[reason] ?? 0) + 1;
        await database.runAsync('UPDATE users SET account_level = ? WHERE id = ?', [level, row.id]);
      }

      // Independent re-derivation from what actually landed in the table: each row's
      // level must follow from its PERSISTED parent level. Any mismatch throws, and
      // the surrounding transaction rolls the whole backfill back.
      const written = await database.getAllAsync<LevelNode & { account_level: AccountLevel | null }>(
        'SELECT id, role, parentId, account_level FROM users'
      );
      const levels = new Map(written.map(r => [r.id, r.account_level]));
      for (const row of written) {
        if (!row.account_level) {
          throw new Error(`v32 backfill left user ${row.id} without an account level`);
        }
        const expected = expectedAccountLevel(
          row.role,
          row.parentId ? levels.get(row.parentId) ?? null : null,
          !!row.parentId
        );
        if (row.account_level !== expected) {
          throw new Error(
            `v32 backfill mismatch for user ${row.id}: stored "${row.account_level}", re-derived "${expected}"`
          );
        }
      }

      if (__DEV__) {
        console.log('[DB] v32 account_level backfill:', JSON.stringify(counts));
        const review = (['dangling-parent', 'depth-exceeded', 'cycle'] as LevelReason[])
          .filter(r => counts[r])
          .map(r => `${r}=${counts[r]}`);
        if (review.length) console.warn('[DB] v32 rows needing review:', review.join(', '));
      }

      await database.execAsync('PRAGMA user_version = 32');
    });
    version = 32;
  }

  if (version < 33) {
    // Close Day snapshots. Purely additive: a closing records a day's totals and
    // never deletes, moves or hides an entry, and never blocks a late entry.
    await database.withTransactionAsync(async () => {
      await database.execAsync(DAY_CLOSING_V33_SQL);
      await database.execAsync('PRAGMA user_version = 33');
    });
    version = 33;
  }

  if (version < 34) {
    // Customer contact fields. All nullable, so every existing row is preserved
    // untouched. Photo is TWO columns: the durable local copy (documentDirectory)
    // and a remote URL that stays NULL until Firebase Storage upload is wired.
    // cnic is national-ID data: stored locally only — syncHelpers strips it from
    // every sync payload while sync is unauthenticated.
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'customers', 'photo_local_path', 'TEXT');
      await addColumnIfNotExists(database, 'customers', 'photo_remote_url', 'TEXT');
      await addColumnIfNotExists(database, 'customers', 'email', 'TEXT');
      await addColumnIfNotExists(database, 'customers', 'cnic', 'TEXT');
      await addColumnIfNotExists(database, 'customers', 'address', 'TEXT');
      await addColumnIfNotExists(database, 'customers', 'city', 'TEXT');
      await database.execAsync('PRAGMA user_version = 34');
    });
    version = 34;
  }

  if (version < 35) {
    // Staff photos, the same two-column shape as customers (v34): the durable local
    // copy (documentDirectory/staff_photos) and a remote URL that stays NULL until
    // Firebase Storage upload is wired. Both nullable, so every existing row is
    // preserved untouched. The old single picture_url column is left in place —
    // nothing ever wrote it, and dropping a column would need a table rebuild.
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'staff_records', 'photo_local_path', 'TEXT');
      await addColumnIfNotExists(database, 'staff_records', 'photo_remote_url', 'TEXT');
      await database.execAsync('PRAGMA user_version = 35');
    });
    version = 35;
  }

  if (version < 36) {
    // Links an HR profile (staff_records) to the login it belongs to (users.id), so
    // the app stops treating one person as two. Nullable: rows created before the
    // unified Add Staff flow have no login and are preserved untouched. From v36 on,
    // Add Staff creates the login and the profile together and sets this at birth.
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'staff_records', 'linked_user_id', 'TEXT');
      await database.execAsync('CREATE INDEX IF NOT EXISTS idx_staff_linked_user ON staff_records(linked_user_id)');
      await database.execAsync('PRAGMA user_version = 36');
    });
    version = 36;
  }

  if (version < 37) {
    // business_type becomes OPTIONAL. SQLite cannot drop a NOT NULL, so this is the
    // standard table rebuild: create the new shape, copy every row across, swap, then
    // put the indexes back. Column list is explicit so a row can never shift columns.
    // Re-running is safe: once the column is nullable the rebuild is skipped.
    const staffCols = await database.getAllAsync<{ name: string; notnull: number; type: string }>('PRAGMA table_info(staff_records)');
    const businessType = staffCols.find(c => c.name === 'business_type');
    if (businessType?.notnull) {
      // Any column this rebuild does not know about — one added by a build that ran on
      // this phone and nowhere else — is carried across as-is. The first version threw
      // instead, which ABORTED THE WHOLE CHAIN: every later migration (v38's
      // salary_month_closings among them) silently never ran on that device.
      const knownShape = ['id','user_id','name_en','name_ur','phone','email','role','joining_date','area','business_type','address','picture_url','document_urls','status','monthly_salary','photo_local_path','photo_remote_url','linked_user_id','created_at','updated_at','synced','is_deleted','deleted_at','firestore_path'];
      const carried = staffCols.filter(c => !knownShape.includes(c.name));
      const carriedDefs = carried.map(c => `,\n            ${c.name} ${c.type || 'TEXT'}`).join('');
      await database.withTransactionAsync(async () => {
        await database.execAsync(`
          CREATE TABLE staff_records_v37 (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name_en TEXT NOT NULL,
            name_ur TEXT,
            phone TEXT NOT NULL,
            email TEXT,
            role TEXT NOT NULL,
            joining_date TEXT NOT NULL,
            area TEXT NOT NULL,
            business_type TEXT,
            address TEXT,
            picture_url TEXT,
            document_urls TEXT,
            status TEXT CHECK(status IN ('active','inactive')) DEFAULT 'active',
            monthly_salary REAL DEFAULT 0,
            photo_local_path TEXT,
            photo_remote_url TEXT,
            linked_user_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            synced INTEGER DEFAULT 0,
            is_deleted INTEGER DEFAULT 0,
            deleted_at TEXT,
            firestore_path TEXT${carriedDefs},
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `);
        // Every column the live table has, in its own order: nothing is dropped and
        // nothing can shift into the wrong column.
        const copied = staffCols.map(c => c.name).join(', ');
        await database.execAsync(`INSERT INTO staff_records_v37 (${copied}) SELECT ${copied} FROM staff_records`);
        // staff_salary_transactions and staff_attendance carry FK clauses naming
        // staff_records. Modern SQLite re-parses those on a rename and can refuse the
        // swap; legacy mode leaves other tables' text alone, which is what a rebuild
        // wants. Foreign keys are not enforced here anyway.
        await database.execAsync('PRAGMA legacy_alter_table = ON');
        await database.execAsync('DROP TABLE staff_records');
        await database.execAsync('ALTER TABLE staff_records_v37 RENAME TO staff_records');
        await database.execAsync('PRAGMA legacy_alter_table = OFF');
        await database.execAsync('CREATE INDEX IF NOT EXISTS idx_staff_user_id ON staff_records(user_id)');
        await database.execAsync('CREATE INDEX IF NOT EXISTS idx_staff_name ON staff_records(name_en)');
        await database.execAsync('CREATE INDEX IF NOT EXISTS idx_staff_phone ON staff_records(phone)');
        await database.execAsync('CREATE INDEX IF NOT EXISTS idx_staff_linked_user ON staff_records(linked_user_id)');
        await database.execAsync('PRAGMA user_version = 37');
      });
    } else {
      await database.execAsync('PRAGMA user_version = 37');
    }
    version = 37;
  }

  if (version < 38) {
    // Salary month closings — the same shape as day_closings (v33): a SNAPSHOT of a
    // month, never a lock. Each row records the salary that applied that month (so
    // raising a salary later cannot rewrite a settled month) and the advance carried
    // OUT of it, which is what reduces the next month's due. Purely additive.
    await database.withTransactionAsync(async () => {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS salary_month_closings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          staff_id TEXT NOT NULL,
          month TEXT NOT NULL,
          closed_at TEXT NOT NULL,
          closed_by TEXT NOT NULL,
          closed_by_name TEXT NOT NULL,
          salary_paisa INTEGER NOT NULL,
          opening_advance_paisa INTEGER NOT NULL,
          paid_paisa INTEGER NOT NULL,
          due_paisa INTEGER NOT NULL,
          remaining_paisa INTEGER NOT NULL,
          carry_advance_paisa INTEGER NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT,
          firestore_path TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (staff_id) REFERENCES staff_records(id) ON DELETE CASCADE
        )
      `);
      await database.execAsync('CREATE INDEX IF NOT EXISTS idx_salary_closing_staff ON salary_month_closings(staff_id, month)');
      await database.execAsync('CREATE INDEX IF NOT EXISTS idx_salary_closing_user ON salary_month_closings(user_id)');
      await database.execAsync('PRAGMA user_version = 38');
    });
    version = 38;
  }

  if (version < 39) {
    // Attachments saved before durableFile.ts stored the picker's CACHE path, which
    // Android may clear at any time. Copy every surviving file into permanent storage
    // and repoint its row; record any already gone in lost_attachments. No row is ever
    // deleted. Also drops the placeholder staff document names ("doc_<time>.pdf") that
    // never had a file. Idempotent: durable paths are skipped, losses recorded once.
    await database.withTransactionAsync(async () => {
      await database.execAsync(`
    CREATE TABLE IF NOT EXISTS lost_attachments (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      original_path TEXT NOT NULL,
      detected_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_lost_attachment_unique
      ON lost_attachments(table_name, record_id, original_path);
      `);
      await repairAttachmentsIn(database);
      await database.execAsync('PRAGMA user_version = 39');
    });
    version = 39;
  }

  if (version < 40) {
    // Stock coming BACK from a customer is not a purchase and not an adjustment: it
    // reverses a sale (units return to stock, their selling value leaves the total sold).
    // A CHECK constraint can only change by rebuilding the table, so every column the
    // table actually has — including the ones earlier migrations added — is copied across.
    await database.withTransactionAsync(async () => {
      const cols = (await database.getAllAsync<{ name: string }>(`PRAGMA table_info(stock_movements)`)).map(c => c.name);
      const extra = ["deleted_at TEXT", "created_at TEXT", "updated_at TEXT", "firestore_path TEXT"]
        .filter(def => cols.includes(def.split(" ")[0]));
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS stock_movements_v40 (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          change INTEGER NOT NULL,
          reason TEXT CHECK(reason IN ('purchase','sale','adjustment','customer_return')) NOT NULL,
          date TEXT NOT NULL,
          cost_per_unit REAL,
          sale_price_unit REAL,
          user_id TEXT NOT NULL,
          note TEXT,
          synced INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0${extra.map(def => ', ' + def).join('')},
          FOREIGN KEY (item_id) REFERENCES stock_items(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      const carried = (await database.getAllAsync<{ name: string }>(`PRAGMA table_info(stock_movements_v40)`))
        .map(c => c.name).filter(name => cols.includes(name)).join(", ");
      await database.execAsync(`
        INSERT OR IGNORE INTO stock_movements_v40 (${carried}) SELECT ${carried} FROM stock_movements;
        DROP TABLE stock_movements;
        ALTER TABLE stock_movements_v40 RENAME TO stock_movements;
      `);
      await database.execAsync('PRAGMA user_version = 40');
    });
    version = 40;
  }

  if (version < 41) {
    // Multi-currency, step 1 of 4 (plan approved 28-Sep-2026): the COLUMNS ONLY. No
    // screen writes anything but 'PKR' until the pickers arrive in steps 2 and 3, so
    // defaulting every existing row is not an assumption — these books have only ever
    // held rupees.
    //
    // Currency is stored on the ENTRY ROOTS the shopkeeper picks it on, and nowhere
    // else. A bill item, a goods receipt, a supplier payment and a purchase return all
    // belong to one of these documents and inherit its currency; giving them their own
    // column would let a line disagree with the invoice it is on.
    //
    // Khata and cashbook get no column: khata has no currency picker (see
    // useDashboardStore). What currency a khata entry is in for a non-PKR account is an
    // open question for step 3, not something this migration decides.
    //
    // NOT NULL DEFAULT 'PKR' rather than a nullable column, so no reader ever has to
    // handle a null currency. `resolveCurrency` still tolerates one for safety.
    // Every one of these tables exists on a real device by v22, but ALTER TABLE on a
    // missing one aborts the whole migration chain — so each is checked rather than
    // assumed. A partial schema is not this migration's problem to fix.
    await database.withTransactionAsync(async () => {
      const tableExists = async (table: string) =>
        (await database.getAllAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table])).length > 0;
      for (const [table, column] of [
        ['users', 'default_currency'],
        ['bills', 'currency'],
        ['expenses', 'currency'],
        ['purchase_orders', 'currency'],
        ['purchase_invoices', 'currency'],
      ] as const) {
        if (await tableExists(table)) {
          await addColumnIfNotExists(database, table, column, "TEXT NOT NULL DEFAULT 'PKR'");
        }
      }
      await database.execAsync('PRAGMA user_version = 41');
    });
    version = 41;
  }

  if (version < 42) {
    // Khata entries were joined to customers by MATCHING THE NAME STRING, so renaming a
    // customer orphaned their whole history and two customers sharing a name shared one
    // ledger. This adds the real link.
    //
    // THE BACKFILL IS DELIBERATELY CONSERVATIVE. A row is linked only when EXACTLY ONE
    // live customer of the same owner carries that name:
    //   * no match (a typo, or a customer since deleted) -> customer_id stays NULL
    //   * TWO OR MORE matches (duplicate names) -> customer_id stays NULL, because the
    //     migration cannot know which of them the entry belonged to and guessing would
    //     silently move money onto the wrong person's ledger
    // Nothing is deleted and no row is rewritten. `partyName` is kept on every row and
    // remains the display fallback, so an unlinked entry still shows exactly as it does
    // today — it simply is not attached to a customer record.
    await database.withTransactionAsync(async () => {
      await addColumnIfNotExists(database, 'transactions', 'customer_id', 'TEXT');
      await database.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id)'
      );
      // TRIM on both sides so trailing whitespace does not block an obvious match.
      // Case and spelling differences are NOT folded: they leave the row on partyName,
      // which still works, rather than risking a wrong attachment.
      await database.runAsync(`
        UPDATE transactions
           SET customer_id = (
                 SELECT c.id FROM customers c
                  WHERE c.user_id = transactions.userId
                    AND c.is_deleted = 0
                    AND TRIM(c.name) = TRIM(transactions.partyName)
               )
         WHERE customer_id IS NULL
           AND (
                 SELECT COUNT(*) FROM customers c
                  WHERE c.user_id = transactions.userId
                    AND c.is_deleted = 0
                    AND TRIM(c.name) = TRIM(transactions.partyName)
               ) = 1
      `);
      await database.execAsync('PRAGMA user_version = 42');
    });
    version = 42;
  }

  if (version < 43) {
    // `staff_records.phone` becomes OPTIONAL (step (c) of removing sub-staff logins).
    //
    // A sub-staff is a RECORD, not an account: a staff member adds one purely to record
    // what they pay someone, and that person never installs the app. There is no login,
    // so there is no username, so a phone number cannot be required. The column stays
    // for contact details when they are known — it is `users.phone` that is the login,
    // and nothing uniqueness-related reads this one.
    //
    // SQLite cannot drop a NOT NULL, so this is the same table rebuild v37 used on this
    // table for business_type: create the new shape, copy every row across by explicit
    // column list, swap, put the indexes back. Re-running is safe — once the column is
    // nullable the rebuild is skipped.
    const staffCols = await database.getAllAsync<{ name: string; notnull: number; type: string }>('PRAGMA table_info(staff_records)');
    const phoneCol = staffCols.find(c => c.name === 'phone');
    // No staff_records table at all (entryAudit's minimal fixture schema) is not this
    // migration's problem to fix; it must not abort the chain either.
    if (staffCols.length > 0 && phoneCol?.notnull) {
      // Same hard-won rule as v37: a column this rebuild does not know about — one added
      // by a build that ran on this phone and nowhere else — is CARRIED ACROSS, never a
      // throw. Throwing here aborts every later migration on that device.
      const knownShape = ['id','user_id','name_en','name_ur','phone','email','role','joining_date','area','business_type','address','picture_url','document_urls','status','monthly_salary','photo_local_path','photo_remote_url','linked_user_id','created_at','updated_at','synced','is_deleted','deleted_at','firestore_path'];
      const carried = staffCols.filter(c => !knownShape.includes(c.name));
      const carriedDefs = carried.map(c => `,
            ${c.name} ${c.type || 'TEXT'}`).join('');
      await database.withTransactionAsync(async () => {
        await database.execAsync(`
          CREATE TABLE staff_records_v43 (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name_en TEXT NOT NULL,
            name_ur TEXT,
            phone TEXT,
            email TEXT,
            role TEXT NOT NULL,
            joining_date TEXT NOT NULL,
            area TEXT NOT NULL,
            business_type TEXT,
            address TEXT,
            picture_url TEXT,
            document_urls TEXT,
            status TEXT CHECK(status IN ('active','inactive')) DEFAULT 'active',
            monthly_salary REAL DEFAULT 0,
            photo_local_path TEXT,
            photo_remote_url TEXT,
            linked_user_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            synced INTEGER DEFAULT 0,
            is_deleted INTEGER DEFAULT 0,
            deleted_at TEXT,
            firestore_path TEXT${carriedDefs},
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `);
        const copied = staffCols.map(c => c.name).join(', ');
        await database.execAsync(`INSERT INTO staff_records_v43 (${copied}) SELECT ${copied} FROM staff_records`);
        // staff_salary_transactions and staff_attendance carry FK clauses naming
        // staff_records; modern SQLite re-parses those on a rename and can refuse the
        // swap. Legacy mode leaves other tables' text alone — exactly as v37 does.
        await database.execAsync('PRAGMA legacy_alter_table = ON');
        await database.execAsync('DROP TABLE staff_records');
        await database.execAsync('ALTER TABLE staff_records_v43 RENAME TO staff_records');
        await database.execAsync('PRAGMA legacy_alter_table = OFF');
        await database.execAsync('CREATE INDEX IF NOT EXISTS idx_staff_user_id ON staff_records(user_id)');
        await database.execAsync('CREATE INDEX IF NOT EXISTS idx_staff_name ON staff_records(name_en)');
        await database.execAsync('CREATE INDEX IF NOT EXISTS idx_staff_phone ON staff_records(phone)');
        await database.execAsync('CREATE INDEX IF NOT EXISTS idx_staff_linked_user ON staff_records(linked_user_id)');
      });
    }
    // Stamped OUTSIDE the rebuild, so a device whose table is already nullable (or which
    // has no staff_records at all) still advances and does not retry this forever.
    await database.execAsync('PRAGMA user_version = 43');
    version = 43;
  }
}

export const closeDatabase = async (): Promise<void> => {
  if (db) {
    await db.closeAsync();
    db = null;
  }
};
