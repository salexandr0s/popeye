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
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_message_ingress_source_chat_message ON message_ingress (workspace_id, source, chat_id, telegram_message_id);',
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
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_message_ingress_source_chat_message ON message_ingress (workspace_id, source, chat_id, telegram_message_id);',
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
  {
    id: '006-browser-sessions',
    statements: [
      'CREATE TABLE IF NOT EXISTS browser_sessions (id TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, expires_at TEXT NOT NULL);',
      'CREATE INDEX IF NOT EXISTS idx_browser_sessions_expires ON browser_sessions(expires_at);',
    ],
  },
  {
    id: '007-instruction-snapshot-project-context',
    statements: [
      'ALTER TABLE instruction_snapshots ADD COLUMN project_id TEXT;',
    ],
  },
  {
    id: '008-telegram-relay-state',
    statements: [
      `CREATE TABLE IF NOT EXISTS telegram_relay_checkpoints (
        relay_key TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        last_acknowledged_update_id INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (relay_key, workspace_id)
      );`,
      `CREATE TABLE IF NOT EXISTS telegram_reply_deliveries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        chat_id TEXT NOT NULL,
        telegram_message_id INTEGER NOT NULL,
        message_ingress_id TEXT NOT NULL REFERENCES message_ingress(id),
        task_id TEXT REFERENCES tasks(id),
        job_id TEXT REFERENCES jobs(id),
        run_id TEXT REFERENCES runs(id),
        status TEXT NOT NULL,
        sent_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_reply_deliveries_chat_message ON telegram_reply_deliveries (workspace_id, chat_id, telegram_message_id);',
      'CREATE INDEX IF NOT EXISTS idx_telegram_reply_deliveries_ingress ON telegram_reply_deliveries (message_ingress_id);',
      'CREATE INDEX IF NOT EXISTS idx_telegram_reply_deliveries_run_id ON telegram_reply_deliveries (run_id);',
    ],
  },
  {
    id: '009-telegram-relay-workspace-scope',
    statements: [
      'DROP INDEX IF EXISTS idx_message_ingress_source_chat_message;',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_message_ingress_source_chat_message ON message_ingress (workspace_id, source, chat_id, telegram_message_id);',
      'DROP INDEX IF EXISTS idx_telegram_reply_deliveries_chat_message;',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_reply_deliveries_chat_message ON telegram_reply_deliveries (workspace_id, chat_id, telegram_message_id);',
    ],
  },
  {
    id: '010-telegram-reply-delivery-observability',
    statements: [
      'ALTER TABLE telegram_reply_deliveries ADD COLUMN sent_telegram_message_id INTEGER;',
    ],
  },
  {
    id: '011-telegram-operator-resolution',
    statements: [
      `CREATE TABLE IF NOT EXISTS telegram_delivery_resolutions (
        id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL REFERENCES telegram_reply_deliveries(id),
        workspace_id TEXT NOT NULL,
        action TEXT NOT NULL,
        intervention_id TEXT REFERENCES interventions(id),
        operator_note TEXT,
        sent_telegram_message_id INTEGER,
        previous_status TEXT NOT NULL,
        new_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS idx_tdr_delivery ON telegram_delivery_resolutions(delivery_id);',
      'CREATE INDEX IF NOT EXISTS idx_tdr_intervention ON telegram_delivery_resolutions(intervention_id);',
      'ALTER TABLE interventions ADD COLUMN updated_at TEXT;',
      'ALTER TABLE interventions ADD COLUMN resolution_note TEXT;',
    ],
  },
  {
    id: '012-telegram-send-attempts',
    statements: [
      `CREATE TABLE IF NOT EXISTS telegram_send_attempts (
        id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL REFERENCES telegram_reply_deliveries(id),
        workspace_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        run_id TEXT,
        content_hash TEXT NOT NULL,
        outcome TEXT NOT NULL,
        sent_telegram_message_id INTEGER,
        error_summary TEXT,
        source TEXT NOT NULL DEFAULT 'relay',
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS idx_tsa_delivery ON telegram_send_attempts(delivery_id);',
      'CREATE INDEX IF NOT EXISTS idx_tsa_workspace_created ON telegram_send_attempts(workspace_id, created_at);',
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
  {
    id: '005-memory-cleanup',
    statements: [
      'DROP TABLE IF EXISTS memory_embeddings;',
      'DROP TABLE IF EXISTS retrieval_cache;',
    ],
  },
  {
    id: '006-memory-fts-stable-id',
    statements: [
      'CREATE VIRTUAL TABLE memories_fts_new USING fts5(memory_id UNINDEXED, description, content);',
      'INSERT INTO memories_fts_new (memory_id, description, content) SELECT id, description, content FROM memories;',
      'DROP TABLE memories_fts;',
      'ALTER TABLE memories_fts_new RENAME TO memories_fts;',
    ],
  },
  {
    id: '007-memory-enhancements',
    statements: [
      'ALTER TABLE memories ADD COLUMN durable INTEGER NOT NULL DEFAULT 0;',
      'CREATE INDEX idx_memories_durable ON memories(durable) WHERE durable = 1;',
      `CREATE TABLE memory_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`,
      'CREATE UNIQUE INDEX idx_memory_entities_canonical ON memory_entities(canonical_name, entity_type);',
      `CREATE TABLE memory_entity_mentions (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        mention_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX idx_mem_entity_mentions_memory ON memory_entity_mentions(memory_id);',
      'CREATE INDEX idx_mem_entity_mentions_entity ON memory_entity_mentions(entity_id);',
    ],
  },
  {
    id: '008-memory-summary-dag',
    statements: [
      `CREATE TABLE memory_summaries (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        parent_id TEXT REFERENCES memory_summaries(id),
        depth INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        token_estimate INTEGER NOT NULL DEFAULT 0,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX idx_memory_summaries_run ON memory_summaries(run_id);',
      'CREATE INDEX idx_memory_summaries_parent ON memory_summaries(parent_id);',
      'CREATE INDEX idx_memory_summaries_depth ON memory_summaries(run_id, depth);',
      `CREATE TABLE memory_summary_sources (
        id TEXT PRIMARY KEY,
        summary_id TEXT NOT NULL REFERENCES memory_summaries(id),
        memory_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX idx_memory_summary_sources_summary ON memory_summary_sources(summary_id);',
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
