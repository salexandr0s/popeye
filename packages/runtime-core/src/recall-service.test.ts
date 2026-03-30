import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MemorySearchQuery, MemorySearchResponse, MemoryRecord } from '@popeye/contracts';

import { RecallService } from './recall-service.js';

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT
    );

    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      session_root_id TEXT NOT NULL,
      state TEXT NOT NULL
    );

    CREATE TABLE receipts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT NOT NULL,
      usage_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      accepted INTEGER NOT NULL,
      related_run_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE message_ingress (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
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

    CREATE TABLE interventions (
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

    CREATE VIRTUAL TABLE receipts_fts USING fts5(receipt_id UNINDEXED, run_id UNINDEXED, workspace_id UNINDEXED, status, summary, details);
    CREATE VIRTUAL TABLE run_events_fts USING fts5(event_id UNINDEXED, run_id UNINDEXED, type, payload);
    CREATE VIRTUAL TABLE messages_fts USING fts5(message_id UNINDEXED, source, sender_id, body);
    CREATE VIRTUAL TABLE message_ingress_fts USING fts5(ingress_id UNINDEXED, workspace_id UNINDEXED, source, sender_id, decision_code, decision_reason, body);
    CREATE VIRTUAL TABLE interventions_fts USING fts5(intervention_id UNINDEXED, run_id UNINDEXED, code, status, reason);
  `);
}

describe('RecallService', () => {
  let db: Database.Database;
  let capturedMemoryQuery: MemorySearchQuery | null;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
    capturedMemoryQuery = null;

    db.prepare('INSERT INTO tasks (id, workspace_id, project_id) VALUES (?, ?, ?)').run('task-1', 'default', 'proj-1');
    db.prepare('INSERT INTO tasks (id, workspace_id, project_id) VALUES (?, ?, ?)').run('task-2', 'default', 'proj-2');

    db.prepare('INSERT INTO runs (id, task_id, workspace_id, session_root_id, state) VALUES (?, ?, ?, ?, ?)').run('run-1', 'task-1', 'default', 'session-1', 'completed');
    db.prepare('INSERT INTO runs (id, task_id, workspace_id, session_root_id, state) VALUES (?, ?, ?, ?, ?)').run('run-2', 'task-2', 'default', 'session-2', 'completed');

    db.prepare('INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('receipt-1', 'run-1', 'job-1', 'task-1', 'default', 'failed', 'Deploy credentials issue', 'Deployment failed because credentials were missing.', '{}', '2026-03-30T10:00:00.000Z');
    db.prepare('INSERT INTO receipts_fts (receipt_id, run_id, workspace_id, status, summary, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run('receipt-1', 'run-1', 'default', 'failed', 'Deploy credentials issue', 'Deployment failed because credentials were missing.');
    db.prepare('INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('receipt-2', 'run-2', 'job-2', 'task-2', 'default', 'succeeded', 'Sibling credentials', 'Sibling project credentials were repaired.', '{}', '2026-03-30T11:00:00.000Z');
    db.prepare('INSERT INTO receipts_fts (receipt_id, run_id, workspace_id, status, summary, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run('receipt-2', 'run-2', 'default', 'succeeded', 'Sibling credentials', 'Sibling project credentials were repaired.');

    db.prepare('INSERT INTO run_events (id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)').run('event-1', 'run-1', 'message', '{"content":"deploy credentials missing"}', '2026-03-30T10:01:00.000Z');
    db.prepare('INSERT INTO run_events_fts (event_id, run_id, type, payload) VALUES (?, ?, ?, ?)').run('event-1', 'run-1', 'message', '{"content":"deploy credentials missing"}');
    db.prepare('INSERT INTO run_events (id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)').run('event-2', 'run-2', 'message', '{"content":"sibling credentials fixed"}', '2026-03-30T11:01:00.000Z');
    db.prepare('INSERT INTO run_events_fts (event_id, run_id, type, payload) VALUES (?, ?, ?, ?)').run('event-2', 'run-2', 'message', '{"content":"sibling credentials fixed"}');

    db.prepare('INSERT INTO messages (id, source, sender_id, body, accepted, related_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('message-1', 'telegram', 'operator', 'Need deploy credentials help', 1, 'run-1', '2026-03-30T10:02:00.000Z');
    db.prepare('INSERT INTO messages_fts (message_id, source, sender_id, body) VALUES (?, ?, ?, ?)').run('message-1', 'telegram', 'operator', 'Need deploy credentials help');
    db.prepare('INSERT INTO messages (id, source, sender_id, body, accepted, related_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('message-2', 'telegram', 'operator', 'Sibling credentials discussion', 1, 'run-2', '2026-03-30T11:02:00.000Z');
    db.prepare('INSERT INTO messages_fts (message_id, source, sender_id, body) VALUES (?, ?, ?, ?)').run('message-2', 'telegram', 'operator', 'Sibling credentials discussion');

    db.prepare('INSERT INTO message_ingress (id, source, sender_id, workspace_id, body, accepted, decision_code, decision_reason, http_status, message_id, task_id, job_id, run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('ingress-1', 'telegram', 'operator', 'default', 'Deploy credentials please', 1, 'accepted', 'accepted', 200, 'message-1', 'task-1', 'job-1', 'run-1', '2026-03-30T10:03:00.000Z', '2026-03-30T10:03:00.000Z');
    db.prepare('INSERT INTO message_ingress_fts (ingress_id, workspace_id, source, sender_id, decision_code, decision_reason, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('ingress-1', 'default', 'telegram', 'operator', 'accepted', 'accepted', 'Deploy credentials please');
    db.prepare('INSERT INTO message_ingress (id, source, sender_id, workspace_id, body, accepted, decision_code, decision_reason, http_status, message_id, task_id, job_id, run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('ingress-2', 'telegram', 'operator', 'default', 'Sibling credentials please', 1, 'accepted', 'accepted', 200, 'message-2', 'task-2', 'job-2', 'run-2', '2026-03-30T11:03:00.000Z', '2026-03-30T11:03:00.000Z');
    db.prepare('INSERT INTO message_ingress_fts (ingress_id, workspace_id, source, sender_id, decision_code, decision_reason, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('ingress-2', 'default', 'telegram', 'operator', 'accepted', 'accepted', 'Sibling credentials please');

    db.prepare('INSERT INTO interventions (id, code, run_id, status, reason, created_at, resolved_at, updated_at, resolution_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('intervention-1', 'needs_credentials', 'run-1', 'open', 'Deploy credentials approval required', '2026-03-30T10:04:00.000Z', null, null, null);
    db.prepare('INSERT INTO interventions_fts (intervention_id, run_id, code, status, reason) VALUES (?, ?, ?, ?, ?)').run('intervention-1', 'run-1', 'needs_credentials', 'open', 'Deploy credentials approval required');
    db.prepare('INSERT INTO interventions (id, code, run_id, status, reason, created_at, resolved_at, updated_at, resolution_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('intervention-2', 'needs_credentials', 'run-2', 'open', 'Sibling credentials approval required', '2026-03-30T11:04:00.000Z', null, null, null);
    db.prepare('INSERT INTO interventions_fts (intervention_id, run_id, code, status, reason) VALUES (?, ?, ?, ?, ?)').run('intervention-2', 'run-2', 'needs_credentials', 'open', 'Sibling credentials approval required');
  });

  afterEach(() => {
    db.close();
  });

  it('searches across runtime artifacts and memory while enforcing project filters', async () => {
    const service = new RecallService({
      appDb: db,
      searchMemory: async (query: MemorySearchQuery): Promise<MemorySearchResponse> => {
        capturedMemoryQuery = query;
        const results = query.projectId === 'proj-1'
          ? [{
              id: 'memory-1',
              description: 'Stored deploy credential lesson',
              content: 'Remember the deploy credential rotation checklist.',
              type: 'semantic',
              confidence: 0.9,
              effectiveConfidence: 0.9,
              scope: 'default/proj-1',
              workspaceId: 'default',
              projectId: 'proj-1',
              sourceType: 'workspace_doc',
              createdAt: '2026-03-29T10:00:00.000Z',
              lastReinforcedAt: null,
              score: 0.91,
              layer: 'fact' as const,
              namespaceId: 'ns-project',
              occurredAt: null,
              validFrom: null,
              validTo: null,
              evidenceCount: 1,
              revisionStatus: 'active' as const,
              domain: 'general' as const,
              scoreBreakdown: {
                relevance: 0.9,
                recency: 0.8,
                confidence: 0.9,
                scopeMatch: 1,
              },
            }]
          : [];
        return {
          query: query.query,
          results,
          totalCandidates: results.length,
          latencyMs: 1,
          searchMode: 'fts_only',
        };
      },
      getMemory: () => null,
    });

    const response = await service.search({
      query: 'deploy credentials',
      workspaceId: 'default',
      projectId: 'proj-1',
      limit: 10,
    });

    expect(capturedMemoryQuery).toMatchObject({
      query: 'deploy credentials',
      workspaceId: 'default',
      projectId: 'proj-1',
    });
    expect(response.results.map((result) => result.sourceKind)).toEqual(
      expect.arrayContaining(['receipt', 'run_event', 'message', 'message_ingress', 'intervention', 'memory']),
    );
    expect(response.results.map((result) => result.sourceId)).toEqual(
      expect.arrayContaining(['receipt-1', 'event-1', 'message-1', 'ingress-1', 'intervention-1', 'memory-1']),
    );
    expect(response.results.map((result) => result.sourceId)).not.toEqual(
      expect.arrayContaining(['receipt-2', 'event-2', 'message-2', 'ingress-2', 'intervention-2']),
    );
  });

  it('returns normalized detail for app artifacts and memory', () => {
    const memoryRecord: MemoryRecord = {
      id: 'memory-1',
      description: 'Stored deploy credential lesson',
      classification: 'embeddable',
      sourceType: 'workspace_doc',
      content: 'Remember the deploy credential rotation checklist.',
      confidence: 0.9,
      scope: 'default/proj-1',
      workspaceId: 'default',
      projectId: 'proj-1',
      sourceRunId: 'run-1',
      sourceTimestamp: '2026-03-29T10:00:00.000Z',
      memoryType: 'semantic',
      dedupKey: null,
      lastReinforcedAt: null,
      archivedAt: null,
      createdAt: '2026-03-29T10:00:00.000Z',
      durable: true,
      domain: 'general',
      contextReleasePolicy: 'full',
    };
    const service = new RecallService({
      appDb: db,
      searchMemory: async () => ({
        query: 'unused',
        results: [],
        totalCandidates: 0,
        latencyMs: 0,
        searchMode: 'fts_only',
      }),
      getMemory: (memoryId) => (memoryId === memoryRecord.id ? memoryRecord : null),
    });

    const receiptDetail = service.getDetail('receipt', 'receipt-1');
    expect(receiptDetail).toMatchObject({
      sourceKind: 'receipt',
      sourceId: 'receipt-1',
      workspaceId: 'default',
      projectId: 'proj-1',
      runId: 'run-1',
      taskId: 'task-1',
      sessionRootId: 'session-1',
      status: 'failed',
    });
    expect(receiptDetail?.content).toContain('credentials were missing');

    const memoryDetail = service.getDetail('memory', 'memory-1');
    expect(memoryDetail).toMatchObject({
      sourceKind: 'memory',
      sourceId: 'memory-1',
      workspaceId: 'default',
      projectId: 'proj-1',
      runId: 'run-1',
      memorySourceType: 'workspace_doc',
    });
    expect(memoryDetail?.content).toContain('rotation checklist');
  });
});
