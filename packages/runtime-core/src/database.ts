import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import type { AppConfig, RuntimePaths } from '@popeye/contracts';

import { ensureRuntimePaths } from './config.js';
import { MigrationManager } from './migration-manager.js';

export interface RuntimeDatabases {
  app: Database.Database;
  memory: Database.Database;
  paths: RuntimePaths;
}

export interface Migration {
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
  {
    id: '013-policy-substrate',
    statements: [
      `CREATE TABLE IF NOT EXISTS secret_refs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        key TEXT NOT NULL,
        connection_id TEXT,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        rotated_at TEXT,
        expires_at TEXT
      );`,
      'CREATE INDEX IF NOT EXISTS idx_secret_refs_provider ON secret_refs(provider);',
      'CREATE INDEX IF NOT EXISTS idx_secret_refs_connection ON secret_refs(connection_id);',

      `CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        domain TEXT NOT NULL,
        risk_class TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        intervention_id TEXT REFERENCES interventions(id),
        payload_preview TEXT NOT NULL DEFAULT '',
        idempotency_key TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        resolved_by TEXT,
        decision_reason TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );`,
      'CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);',
      'CREATE INDEX IF NOT EXISTS idx_approvals_domain_scope ON approvals(domain, scope);',
      'CREATE INDEX IF NOT EXISTS idx_approvals_idempotency ON approvals(idempotency_key);',
      'CREATE INDEX IF NOT EXISTS idx_approvals_intervention ON approvals(intervention_id);',

      `CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        provider_kind TEXT NOT NULL,
        label TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'read_only',
        secret_ref_id TEXT REFERENCES secret_refs(id),
        enabled INTEGER NOT NULL DEFAULT 1,
        sync_interval_seconds INTEGER NOT NULL DEFAULT 900,
        allowed_scopes TEXT NOT NULL DEFAULT '[]',
        allowed_resources TEXT NOT NULL DEFAULT '[]',
        last_sync_at TEXT,
        last_sync_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS idx_connections_domain ON connections(domain);',
      'CREATE INDEX IF NOT EXISTS idx_connections_provider ON connections(provider_kind);',

      `CREATE TABLE IF NOT EXISTS context_releases (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        vault_id TEXT,
        source_ref TEXT NOT NULL,
        release_level TEXT NOT NULL,
        approval_id TEXT REFERENCES approvals(id),
        run_id TEXT REFERENCES runs(id),
        token_estimate INTEGER NOT NULL DEFAULT 0,
        redacted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS idx_context_releases_domain ON context_releases(domain);',
      'CREATE INDEX IF NOT EXISTS idx_context_releases_run ON context_releases(run_id);',
      'CREATE INDEX IF NOT EXISTS idx_context_releases_approval ON context_releases(approval_id);',
    ],
  },
  {
    id: '014-execution-profiles',
    statements: [
      "ALTER TABLE agent_profiles ADD COLUMN description TEXT NOT NULL DEFAULT '';",
      "ALTER TABLE agent_profiles ADD COLUMN mode TEXT NOT NULL DEFAULT 'interactive';",
      "ALTER TABLE agent_profiles ADD COLUMN model_policy TEXT NOT NULL DEFAULT 'inherit';",
      "ALTER TABLE agent_profiles ADD COLUMN allowed_runtime_tools_json TEXT NOT NULL DEFAULT '[]';",
      "ALTER TABLE agent_profiles ADD COLUMN allowed_capability_ids_json TEXT NOT NULL DEFAULT '[]';",
      "ALTER TABLE agent_profiles ADD COLUMN memory_scope TEXT NOT NULL DEFAULT 'workspace';",
      "ALTER TABLE agent_profiles ADD COLUMN recall_scope TEXT NOT NULL DEFAULT 'workspace';",
      "ALTER TABLE agent_profiles ADD COLUMN filesystem_policy_class TEXT NOT NULL DEFAULT 'workspace';",
      "ALTER TABLE agent_profiles ADD COLUMN context_release_policy TEXT NOT NULL DEFAULT 'summary_only';",
      'ALTER TABLE agent_profiles ADD COLUMN updated_at TEXT;',
      "ALTER TABLE tasks ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'default';",
      "ALTER TABLE runs ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'default';",
      'CREATE INDEX IF NOT EXISTS idx_tasks_profile_id ON tasks(profile_id);',
      'CREATE INDEX IF NOT EXISTS idx_runs_profile_id ON runs(profile_id);',
    ],
  },
  {
    id: '015-execution-envelopes',
    statements: [
      `CREATE TABLE IF NOT EXISTS execution_envelopes (
        run_id TEXT PRIMARY KEY REFERENCES runs(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        profile_id TEXT NOT NULL REFERENCES agent_profiles(id),
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        project_id TEXT REFERENCES projects(id),
        mode TEXT NOT NULL,
        model_policy TEXT NOT NULL,
        allowed_runtime_tools_json TEXT NOT NULL,
        allowed_capability_ids_json TEXT NOT NULL,
        memory_scope TEXT NOT NULL,
        recall_scope TEXT NOT NULL,
        filesystem_policy_class TEXT NOT NULL,
        context_release_policy TEXT NOT NULL,
        read_roots_json TEXT NOT NULL,
        write_roots_json TEXT NOT NULL,
        protected_paths_json TEXT NOT NULL,
        scratch_root TEXT NOT NULL,
        cwd TEXT,
        provenance_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS idx_execution_envelopes_profile_id ON execution_envelopes(profile_id);',
      'CREATE INDEX IF NOT EXISTS idx_execution_envelopes_workspace_id ON execution_envelopes(workspace_id);',
    ],
  },
  {
    id: '016-policy-automation',
    statements: [
      "ALTER TABLE approvals ADD COLUMN action_kind TEXT NOT NULL DEFAULT 'read';",
      "ALTER TABLE approvals ADD COLUMN resource_scope TEXT NOT NULL DEFAULT 'resource';",
      'ALTER TABLE approvals ADD COLUMN run_id TEXT REFERENCES runs(id);',
      'ALTER TABLE approvals ADD COLUMN standing_approval_eligible INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE approvals ADD COLUMN automation_grant_eligible INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE approvals ADD COLUMN resolved_by_grant_id TEXT;',
      'CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id);',
      'CREATE INDEX IF NOT EXISTS idx_approvals_action_kind ON approvals(action_kind);',
      `CREATE TABLE IF NOT EXISTS standing_approvals (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        domain TEXT NOT NULL,
        action_kind TEXT NOT NULL,
        resource_scope TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        requested_by TEXT,
        workspace_id TEXT REFERENCES workspaces(id),
        project_id TEXT REFERENCES projects(id),
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        expires_at TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by TEXT
      );`,
      'CREATE INDEX IF NOT EXISTS idx_standing_approvals_match ON standing_approvals(status, scope, domain, action_kind, resource_type);',
      'CREATE INDEX IF NOT EXISTS idx_standing_approvals_workspace ON standing_approvals(workspace_id, project_id);',
      `CREATE TABLE IF NOT EXISTS automation_grants (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        domain TEXT NOT NULL,
        action_kind TEXT NOT NULL,
        resource_scope TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        requested_by TEXT,
        workspace_id TEXT REFERENCES workspaces(id),
        project_id TEXT REFERENCES projects(id),
        task_sources_json TEXT NOT NULL DEFAULT '["heartbeat","schedule"]',
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        expires_at TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by TEXT
      );`,
      'CREATE INDEX IF NOT EXISTS idx_automation_grants_match ON automation_grants(status, scope, domain, action_kind, resource_type);',
      'CREATE INDEX IF NOT EXISTS idx_automation_grants_workspace ON automation_grants(workspace_id, project_id);',
    ],
  },
  {
    id: '017-provider-oauth-and-connection-rollups',
    statements: [
      "ALTER TABLE connections ADD COLUMN health_json TEXT NOT NULL DEFAULT '{}';",
      "ALTER TABLE connections ADD COLUMN sync_json TEXT NOT NULL DEFAULT '{}';",
      `CREATE TABLE IF NOT EXISTS oauth_sessions (
        id TEXT PRIMARY KEY,
        provider_kind TEXT NOT NULL,
        domain TEXT NOT NULL,
        status TEXT NOT NULL,
        connection_mode TEXT NOT NULL,
        sync_interval_seconds INTEGER NOT NULL DEFAULT 900,
        connection_id TEXT REFERENCES connections(id),
        state_token TEXT NOT NULL,
        pkce_verifier TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        authorization_url TEXT NOT NULL,
        error TEXT,
        account_id TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        completed_at TEXT
      );`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_sessions_state ON oauth_sessions(state_token);',
      'CREATE INDEX IF NOT EXISTS idx_oauth_sessions_status ON oauth_sessions(status);',
      'CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires ON oauth_sessions(expires_at);',
    ],
  },
  {
    id: '018-connection-resource-rules',
    statements: [
      "ALTER TABLE connections ADD COLUMN resource_rules_json TEXT NOT NULL DEFAULT '[]';",
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
  {
    id: '009-domain-fields',
    statements: [
      "ALTER TABLE memories ADD COLUMN domain TEXT DEFAULT 'general';",
      "ALTER TABLE memories ADD COLUMN context_release_policy TEXT DEFAULT 'full';",
      'CREATE INDEX IF NOT EXISTS idx_memory_sources_source_ref ON memory_sources(source_type, source_ref);',
    ],
  },
  {
    id: '010-structured-memory',
    statements: [
      `CREATE TABLE IF NOT EXISTS memory_namespaces (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        external_ref TEXT,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_namespaces_kind_ref ON memory_namespaces(kind, external_ref);',
      `CREATE TABLE IF NOT EXISTS memory_tags (
        id TEXT PRIMARY KEY,
        owner_kind TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS idx_memory_tags_owner ON memory_tags(owner_kind, owner_id);',
      'CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);',
      `CREATE TABLE IF NOT EXISTS memory_artifacts (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        classification TEXT NOT NULL,
        scope TEXT NOT NULL,
        namespace_id TEXT NOT NULL REFERENCES memory_namespaces(id),
        source_run_id TEXT,
        source_ref TEXT,
        source_ref_type TEXT,
        captured_at TEXT NOT NULL,
        occurred_at TEXT,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );`,
      'CREATE INDEX IF NOT EXISTS idx_memory_artifacts_scope ON memory_artifacts(scope, source_type, captured_at);',
      'CREATE INDEX IF NOT EXISTS idx_memory_artifacts_hash ON memory_artifacts(content_hash);',
      `CREATE TABLE IF NOT EXISTS memory_facts (
        id TEXT PRIMARY KEY,
        namespace_id TEXT NOT NULL REFERENCES memory_namespaces(id),
        scope TEXT NOT NULL,
        classification TEXT NOT NULL,
        source_type TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        fact_kind TEXT NOT NULL,
        text TEXT NOT NULL,
        confidence REAL NOT NULL,
        source_reliability REAL NOT NULL,
        extraction_confidence REAL NOT NULL,
        human_confirmed INTEGER NOT NULL DEFAULT 0,
        occurred_at TEXT,
        valid_from TEXT,
        valid_to TEXT,
        source_run_id TEXT,
        source_timestamp TEXT,
        dedup_key TEXT,
        last_reinforced_at TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        durable INTEGER NOT NULL DEFAULT 0,
        revision_status TEXT NOT NULL DEFAULT 'active'
      );`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_facts_dedup_key ON memory_facts(dedup_key) WHERE dedup_key IS NOT NULL;',
      'CREATE INDEX IF NOT EXISTS idx_memory_facts_scope ON memory_facts(scope, memory_type, created_at);',
      'CREATE INDEX IF NOT EXISTS idx_memory_facts_namespace ON memory_facts(namespace_id, archived_at);',
      'CREATE INDEX IF NOT EXISTS idx_memory_facts_occurred ON memory_facts(occurred_at);',
      `CREATE TABLE IF NOT EXISTS memory_fact_sources (
        id TEXT PRIMARY KEY,
        fact_id TEXT NOT NULL REFERENCES memory_facts(id),
        artifact_id TEXT NOT NULL REFERENCES memory_artifacts(id),
        excerpt TEXT,
        created_at TEXT NOT NULL
      );`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_fact_sources_pair ON memory_fact_sources(fact_id, artifact_id);',
      `CREATE TABLE IF NOT EXISTS memory_revisions (
        id TEXT PRIMARY KEY,
        relation_type TEXT NOT NULL,
        source_fact_id TEXT NOT NULL REFERENCES memory_facts(id),
        target_fact_id TEXT NOT NULL REFERENCES memory_facts(id),
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS idx_memory_revisions_source ON memory_revisions(source_fact_id);',
      'CREATE INDEX IF NOT EXISTS idx_memory_revisions_target ON memory_revisions(target_fact_id);',
      `CREATE TABLE IF NOT EXISTS memory_syntheses (
        id TEXT PRIMARY KEY,
        namespace_id TEXT NOT NULL REFERENCES memory_namespaces(id),
        scope TEXT NOT NULL,
        classification TEXT NOT NULL,
        synthesis_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        confidence REAL NOT NULL,
        refresh_policy TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );`,
      'CREATE INDEX IF NOT EXISTS idx_memory_syntheses_scope ON memory_syntheses(scope, synthesis_kind, updated_at);',
      `CREATE TABLE IF NOT EXISTS memory_synthesis_sources (
        id TEXT PRIMARY KEY,
        synthesis_id TEXT NOT NULL REFERENCES memory_syntheses(id),
        fact_id TEXT NOT NULL REFERENCES memory_facts(id),
        created_at TEXT NOT NULL
      );`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_synthesis_sources_pair ON memory_synthesis_sources(synthesis_id, fact_id);',
      'CREATE VIRTUAL TABLE IF NOT EXISTS memory_facts_fts USING fts5(fact_id UNINDEXED, text);',
      'CREATE VIRTUAL TABLE IF NOT EXISTS memory_syntheses_fts USING fts5(synthesis_id UNINDEXED, title, text);',
    ],
  },
  {
    id: '011-memory-locations',
    statements: [
      'ALTER TABLE memories ADD COLUMN workspace_id TEXT;',
      'ALTER TABLE memories ADD COLUMN project_id TEXT;',
      `UPDATE memories
       SET workspace_id = CASE
         WHEN scope = 'global' THEN NULL
         WHEN instr(scope, '/') > 0 THEN substr(scope, 1, instr(scope, '/') - 1)
         ELSE scope
       END
       WHERE workspace_id IS NULL;`,
      `UPDATE memories
       SET project_id = CASE
         WHEN scope = 'global' THEN NULL
         WHEN instr(scope, '/') > 0 THEN substr(scope, instr(scope, '/') + 1)
         ELSE NULL
       END
       WHERE project_id IS NULL;`,
      'CREATE INDEX IF NOT EXISTS idx_memories_location_created ON memories(workspace_id, project_id, created_at);',
    ],
  },
  {
    id: '012-structured-memory-locations',
    statements: [
      'ALTER TABLE memory_artifacts ADD COLUMN workspace_id TEXT;',
      'ALTER TABLE memory_artifacts ADD COLUMN project_id TEXT;',
      `UPDATE memory_artifacts
       SET workspace_id = CASE
         WHEN scope = 'global' THEN NULL
         WHEN instr(scope, '/') > 0 THEN substr(scope, 1, instr(scope, '/') - 1)
         ELSE scope
       END
       WHERE workspace_id IS NULL;`,
      `UPDATE memory_artifacts
       SET project_id = CASE
         WHEN scope = 'global' THEN NULL
         WHEN instr(scope, '/') > 0 THEN substr(scope, instr(scope, '/') + 1)
         ELSE NULL
       END
       WHERE project_id IS NULL;`,
      'CREATE INDEX IF NOT EXISTS idx_memory_artifacts_location_captured ON memory_artifacts(workspace_id, project_id, captured_at);',

      'ALTER TABLE memory_facts ADD COLUMN workspace_id TEXT;',
      'ALTER TABLE memory_facts ADD COLUMN project_id TEXT;',
      `UPDATE memory_facts
       SET workspace_id = CASE
         WHEN scope = 'global' THEN NULL
         WHEN instr(scope, '/') > 0 THEN substr(scope, 1, instr(scope, '/') - 1)
         ELSE scope
       END
       WHERE workspace_id IS NULL;`,
      `UPDATE memory_facts
       SET project_id = CASE
         WHEN scope = 'global' THEN NULL
         WHEN instr(scope, '/') > 0 THEN substr(scope, instr(scope, '/') + 1)
         ELSE NULL
       END
       WHERE project_id IS NULL;`,
      'CREATE INDEX IF NOT EXISTS idx_memory_facts_location_created ON memory_facts(workspace_id, project_id, created_at);',
      'CREATE INDEX IF NOT EXISTS idx_memory_facts_location_occurred ON memory_facts(workspace_id, project_id, occurred_at);',

      'ALTER TABLE memory_syntheses ADD COLUMN workspace_id TEXT;',
      'ALTER TABLE memory_syntheses ADD COLUMN project_id TEXT;',
      `UPDATE memory_syntheses
       SET workspace_id = CASE
         WHEN scope = 'global' THEN NULL
         WHEN instr(scope, '/') > 0 THEN substr(scope, 1, instr(scope, '/') - 1)
         ELSE scope
       END
       WHERE workspace_id IS NULL;`,
      `UPDATE memory_syntheses
       SET project_id = CASE
         WHEN scope = 'global' THEN NULL
         WHEN instr(scope, '/') > 0 THEN substr(scope, instr(scope, '/') + 1)
         ELSE NULL
       END
       WHERE project_id IS NULL;`,
      'CREATE INDEX IF NOT EXISTS idx_memory_syntheses_location_updated ON memory_syntheses(workspace_id, project_id, updated_at);',
    ],
  },
  {
    id: '013-coding-domain',
    statements: [
      "ALTER TABLE memory_facts ADD COLUMN domain TEXT DEFAULT 'general';",
      "ALTER TABLE memory_artifacts ADD COLUMN domain TEXT DEFAULT 'general';",
      "ALTER TABLE memory_syntheses ADD COLUMN domain TEXT DEFAULT 'general';",
      'CREATE INDEX IF NOT EXISTS idx_memory_facts_domain ON memory_facts(domain);',
      'CREATE INDEX IF NOT EXISTS idx_memory_artifacts_domain ON memory_artifacts(domain);',
      'CREATE INDEX IF NOT EXISTS idx_memory_syntheses_domain ON memory_syntheses(domain);',
    ],
  },
  {
    id: '014-retrieval-logs',
    statements: [
      `CREATE TABLE IF NOT EXISTS memory_retrieval_logs (
        id TEXT PRIMARY KEY,
        query_hash TEXT NOT NULL,
        query_text_redacted TEXT,
        strategy TEXT NOT NULL,
        filters_json TEXT NOT NULL DEFAULT '{}',
        candidate_counts_json TEXT NOT NULL DEFAULT '{}',
        selected_json TEXT NOT NULL DEFAULT '[]',
        feature_traces_json TEXT NOT NULL DEFAULT '{}',
        latency_ms REAL NOT NULL,
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS idx_retrieval_logs_created ON memory_retrieval_logs(created_at);',
      'CREATE INDEX IF NOT EXISTS idx_retrieval_logs_strategy ON memory_retrieval_logs(strategy);',
      'CREATE INDEX IF NOT EXISTS idx_retrieval_logs_query_hash ON memory_retrieval_logs(query_hash);',
    ],
  },
  {
    id: '015-source-streams',
    statements: [
      `CREATE TABLE IF NOT EXISTS memory_source_streams (
        id TEXT PRIMARY KEY,
        stable_key TEXT NOT NULL,
        provider_kind TEXT NOT NULL,
        source_type TEXT NOT NULL,
        external_id TEXT,
        namespace_id TEXT NOT NULL,
        workspace_id TEXT,
        project_id TEXT,
        title TEXT,
        canonical_uri TEXT,
        classification TEXT NOT NULL,
        context_release_policy TEXT NOT NULL DEFAULT 'full',
        trust_tier INTEGER NOT NULL DEFAULT 3,
        trust_score REAL NOT NULL DEFAULT 0.7,
        ingestion_status TEXT NOT NULL DEFAULT 'ready',
        last_processed_hash TEXT,
        last_sync_cursor TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_source_streams_stable_key ON memory_source_streams(stable_key);',
      'CREATE INDEX IF NOT EXISTS idx_source_streams_ns_status ON memory_source_streams(namespace_id, ingestion_status);',
      'CREATE INDEX IF NOT EXISTS idx_source_streams_location ON memory_source_streams(workspace_id, project_id);',
    ],
  },
  {
    id: '016-artifact-chunks',
    statements: [
      `CREATE TABLE IF NOT EXISTS memory_artifact_chunks (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        source_stream_id TEXT,
        chunk_index INTEGER NOT NULL,
        section_path TEXT,
        chunk_kind TEXT NOT NULL,
        text TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        language TEXT,
        classification TEXT NOT NULL,
        context_release_policy TEXT NOT NULL DEFAULT 'full',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        invalidated_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_chunks_artifact_idx ON memory_artifact_chunks(artifact_id, chunk_index);',
      'CREATE INDEX IF NOT EXISTS idx_artifact_chunks_stream ON memory_artifact_chunks(source_stream_id, invalidated_at);',
      'CREATE INDEX IF NOT EXISTS idx_artifact_chunks_hash ON memory_artifact_chunks(text_hash);',
      'CREATE VIRTUAL TABLE IF NOT EXISTS memory_artifact_chunks_fts USING fts5(chunk_id UNINDEXED, section_path, text);',
    ],
  },
  {
    id: '017-embedding-registry',
    statements: [
      `CREATE TABLE IF NOT EXISTS memory_embeddings (
        id TEXT PRIMARY KEY,
        owner_kind TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        embedding_version TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_owner ON memory_embeddings(owner_kind, owner_id);',
      'CREATE INDEX IF NOT EXISTS idx_embeddings_status_kind ON memory_embeddings(status, owner_kind);',
    ],
  },
  {
    id: '018-schema-extensions',
    statements: [
      // memory_artifacts extensions
      'ALTER TABLE memory_artifacts ADD COLUMN source_stream_id TEXT;',
      "ALTER TABLE memory_artifacts ADD COLUMN artifact_version INTEGER NOT NULL DEFAULT 1;",
      "ALTER TABLE memory_artifacts ADD COLUMN context_release_policy TEXT NOT NULL DEFAULT 'full';",
      'ALTER TABLE memory_artifacts ADD COLUMN trust_score REAL NOT NULL DEFAULT 0.7;',
      'ALTER TABLE memory_artifacts ADD COLUMN invalidated_at TEXT;',

      // memory_facts extensions
      'ALTER TABLE memory_facts ADD COLUMN root_fact_id TEXT;',
      'ALTER TABLE memory_facts ADD COLUMN parent_fact_id TEXT;',
      'ALTER TABLE memory_facts ADD COLUMN is_latest INTEGER NOT NULL DEFAULT 1;',
      'ALTER TABLE memory_facts ADD COLUMN claim_key TEXT;',
      'ALTER TABLE memory_facts ADD COLUMN salience REAL NOT NULL DEFAULT 0.5;',
      'ALTER TABLE memory_facts ADD COLUMN support_count INTEGER NOT NULL DEFAULT 1;',
      'ALTER TABLE memory_facts ADD COLUMN source_trust_score REAL NOT NULL DEFAULT 0.7;',
      "ALTER TABLE memory_facts ADD COLUMN context_release_policy TEXT NOT NULL DEFAULT 'full';",
      'ALTER TABLE memory_facts ADD COLUMN forget_after TEXT;',
      'ALTER TABLE memory_facts ADD COLUMN stale_after TEXT;',
      'ALTER TABLE memory_facts ADD COLUMN expired_at TEXT;',
      'ALTER TABLE memory_facts ADD COLUMN invalidated_at TEXT;',
      "ALTER TABLE memory_facts ADD COLUMN operator_status TEXT NOT NULL DEFAULT 'normal';",
      'CREATE INDEX IF NOT EXISTS idx_memory_facts_latest ON memory_facts(is_latest, archived_at);',
      'CREATE INDEX IF NOT EXISTS idx_memory_facts_claim_key ON memory_facts(claim_key);',
      'CREATE INDEX IF NOT EXISTS idx_memory_facts_forget ON memory_facts(forget_after);',

      // memory_fact_sources extensions
      'ALTER TABLE memory_fact_sources ADD COLUMN chunk_id TEXT;',
      'ALTER TABLE memory_fact_sources ADD COLUMN source_stream_id TEXT;',
      'ALTER TABLE memory_fact_sources ADD COLUMN confidence_contribution REAL NOT NULL DEFAULT 1.0;',

      // memory_syntheses extensions
      'ALTER TABLE memory_syntheses ADD COLUMN subject_kind TEXT;',
      'ALTER TABLE memory_syntheses ADD COLUMN subject_id TEXT;',
      'ALTER TABLE memory_syntheses ADD COLUMN refresh_due_at TEXT;',
      'ALTER TABLE memory_syntheses ADD COLUMN salience REAL NOT NULL DEFAULT 0.5;',
      'ALTER TABLE memory_syntheses ADD COLUMN quality_score REAL NOT NULL DEFAULT 0.7;',
      "ALTER TABLE memory_syntheses ADD COLUMN context_release_policy TEXT NOT NULL DEFAULT 'full';",
      'ALTER TABLE memory_syntheses ADD COLUMN invalidated_at TEXT;',
      "ALTER TABLE memory_syntheses ADD COLUMN operator_status TEXT NOT NULL DEFAULT 'normal';",
    ],
  },
  {
    id: '019-relations',
    statements: [
      `CREATE TABLE IF NOT EXISTS memory_relations (
        id TEXT PRIMARY KEY,
        relation_type TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        created_by TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS idx_relations_source ON memory_relations(source_kind, source_id);',
      'CREATE INDEX IF NOT EXISTS idx_relations_target ON memory_relations(target_kind, target_id);',
      'CREATE INDEX IF NOT EXISTS idx_relations_type ON memory_relations(relation_type);',
    ],
  },
  {
    id: '020-operator-actions',
    statements: [
      `CREATE TABLE IF NOT EXISTS memory_operator_actions (
        id TEXT PRIMARY KEY,
        action_kind TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS idx_operator_actions_target ON memory_operator_actions(target_kind, target_id);',
      'CREATE INDEX IF NOT EXISTS idx_operator_actions_kind ON memory_operator_actions(action_kind);',
    ],
  },
  {
    id: '021-drop-legacy-tables',
    statements: [
      'DROP TABLE IF EXISTS memories_fts;',
      'DROP TABLE IF EXISTS memory_vec;',
      'DROP TABLE IF EXISTS memory_consolidations;',
      'DROP TABLE IF EXISTS memory_sources;',
      'DROP TABLE IF EXISTS memory_events;',
      'DROP TABLE IF EXISTS memory_entity_mentions;',
      'DROP TABLE IF EXISTS memory_entities;',
      'DROP TABLE IF EXISTS memories;',
    ],
  },
];

function configure(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

export function applyMigrations(db: Database.Database, migrations: Migration[]): void {
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

  // Post-migration verification via MigrationManager
  const migrationManager = new MigrationManager(app);
  migrationManager.ensureSchemaTable();
  const verification = migrationManager.verifyPostMigration();
  if (!verification.ok) {
    for (const error of verification.errors) {
      console.warn(`[migration-manager] post-migration warning: ${error}`);
    }
  }

  return { app, memory, paths };
}
