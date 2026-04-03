import type { DbConnection } from '@popeye/contracts';
import { z } from 'zod';

import { generateToken } from './auth.js';

export const NATIVE_APP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const NativeAppSessionRowSchema = z.object({
  id: z.string(),
  client_name: z.string(),
  csrf_token: z.string(),
  created_at: z.string(),
  last_used_at: z.string(),
  expires_at: z.string(),
});

export interface NativeAppSessionRecord {
  id: string;
  clientName: string;
  csrfToken: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export type NativeAppSessionValidationResult =
  | { status: 'valid'; session: NativeAppSessionRecord }
  | { status: 'expired' | 'invalid' };

function mapNativeAppSessionRow(row: unknown): NativeAppSessionRecord {
  const parsed = NativeAppSessionRowSchema.parse(row);
  return {
    id: parsed.id,
    clientName: parsed.client_name,
    csrfToken: parsed.csrf_token,
    createdAt: parsed.created_at,
    lastUsedAt: parsed.last_used_at,
    expiresAt: parsed.expires_at,
  };
}

export function createNativeAppSession(
  db: DbConnection,
  clientName: string,
  now = new Date(),
  ttlMs = NATIVE_APP_SESSION_TTL_MS,
): NativeAppSessionRecord {
  const createdAt = now.toISOString();
  const session: NativeAppSessionRecord = {
    id: generateToken(),
    clientName,
    csrfToken: generateToken(),
    createdAt,
    lastUsedAt: createdAt,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  db.prepare(
    `INSERT INTO native_app_sessions (
      id,
      client_name,
      csrf_token,
      created_at,
      last_used_at,
      expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.clientName,
    session.csrfToken,
    session.createdAt,
    session.lastUsedAt,
    session.expiresAt,
  );
  return session;
}

export function validateNativeAppSession(
  db: DbConnection,
  sessionId: string,
  now = new Date(),
  ttlMs = NATIVE_APP_SESSION_TTL_MS,
): NativeAppSessionValidationResult {
  const row = db.prepare('SELECT * FROM native_app_sessions WHERE id = ?').get(sessionId);
  if (!row) {
    return { status: 'invalid' };
  }

  const session = mapNativeAppSessionRow(row);
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    db.prepare('DELETE FROM native_app_sessions WHERE id = ?').run(sessionId);
    return { status: 'expired' };
  }

  const lastUsedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  db.prepare('UPDATE native_app_sessions SET last_used_at = ?, expires_at = ? WHERE id = ?').run(lastUsedAt, expiresAt, sessionId);
  return {
    status: 'valid',
    session: {
      ...session,
      lastUsedAt,
      expiresAt,
    },
  };
}

export function revokeNativeAppSession(db: DbConnection, sessionId: string): boolean {
  return (db.prepare('DELETE FROM native_app_sessions WHERE id = ?').run(sessionId).changes as number) > 0;
}
