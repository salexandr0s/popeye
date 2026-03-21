import { chmodSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { MigrationManager, type MigrationDefinition } from './migration-manager.ts';

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-migration-'));
  chmodSync(dir, 0o700);
  return dir;
}

function openDb(dir: string, name = 'test.db'): Database.Database {
  const db = new Database(join(dir, name));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('MigrationManager', () => {
  const openDbs: Database.Database[] = [];

  function trackDb(db: Database.Database): Database.Database {
    openDbs.push(db);
    return db;
  }

  afterEach(() => {
    for (const db of openDbs) {
      try { db.close(); } catch { /* already closed */ }
    }
    openDbs.length = 0;
  });

  describe('ensureSchemaTable', () => {
    it('creates schema_migrations table on fresh database', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      manager.ensureSchemaTable();

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
        .all() as { name: string }[];
      expect(tables).toHaveLength(1);
    });

    it('is idempotent — calling twice does not throw', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      manager.ensureSchemaTable();
      manager.ensureSchemaTable();

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
        .all() as { name: string }[];
      expect(tables).toHaveLength(1);
    });

    it('creates table with expected columns', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      manager.ensureSchemaTable();

      const columns = db.pragma('table_info(schema_migrations)') as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).toEqual(['version', 'timestamp', 'status', 'backup_path']);
    });
  });

  describe('runMigrations', () => {
    it('applies migrations and records them', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      const migrations: MigrationDefinition[] = [
        {
          version: '001-init',
          statements: [
            'CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);',
          ],
        },
        {
          version: '002-add-email',
          statements: [
            'ALTER TABLE users ADD COLUMN email TEXT;',
          ],
        },
      ];

      manager.runMigrations(migrations);

      // Verify tables created
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .all();
      expect(tables).toHaveLength(1);

      // Verify columns
      const columns = db.pragma('table_info(users)') as Array<{ name: string }>;
      expect(columns.map((c) => c.name)).toContain('email');

      // Verify migration records
      const applied = manager.listApplied();
      expect(applied).toHaveLength(2);
      expect(applied[0].version).toBe('001-init');
      expect(applied[0].status).toBe('applied');
      expect(applied[1].version).toBe('002-add-email');
      expect(applied[1].status).toBe('applied');
    });

    it('skips already-applied migrations', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      const migrations: MigrationDefinition[] = [
        {
          version: '001-init',
          statements: [
            'CREATE TABLE items (id TEXT PRIMARY KEY);',
          ],
        },
      ];

      manager.runMigrations(migrations);
      manager.runMigrations(migrations);

      const applied = manager.listApplied();
      expect(applied).toHaveLength(1);
    });

    it('rolls back a failing migration without applying partial changes', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      const migrations: MigrationDefinition[] = [
        {
          version: '001-init',
          statements: [
            'CREATE TABLE items (id TEXT PRIMARY KEY);',
          ],
        },
        {
          version: '002-bad',
          statements: [
            'CREATE TABLE extras (id TEXT PRIMARY KEY);',
            'THIS IS NOT VALID SQL;',
          ],
        },
      ];

      expect(() => manager.runMigrations(migrations)).toThrow();

      // First migration should have been applied
      const applied = manager.listApplied();
      expect(applied).toHaveLength(1);
      expect(applied[0].version).toBe('001-init');

      // Second migration's table should not exist (rolled back)
      const extras = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='extras'")
        .all();
      expect(extras).toHaveLength(0);
    });
  });

  describe('backupBeforeMigration', () => {
    it('creates a backup file in the specified directory', () => {
      const dir = makeTempDir();
      const backupDir = join(dir, 'backups');
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      // Write some data so the file has content
      db.exec('CREATE TABLE test_data (id TEXT PRIMARY KEY);');

      const backupPath = manager.backupBeforeMigration('001', backupDir);

      expect(existsSync(backupPath)).toBe(true);
      expect(backupPath).toContain('pre-migration-001');
      expect(backupPath).toContain(backupDir);
    });

    it('backup is a valid SQLite database', () => {
      const dir = makeTempDir();
      const backupDir = join(dir, 'backups');
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      db.exec('CREATE TABLE test_data (id TEXT PRIMARY KEY);');
      db.prepare('INSERT INTO test_data (id) VALUES (?)').run('row-1');

      const backupPath = manager.backupBeforeMigration('001', backupDir);

      const backupDb = new Database(backupPath);
      try {
        const rows = backupDb.prepare('SELECT id FROM test_data').all() as { id: string }[];
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('row-1');
      } finally {
        backupDb.close();
      }
    });
  });

  describe('verifyPostMigration', () => {
    it('returns ok=true for a healthy migration set', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      manager.runMigrations([
        { version: '001-init', statements: ['CREATE TABLE t1 (id TEXT PRIMARY KEY);'] },
        { version: '002-second', statements: ['CREATE TABLE t2 (id TEXT PRIMARY KEY);'] },
      ]);

      const result = manager.verifyPostMigration();
      expect(result.ok).toBe(true);
      expect(result.applied).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('returns ok=false when schema_migrations table does not exist', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      const result = manager.verifyPostMigration();
      expect(result.ok).toBe(false);
      expect(result.applied).toBe(0);
      expect(result.errors).toContain('schema_migrations table does not exist');
    });

    it('detects non-applied status', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      manager.ensureSchemaTable();
      db.prepare(
        'INSERT INTO schema_migrations (version, timestamp, status, backup_path) VALUES (?, ?, ?, ?)',
      ).run('001-bad', new Date().toISOString(), 'failed', null);

      const result = manager.verifyPostMigration();
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes('unexpected status'))).toBe(true);
    });
  });

  describe('rollbackMigration', () => {
    it('copies backup to target path', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      db.exec('CREATE TABLE original (id TEXT PRIMARY KEY);');
      db.prepare('INSERT INTO original (id) VALUES (?)').run('before-migration');

      const backupDir = join(dir, 'backups');
      const backupPath = manager.backupBeforeMigration('001', backupDir);

      // Simulate destructive migration
      db.exec('DROP TABLE original;');
      db.exec('CREATE TABLE replacement (id TEXT PRIMARY KEY);');

      // Rollback
      const restoredPath = join(dir, 'restored.db');
      manager.rollbackMigration(backupPath, restoredPath);

      expect(existsSync(restoredPath)).toBe(true);

      const restoredDb = new Database(restoredPath);
      try {
        const tables = restoredDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='original'")
          .all();
        expect(tables).toHaveLength(1);

        const rows = restoredDb.prepare('SELECT id FROM original').all() as { id: string }[];
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('before-migration');
      } finally {
        restoredDb.close();
      }
    });

    it('throws when backup file does not exist', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      expect(() => {
        manager.rollbackMigration(join(dir, 'nonexistent.db'), join(dir, 'target.db'));
      }).toThrow('Backup file not found');
    });

    it('throws when backup path is a directory', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      expect(() => {
        manager.rollbackMigration(dir, join(dir, 'target.db'));
      }).toThrow('Backup path is not a file');
    });
  });

  describe('listApplied', () => {
    it('returns empty array on fresh database', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      const applied = manager.listApplied();
      expect(applied).toEqual([]);
    });

    it('returns migrations in version order', () => {
      const dir = makeTempDir();
      const db = trackDb(openDb(dir));
      const manager = new MigrationManager(db);

      manager.runMigrations([
        { version: '002-second', statements: ['CREATE TABLE t2 (id TEXT PRIMARY KEY);'] },
        { version: '001-first', statements: ['CREATE TABLE t1 (id TEXT PRIMARY KEY);'] },
      ]);

      const applied = manager.listApplied();
      expect(applied.map((m) => m.version)).toEqual(['001-first', '002-second']);
    });
  });

  describe('end-to-end: backup, migrate, verify, rollback', () => {
    it('full lifecycle works correctly', () => {
      const dir = makeTempDir();
      const dbPath = join(dir, 'lifecycle.db');
      const db = trackDb(new Database(dbPath));
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      const manager = new MigrationManager(db);

      // Step 1: Initial migration
      manager.runMigrations([
        {
          version: '001-init',
          statements: ['CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL);'],
        },
      ]);
      db.prepare('INSERT INTO accounts (id, name) VALUES (?, ?)').run('acc-1', 'Alpha');

      // Step 2: Backup before second migration
      const backupDir = join(dir, 'backups');
      const backupPath = manager.backupBeforeMigration('002', backupDir);
      expect(existsSync(backupPath)).toBe(true);

      // Step 3: Apply second migration
      manager.runMigrations([
        {
          version: '001-init',
          statements: ['CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL);'],
        },
        {
          version: '002-add-status',
          statements: ['ALTER TABLE accounts ADD COLUMN status TEXT DEFAULT \'active\';'],
        },
      ]);

      // Step 4: Verify
      const verification = manager.verifyPostMigration();
      expect(verification.ok).toBe(true);
      expect(verification.applied).toBe(2);

      // Step 5: Rollback to pre-002 state
      db.close();
      const freshManager = new MigrationManager(new Database(':memory:'));
      freshManager.rollbackMigration(backupPath, dbPath);

      // Step 6: Verify rollback — status column should not exist
      const restoredDb = trackDb(new Database(dbPath));
      const columns = restoredDb.pragma('table_info(accounts)') as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).not.toContain('status');

      // Original data preserved
      const rows = restoredDb.prepare('SELECT id, name FROM accounts').all() as { id: string; name: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ id: 'acc-1', name: 'Alpha' });
    });

    it('multi-version lifecycle: v1 create, v2 alter with backup, verify both, rollback to v1', () => {
      const dir = makeTempDir();
      const dbPath = join(dir, 'multi-version.db');
      const backupDir = join(dir, 'backups');

      // --- Phase 1: Create DB and apply v1 migrations ---
      const db = trackDb(new Database(dbPath));
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      const manager = new MigrationManager(db);

      const v1Migrations: MigrationDefinition[] = [
        {
          version: '001-create-projects',
          statements: [
            `CREATE TABLE projects (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );`,
          ],
        },
        {
          version: '002-create-tasks',
          statements: [
            `CREATE TABLE tasks (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id),
              title TEXT NOT NULL,
              done INTEGER NOT NULL DEFAULT 0
            );`,
          ],
        },
      ];

      manager.runMigrations(v1Migrations);

      // Insert seed data
      db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('proj-1', 'Popeye');
      db.prepare('INSERT INTO tasks (id, project_id, title) VALUES (?, ?, ?)').run('task-1', 'proj-1', 'Build runtime');
      db.prepare('INSERT INTO tasks (id, project_id, title, done) VALUES (?, ?, ?, ?)').run('task-2', 'proj-1', 'Write tests', 1);

      // Verify v1 schema exists
      const v1Tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const v1TableNames = v1Tables.map((t) => t.name);
      expect(v1TableNames).toContain('projects');
      expect(v1TableNames).toContain('tasks');
      expect(v1TableNames).toContain('schema_migrations');

      const v1Applied = manager.listApplied();
      expect(v1Applied).toHaveLength(2);
      expect(v1Applied[0].version).toBe('001-create-projects');
      expect(v1Applied[1].version).toBe('002-create-tasks');

      const v1Verify = manager.verifyPostMigration();
      expect(v1Verify.ok).toBe(true);
      expect(v1Verify.applied).toBe(2);
      expect(v1Verify.errors).toHaveLength(0);

      // --- Phase 2: Backup before v2 migration ---
      const backupPath = manager.backupBeforeMigration('v2', backupDir);
      expect(existsSync(backupPath)).toBe(true);
      expect(backupPath).toContain('pre-migration-v2');

      // Verify backup is a valid database with v1 data
      const backupDb = new Database(backupPath);
      const backupProjects = backupDb.prepare('SELECT id, name FROM projects').all() as { id: string; name: string }[];
      expect(backupProjects).toHaveLength(1);
      expect(backupProjects[0]).toEqual({ id: 'proj-1', name: 'Popeye' });
      const backupTasks = backupDb.prepare('SELECT id FROM tasks').all();
      expect(backupTasks).toHaveLength(2);
      backupDb.close();

      // --- Phase 3: Apply v2 migrations (alter + add table) ---
      const v2Migrations: MigrationDefinition[] = [
        ...v1Migrations,
        {
          version: '003-add-priority',
          statements: [
            "ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'normal';",
          ],
        },
        {
          version: '004-create-labels',
          statements: [
            `CREATE TABLE labels (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE
            );`,
            `CREATE TABLE task_labels (
              task_id TEXT NOT NULL REFERENCES tasks(id),
              label_id TEXT NOT NULL REFERENCES labels(id),
              PRIMARY KEY (task_id, label_id)
            );`,
          ],
        },
      ];

      manager.runMigrations(v2Migrations);

      // Verify v2 schema exists
      const v2Tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const v2TableNames = v2Tables.map((t) => t.name);
      expect(v2TableNames).toContain('labels');
      expect(v2TableNames).toContain('task_labels');

      // Verify tasks table has the new priority column
      const taskColumns = db.pragma('table_info(tasks)') as Array<{ name: string }>;
      expect(taskColumns.map((c) => c.name)).toContain('priority');

      // Verify all four migrations recorded
      const v2Applied = manager.listApplied();
      expect(v2Applied).toHaveLength(4);
      expect(v2Applied.map((m) => m.version)).toEqual([
        '001-create-projects',
        '002-create-tasks',
        '003-add-priority',
        '004-create-labels',
      ]);

      const v2Verify = manager.verifyPostMigration();
      expect(v2Verify.ok).toBe(true);
      expect(v2Verify.applied).toBe(4);
      expect(v2Verify.errors).toHaveLength(0);

      // Original data still intact after v2
      const projectsAfterV2 = db.prepare('SELECT id, name FROM projects').all() as { id: string; name: string }[];
      expect(projectsAfterV2).toHaveLength(1);
      expect(projectsAfterV2[0]).toEqual({ id: 'proj-1', name: 'Popeye' });

      const tasksAfterV2 = db.prepare('SELECT id, title, done, priority FROM tasks ORDER BY id').all() as Array<{
        id: string;
        title: string;
        done: number;
        priority: string | null;
      }>;
      expect(tasksAfterV2).toHaveLength(2);
      expect(tasksAfterV2[0].priority).toBe('normal'); // default value applied

      // --- Phase 4: Rollback to pre-v2 backup ---
      db.close();

      const rollbackManager = new MigrationManager(new Database(':memory:'));
      rollbackManager.rollbackMigration(backupPath, dbPath);

      // --- Phase 5: Verify rollback restored v1 state ---
      const restoredDb = trackDb(new Database(dbPath));
      restoredDb.pragma('foreign_keys = ON');

      // v2 tables should not exist
      const restoredTables = restoredDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const restoredTableNames = restoredTables.map((t) => t.name);
      expect(restoredTableNames).not.toContain('labels');
      expect(restoredTableNames).not.toContain('task_labels');

      // tasks should not have the priority column
      const restoredTaskCols = restoredDb.pragma('table_info(tasks)') as Array<{ name: string }>;
      expect(restoredTaskCols.map((c) => c.name)).not.toContain('priority');

      // v1 tables and data preserved
      expect(restoredTableNames).toContain('projects');
      expect(restoredTableNames).toContain('tasks');

      const restoredProjects = restoredDb.prepare('SELECT id, name FROM projects').all() as { id: string; name: string }[];
      expect(restoredProjects).toHaveLength(1);
      expect(restoredProjects[0]).toEqual({ id: 'proj-1', name: 'Popeye' });

      const restoredTasks = restoredDb.prepare('SELECT id, title, done FROM tasks ORDER BY id').all() as Array<{
        id: string;
        title: string;
        done: number;
      }>;
      expect(restoredTasks).toHaveLength(2);
      expect(restoredTasks[0]).toEqual({ id: 'task-1', title: 'Build runtime', done: 0 });
      expect(restoredTasks[1]).toEqual({ id: 'task-2', title: 'Write tests', done: 1 });

      // Only v1 migrations in schema_migrations
      const restoredManager = new MigrationManager(restoredDb);
      const restoredApplied = restoredManager.listApplied();
      expect(restoredApplied).toHaveLength(2);
      expect(restoredApplied.map((m) => m.version)).toEqual([
        '001-create-projects',
        '002-create-tasks',
      ]);

      const restoredVerify = restoredManager.verifyPostMigration();
      expect(restoredVerify.ok).toBe(true);
      expect(restoredVerify.applied).toBe(2);
    });
  });
});
