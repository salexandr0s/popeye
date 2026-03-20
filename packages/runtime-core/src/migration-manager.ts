import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type Database from 'better-sqlite3';

export interface MigrationRecord {
  version: string;
  timestamp: string;
  status: string;
  backup_path: string | null;
}

export interface MigrationDefinition {
  version: string;
  statements: string[];
}

export interface PostMigrationResult {
  ok: boolean;
  applied: number;
  errors: string[];
}

export class MigrationManager {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Creates the schema_migrations tracking table if it does not exist. */
  ensureSchemaTable(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        backup_path TEXT
      );`,
    );
  }

  /**
   * Copies the database file to a timestamped backup before a migration runs.
   * Returns the path of the backup file.
   */
  backupBeforeMigration(version: string, backupDir: string): string {
    const dbPath = this.db.name;
    if (!dbPath || !existsSync(dbPath)) {
      throw new Error(`Cannot backup: database path is not a file on disk (${dbPath})`);
    }

    mkdirSync(backupDir, { recursive: true, mode: 0o700 });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dbName = basename(dbPath);
    const backupFileName = `pre-migration-${version}-${timestamp}-${dbName}`;
    const backupPath = join(backupDir, backupFileName);

    copyFileSync(dbPath, backupPath);

    // Also copy WAL and SHM files if they exist so the backup is self-consistent
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    if (existsSync(walPath)) {
      copyFileSync(walPath, `${backupPath}-wal`);
    }
    if (existsSync(shmPath)) {
      copyFileSync(shmPath, `${backupPath}-shm`);
    }

    return backupPath;
  }

  /**
   * Applies an ordered list of migrations. Each migration runs inside a
   * transaction and is recorded in schema_migrations on success. Already-applied
   * migrations (by version) are skipped.
   */
  runMigrations(migrations: MigrationDefinition[]): void {
    this.ensureSchemaTable();

    const getApplied = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
    const recordMigration = this.db.prepare(
      'INSERT INTO schema_migrations (version, timestamp, status, backup_path) VALUES (?, ?, ?, ?)',
    );

    for (const migration of migrations) {
      const existing = getApplied.get(migration.version) as { version: string } | undefined;
      if (existing) {
        continue;
      }

      const tx = this.db.transaction(() => {
        for (const statement of migration.statements) {
          this.db.exec(statement);
        }
        recordMigration.run(migration.version, new Date().toISOString(), 'applied', null);
      });
      tx();
    }
  }

  /**
   * Checks schema_migrations table integrity.
   * Returns status with count of applied migrations and any detected errors.
   *
   * Handles both the legacy schema (id, applied_at) created by the inline
   * applyMigrations() helper and the MigrationManager schema (version,
   * timestamp, status, backup_path).
   */
  verifyPostMigration(): PostMigrationResult {
    const errors: string[] = [];

    // Verify the table exists
    const tableCheck = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get() as { name: string } | undefined;

    if (!tableCheck) {
      return { ok: false, applied: 0, errors: ['schema_migrations table does not exist'] };
    }

    // Detect which schema variant is present by inspecting column names
    const columns = this.db.prepare('PRAGMA table_info(schema_migrations)').all() as Array<{
      name: string;
    }>;
    const columnNames = new Set(columns.map((c) => c.name));
    const hasLegacySchema = columnNames.has('id') && !columnNames.has('version');

    if (hasLegacySchema) {
      // Legacy schema: columns are (id, applied_at)
      const rows = this.db
        .prepare('SELECT id, applied_at FROM schema_migrations ORDER BY id')
        .all() as Array<{ id: string; applied_at: string }>;

      for (const row of rows) {
        if (!row.id) {
          errors.push('Migration record with empty id found');
        }
        if (!row.applied_at) {
          errors.push(`Migration ${row.id}: missing applied_at`);
        }
      }

      // Check for duplicates
      const ids = rows.map((r) => r.id);
      const uniqueIds = new Set(ids);
      if (ids.length !== uniqueIds.size) {
        errors.push('Duplicate migration ids detected');
      }

      return { ok: errors.length === 0, applied: rows.length, errors };
    }

    // MigrationManager schema: columns are (version, timestamp, status, backup_path)
    const rows = this.db
      .prepare('SELECT version, timestamp, status FROM schema_migrations ORDER BY version')
      .all() as MigrationRecord[];

    for (const row of rows) {
      if (!row.version) {
        errors.push('Migration record with empty version found');
      }
      if (!row.timestamp) {
        errors.push(`Migration ${row.version}: missing timestamp`);
      }
      if (row.status !== 'applied') {
        errors.push(`Migration ${row.version}: unexpected status "${row.status}"`);
      }
    }

    // Check for duplicates
    const versions = rows.map((r) => r.version);
    const uniqueVersions = new Set(versions);
    if (versions.length !== uniqueVersions.size) {
      errors.push('Duplicate migration versions detected');
    }

    return { ok: errors.length === 0, applied: rows.length, errors };
  }

  /**
   * Restores a database from a backup file. Copies the backup to the target
   * path and verifies the restored file is a valid SQLite database.
   */
  rollbackMigration(backupPath: string, targetPath: string): void {
    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    const stats = statSync(backupPath);
    if (!stats.isFile()) {
      throw new Error(`Backup path is not a file: ${backupPath}`);
    }

    mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
    copyFileSync(backupPath, targetPath);

    // Copy WAL and SHM if they exist alongside the backup
    const walBackup = `${backupPath}-wal`;
    const shmBackup = `${backupPath}-shm`;
    if (existsSync(walBackup)) {
      copyFileSync(walBackup, `${targetPath}-wal`);
    }
    if (existsSync(shmBackup)) {
      copyFileSync(shmBackup, `${targetPath}-shm`);
    }
  }

  /** Returns the list of applied migrations in version order. */
  listApplied(): MigrationRecord[] {
    this.ensureSchemaTable();

    return this.db
      .prepare('SELECT version, timestamp, status, backup_path FROM schema_migrations ORDER BY version')
      .all() as MigrationRecord[];
  }
}
