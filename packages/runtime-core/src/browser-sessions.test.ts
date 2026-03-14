import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { clearBrowserSessions, createBrowserSession, validateBrowserSession } from './browser-sessions.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE browser_sessions (
      id TEXT PRIMARY KEY,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('browser sessions', () => {
  it('creates a browser session with a separate csrf token', () => {
    const db = createTestDb();
    try {
      const session = createBrowserSession(db, new Date('2026-03-14T10:00:00.000Z'), 60_000);
      expect(session.id).toBeTruthy();
      expect(session.csrfToken).toBeTruthy();
      expect(session.csrfToken).not.toBe(session.id);
    } finally {
      db.close();
    }
  });

  it('validates and refreshes a non-expired browser session', () => {
    const db = createTestDb();
    try {
      const session = createBrowserSession(db, new Date('2026-03-14T10:00:00.000Z'), 60_000);
      const result = validateBrowserSession(db, session.id, new Date('2026-03-14T10:00:30.000Z'), 60_000);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.session.csrfToken).toBe(session.csrfToken);
        expect(result.session.expiresAt).toBe('2026-03-14T10:01:30.000Z');
      }
    } finally {
      db.close();
    }
  });

  it('expires and deletes stale browser sessions', () => {
    const db = createTestDb();
    try {
      const session = createBrowserSession(db, new Date('2026-03-14T10:00:00.000Z'), 1_000);
      expect(validateBrowserSession(db, session.id, new Date('2026-03-14T10:00:02.000Z'), 1_000)).toEqual({ status: 'expired' });
      expect(validateBrowserSession(db, session.id)).toEqual({ status: 'invalid' });
    } finally {
      db.close();
    }
  });

  it('clears all browser sessions', () => {
    const db = createTestDb();
    try {
      createBrowserSession(db);
      createBrowserSession(db);
      expect(clearBrowserSessions(db)).toBe(2);
      const count = db.prepare('SELECT COUNT(*) AS count FROM browser_sessions').get() as { count: number };
      expect(count.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
