import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import type { AppConfig, RuntimePaths } from '@popeye/contracts';

import { ensureRuntimePaths } from './config.js';

export interface RuntimeDatabases {
  app: Database.Database;
  memory: Database.Database;
  paths: RuntimePaths;
}

interface Migration {
  id: string;
  statements: string[];
}

const APP_MIGRATIONS: Migration[] = [
  {
    id: '001-app-schema',
    statements: [
      'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS daemon_state (id INTEGER PRIMARY KEY CHECK (id = 1), started_at TEXT NOT NULL, last_shutdown_at TEXT, engine_kind TEXT NOT NULL, schema_version TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS agent_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, title TEXT NOT NULL, prompt TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, retry_policy_json TEXT NOT NULL, side_effect_profile TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, interval_seconds INTEGER, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, workspace_id TEXT NOT NULL, status TEXT NOT NULL, retry_count INTEGER NOT NULL, available_at TEXT NOT NULL, last_run_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS job_leases (job_id TEXT PRIMARY KEY, lease_owner TEXT NOT NULL, lease_expires_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS locks (id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS session_roots (id TEXT PRIMARY KEY, kind TEXT NOT NULL, scope TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, task_id TEXT NOT NULL, workspace_id TEXT NOT NULL, session_root_id TEXT NOT NULL, engine_session_ref TEXT, state TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, error TEXT);',
      'CREATE TABLE IF NOT EXISTS run_events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS run_outputs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, job_id TEXT NOT NULL, task_id TEXT NOT NULL, workspace_id TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, details TEXT NOT NULL, usage_json TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS instruction_snapshots (id TEXT PRIMARY KEY, scope TEXT NOT NULL, bundle_json TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS interventions (id TEXT PRIMARY KEY, code TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);',
      'CREATE TABLE IF NOT EXISTS security_audit (id TEXT PRIMARY KEY, code TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, component TEXT NOT NULL, timestamp TEXT NOT NULL, details_json TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, source TEXT NOT NULL, sender_id TEXT NOT NULL, body TEXT NOT NULL, accepted INTEGER NOT NULL, related_run_id TEXT, created_at TEXT NOT NULL);',
    ],
  },
  {
    id: '002-app-message-ingress',
    statements: [
      'CREATE TABLE IF NOT EXISTS message_ingress (id TEXT PRIMARY KEY, source TEXT NOT NULL, sender_id TEXT NOT NULL, chat_id TEXT, chat_type TEXT, telegram_message_id INTEGER, idempotency_key TEXT, workspace_id TEXT NOT NULL, body TEXT NOT NULL, accepted INTEGER NOT NULL, decision_code TEXT NOT NULL, decision_reason TEXT NOT NULL, http_status INTEGER NOT NULL, message_id TEXT, task_id TEXT, job_id TEXT, run_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_message_ingress_source_chat_message ON message_ingress (source, chat_id, telegram_message_id);',
      'CREATE INDEX IF NOT EXISTS idx_message_ingress_source_sender_created ON message_ingress (source, sender_id, created_at);',
      'CREATE INDEX IF NOT EXISTS idx_message_ingress_source_chat_created ON message_ingress (source, chat_id, created_at);',
      'CREATE INDEX IF NOT EXISTS idx_message_ingress_idempotency_key ON message_ingress (idempotency_key);',
    ],
  },
];

const MEMORY_MIGRATIONS: Migration[] = [
  {
    id: '001-memory-schema',
    statements: [
      'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, description TEXT NOT NULL, classification TEXT NOT NULL, source_type TEXT NOT NULL, content TEXT NOT NULL, confidence REAL NOT NULL, scope TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS memory_events (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS memory_embeddings (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, embedding_json TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS memory_sources (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, source_type TEXT NOT NULL, source_ref TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS memory_consolidations (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, merged_into_id TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS retrieval_cache (id TEXT PRIMARY KEY, query TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);',
      'CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(description, content);',
    ],
  },
];

function configure(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

function applyMigrations(db: Database.Database, migrations: Migration[]): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
  const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
  const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of migrations) {
    if (getMigration.get(migration.id)) continue;
    const tx = db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      addMigration.run(migration.id, new Date().toISOString());
    });
    tx();
  }
}

export function openRuntimeDatabases(config: AppConfig): RuntimeDatabases {
  const paths = ensureRuntimePaths(config);
  mkdirSync(dirname(paths.appDbPath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(paths.memoryDbPath), { recursive: true, mode: 0o700 });
  const app = new Database(paths.appDbPath);
  const memory = new Database(paths.memoryDbPath);
  configure(app);
  configure(memory);
  applyMigrations(app, APP_MIGRATIONS);
  applyMigrations(memory, MEMORY_MIGRATIONS);
  return { app, memory, paths };
}

export function writeReceiptArtifact(paths: RuntimePaths, receiptId: string, content: string): string {
  const filePath = `${paths.receiptsByRunDir}/${receiptId}.json`;
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function readReceiptArtifact(paths: RuntimePaths, receiptId: string): string | null {
  try {
    return readFileSync(`${paths.receiptsByRunDir}/${receiptId}.json`, 'utf8');
  } catch {
    return null;
  }
}
