import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createNativeAppSession, revokeNativeAppSession, validateNativeAppSession } from './native-app-sessions.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE native_app_sessions (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('native app sessions', () => {
  it('creates a native app session with separate csrf token', () => {
    const db = createDb();
    try {
      const session = createNativeAppSession(db, 'PopeyeMac');
      expect(session.clientName).toBe('PopeyeMac');
      expect(session.id).toBeTruthy();
      expect(session.csrfToken).toBeTruthy();
      expect(session.csrfToken).not.toBe(session.id);
    } finally {
      db.close();
    }
  });

  it('validates and refreshes a native app session', () => {
    const db = createDb();
    try {
      const initial = new Date('2026-04-02T08:00:00.000Z');
      const session = createNativeAppSession(db, 'PopeyeMac', initial, 60_000);
      const validatedAt = new Date('2026-04-02T08:00:30.000Z');
      const result = validateNativeAppSession(db, session.id, validatedAt, 60_000);
      expect(result.status).toBe('valid');
      if (result.status === 'valid') {
        expect(result.session.clientName).toBe('PopeyeMac');
        expect(result.session.csrfToken).toBe(session.csrfToken);
        expect(result.session.lastUsedAt).toBe(validatedAt.toISOString());
        expect(result.session.expiresAt).toBe(new Date(validatedAt.getTime() + 60_000).toISOString());
      }
    } finally {
      db.close();
    }
  });

  it('expires stale native app sessions', () => {
    const db = createDb();
    try {
      const createdAt = new Date('2026-04-02T08:00:00.000Z');
      const session = createNativeAppSession(db, 'PopeyeMac', createdAt, 1_000);
      const result = validateNativeAppSession(db, session.id, new Date('2026-04-02T08:00:02.000Z'), 1_000);
      expect(result).toEqual({ status: 'expired' });
    } finally {
      db.close();
    }
  });

  it('revokes native app sessions explicitly', () => {
    const db = createDb();
    try {
      const session = createNativeAppSession(db, 'PopeyeMac');
      expect(revokeNativeAppSession(db, session.id)).toBe(true);
      expect(validateNativeAppSession(db, session.id)).toEqual({ status: 'invalid' });
    } finally {
      db.close();
    }
  });
});
