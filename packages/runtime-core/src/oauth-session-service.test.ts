import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initAuthStore } from './auth.ts';
import { openRuntimeDatabases } from './database.ts';
import { OAuthSessionService } from './oauth-session-service.ts';

function makeConfig(dir: string) {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: {
      bindHost: '127.0.0.1' as const,
      bindPort: 3210,
      redactionPatterns: [],
      promptScanQuarantinePatterns: [],
      promptScanSanitizePatterns: [],
    },
    telegram: {
      enabled: false,
      allowedUserId: '42',
      maxMessagesPerMinute: 10,
      globalMaxMessagesPerMinute: 30,
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
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  };
}

describe('OAuthSessionService', () => {
  it('creates sessions and completes them without exposing internal PKCE/state fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-oauth-sessions-'));
    chmodSync(dir, 0o700);
    const databases = openRuntimeDatabases(makeConfig(dir));
    const service = new OAuthSessionService(databases.app as never);

    const created = service.createSession({
      id: 'oauth-session-1',
      providerKind: 'github',
      domain: 'github',
      connectionMode: 'read_only',
      syncIntervalSeconds: 900,
      stateToken: 'oauth-state-token',
      pkceVerifier: 'oauth-pkce-verifier',
      redirectUri: 'http://127.0.0.1:3210/v1/connections/oauth/callback',
      authorizationUrl: 'https://github.com/login/oauth/authorize?state=oauth-state-token',
      expiresAt: '2026-03-20T11:15:00.000Z',
    });

    expect(created.status).toBe('pending');
    expect(created.stateToken).toBe('oauth-state-token');

    const publicRecord = service.getSession('oauth-session-1');
    expect(publicRecord).toMatchObject({
      id: 'oauth-session-1',
      status: 'pending',
      providerKind: 'github',
      domain: 'github',
    });
    expect(publicRecord).not.toHaveProperty('stateToken');
    expect(publicRecord).not.toHaveProperty('pkceVerifier');

    databases.app.prepare(
      `INSERT INTO connections (
        id, domain, provider_kind, label, mode, secret_ref_id, enabled,
        sync_interval_seconds, allowed_scopes, allowed_resources, last_sync_at,
        last_sync_status, created_at, updated_at, health_json, sync_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'connection-1',
      'github',
      'github',
      'GitHub (operator)',
      'read_only',
      null,
      1,
      900,
      '[]',
      '[]',
      null,
      null,
      '2026-03-20T10:00:00.000Z',
      '2026-03-20T10:00:00.000Z',
      '{}',
      '{}',
    );

    const completed = service.completeSession('oauth-session-1', {
      connectionId: 'connection-1',
      accountId: 'account-1',
    });
    expect(completed?.status).toBe('completed');
    expect(completed?.connectionId).toBe('connection-1');
    expect(completed?.accountId).toBe('account-1');

    databases.app.close();
    databases.memory.close();
  });

  it('expires only pending sessions whose expiry has passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-oauth-sessions-'));
    chmodSync(dir, 0o700);
    const databases = openRuntimeDatabases(makeConfig(dir));
    const service = new OAuthSessionService(databases.app as never);

    service.createSession({
      id: 'oauth-session-expired',
      providerKind: 'gmail',
      domain: 'email',
      connectionMode: 'read_only',
      syncIntervalSeconds: 900,
      stateToken: 'expired-state',
      pkceVerifier: 'expired-verifier',
      redirectUri: 'http://127.0.0.1:3210/v1/connections/oauth/callback',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=expired-state',
      expiresAt: '2026-03-20T10:00:00.000Z',
    });
    service.createSession({
      id: 'oauth-session-active',
      providerKind: 'google_calendar',
      domain: 'calendar',
      connectionMode: 'read_only',
      syncIntervalSeconds: 900,
      stateToken: 'active-state',
      pkceVerifier: 'active-verifier',
      redirectUri: 'http://127.0.0.1:3210/v1/connections/oauth/callback',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=active-state',
      expiresAt: '2026-03-20T12:00:00.000Z',
    });

    const expiredCount = service.expirePendingSessions(new Date('2026-03-20T11:00:00.000Z'));
    expect(expiredCount).toBe(1);
    expect(service.getSession('oauth-session-expired')?.status).toBe('expired');
    expect(service.getSession('oauth-session-active')?.status).toBe('pending');

    databases.app.close();
    databases.memory.close();
  });
});
