import type { DbConnection, OAuthConnectStartRequest, OAuthSessionRecord } from '@popeye/contracts';
import { OAuthSessionRecordSchema, nowIso } from '@popeye/contracts';

interface OAuthSessionRow {
  id: string;
  provider_kind: OAuthSessionRecord['providerKind'];
  domain: OAuthSessionRecord['domain'];
  status: OAuthSessionRecord['status'];
  connection_mode: OAuthConnectStartRequest['mode'];
  sync_interval_seconds: number;
  connection_id: string | null;
  state_token: string;
  pkce_verifier: string;
  redirect_uri: string;
  authorization_url: string;
  error: string | null;
  account_id: string | null;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}

export interface OAuthSessionInternalRecord extends OAuthSessionRecord {
  connectionMode: OAuthConnectStartRequest['mode'];
  syncIntervalSeconds: number;
  stateToken: string;
  pkceVerifier: string;
}

function mapRow(row: OAuthSessionRow): OAuthSessionInternalRecord {
  const record = {
    id: row.id,
    providerKind: row.provider_kind,
    domain: row.domain,
    status: row.status,
    authorizationUrl: row.authorization_url,
    redirectUri: row.redirect_uri,
    connectionId: row.connection_id,
    accountId: row.account_id,
    error: row.error,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    connectionMode: row.connection_mode,
    syncIntervalSeconds: row.sync_interval_seconds,
    stateToken: row.state_token,
    pkceVerifier: row.pkce_verifier,
  } satisfies OAuthSessionInternalRecord;
  OAuthSessionRecordSchema.parse(record);
  return record;
}

function toPublicRecord(record: OAuthSessionInternalRecord): OAuthSessionRecord {
  return OAuthSessionRecordSchema.parse({
    id: record.id,
    providerKind: record.providerKind,
    domain: record.domain,
    status: record.status,
    authorizationUrl: record.authorizationUrl,
    redirectUri: record.redirectUri,
    connectionId: record.connectionId,
    accountId: record.accountId,
    error: record.error,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    completedAt: record.completedAt,
  });
}

export class OAuthSessionService {
  constructor(private readonly db: DbConnection) {}

  createSession(input: {
    id: string;
    providerKind: OAuthSessionRecord['providerKind'];
    domain: OAuthSessionRecord['domain'];
    connectionMode: OAuthConnectStartRequest['mode'];
    syncIntervalSeconds: number;
    connectionId?: string | null;
    stateToken: string;
    pkceVerifier: string;
    redirectUri: string;
    authorizationUrl: string;
    expiresAt: string;
  }): OAuthSessionInternalRecord {
    const createdAt = nowIso();
    this.db.prepare(
      `INSERT INTO oauth_sessions (
        id, provider_kind, domain, status, connection_mode, sync_interval_seconds, connection_id,
        state_token, pkce_verifier, redirect_uri, authorization_url, error, account_id, created_at, expires_at, completed_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
    ).run(
      input.id,
      input.providerKind,
      input.domain,
      input.connectionMode,
      input.syncIntervalSeconds,
      input.connectionId ?? null,
      input.stateToken,
      input.pkceVerifier,
      input.redirectUri,
      input.authorizationUrl,
      createdAt,
      input.expiresAt,
    );
    return this.getSessionInternal(input.id)!;
  }

  getSession(id: string): OAuthSessionRecord | null {
    const record = this.getSessionInternal(id);
    return record ? toPublicRecord(record) : null;
  }

  getSessionInternal(id: string): OAuthSessionInternalRecord | null {
    const row = this.db.prepare('SELECT * FROM oauth_sessions WHERE id = ?').get(id) as OAuthSessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  getByStateToken(stateToken: string): OAuthSessionInternalRecord | null {
    const row = this.db.prepare('SELECT * FROM oauth_sessions WHERE state_token = ?').get(stateToken) as OAuthSessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  completeSession(id: string, input: { connectionId: string; accountId: string }): OAuthSessionInternalRecord | null {
    const completedAt = nowIso();
    this.db.prepare(
      'UPDATE oauth_sessions SET status = ?, connection_id = ?, account_id = ?, error = NULL, completed_at = ? WHERE id = ?',
    ).run('completed', input.connectionId, input.accountId, completedAt, id);
    return this.getSessionInternal(id);
  }

  failSession(id: string, error: string, status: OAuthSessionRecord['status'] = 'failed'): OAuthSessionInternalRecord | null {
    const completedAt = status === 'failed' ? nowIso() : null;
    this.db.prepare(
      'UPDATE oauth_sessions SET status = ?, error = ?, completed_at = ? WHERE id = ?',
    ).run(status, error, completedAt, id);
    return this.getSessionInternal(id);
  }

  expirePendingSessions(now = new Date()): number {
    const result = this.db.prepare(
      `UPDATE oauth_sessions
       SET status = 'expired', error = COALESCE(error, 'OAuth session expired')
       WHERE status = 'pending' AND expires_at <= ?`,
    ).run(now.toISOString());
    return Number(result.changes ?? 0);
  }
}
