import { chmodSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { initAuthStore } from './auth.ts';
import { openRuntimeDatabases, type RuntimeDatabases } from './database.ts';

function makeConfig(dir: string) {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
    telegram: {
      enabled: false,
      allowedUserId: undefined,
      maxMessagesPerMinute: 10,
      rateLimitWindowSeconds: 60,
    },
    embeddings: {
      provider: 'disabled' as const,
      allowedClassifications: ['embeddable'],
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
    memory: {
      confidenceHalfLifeDays: 30,
      archiveThreshold: 0.1,
      dailySummaryHour: 23,
      consolidationEnabled: true,
      compactionFlushConfidence: 0.7,
    },
    engine: { kind: 'fake' as const, command: 'node', args: [] },
    workspaces: [
      {
        id: 'default',
        name: 'Default workspace',
        heartbeatEnabled: true,
        heartbeatIntervalSeconds: 3600,
      },
    ],
  };
}

function openFresh(): { databases: RuntimeDatabases; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-db-'));
  chmodSync(dir, 0o700);
  const config = makeConfig(dir);
  const databases = openRuntimeDatabases(config);
  return { databases, dir };
}

function seedLegacyAppDatabase(dir: string): void {
  const stateDir = join(dir, 'state');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(stateDir, 'app.db'));
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE agent_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE instruction_snapshots (id TEXT PRIMARY KEY, scope TEXT NOT NULL, bundle_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, title TEXT NOT NULL, prompt TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, retry_policy_json TEXT NOT NULL, side_effect_profile TEXT NOT NULL, created_at TEXT NOT NULL, coalesce_key TEXT);
      CREATE TABLE jobs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, workspace_id TEXT NOT NULL, status TEXT NOT NULL, retry_count INTEGER NOT NULL, available_at TEXT NOT NULL, last_run_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, task_id TEXT NOT NULL, workspace_id TEXT NOT NULL, session_root_id TEXT NOT NULL, engine_session_ref TEXT, state TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, error TEXT);
      CREATE TABLE interventions (id TEXT PRIMARY KEY, code TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);
      CREATE TABLE message_ingress (
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
        task_id TEXT,
        job_id TEXT,
        run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const appliedAt = '2026-03-13T00:00:00.000Z';
    for (const migrationId of [
      '001-app-schema',
      '002-app-message-ingress',
      '003-app-coalesce-key',
      '004-app-schema-hardening',
    ]) {
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(migrationId, appliedAt);
    }
    db.prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').run('ws-1', 'Workspace 1', appliedAt);
    db.prepare('INSERT INTO projects (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)').run('project-1', 'ws-1', 'Project 1', appliedAt);
  } finally {
    db.close();
  }
}

