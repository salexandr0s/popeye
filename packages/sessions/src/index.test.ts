import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionRootKind } from '@popeye/contracts';

import { selectSessionRoot, SessionService } from './index.js';

// ---------------------------------------------------------------------------
// selectSessionRoot — pure function tests
// ---------------------------------------------------------------------------

describe('selectSessionRoot', () => {
  const allKinds: SessionRootKind[] = [
    'interactive_main',
    'system_heartbeat',
    'scheduled_task',
    'recovery',
    'telegram_user',
  ];

  it('creates deterministic ids', () => {
    expect(selectSessionRoot({ kind: 'system_heartbeat', scope: 'workspace-a' }).id).toBe(
      'system_heartbeat:workspace-a',
    );
  });

  it.each(allKinds)('produces correct ID format for kind "%s"', (kind) => {
    const result = selectSessionRoot({ kind, scope: 'my-scope' });
    expect(result.id).toBe(`${kind}:my-scope`);
  });

  it('returns the same ID for the same kind+scope (determinism)', () => {
    const a = selectSessionRoot({ kind: 'recovery', scope: 'proj-1' });
    const b = selectSessionRoot({ kind: 'recovery', scope: 'proj-1' });
    expect(a.id).toBe(b.id);
  });

  it('returns different IDs for different kind+scope combinations', () => {
    const ids = new Set(
      allKinds.map((kind) => selectSessionRoot({ kind, scope: 'same-scope' }).id),
    );
    expect(ids.size).toBe(allKinds.length);
  });

  it('returns different IDs for same kind with different scopes', () => {
    const a = selectSessionRoot({ kind: 'scheduled_task', scope: 'scope-a' });
    const b = selectSessionRoot({ kind: 'scheduled_task', scope: 'scope-b' });
    expect(a.id).not.toBe(b.id);
  });

  it('sets kind and scope fields correctly on the returned record', () => {
    const result = selectSessionRoot({ kind: 'telegram_user', scope: 'user-42' });
    expect(result.kind).toBe('telegram_user');
    expect(result.scope).toBe('user-42');
  });

  it('returns a valid ISO date string for createdAt', () => {
    const result = selectSessionRoot({ kind: 'interactive_main', scope: 'ws' });
    // ISO 8601 round-trip: parsing should not produce NaN
    const parsed = Date.parse(result.createdAt);
    expect(Number.isNaN(parsed)).toBe(false);
    // And the string should round-trip through Date
    expect(new Date(result.createdAt).toISOString()).toBe(result.createdAt);
  });

  it('handles empty scope string', () => {
    const result = selectSessionRoot({ kind: 'recovery', scope: '' });
    expect(result.id).toBe('recovery:');
    expect(result.scope).toBe('');
  });

  it('handles scope containing colons', () => {
    const result = selectSessionRoot({ kind: 'system_heartbeat', scope: 'a:b:c' });
    expect(result.id).toBe('system_heartbeat:a:b:c');
    expect(result.scope).toBe('a:b:c');
  });

  it('handles scope containing slashes', () => {
    const result = selectSessionRoot({ kind: 'scheduled_task', scope: 'path/to/project' });
    expect(result.id).toBe('scheduled_task:path/to/project');
    expect(result.scope).toBe('path/to/project');
  });

  it('handles scope containing spaces', () => {
    const result = selectSessionRoot({ kind: 'interactive_main', scope: 'my workspace' });
    expect(result.id).toBe('interactive_main:my workspace');
    expect(result.scope).toBe('my workspace');
  });
});

// ---------------------------------------------------------------------------
// SessionService — DB-backed tests
// ---------------------------------------------------------------------------

