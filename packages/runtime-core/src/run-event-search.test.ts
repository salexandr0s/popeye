import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sanitizeFtsQuery, searchRunEvents } from './run-event-search.js';

// ---------------------------------------------------------------------------
// Schema setup helpers
// ---------------------------------------------------------------------------

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_root_id TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at TEXT NOT NULL,
      job_id TEXT,
      task_id TEXT,
      profile_id TEXT,
      engine_session_ref TEXT,
      finished_at TEXT,
      error TEXT,
      iterations_used INTEGER,
      parent_run_id TEXT,
      delegation_depth INTEGER DEFAULT 0
    );

    CREATE TABLE run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE run_events_fts USING fts5(
      event_id UNINDEXED,
      run_id UNINDEXED,
      type,
      payload
    );
  `);
}

function insertRun(
  db: Database.Database,
  id: string,
  workspaceId: string = 'ws-1',
): void {
  db.prepare(
    `INSERT INTO runs (id, workspace_id, session_root_id, state, started_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, `session-${id}`, 'completed', '2026-03-24T00:00:00Z');
}

function insertEvent(
  db: Database.Database,
  id: string,
  runId: string,
  type: string,
  payload: string,
  createdAt: string = '2026-03-24T12:00:00Z',
): void {
  db.prepare(
    `INSERT INTO run_events (id, run_id, type, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, runId, type, payload, createdAt);
  db.prepare(
    `INSERT INTO run_events_fts (event_id, run_id, type, payload)
     VALUES (?, ?, ?, ?)`,
  ).run(id, runId, type, payload);
}

// ---------------------------------------------------------------------------
// Tests — sanitizeFtsQuery
// ---------------------------------------------------------------------------

describe('sanitizeFtsQuery', () => {
  it('wraps normal words in quotes joined with OR', () => {
    expect(sanitizeFtsQuery('hello world')).toBe('"hello" OR "world"');
  });

  it('strips special FTS5 characters', () => {
    expect(sanitizeFtsQuery('hello* (test) "quoted"')).toBe('"hello" OR "test" OR "quoted"');
  });

  it('removes a leading NOT token', () => {
    expect(sanitizeFtsQuery('NOT something')).toBe('"something"');
  });

  it('returns empty-string match for empty input', () => {
    expect(sanitizeFtsQuery('')).toBe('""');
  });

  it('returns empty-string match for input with only special chars', () => {
    expect(sanitizeFtsQuery('(){}*:^~')).toBe('""');
  });
});

// ---------------------------------------------------------------------------
// Tests — searchRunEvents
// ---------------------------------------------------------------------------

describe('searchRunEvents', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);

    // Seed data
    insertRun(db, 'run-1', 'ws-1');
    insertRun(db, 'run-2', 'ws-2');

    insertEvent(db, 'e1', 'run-1', 'message', JSON.stringify({ role: 'user', content: 'deploy the app' }), '2026-03-24T10:00:00Z');
    insertEvent(db, 'e2', 'run-1', 'tool_call', JSON.stringify({ toolName: 'bash', input: 'npm run deploy' }), '2026-03-24T10:01:00Z');
    insertEvent(db, 'e3', 'run-1', 'message', JSON.stringify({ role: 'assistant', content: 'deployment complete' }), '2026-03-24T10:02:00Z');
    insertEvent(db, 'e4', 'run-2', 'message', JSON.stringify({ role: 'user', content: 'run the tests' }), '2026-03-24T11:00:00Z');
    insertEvent(db, 'e5', 'run-2', 'message', JSON.stringify({ role: 'assistant', content: 'all tests passed' }), '2026-03-24T11:01:00Z');
  });

  afterEach(() => {
    db.close();
  });

  it('returns matching results for a basic search', () => {
    const result = searchRunEvents(db, { q: 'deploy', limit: 50 });
    expect(result.query).toBe('deploy');
    expect(result.results.length).toBeGreaterThan(0);
    // All results should mention deploy in type or payload
    for (const r of result.results) {
      const combined = `${r.type} ${r.payload}`;
      expect(combined.toLowerCase()).toContain('deploy');
    }
  });

  it('filters by event type', () => {
    const result = searchRunEvents(db, { q: 'deploy', type: 'tool_call', limit: 50 });
    expect(result.results.length).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.type).toBe('tool_call');
    }
  });

  it('filters by workspaceId', () => {
    const result = searchRunEvents(db, { q: 'tests', workspaceId: 'ws-2', limit: 50 });
    expect(result.results.length).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.runId).toBe('run-2');
    }
  });

  it('filters by from/to time range', () => {
    const result = searchRunEvents(db, {
      q: 'deploy',
      from: '2026-03-24T10:00:00Z',
      to: '2026-03-24T10:01:30Z',
      limit: 50,
    });
    expect(result.results.length).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.createdAt >= '2026-03-24T10:00:00Z').toBe(true);
      expect(r.createdAt <= '2026-03-24T10:01:30Z').toBe(true);
    }
  });

  it('respects the limit parameter', () => {
    const result = searchRunEvents(db, { q: 'deploy', limit: 1 });
    expect(result.results.length).toBeLessThanOrEqual(1);
  });

  it('returns empty results for an empty query', () => {
    const result = searchRunEvents(db, { q: '', limit: 50 });
    expect(result.results).toEqual([]);
    expect(result.totalMatches).toBe(0);
  });

  it('handles special characters without crashing', () => {
    const result = searchRunEvents(db, { q: '(hello) "world" NOT *test*', limit: 50 });
    // Should not throw, and should return a valid response
    expect(result).toHaveProperty('query');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('totalMatches');
  });
});
