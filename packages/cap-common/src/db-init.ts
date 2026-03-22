import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { CapabilityMigration } from './migration-runner.js';
import { applyCapabilityMigrations } from './migration-runner.js';

export function openCapabilityDb(storesDir: string, dbFileName: string, migrations: CapabilityMigration[]): Database.Database {
  mkdirSync(storesDir, { recursive: true });
  const dbPath = join(storesDir, dbFileName);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyCapabilityMigrations(db, migrations);
  return db;
}