function seedLegacyMemoryDatabase(dir: string): void {
  const stateDir = join(dir, 'state');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(stateDir, 'memory.db'));
  try {
    db.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        classification TEXT NOT NULL,
        source_type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL,
        scope TEXT NOT NULL,
        created_at TEXT NOT NULL,
        memory_type TEXT DEFAULT 'episodic',
        dedup_key TEXT,
        last_reinforced_at TEXT,
        archived_at TEXT,
        source_run_id TEXT,
        source_timestamp TEXT
      );
      CREATE TABLE memory_events (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT DEFAULT '{}'
      );
      CREATE TABLE memory_sources (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE memory_consolidations (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        merged_into_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reason TEXT DEFAULT ''
      );
      CREATE VIRTUAL TABLE memories_fts USING fts5(description, content);
    `);
    const appliedAt = '2026-03-13T00:00:00.000Z';
    for (const migrationId of [
      '001-memory-schema',
      '002-memory-lifecycle',
      '003-memory-schema-enrichment',
      '004-memory-consolidation-reason',
      '005-memory-cleanup',
    ]) {
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(migrationId, appliedAt);
    }
    db.prepare(
      'INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, created_at, memory_type, dedup_key, last_reinforced_at, archived_at, source_run_id, source_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'm-beta',
      'Beta memory',
      'embeddable',
      'curated_memory',
      'beta content',
      0.9,
      'workspace',
      appliedAt,
      'semantic',
      'dedup-beta',
      appliedAt,
      null,
      null,
      appliedAt,
    );
    db.prepare('INSERT INTO memories_fts (rowid, description, content) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?, ?)').run('m-beta', 'Beta memory', 'beta content');
  } finally {
    db.close();
  }
}

function seedStructuredMemoryDatabaseBeforeLocationMigration(dir: string): void {
  const stateDir = join(dir, 'state');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(stateDir, 'memory.db'));
  try {
    db.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        classification TEXT NOT NULL,
        source_type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL,
        scope TEXT NOT NULL,
        created_at TEXT NOT NULL,
        memory_type TEXT DEFAULT 'episodic',
        dedup_key TEXT,
        last_reinforced_at TEXT,
        archived_at TEXT,
        source_run_id TEXT,
        source_timestamp TEXT,
        workspace_id TEXT,
        project_id TEXT,
        durable INTEGER NOT NULL DEFAULT 0,
        domain TEXT DEFAULT 'general',
        context_release_policy TEXT DEFAULT 'full'
      );
      CREATE TABLE memory_events (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT DEFAULT '{}'
      );
      CREATE TABLE memory_sources (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE memory_consolidations (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        merged_into_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reason TEXT DEFAULT ''
      );
      CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, description, content);
      CREATE TABLE memory_namespaces (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        external_ref TEXT,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE memory_tags (
        id TEXT PRIMARY KEY,
        owner_kind TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE memory_artifacts (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        classification TEXT NOT NULL,
        scope TEXT NOT NULL,
        namespace_id TEXT NOT NULL,
        source_run_id TEXT,
        source_ref TEXT,
        source_ref_type TEXT,
        captured_at TEXT NOT NULL,
        occurred_at TEXT,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE memory_facts (
        id TEXT PRIMARY KEY,
        namespace_id TEXT NOT NULL,
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
      );
      CREATE TABLE memory_fact_sources (
        id TEXT PRIMARY KEY,
        fact_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        excerpt TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE memory_revisions (
        id TEXT PRIMARY KEY,
        relation_type TEXT NOT NULL,
        source_fact_id TEXT NOT NULL,
        target_fact_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE memory_syntheses (
        id TEXT PRIMARY KEY,
        namespace_id TEXT NOT NULL,
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
      );
      CREATE TABLE memory_synthesis_sources (
        id TEXT PRIMARY KEY,
        synthesis_id TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE memory_facts_fts USING fts5(fact_id UNINDEXED, text);
      CREATE VIRTUAL TABLE memory_syntheses_fts USING fts5(synthesis_id UNINDEXED, title, text);
    `);
    const appliedAt = '2026-03-13T00:00:00.000Z';
    for (const migrationId of [
      '001-memory-schema',
      '002-memory-lifecycle',
      '003-memory-schema-enrichment',
      '004-memory-consolidation-reason',
      '005-memory-cleanup',
      '006-memory-fts-stable-id',
      '007-memory-enhancements',
      '008-memory-summary-dag',
      '009-domain-fields',
      '010-structured-memory',
      '011-memory-locations',
    ]) {
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(migrationId, appliedAt);
    }

    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-workspace', 'workspace', 'ws-1', 'Workspace ws-1', appliedAt, appliedAt);
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-project', 'project', 'ws-1/proj-1', 'Project ws-1/proj-1', appliedAt, appliedAt);
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-global', 'global', null, 'Global', appliedAt, appliedAt);

    db.prepare(
      'INSERT INTO memory_artifacts (id, source_type, classification, scope, namespace_id, source_run_id, source_ref, source_ref_type, captured_at, occurred_at, content, content_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('artifact-1', 'receipt', 'internal', 'ws-1/proj-1', 'ns-project', 'run-1', 'receipt-1', 'receipt', appliedAt, appliedAt, 'artifact content', 'artifact-hash', '{}');
    db.prepare(
      'INSERT INTO memory_facts (id, namespace_id, scope, classification, source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence, human_confirmed, occurred_at, valid_from, valid_to, source_run_id, source_timestamp, dedup_key, last_reinforced_at, archived_at, created_at, durable, revision_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('fact-1', 'ns-workspace', 'ws-1', 'internal', 'receipt', 'semantic', 'state', 'workspace fact', 0.8, 0.9, 0.9, 0, appliedAt, null, null, 'run-1', appliedAt, 'dedup-fact', appliedAt, null, appliedAt, 0, 'active');
    db.prepare(
      'INSERT INTO memory_syntheses (id, namespace_id, scope, classification, synthesis_kind, title, text, confidence, refresh_policy, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('synth-1', 'ns-global', 'global', 'internal', 'daily', 'Daily global', 'global synthesis', 0.75, 'manual', appliedAt, appliedAt, null);
  } finally {
    db.close();
  }
}

describe('openRuntimeDatabases', () => {
  describe('Test 1: All tables created', () => {
    it('creates all expected app DB tables', () => {
      const { databases } = openFresh();
      try {
        const rows = databases.app
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all() as { name: string }[];
        const tableNames = rows.map((r) => r.name);

        const expectedAppTables = [
          'schema_migrations',
          'daemon_state',
          'browser_sessions',
          'workspaces',
          'projects',
          'agent_profiles',
          'tasks',
          'schedules',
          'jobs',
          'job_leases',
          'locks',
          'session_roots',
          'runs',
          'run_events',
          'execution_envelopes',
          'receipts',
          'instruction_snapshots',
          'interventions',
          'security_audit',
          'messages',
          'message_ingress',
          'telegram_relay_checkpoints',
          'telegram_reply_deliveries',
        ];

        for (const table of expectedAppTables) {
          expect(tableNames, `missing app table: ${table}`).toContain(table);
        }
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('does not contain the dropped run_outputs table', () => {
      const { databases } = openFresh();
      try {
        const rows = databases.app
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='run_outputs'")
          .all();
        expect(rows).toHaveLength(0);
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('does not contain dropped memory_embeddings and retrieval_cache tables', () => {
      const { databases } = openFresh();
      try {
        const embeddings = databases.memory
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'")
          .all();
        const cache = databases.memory
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='retrieval_cache'")
          .all();
        expect(embeddings).toHaveLength(0);
        expect(cache).toHaveLength(0);
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('creates all expected memory DB tables', () => {
      const { databases } = openFresh();
      try {
        const rows = databases.memory
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all() as { name: string }[];
        const tableNames = rows.map((r) => r.name);

        const expectedMemoryTables = [
          'schema_migrations',
          'memories',
          'memory_events',
          'memory_sources',
          'memory_consolidations',
          'memory_namespaces',
          'memory_tags',
          'memory_artifacts',
          'memory_facts',
          'memory_fact_sources',
          'memory_revisions',
          'memory_syntheses',
          'memory_synthesis_sources',
          'memories_fts',
          'memory_facts_fts',
          'memory_syntheses_fts',
        ];

        for (const table of expectedMemoryTables) {
          expect(tableNames, `missing memory table: ${table}`).toContain(table);
        }
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });
  });

  describe('Test 2: FK constraints enforced', () => {
    it('has PRAGMA foreign_keys enabled', () => {
      const { databases } = openFresh();
      try {
        const appResult = databases.app.pragma('foreign_keys') as { foreign_keys: number }[];
        const memResult = databases.memory.pragma('foreign_keys') as { foreign_keys: number }[];
        expect(appResult[0].foreign_keys).toBe(1);
        expect(memResult[0].foreign_keys).toBe(1);
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('rejects a run with a bogus job_id (FK violation)', () => {
      const { databases } = openFresh();
      try {
        // First insert a workspace and task so those FKs are satisfied
        databases.app
          .prepare("INSERT INTO workspaces (id, name, created_at) VALUES ('ws-1', 'Test', '2025-01-01T00:00:00Z')")
          .run();
        databases.app
          .prepare(
            "INSERT INTO tasks (id, workspace_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at) VALUES ('task-1', 'ws-1', 'Test', 'Do stuff', 'manual', 'pending', '{}', 'safe', '2025-01-01T00:00:00Z')",
          )
          .run();

        // Attempt to insert a run with a non-existent job_id
        expect(() => {
          databases.app
            .prepare(
              "INSERT INTO runs (id, job_id, task_id, workspace_id, session_root_id, state, started_at) VALUES ('run-1', 'bogus-job-id', 'task-1', 'ws-1', 'sr-1', 'running', '2025-01-01T00:00:00Z')",
            )
            .run();
        }).toThrow(/FOREIGN KEY constraint failed/);
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });
  });

  describe('Test 3: Indexes exist', () => {
    it('has core scheduler and execution-profile indexes', () => {
      const { databases } = openFresh();
      try {
        const rows = databases.app
          .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
          .all() as { name: string }[];
        const indexNames = rows.map((r) => r.name);

        const expectedIndexes = [
          'idx_browser_sessions_expires',
          'idx_jobs_status_created',
          'idx_jobs_workspace_status',
          'idx_jobs_task_status',
          'idx_tasks_profile_id',
          'idx_runs_state_finished',
          'idx_runs_job_id',
          'idx_runs_profile_id',
          'idx_runs_started_at',
          'idx_execution_envelopes_profile_id',
          'idx_execution_envelopes_workspace_id',
          'idx_run_events_run_id',
          'idx_receipts_run_status',
          'idx_job_leases_expires',
          'idx_tasks_workspace',
          'idx_projects_workspace',
        ];

        for (const idx of expectedIndexes) {
          expect(indexNames, `missing index: ${idx}`).toContain(idx);
        }
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('has memory retrieval indexes', () => {
      const { databases } = openFresh();
      try {
        const rows = databases.memory
          .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
          .all() as { name: string }[];
        const indexNames = rows.map((r) => r.name);

        for (const idx of [
          'idx_memories_location_created',
          'idx_memories_dedup_key',
          'idx_memory_artifacts_location_captured',
          'idx_memory_facts_scope',
          'idx_memory_facts_location_created',
          'idx_memory_syntheses_scope',
          'idx_memory_syntheses_location_updated',
        ]) {
          expect(indexNames, `missing memory index: ${idx}`).toContain(idx);
        }
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('has message_ingress indexes', () => {
      const { databases } = openFresh();
      try {
        const messageIngressRows = databases.app
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_message_ingress%' ORDER BY name",
          )
          .all() as { name: string }[];
        const telegramRows = databases.app
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_telegram_reply_deliveries%' ORDER BY name",
          )
          .all() as { name: string }[];
        const indexNames = messageIngressRows.map((r) => r.name);
        const telegramIndexNames = telegramRows.map((r) => r.name);

        expect(indexNames).toContain('idx_message_ingress_source_chat_message');
        expect(indexNames).toContain('idx_message_ingress_source_sender_created');
        expect(indexNames).toContain('idx_message_ingress_source_chat_created');
        expect(indexNames).toContain('idx_message_ingress_idempotency_key');
        expect(telegramIndexNames).toContain('idx_telegram_reply_deliveries_chat_message');
        expect(telegramIndexNames).toContain('idx_telegram_reply_deliveries_ingress');
        expect(telegramIndexNames).toContain('idx_telegram_reply_deliveries_run_id');
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('has memory location index', () => {
      const { databases } = openFresh();
      try {
        const rows = databases.memory
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memories_location_created'")
          .all() as { name: string }[];
        expect(rows).toHaveLength(1);
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('has tasks coalesce_key index', () => {
      const { databases } = openFresh();
      try {
        const rows = databases.app
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_coalesce_key'")
          .all() as { name: string }[];
        expect(rows).toHaveLength(1);
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });
  });

  describe('Test 4: Schema enrichment columns', () => {
    it('agent_profiles, tasks, and runs have execution-profile columns', () => {
      const { databases } = openFresh();
      try {
        const agentProfileColumns = databases.app.pragma('table_info(agent_profiles)') as Array<{ name: string }>;
        const taskColumns = databases.app.pragma('table_info(tasks)') as Array<{ name: string }>;
        const runColumns = databases.app.pragma('table_info(runs)') as Array<{ name: string }>;

        expect(agentProfileColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
          'description',
          'mode',
          'model_policy',
          'allowed_runtime_tools_json',
          'allowed_capability_ids_json',
          'memory_scope',
          'recall_scope',
          'filesystem_policy_class',
          'context_release_policy',
          'updated_at',
        ]));
        expect(taskColumns.map((column) => column.name)).toContain('profile_id');
        expect(runColumns.map((column) => column.name)).toContain('profile_id');
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('memories table has source_run_id, source_timestamp, and location columns', () => {
      const { databases } = openFresh();
      try {
        const columns = databases.memory.pragma('table_info(memories)') as {
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }[];
        const columnNames = columns.map((c) => c.name);

        expect(columnNames, 'missing memories.source_run_id').toContain('source_run_id');
        expect(columnNames, 'missing memories.source_timestamp').toContain('source_timestamp');
        expect(columnNames, 'missing memories.workspace_id').toContain('workspace_id');
        expect(columnNames, 'missing memories.project_id').toContain('project_id');
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('structured memory tables have explicit location columns', () => {
      const { databases } = openFresh();
      try {
        const artifactColumns = databases.memory.pragma('table_info(memory_artifacts)') as Array<{ name: string }>;
        const factColumns = databases.memory.pragma('table_info(memory_facts)') as Array<{ name: string }>;
        const synthesisColumns = databases.memory.pragma('table_info(memory_syntheses)') as Array<{ name: string }>;

        expect(artifactColumns.map((column) => column.name)).toEqual(expect.arrayContaining(['workspace_id', 'project_id']));
        expect(factColumns.map((column) => column.name)).toEqual(expect.arrayContaining(['workspace_id', 'project_id']));
        expect(synthesisColumns.map((column) => column.name)).toEqual(expect.arrayContaining(['workspace_id', 'project_id']));
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('memories table has lifecycle columns from migration 002', () => {
      const { databases } = openFresh();
      try {
        const columns = databases.memory.pragma('table_info(memories)') as {
          name: string;
          type: string;
        }[];
        const columnNames = columns.map((c) => c.name);

        expect(columnNames, 'missing memories.memory_type').toContain('memory_type');
        expect(columnNames, 'missing memories.dedup_key').toContain('dedup_key');
        expect(columnNames, 'missing memories.last_reinforced_at').toContain('last_reinforced_at');
        expect(columnNames, 'missing memories.archived_at').toContain('archived_at');
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('memory_events table has payload column from migration 002', () => {
      const { databases } = openFresh();
      try {
        const columns = databases.memory.pragma('table_info(memory_events)') as {
          name: string;
        }[];
        const columnNames = columns.map((c) => c.name);

        expect(columnNames, 'missing memory_events.payload').toContain('payload');
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });
  });

  describe('Test 5: Migration idempotency', () => {
    it('can open databases twice on the same directory without errors', () => {
      const dir = mkdtempSync(join(tmpdir(), 'popeye-db-idempotent-'));
      chmodSync(dir, 0o700);
      const config = makeConfig(dir);

      // First open: applies all migrations
      const first = openRuntimeDatabases(config);
      first.app.close();
      first.memory.close();

      // Second open: should skip already-applied migrations without error
      const second = openRuntimeDatabases(config);
      try {
        // Verify tables still exist after second pass
        const appTables = second.app
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runs'")
          .all() as { name: string }[];
        expect(appTables).toHaveLength(1);

        const memoryTables = second.memory
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'")
          .all() as { name: string }[];
        expect(memoryTables).toHaveLength(1);

        // Verify migration records were not duplicated
        const appMigrations = second.app
          .prepare('SELECT id FROM schema_migrations ORDER BY id')
          .all() as { id: string }[];
        const appMigrationIds = appMigrations.map((r) => r.id);
        const uniqueAppIds = [...new Set(appMigrationIds)];
        expect(appMigrationIds).toEqual(uniqueAppIds);

        const memMigrations = second.memory
          .prepare('SELECT id FROM schema_migrations ORDER BY id')
          .all() as { id: string }[];
        const memMigrationIds = memMigrations.map((r) => r.id);
        const uniqueMemIds = [...new Set(memMigrationIds)];
        expect(memMigrationIds).toEqual(uniqueMemIds);
      } finally {
        second.app.close();
        second.memory.close();
      }
    });

    it('records all expected migration IDs', () => {
      const { databases } = openFresh();
      try {
        const appMigrations = databases.app
          .prepare('SELECT id FROM schema_migrations ORDER BY id')
          .all() as { id: string }[];
        const appIds = appMigrations.map((r) => r.id);
        expect(appIds).toEqual([
          '001-app-schema',
          '002-app-message-ingress',
          '003-app-coalesce-key',
          '004-app-schema-hardening',
          '005-workspace-project-paths',
          '006-browser-sessions',
          '007-instruction-snapshot-project-context',
          '008-telegram-relay-state',
          '009-telegram-relay-workspace-scope',
          '010-telegram-reply-delivery-observability',
          '011-telegram-operator-resolution',
          '012-telegram-send-attempts',
          '013-policy-substrate',
          '014-execution-profiles',
          '015-execution-envelopes',
          '016-policy-automation',
          '017-provider-oauth-and-connection-rollups',
        ]);

        const memMigrations = databases.memory
          .prepare('SELECT id FROM schema_migrations ORDER BY id')
          .all() as { id: string }[];
        const memIds = memMigrations.map((r) => r.id);
        expect(memIds).toEqual([
          '001-memory-schema',
          '002-memory-lifecycle',
          '003-memory-schema-enrichment',
          '004-memory-consolidation-reason',
          '005-memory-cleanup',
          '006-memory-fts-stable-id',
          '007-memory-enhancements',
          '008-memory-summary-dag',
          '009-domain-fields',
          '010-structured-memory',
          '011-memory-locations',
          '012-structured-memory-locations',
        ]);
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('applies app migration 005 and preserves workspace/project rows', () => {
      const dir = mkdtempSync(join(tmpdir(), 'popeye-db-app-upgrade-'));
      chmodSync(dir, 0o700);
      seedLegacyAppDatabase(dir);

      const databases = openRuntimeDatabases(makeConfig(dir));
      try {
        const migrationIds = databases.app
          .prepare('SELECT id FROM schema_migrations ORDER BY id')
          .all() as Array<{ id: string }>;
        expect(migrationIds.map((row) => row.id)).toContain('005-workspace-project-paths');
        expect(migrationIds.map((row) => row.id)).toContain('007-instruction-snapshot-project-context');
        expect(migrationIds.map((row) => row.id)).toContain('008-telegram-relay-state');
        expect(migrationIds.map((row) => row.id)).toContain('009-telegram-relay-workspace-scope');
        expect(migrationIds.map((row) => row.id)).toContain('010-telegram-reply-delivery-observability');
        expect(migrationIds.map((row) => row.id)).toContain('014-execution-profiles');
        expect(migrationIds.map((row) => row.id)).toContain('015-execution-envelopes');

        const workspaceColumns = databases.app.pragma('table_info(workspaces)') as Array<{ name: string }>;
        expect(workspaceColumns.map((column) => column.name)).toContain('root_path');

        const projectColumns = databases.app.pragma('table_info(projects)') as Array<{ name: string }>;
        expect(projectColumns.map((column) => column.name)).toContain('path');

        const snapshotColumns = databases.app.pragma('table_info(instruction_snapshots)') as Array<{ name: string }>;
        expect(snapshotColumns.map((column) => column.name)).toContain('project_id');

        const telegramDeliveryColumns = databases.app.pragma('table_info(telegram_reply_deliveries)') as Array<{ name: string }>;
        expect(telegramDeliveryColumns.map((column) => column.name)).toContain('sent_telegram_message_id');

        const agentProfileColumns = databases.app.pragma('table_info(agent_profiles)') as Array<{ name: string }>;
        expect(agentProfileColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
          'description',
          'mode',
          'model_policy',
          'allowed_runtime_tools_json',
          'allowed_capability_ids_json',
          'memory_scope',
          'recall_scope',
          'filesystem_policy_class',
          'context_release_policy',
          'updated_at',
        ]));

        const taskColumns = databases.app.pragma('table_info(tasks)') as Array<{ name: string }>;
        expect(taskColumns.map((column) => column.name)).toContain('profile_id');

        const runColumns = databases.app.pragma('table_info(runs)') as Array<{ name: string }>;
        expect(runColumns.map((column) => column.name)).toContain('profile_id');

        const envelopeColumns = databases.app.pragma('table_info(execution_envelopes)') as Array<{ name: string }>;
        expect(envelopeColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
          'run_id',
          'task_id',
          'profile_id',
          'workspace_id',
          'project_id',
          'allowed_runtime_tools_json',
          'allowed_capability_ids_json',
          'memory_scope',
          'recall_scope',
          'filesystem_policy_class',
          'context_release_policy',
          'read_roots_json',
          'write_roots_json',
          'protected_paths_json',
          'scratch_root',
          'cwd',
          'provenance_json',
        ]));

        const workspace = databases.app.prepare('SELECT id, name, root_path FROM workspaces WHERE id = ?').get('ws-1') as {
          id: string;
          name: string;
          root_path: string | null;
        } | undefined;
        expect(workspace).toEqual({ id: 'ws-1', name: 'Workspace 1', root_path: null });

        const project = databases.app.prepare('SELECT id, workspace_id, name, path FROM projects WHERE id = ?').get('project-1') as {
          id: string;
          workspace_id: string;
          name: string;
          path: string | null;
        } | undefined;
        expect(project).toEqual({ id: 'project-1', workspace_id: 'ws-1', name: 'Project 1', path: null });
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('applies memory migration 006 and rebuilds FTS entries with stable memory IDs', () => {
      const dir = mkdtempSync(join(tmpdir(), 'popeye-db-memory-upgrade-'));
      chmodSync(dir, 0o700);
      seedLegacyMemoryDatabase(dir);

      const databases = openRuntimeDatabases(makeConfig(dir));
      try {
        const migrationIds = databases.memory
          .prepare('SELECT id FROM schema_migrations ORDER BY id')
          .all() as Array<{ id: string }>;
        expect(migrationIds.map((row) => row.id)).toContain('006-memory-fts-stable-id');
        expect(migrationIds.map((row) => row.id)).toContain('011-memory-locations');

        const ftsColumns = databases.memory.pragma('table_info(memories_fts)') as Array<{ name: string }>;
        expect(ftsColumns.map((column) => column.name)).toEqual(['memory_id', 'description', 'content']);

        const searchRows = databases.memory
          .prepare("SELECT memory_id, description FROM memories_fts WHERE memories_fts MATCH 'beta'")
          .all() as Array<{ memory_id: string; description: string }>;
        expect(searchRows).toEqual([{ memory_id: 'm-beta', description: 'Beta memory' }]);

        const locationRow = databases.memory
          .prepare('SELECT scope, workspace_id, project_id FROM memories WHERE id = ?')
          .get('m-beta') as { scope: string; workspace_id: string | null; project_id: string | null } | undefined;
        expect(locationRow).toEqual({
          scope: 'workspace',
          workspace_id: 'workspace',
          project_id: null,
        });
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });

    it('applies memory migration 012 and backfills structured location columns', () => {
      const dir = mkdtempSync(join(tmpdir(), 'popeye-db-structured-location-upgrade-'));
      chmodSync(dir, 0o700);
      seedStructuredMemoryDatabaseBeforeLocationMigration(dir);

      const databases = openRuntimeDatabases(makeConfig(dir));
      try {
        const migrationIds = databases.memory
          .prepare('SELECT id FROM schema_migrations ORDER BY id')
          .all() as Array<{ id: string }>;
        expect(migrationIds.map((row) => row.id)).toContain('012-structured-memory-locations');

        const artifact = databases.memory
          .prepare('SELECT scope, workspace_id, project_id FROM memory_artifacts WHERE id = ?')
          .get('artifact-1') as { scope: string; workspace_id: string | null; project_id: string | null } | undefined;
        expect(artifact).toEqual({
          scope: 'ws-1/proj-1',
          workspace_id: 'ws-1',
          project_id: 'proj-1',
        });

        const fact = databases.memory
          .prepare('SELECT scope, workspace_id, project_id FROM memory_facts WHERE id = ?')
          .get('fact-1') as { scope: string; workspace_id: string | null; project_id: string | null } | undefined;
        expect(fact).toEqual({
          scope: 'ws-1',
          workspace_id: 'ws-1',
          project_id: null,
        });

        const synthesis = databases.memory
          .prepare('SELECT scope, workspace_id, project_id FROM memory_syntheses WHERE id = ?')
          .get('synth-1') as { scope: string; workspace_id: string | null; project_id: string | null } | undefined;
        expect(synthesis).toEqual({
          scope: 'global',
          workspace_id: null,
          project_id: null,
        });
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });
  });
});
