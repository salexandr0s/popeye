import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initAuthStore } from './auth.js';
import { openRuntimeDatabases, type RuntimeDatabases } from './database.js';

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
          'receipts',
          'instruction_snapshots',
          'interventions',
          'security_audit',
          'messages',
          'message_ingress',
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
          'memory_embeddings',
          'memory_sources',
          'memory_consolidations',
          'retrieval_cache',
          'memories_fts',
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
    it('has all 11 performance indexes from the hardening migration', () => {
      const { databases } = openFresh();
      try {
        const rows = databases.app
          .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
          .all() as { name: string }[];
        const indexNames = rows.map((r) => r.name);

        const expectedIndexes = [
          'idx_jobs_status_created',
          'idx_jobs_workspace_status',
          'idx_jobs_task_status',
          'idx_runs_state_finished',
          'idx_runs_job_id',
          'idx_runs_started_at',
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

    it('has message_ingress indexes', () => {
      const { databases } = openFresh();
      try {
        const rows = databases.app
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_message_ingress%' ORDER BY name",
          )
          .all() as { name: string }[];
        const indexNames = rows.map((r) => r.name);

        expect(indexNames).toContain('idx_message_ingress_source_chat_message');
        expect(indexNames).toContain('idx_message_ingress_source_sender_created');
        expect(indexNames).toContain('idx_message_ingress_source_chat_created');
        expect(indexNames).toContain('idx_message_ingress_idempotency_key');
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

  describe('Test 4: Memory enrichment columns', () => {
    it('memories table has source_run_id and source_timestamp columns', () => {
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
        ]);

        const memMigrations = databases.memory
          .prepare('SELECT id FROM schema_migrations ORDER BY id')
          .all() as { id: string }[];
        const memIds = memMigrations.map((r) => r.id);
        expect(memIds).toEqual([
          '001-memory-schema',
          '002-memory-lifecycle',
          '003-memory-schema-enrichment',
        ]);
      } finally {
        databases.app.close();
        databases.memory.close();
      }
    });
  });
});
