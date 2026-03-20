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
  });
});
