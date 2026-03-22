import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProfileContext } from './profile-context.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_syntheses (
      id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, scope TEXT NOT NULL,
      workspace_id TEXT, project_id TEXT, classification TEXT NOT NULL,
      synthesis_kind TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL,
      confidence REAL NOT NULL, refresh_policy TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
      domain TEXT NOT NULL DEFAULT 'general', subject_kind TEXT, subject_id TEXT,
      refresh_due_at TEXT, salience REAL NOT NULL DEFAULT 0.5,
      quality_score REAL NOT NULL DEFAULT 0.7,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      invalidated_at TEXT, operator_status TEXT NOT NULL DEFAULT 'normal'
    );
  `);
  return db;
}

function insertSynthesis(db: Database.Database, kind: string, text: string, opts: { archived?: boolean } = {}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO memory_syntheses (id, namespace_id, scope, classification, synthesis_kind, title, text, confidence, created_at, updated_at, archived_at, domain)
     VALUES (?, 'ns-1', 'workspace', 'internal', ?, ?, ?, 0.8, ?, ?, ?, 'general')`,
  ).run(`s-${Math.random().toString(36).slice(2, 8)}`, kind, `${kind} title`, text, now, now, opts.archived ? now : null);
}

describe('getProfileContext', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns null profiles when none exist', () => {
    const result = getProfileContext({ db, scope: 'workspace' });
    expect(result.staticProfile).toBeNull();
    expect(result.dynamicProfile).toBeNull();
    expect(result.totalTokens).toBe(0);
  });

  it('returns static and dynamic profiles', () => {
    insertSynthesis(db, 'profile_static', '## Identity\n- Senior engineer');
    insertSynthesis(db, 'profile_dynamic', '- [event] Deployed v2.1');

    const result = getProfileContext({ db, scope: 'workspace' });
    expect(result.staticProfile).toContain('Senior engineer');
    expect(result.dynamicProfile).toContain('Deployed v2.1');
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('skips archived profiles', () => {
    insertSynthesis(db, 'profile_static', 'Archived profile', { archived: true });

    const result = getProfileContext({ db, scope: 'workspace' });
    expect(result.staticProfile).toBeNull();
  });

  it('respects scope filter', () => {
    insertSynthesis(db, 'profile_static', 'Workspace profile');
    // Change scope of the inserted synthesis
    db.prepare("UPDATE memory_syntheses SET scope = 'other-scope'").run();

    const result = getProfileContext({ db, scope: 'workspace' });
    expect(result.staticProfile).toBeNull();
  });

  it('filters by workspaceId when provided', () => {
    insertSynthesis(db, 'profile_static', 'Workspace A profile');
    db.prepare("UPDATE memory_syntheses SET workspace_id = 'ws-a'").run();

    // Match
    const result = getProfileContext({ db, scope: 'workspace', workspaceId: 'ws-a' });
    expect(result.staticProfile).toContain('Workspace A profile');

    // No match
    const result2 = getProfileContext({ db, scope: 'workspace', workspaceId: 'ws-b' });
    expect(result2.staticProfile).toBeNull();

    // Without workspaceId — returns regardless of workspace_id
    const result3 = getProfileContext({ db, scope: 'workspace' });
    expect(result3.staticProfile).toContain('Workspace A profile');
  });

  it('truncates when combined exceeds maxTokens', () => {
    const longText = 'A'.repeat(4000); // ~1000 tokens
    insertSynthesis(db, 'profile_static', longText);
    insertSynthesis(db, 'profile_dynamic', longText);

    const result = getProfileContext({ db, scope: 'workspace', maxTokens: 200 });
    expect(result.totalTokens).toBeLessThanOrEqual(200);
  });
});