describe('SessionService', () => {
  let db: InstanceType<typeof Database>;
  let service: SessionService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create the two tables the service depends on, matching the runtime migration schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_roots (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interventions (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        run_id TEXT,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        updated_at TEXT,
        resolution_note TEXT
      );
    `);

    service = new SessionService({ app: db });
  });

  afterEach(() => {
    db.close();
  });

  // -- ensureSessionRoot -------------------------------------------------

  describe('ensureSessionRoot', () => {
    it('inserts a new session root', () => {
      const root = selectSessionRoot({ kind: 'system_heartbeat', scope: 'ws-1' });
      service.ensureSessionRoot(root);

      const rows = db.prepare('SELECT * FROM session_roots').all() as Array<{
        id: string;
        kind: string;
        scope: string;
        created_at: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('system_heartbeat:ws-1');
      expect(rows[0].kind).toBe('system_heartbeat');
      expect(rows[0].scope).toBe('ws-1');
    });

    it('is idempotent (INSERT OR IGNORE)', () => {
      const root = selectSessionRoot({ kind: 'recovery', scope: 'proj-x' });
      service.ensureSessionRoot(root);
      service.ensureSessionRoot(root);

      const rows = db.prepare('SELECT * FROM session_roots').all();
      expect(rows).toHaveLength(1);
    });

    it('does not overwrite an existing root with new data', () => {
      const first = selectSessionRoot({ kind: 'interactive_main', scope: 'ws-1' });
      service.ensureSessionRoot(first);

      // Second call with same id but potentially different createdAt
      const second = { ...first, createdAt: '2099-01-01T00:00:00.000Z' };
      service.ensureSessionRoot(second);

      const rows = db.prepare('SELECT * FROM session_roots').all() as Array<{
        created_at: string;
      }>;
      expect(rows).toHaveLength(1);
      // The original timestamp should be preserved
      expect(rows[0].created_at).toBe(first.createdAt);
    });
  });

  // -- listSessionRoots --------------------------------------------------

  describe('listSessionRoots', () => {
    it('returns an empty array when no roots exist', () => {
      expect(service.listSessionRoots()).toEqual([]);
    });

    it('returns inserted roots', () => {
      const root = selectSessionRoot({ kind: 'telegram_user', scope: 'u-1' });
      service.ensureSessionRoot(root);

      const list = service.listSessionRoots();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('telegram_user:u-1');
      expect(list[0].kind).toBe('telegram_user');
      expect(list[0].scope).toBe('u-1');
    });

    it('returns roots in ascending created_at order', () => {
      // Insert with explicit timestamps so ordering is deterministic
      const rootA = { id: 'recovery:a', kind: 'recovery' as const, scope: 'a', createdAt: '2025-01-01T00:00:00.000Z' };
      const rootB = { id: 'recovery:b', kind: 'recovery' as const, scope: 'b', createdAt: '2025-01-02T00:00:00.000Z' };
      const rootC = { id: 'recovery:c', kind: 'recovery' as const, scope: 'c', createdAt: '2024-12-31T00:00:00.000Z' };

      // Insert out of order
      service.ensureSessionRoot(rootB);
      service.ensureSessionRoot(rootC);
      service.ensureSessionRoot(rootA);

      const list = service.listSessionRoots();
      expect(list).toHaveLength(3);
      expect(list[0].id).toBe('recovery:c');
      expect(list[1].id).toBe('recovery:a');
      expect(list[2].id).toBe('recovery:b');
    });

    it('maps snake_case DB columns to camelCase record fields', () => {
      const root = selectSessionRoot({ kind: 'scheduled_task', scope: 'daily' });
      service.ensureSessionRoot(root);

      const list = service.listSessionRoots();
      expect(list[0]).toHaveProperty('createdAt');
      expect(list[0]).not.toHaveProperty('created_at');
    });
  });

  // -- createIntervention -------------------------------------------------

  describe('createIntervention', () => {
    it('creates an intervention record with correct fields', () => {
      const intervention = service.createIntervention('needs_credentials', 'run-1', 'Missing API key');

      expect(intervention.code).toBe('needs_credentials');
      expect(intervention.runId).toBe('run-1');
      expect(intervention.status).toBe('open');
      expect(intervention.reason).toBe('Missing API key');
      expect(intervention.resolvedAt).toBeNull();
      expect(intervention.id).toBeTruthy();
    });

    it('assigns a UUID id', () => {
      const intervention = service.createIntervention('auth_failure', null, 'Token expired');
      // UUID v4 format check
      expect(intervention.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('persists the intervention to the database', () => {
      const intervention = service.createIntervention('needs_policy_decision', null, 'Approve?');

      const row = db.prepare('SELECT * FROM interventions WHERE id = ?').get(intervention.id) as {
        id: string;
        code: string;
        status: string;
      };
      expect(row).toBeTruthy();
      expect(row.code).toBe('needs_policy_decision');
      expect(row.status).toBe('open');
    });

    it('allows null run_id', () => {
      const intervention = service.createIntervention('needs_operator_input', null, 'Need guidance');
      expect(intervention.runId).toBeNull();
    });

    it('sets createdAt to a valid ISO timestamp', () => {
      const intervention = service.createIntervention('retry_budget_exhausted', 'run-2', 'Max retries');
      const parsed = Date.parse(intervention.createdAt);
      expect(Number.isNaN(parsed)).toBe(false);
    });
  });

  // -- getIntervention ----------------------------------------------------

  describe('getIntervention', () => {
    it('retrieves an intervention by ID', () => {
      const created = service.createIntervention('needs_workspace_fix', 'run-3', 'Config error');
      const retrieved = service.getIntervention(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.code).toBe('needs_workspace_fix');
      expect(retrieved!.reason).toBe('Config error');
    });

    it('returns null for a non-existent ID', () => {
      const result = service.getIntervention('non-existent-id');
      expect(result).toBeNull();
    });

    it('maps snake_case DB columns to camelCase record fields', () => {
      const created = service.createIntervention('needs_instruction_fix', 'run-4', 'Bad instruction');
      const retrieved = service.getIntervention(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved).toHaveProperty('runId');
      expect(retrieved).toHaveProperty('createdAt');
      expect(retrieved).toHaveProperty('resolvedAt');
      expect(retrieved).not.toHaveProperty('run_id');
      expect(retrieved).not.toHaveProperty('created_at');
      expect(retrieved).not.toHaveProperty('resolved_at');
    });
  });

  // -- resolveIntervention ------------------------------------------------

  describe('resolveIntervention', () => {
    it('updates status to resolved', () => {
      const created = service.createIntervention('needs_credentials', 'run-5', 'Missing key');
      const resolved = service.resolveIntervention(created.id, 'Key added');

      expect(resolved).not.toBeNull();
      expect(resolved!.status).toBe('resolved');
    });

    it('sets resolvedAt to a valid ISO timestamp', () => {
      const created = service.createIntervention('auth_failure', null, 'Expired');
      const resolved = service.resolveIntervention(created.id);

      expect(resolved).not.toBeNull();
      expect(resolved!.resolvedAt).not.toBeNull();
      const parsed = Date.parse(resolved!.resolvedAt!);
      expect(Number.isNaN(parsed)).toBe(false);
    });

    it('sets updatedAt to a valid ISO timestamp', () => {
      const created = service.createIntervention('needs_policy_decision', null, 'Approve?');
      const resolved = service.resolveIntervention(created.id);

      expect(resolved).not.toBeNull();
      expect(resolved!.updatedAt).not.toBeNull();
      const parsed = Date.parse(resolved!.updatedAt!);
      expect(Number.isNaN(parsed)).toBe(false);
    });

    it('stores the resolution note', () => {
      const created = service.createIntervention('needs_operator_input', null, 'Need guidance');
      const resolved = service.resolveIntervention(created.id, 'Operator approved');

      expect(resolved).not.toBeNull();
      expect(resolved!.resolutionNote).toBe('Operator approved');
    });

    it('leaves resolutionNote as null when not provided', () => {
      const created = service.createIntervention('failed_final', 'run-6', 'Unrecoverable');
      const resolved = service.resolveIntervention(created.id);

      expect(resolved).not.toBeNull();
      expect(resolved!.resolutionNote).toBeNull();
    });

    it('returns null for a non-existent intervention ID', () => {
      const result = service.resolveIntervention('non-existent-id', 'note');
      expect(result).toBeNull();
    });
  });

  // -- listInterventions --------------------------------------------------

  describe('listInterventions', () => {
    it('returns an empty array when no interventions exist', () => {
      expect(service.listInterventions()).toEqual([]);
    });

    it('returns interventions in reverse chronological order (newest first)', () => {
      // Insert interventions with small delays simulated via explicit timestamps
      db.prepare(
        'INSERT INTO interventions (id, code, run_id, status, reason, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('i-1', 'needs_credentials', null, 'open', 'reason-1', '2025-01-01T00:00:00.000Z', null);
      db.prepare(
        'INSERT INTO interventions (id, code, run_id, status, reason, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('i-2', 'auth_failure', null, 'open', 'reason-2', '2025-01-03T00:00:00.000Z', null);
      db.prepare(
        'INSERT INTO interventions (id, code, run_id, status, reason, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('i-3', 'failed_final', null, 'open', 'reason-3', '2025-01-02T00:00:00.000Z', null);

      const list = service.listInterventions();
      expect(list).toHaveLength(3);
      // DESC order: i-2 (Jan 3), i-3 (Jan 2), i-1 (Jan 1)
      expect(list[0].id).toBe('i-2');
      expect(list[1].id).toBe('i-3');
      expect(list[2].id).toBe('i-1');
    });

    it('includes both open and resolved interventions', () => {
      service.createIntervention('needs_credentials', null, 'open one');
      const toResolve = service.createIntervention('auth_failure', null, 'will resolve');
      service.resolveIntervention(toResolve.id, 'done');

      const list = service.listInterventions();
      expect(list).toHaveLength(2);

      const statuses = list.map((i) => i.status);
      expect(statuses).toContain('open');
      expect(statuses).toContain('resolved');
    });
  });
});
