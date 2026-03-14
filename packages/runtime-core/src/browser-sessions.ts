import type { DbConnection } from '@popeye/contracts';
import { z } from 'zod';

import { generateToken } from './auth.js';

export const BROWSER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const BrowserSessionRowSchema = z.object({
  id: z.string(),
  csrf_token: z.string(),
  created_at: z.string(),
  last_used_at: z.string(),
  expires_at: z.string(),
});

export interface BrowserSessionRecord {
  id: string;
  csrfToken: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export type BrowserSessionValidationResult =
  | { status: 'valid'; session: BrowserSessionRecord }
  | { status: 'expired' | 'invalid' };

function mapBrowserSessionRow(row: unknown): BrowserSessionRecord {
  const parsed = BrowserSessionRowSchema.parse(row);
  return {
    id: parsed.id,
    csrfToken: parsed.csrf_token,
    createdAt: parsed.created_at,
    lastUsedAt: parsed.last_used_at,
    expiresAt: parsed.expires_at,
  };
}

export function createBrowserSession(
  db: DbConnection,
  now = new Date(),
  ttlMs = BROWSER_SESSION_TTL_MS,
): BrowserSessionRecord {
  const createdAt = now.toISOString();
  const session: BrowserSessionRecord = {
    id: generateToken(),
    csrfToken: generateToken(),
    createdAt,
    lastUsedAt: createdAt,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  db.prepare(
    'INSERT INTO browser_sessions (id, csrf_token, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(session.id, session.csrfToken, session.createdAt, session.lastUsedAt, session.expiresAt);
  return session;
}

export function validateBrowserSession(
  db: DbConnection,
  sessionId: string,
  now = new Date(),
  ttlMs = BROWSER_SESSION_TTL_MS,
): BrowserSessionValidationResult {
  const row = db.prepare('SELECT * FROM browser_sessions WHERE id = ?').get(sessionId);
  if (!row) {
    return { status: 'invalid' };
  }

  const session = mapBrowserSessionRow(row);
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    db.prepare('DELETE FROM browser_sessions WHERE id = ?').run(sessionId);
    return { status: 'expired' };
  }

  const lastUsedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  db.prepare('UPDATE browser_sessions SET last_used_at = ?, expires_at = ? WHERE id = ?').run(lastUsedAt, expiresAt, sessionId);
  return {
    status: 'valid',
    session: {
      ...session,
      lastUsedAt,
      expiresAt,
    },
  };
}

export function clearBrowserSessions(db: DbConnection): number {
  return db.prepare('DELETE FROM browser_sessions').run().changes as number;
}
