import { mkdirSync } from 'node:fs';
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
  {
    id: '003-app-coalesce-key',
    statements: [
      'ALTER TABLE tasks ADD COLUMN coalesce_key TEXT;',
      'CREATE INDEX IF NOT EXISTS idx_tasks_coalesce_key ON tasks (coalesce_key);',
    ],
  },
  {
    id: '004-app-schema-hardening',
    statements: [
      // --- projects: add FK on workspace_id ---
      `CREATE TABLE projects_new (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`,
      'INSERT INTO projects_new SELECT id, workspace_id, name, created_at FROM projects;',
      'DROP TABLE projects;',
      'ALTER TABLE projects_new RENAME TO projects;',

      // --- tasks: add FK on workspace_id, preserve coalesce_key ---
      `CREATE TABLE tasks_new (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        project_id TEXT,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_policy_json TEXT NOT NULL,
        side_effect_profile TEXT NOT NULL,
        created_at TEXT NOT NULL,
        coalesce_key TEXT
      );`,
      'INSERT INTO tasks_new SELECT id, workspace_id, project_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at, coalesce_key FROM tasks;',
      'DROP TABLE tasks;',
      'ALTER TABLE tasks_new RENAME TO tasks;',
      'CREATE INDEX IF NOT EXISTS idx_tasks_coalesce_key ON tasks (coalesce_key);',

      // --- schedules: add FK on task_id ---
      `CREATE TABLE schedules_new (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        interval_seconds INTEGER,
        created_at TEXT NOT NULL
      );`,
      'INSERT INTO schedules_new SELECT id, task_id, interval_seconds, created_at FROM schedules;',
      'DROP TABLE schedules;',
      'ALTER TABLE schedules_new RENAME TO schedules;',

      // --- jobs: add FKs on task_id, workspace_id ---
      `CREATE TABLE jobs_new (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL,
        available_at TEXT NOT NULL,
        last_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      'INSERT INTO jobs_new SELECT id, task_id, workspace_id, status, retry_count, available_at, last_run_id, created_at, updated_at FROM jobs;',
      'DROP TABLE jobs;',
      'ALTER TABLE jobs_new RENAME TO jobs;',

      // --- job_leases: add FK on job_id ---
      `CREATE TABLE job_leases_new (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id),
        lease_owner TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      'INSERT INTO job_leases_new SELECT job_id, lease_owner, lease_expires_at, updated_at FROM job_leases;',
      'DROP TABLE job_leases;',
      'ALTER TABLE job_leases_new RENAME TO job_leases;',

      // --- runs: add FKs on job_id, task_id, workspace_id ---
      `CREATE TABLE runs_new (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        session_root_id TEXT NOT NULL,
        engine_session_ref TEXT,
        state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT
      );`,
      'INSERT INTO runs_new SELECT id, job_id, task_id, workspace_id, session_root_id, engine_session_ref, state, started_at, finished_at, error FROM runs;',
      'DROP TABLE runs;',
      'ALTER TABLE runs_new RENAME TO runs;',

      // --- run_events: add FK on run_id ---
      `CREATE TABLE run_events_new (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`,
      'INSERT INTO run_events_new SELECT id, run_id, type, payload, created_at FROM run_events;',
      'DROP TABLE run_events;',
      'ALTER TABLE run_events_new RENAME TO run_events;',

      // --- receipts: add FKs on run_id, job_id ---
      `CREATE TABLE receipts_new (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        job_id TEXT NOT NULL REFERENCES jobs(id),
        task_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`,
      'INSERT INTO receipts_new SELECT id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at FROM receipts;',
      'DROP TABLE receipts;',
      'ALTER TABLE receipts_new RENAME TO receipts;',

      // --- interventions: add FK on run_id ---
      `CREATE TABLE interventions_new (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        run_id TEXT REFERENCES runs(id),
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );`,
      'INSERT INTO interventions_new SELECT id, code, run_id, status, reason, created_at, resolved_at FROM interventions;',
      'DROP TABLE interventions;',
      'ALTER TABLE interventions_new RENAME TO interventions;',

      // --- message_ingress: add FKs on workspace_id, task_id, job_id, run_id ---
      `CREATE TABLE message_ingress_new (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        chat_id TEXT,
        chat_type TEXT,
        telegram_message_id INTEGER,
        idempotency_key TEXT,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        body TEXT NOT NULL,
        accepted INTEGER NOT NULL,
        decision_code TEXT NOT NULL,
        decision_reason TEXT NOT NULL,
        http_status INTEGER NOT NULL,
        message_id TEXT,
        task_id TEXT REFERENCES tasks(id),
        job_id TEXT REFERENCES jobs(id),
        run_id TEXT REFERENCES runs(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      'INSERT INTO message_ingress_new SELECT id, source, sender_id, chat_id, chat_type, telegram_message_id, idempotency_key, workspace_id, body, accepted, decision_code, decision_reason, http_status, message_id, task_id, job_id, run_id, created_at, updated_at FROM message_ingress;',
      'DROP TABLE message_ingress;',
      'ALTER TABLE message_ingress_new RENAME TO message_ingress;',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_message_ingress_source_chat_message ON message_ingress (source, chat_id, telegram_message_id);',
      'CREATE INDEX IF NOT EXISTS idx_message_ingress_source_sender_created ON message_ingress (source, sender_id, created_at);',
      'CREATE INDEX IF NOT EXISTS idx_message_ingress_source_chat_created ON message_ingress (source, chat_id, created_at);',
      'CREATE INDEX IF NOT EXISTS idx_message_ingress_idempotency_key ON message_ingress (idempotency_key);',

      // --- 5b: Performance indexes ---
      'CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);',
      'CREATE INDEX IF NOT EXISTS idx_jobs_workspace_status ON jobs(workspace_id, status);',
      'CREATE INDEX IF NOT EXISTS idx_jobs_task_status ON jobs(task_id, status);',
      'CREATE INDEX IF NOT EXISTS idx_runs_state_finished ON runs(state, finished_at);',
      'CREATE INDEX IF NOT EXISTS idx_runs_job_id ON runs(job_id);',
      'CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id);',
      'CREATE INDEX IF NOT EXISTS idx_receipts_run_status ON receipts(run_id, status);',
      'CREATE INDEX IF NOT EXISTS idx_job_leases_expires ON job_leases(lease_expires_at);',
      'CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);',
      'CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);',

      // --- 5c: Remove dead table ---
      'DROP TABLE IF EXISTS run_outputs;',
    ],
  },
  {
    id: '005-workspace-project-paths',
    statements: [
      'ALTER TABLE workspaces ADD COLUMN root_path TEXT;',
      'ALTER TABLE projects ADD COLUMN path TEXT;',
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
  {
    id: '002-memory-lifecycle',
    statements: [
      "ALTER TABLE memories ADD COLUMN memory_type TEXT DEFAULT 'episodic';",
      'ALTER TABLE memories ADD COLUMN dedup_key TEXT;',
      'ALTER TABLE memories ADD COLUMN last_reinforced_at TEXT;',
      'ALTER TABLE memories ADD COLUMN archived_at TEXT;',
      "ALTER TABLE memory_events ADD COLUMN payload TEXT DEFAULT '{}';",
      'CREATE INDEX IF NOT EXISTS idx_memories_dedup_key ON memories(dedup_key);',
    ],
  },
  {
    id: '003-memory-schema-enrichment',
    statements: [
      'ALTER TABLE memories ADD COLUMN source_run_id TEXT;',
      'ALTER TABLE memories ADD COLUMN source_timestamp TEXT;',
    ],
  },
  {
    id: '004-memory-consolidation-reason',
    statements: [
      "ALTER TABLE memory_consolidations ADD COLUMN reason TEXT DEFAULT '';",
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

