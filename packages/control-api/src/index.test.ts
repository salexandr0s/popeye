import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTH_COOKIE_NAME, initAuthStore, issueCsrfToken, readAuthStore, createRuntimeService } from '../../runtime-core/src/index.ts';

import { createControlApi } from './index.ts';

function insertMemoryForPromotion(
  runtime: ReturnType<typeof createRuntimeService>,
  content = 'Promoted memory body',
): string {
  const memoryId = randomUUID();
  const now = new Date().toISOString();
  // Ensure namespace exists
  runtime.databases.memory
    .prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('ns-promote', 'workspace', 'default', 'Workspace default', now, now);
  runtime.databases.memory
    .prepare(
      `INSERT INTO memory_facts (
        id, namespace_id, scope, classification, source_type, memory_type, fact_kind,
        text, confidence, source_reliability, extraction_confidence, created_at, domain
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      memoryId,
      'ns-promote',
      'default',
      'embeddable',
      'compaction_flush',
      'semantic',
      'event',
      content,
      0.8,
      0.8,
      0.8,
      now,
      'general',
    );
  return memoryId;
}

describe('control api', () => {
  function extractCookieValue(setCookie: string | string[] | undefined, cookieName: string): string | null {
    const raw = Array.isArray(setCookie) ? setCookie.join(';') : setCookie;
    if (!raw) return null;
    const match = raw.match(new RegExp(`${cookieName}=([^;]+)`));
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }

  it('requires auth for protected endpoints and csrf for mutations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const unauthorized = await app.inject({ method: 'GET', url: '/v1/security/audit' });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: 'GET',
      url: '/v1/security/audit',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(authorized.statusCode).toBe(200);

    const schedulerState = await app.inject({
      method: 'GET',
      url: '/v1/daemon/scheduler',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(schedulerState.statusCode).toBe(200);

    const csrf = issueCsrfToken(readAuthStore(authFile));
    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${store.current.token}` },
      payload: { workspaceId: 'default', projectId: null, title: 't', prompt: 'hello', source: 'manual', autoEnqueue: false },
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' },
      payload: { workspaceId: 'default', projectId: null, title: 't', prompt: 'hello', source: 'manual', autoEnqueue: false },
    });
    expect(created.statusCode).toBe(200);

    await runtime.close();
    await app.close();
  });

  it('requires an operator bearer token to exchange a bootstrap nonce for a browser auth cookie', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-exchange-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const readonlyStore = initAuthStore(authFile, 'readonly');
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({
      runtime,
      validateAuthExchangeNonce: (nonce) => nonce === 'valid-bootstrap-nonce' ? 'accepted' : 'invalid',
    });

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      headers: { authorization: `Bearer ${store.current.token}` },
      payload: { nonce: 'invalid' },
    });
    expect(rejected.statusCode).toBe(401);

    const readonlyRejected = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      headers: { authorization: `Bearer ${readonlyStore.current.token}` },
      payload: { nonce: 'valid-bootstrap-nonce' },
    });
    expect(readonlyRejected.statusCode).toBe(403);

    const missingAuth = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      payload: { nonce: 'valid-bootstrap-nonce' },
    });
    expect(missingAuth.statusCode).toBe(401);

    const exchanged = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      headers: { authorization: `Bearer ${store.current.token}` },
      payload: { nonce: 'valid-bootstrap-nonce' },
    });
    expect(exchanged.statusCode).toBe(200);
    expect(exchanged.json()).toEqual({ ok: true });
    expect(exchanged.headers['set-cookie']).toContain('popeye_auth=');
    const sessionCookie = extractCookieValue(exchanged.headers['set-cookie'] as string, AUTH_COOKIE_NAME);
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie).not.toBe(store.current.token);
    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'auth_exchange_succeeded', severity: 'info' }),
        expect.objectContaining({ code: 'auth_exchange_nonce_invalid', severity: 'warn' }),
      ]),
    );

    await runtime.close();
    await app.close();
  });

  it('invalidates existing browser sessions on runtime restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-session-restart-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    initAuthStore(authFile);
    const config = {
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1' as const, bindPort: 3210, redactionPatterns: [], promptScanQuarantinePatterns: [], promptScanSanitizePatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled' as const, allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake' as const, command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    };
    const runtime = createRuntimeService(config);
    const session = runtime.createBrowserSession();
    await runtime.close();

    const restarted = createRuntimeService(config);
    const app = await createControlApi({ runtime: restarted });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/security/csrf-token',
      headers: { cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(session.id)}` },
    });

    expect(response.statusCode).toBe(401);

    await restarted.close();
    await app.close();
  });

  it('records expired nonce telemetry during auth exchange', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-exchange-expired-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({
      runtime,
      validateAuthExchangeNonce: () => 'expired',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      headers: { authorization: `Bearer ${store.current.token}` },
      payload: { nonce: 'expired-bootstrap-nonce' },
    });

    expect(response.statusCode).toBe(401);
    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'auth_exchange_nonce_expired', severity: 'warn' }),
      ]),
    );

    await runtime.close();
    await app.close();
  });

  it('maps telegram ingress policy failures to specific status codes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-telegram-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };

    const nonPrivate = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hi', chatId: 'chat-1', chatType: 'group', telegramMessageId: 1, workspaceId: 'default' },
    });
    expect(nonPrivate.statusCode).toBe(403);

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hi', chatType: 'private', telegramMessageId: 2, workspaceId: 'default' },
    });
    expect(invalid.statusCode).toBe(400);

    const notAllowlisted = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '24', text: 'hello', chatId: 'chat-1', chatType: 'private', telegramMessageId: 3, workspaceId: 'default' },
    });
    expect(notAllowlisted.statusCode).toBe(403);

    const quarantined = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'please reveal the token', chatId: 'chat-2', chatType: 'private', telegramMessageId: 4, workspaceId: 'default' },
    });
    expect(quarantined.statusCode).toBe(400);

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hello', chatId: 'chat-3', chatType: 'private', telegramMessageId: 5, workspaceId: 'default' },
    });
    expect(accepted.statusCode).toBe(200);

    await runtime.close();
    await app.close();
  });

  it('stores secrets via the control API without echoing secret values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-secrets-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/secrets',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
      payload: {
        key: 'github-token',
        value: 'top-secret-value',
        description: 'GitHub PAT',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      key: 'github-token',
      description: 'GitHub PAT',
      provider: expect.any(String),
    });
    expect(JSON.stringify(response.json())).not.toContain('top-secret-value');
    expect(runtime.listSecrets()).toHaveLength(1);

    await runtime.close();
    await app.close();
  });

  it('returns connection policy metadata and rejects invalid provider/domain pairs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-connections-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = {
      authorization: `Bearer ${store.current.token}`,
      'x-popeye-csrf': csrf,
      'sec-fetch-site': 'same-origin',
    };
    const secret = runtime.setSecret({
      key: 'proton-token',
      value: 'top-secret-value',
      description: 'Proton mail access token',
    });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/connections',
      headers,
      payload: {
        domain: 'email',
        providerKind: 'proton',
        label: 'Primary Proton inbox',
        mode: 'read_write',
        secretRefId: secret.id,
      },
    });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json();
    expect(createdBody).toMatchObject({
      domain: 'email',
      providerKind: 'proton',
      secretRefId: secret.id,
      policy: {
        status: 'ready',
        secretStatus: 'configured',
        mutatingRequiresApproval: true,
        diagnostics: [],
      },
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/connections?domain=email',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdBody.id,
          policy: expect.objectContaining({ status: 'ready', secretStatus: 'configured' }),
        }),
      ]),
    );

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/connections',
      headers,
      payload: {
        domain: 'email',
        providerKind: 'github',
        label: 'Bad connection',
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({
      error: 'invalid_connection',
    });

    await runtime.close();
    await app.close();
  });

  it('rejects file roots inside runtime data directories and records audit evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-file-roots-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/files/roots',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
      payload: {
        workspaceId: 'default',
        label: 'Runtime data dir',
        rootPath: dir,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_file_root' });
    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'file_root_registration_denied',
          severity: 'warn',
          details: expect.objectContaining({
            reasonCode: 'runtime_directory_forbidden',
          }),
        }),
      ]),
    );

    await runtime.close();
    await app.close();
  });

  it('rejects file searches against disabled roots and records audit evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-file-search-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const externalRoot = mkdtempSync(join(tmpdir(), 'popeye-search-root-'));
    const created = runtime.registerFileRoot({
      workspaceId: 'default',
      label: 'Search root',
      rootPath: externalRoot,
      permission: 'read',
      filePatterns: ['**/*'],
      excludePatterns: [],
      maxFileSizeBytes: 1024,
    });
    runtime.disableFileRoot(created.id);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/files/search?query=notes&rootId=${encodeURIComponent(created.id)}`,
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_file_root' });
    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'file_root_policy_denied',
          severity: 'warn',
          details: expect.objectContaining({
            reasonCode: 'root_disabled',
            rootId: created.id,
          }),
        }),
      ]),
    );

    await runtime.close();
    await app.close();
  });

  it('rejects email digest reads for disabled connection-backed accounts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-email-digest-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const connection = runtime.createConnection({
      domain: 'email',
      providerKind: 'gmail',
      label: 'Gmail',
      mode: 'read_only',
      syncIntervalSeconds: 900,
      allowedScopes: [],
      allowedResources: [],
    });
    const account = runtime.registerEmailAccount({
      connectionId: connection.id,
      emailAddress: 'operator@example.com',
      displayName: 'Operator Mail',
    });
    runtime.updateConnection(connection.id, { enabled: false });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/email/digest?accountId=${encodeURIComponent(account.id)}`,
      headers: {
        authorization: `Bearer ${store.current.token}`,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_email_account' });
    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'connection_policy_denied',
          details: expect.objectContaining({
            connectionId: connection.id,
            purpose: 'email_digest_read',
            reasonCode: 'connection_disabled',
          }),
        }),
      ]),
    );

    await runtime.close();
    await app.close();
  });

  it('applies per-item memory location filters on read and promotion routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-memory-scope-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{
        id: 'default',
        name: 'Default workspace',
        heartbeatEnabled: true,
        heartbeatIntervalSeconds: 3600,
        projects: [
          { id: 'proj-1', name: 'Project One' },
          { id: 'proj-2', name: 'Project Two' },
        ],
      }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const memory = runtime.insertMemory({
      description: 'Project two private memory',
      classification: 'internal',
      sourceType: 'receipt',
      content: 'Only project two should be able to read this memory.',
      confidence: 0.9,
      scope: 'default/proj-2',
      workspaceId: 'default',
      projectId: 'proj-2',
    });

    const denied = await app.inject({
      method: 'GET',
      url: `/v1/memory/${memory.id}?workspaceId=default&projectId=proj-1`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(denied.statusCode).toBe(404);

    const allowed = await app.inject({
      method: 'GET',
      url: `/v1/memory/${memory.id}?scope=default/proj-2`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      id: memory.id,
      workspaceId: 'default',
      projectId: 'proj-2',
    });

    const deniedPromotion = await app.inject({
      method: 'POST',
      url: `/v1/memory/${memory.id}/promote/propose?workspaceId=default&projectId=proj-1`,
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
      payload: { targetPath: join(runtime.databases.paths.memoryDailyDir, 'project-two.md') },
    });
    expect(deniedPromotion.statusCode).toBe(404);

    await runtime.close();
    await app.close();
  });

  it('exposes runtime execution context on receipt routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-receipt-runtime-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{
        id: 'default',
        name: 'Default workspace',
        heartbeatEnabled: true,
        heartbeatIntervalSeconds: 3600,
        projects: [{ id: 'proj-1', name: 'Project One' }],
      }],
    });
    const app = await createControlApi({ runtime });

    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: 'proj-1',
      title: 'receipt runtime context',
      prompt: 'hello from receipt observability',
      source: 'manual',
      autoEnqueue: true,
    });
    const terminal = await runtime.waitForJobTerminalState(created.job!.id, 5_000);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${terminal!.run!.id}/receipt`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runId: terminal!.run!.id,
      runtime: {
        projectId: 'proj-1',
        profileId: 'default',
        execution: expect.objectContaining({
          mode: 'interactive',
          memoryScope: 'workspace',
          recallScope: 'workspace',
          filesystemPolicyClass: 'workspace',
          contextReleasePolicy: 'summary_only',
          sessionPolicy: expect.any(String),
          warnings: expect.any(Array),
        }),
        timeline: expect.arrayContaining([
          expect.objectContaining({
            code: 'engine_started',
            source: 'run_event',
          }),
          expect.objectContaining({
            code: 'receipt_succeeded',
            source: 'receipt',
          }),
        ]),
      },
    });

    await runtime.close();
    await app.close();
  });

  it('returns 429 when telegram ingress exceeds the durable rate limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-rate-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 1, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hello', chatId: 'chat-1', chatType: 'private', telegramMessageId: 1, workspaceId: 'default' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hello again', chatId: 'chat-1', chatType: 'private', telegramMessageId: 2, workspaceId: 'default' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);

    await runtime.close();
    await app.close();
  });

  it('replays duplicate telegram deliveries with the original accepted result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-dup-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };
    const payload = { source: 'telegram', senderId: '42', text: 'hello', chatId: 'chat-1', chatType: 'private', telegramMessageId: 3, workspaceId: 'default' };

    const first = await app.inject({ method: 'POST', url: '/v1/messages/ingest', headers, payload });
    const second = await app.inject({ method: 'POST', url: '/v1/messages/ingest', headers, payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ accepted: true, duplicate: true, decisionCode: 'duplicate_replayed' });

    await runtime.close();
    await app.close();
  });

  it('exposes job lookup, run receipt lookup, and message-to-run linkage for accepted telegram ingress', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-links-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };

    const ingress = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: {
        source: 'telegram',
        senderId: '42',
        text: 'link this to a run',
        chatId: 'chat-1',
        chatType: 'private',
        telegramMessageId: 11,
        workspaceId: 'default',
      },
    });

    expect(ingress.statusCode).toBe(200);
    const ingressBody = ingress.json() as {
      accepted: boolean;
      jobId: string | null;
      taskId: string | null;
      message: { id: string } | null;
      telegramDelivery: { chatId: string; telegramMessageId: number; status: string } | null;
    };
    expect(ingressBody.accepted).toBe(true);
    expect(ingressBody.jobId).toBeTruthy();
    expect(ingressBody.telegramDelivery).toEqual({
      chatId: 'chat-1',
      telegramMessageId: 11,
      status: 'pending',
    });

    const terminal = ingressBody.jobId
      ? await runtime.waitForJobTerminalState(ingressBody.jobId, 5_000)
      : null;
    expect(terminal?.run?.id).toBeTruthy();

    const jobResponse = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${ingressBody.jobId}`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(jobResponse.statusCode).toBe(200);
    expect(jobResponse.json()).toMatchObject({
      id: ingressBody.jobId,
      taskId: ingressBody.taskId,
      lastRunId: terminal?.run?.id,
      status: terminal?.job.status,
    });

    const receiptResponse = await app.inject({
      method: 'GET',
      url: `/v1/runs/${terminal?.run?.id}/receipt`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    const replyResponse = await app.inject({
      method: 'GET',
      url: `/v1/runs/${terminal?.run?.id}/reply`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(receiptResponse.statusCode).toBe(200);
    expect(receiptResponse.json()).toMatchObject({
      runId: terminal?.run?.id,
      jobId: ingressBody.jobId,
      taskId: ingressBody.taskId,
      status: terminal?.receipt?.status,
    });
    expect(replyResponse.statusCode).toBe(200);
    expect(replyResponse.json()).toMatchObject({
      runId: terminal?.run?.id,
      terminalStatus: terminal?.receipt?.status,
      source: 'completed_output',
    });

    const messageRow = runtime.databases.app
      .prepare('SELECT related_run_id FROM messages WHERE id = ?')
      .get(ingressBody.message?.id) as { related_run_id: string | null };
    const ingressRow = runtime.databases.app
      .prepare('SELECT task_id, job_id, run_id FROM message_ingress WHERE message_id = ?')
      .get(ingressBody.message?.id) as { task_id: string | null; job_id: string | null; run_id: string | null };

    expect(messageRow.related_run_id).toBe(terminal?.run?.id);
    expect(ingressRow).toEqual({
      task_id: ingressBody.taskId,
      job_id: ingressBody.jobId,
      run_id: terminal?.run?.id,
    });

    await runtime.close();
    await app.close();
  });

  it('serves job and run receipt routes for Telegram-ingested runs and preserves linkage invariants', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-run-linkage-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };

    const ingest = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hello', chatId: 'chat-7', chatType: 'private', telegramMessageId: 7, workspaceId: 'default' },
    });
    expect(ingest.statusCode).toBe(200);
    const ingressBody = ingest.json() as {
      message: { id: string } | null;
      jobId: string | null;
      taskId: string | null;
      telegramDelivery: { chatId: string; telegramMessageId: number; status: string } | null;
    };
    const terminal = ingressBody.jobId ? await runtime.waitForJobTerminalState(ingressBody.jobId, 5_000) : null;

    const jobResponse = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${terminal?.job.id}`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    const receiptResponse = await app.inject({
      method: 'GET',
      url: `/v1/runs/${terminal?.run?.id}/receipt`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(jobResponse.statusCode).toBe(200);
    expect(jobResponse.json()).toMatchObject({
      id: terminal?.job.id,
      taskId: ingressBody.taskId,
      lastRunId: terminal?.run?.id,
      status: terminal?.job.status,
    });
    expect(receiptResponse.statusCode).toBe(200);
    expect(receiptResponse.json()).toMatchObject({
      runId: terminal?.run?.id,
      jobId: terminal?.job.id,
      taskId: ingressBody.taskId,
      status: terminal?.receipt?.status,
    });
    expect(ingressBody.telegramDelivery).toEqual({
      chatId: 'chat-7',
      telegramMessageId: 7,
      status: 'pending',
    });

    const messageRow = runtime.databases.app
      .prepare('SELECT related_run_id FROM messages WHERE id = ?')
      .get(ingressBody.message?.id) as { related_run_id: string | null };
    const ingressRow = runtime.databases.app
      .prepare('SELECT task_id, job_id, run_id FROM message_ingress WHERE message_id = ?')
      .get(ingressBody.message?.id) as { task_id: string | null; job_id: string | null; run_id: string | null };

    expect(messageRow.related_run_id).toBe(terminal?.run?.id ?? null);
    expect(ingressRow).toEqual({
      task_id: ingressBody.taskId,
      job_id: terminal?.job.id ?? null,
      run_id: terminal?.run?.id ?? null,
    });

    const checkpointBefore = await app.inject({
      method: 'GET',
      url: '/v1/telegram/relay/checkpoint?workspaceId=default',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(checkpointBefore.statusCode).toBe(200);
    expect(checkpointBefore.json()).toBeNull();

    const checkpointSaved = await app.inject({
      method: 'POST',
      url: '/v1/telegram/relay/checkpoint',
      headers,
      payload: { workspaceId: 'default', lastAcknowledgedUpdateId: 88 },
    });
    expect(checkpointSaved.statusCode).toBe(200);
    expect(checkpointSaved.json()).toMatchObject({
      relayKey: 'telegram_long_poll',
      workspaceId: 'default',
      lastAcknowledgedUpdateId: 88,
    });

    const checkpointRegressed = await app.inject({
      method: 'POST',
      url: '/v1/telegram/relay/checkpoint',
      headers,
      payload: { workspaceId: 'default', lastAcknowledgedUpdateId: 12 },
    });
    expect(checkpointRegressed.statusCode).toBe(200);
    expect(checkpointRegressed.json()).toMatchObject({
      relayKey: 'telegram_long_poll',
      workspaceId: 'default',
      lastAcknowledgedUpdateId: 88,
    });

    const markSent = await app.inject({
      method: 'POST',
      url: '/v1/telegram/replies/chat-7/7/mark-sent',
      headers,
      payload: { workspaceId: 'default', runId: terminal?.run?.id ?? null, sentTelegramMessageId: 907 },
    });
    expect(markSent.statusCode).toBe(200);
    expect(markSent.json()).toEqual({
      chatId: 'chat-7',
      telegramMessageId: 7,
      status: 'sent',
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hello', chatId: 'chat-7', chatType: 'private', telegramMessageId: 7, workspaceId: 'default' },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      accepted: true,
      duplicate: true,
      telegramDelivery: {
        chatId: 'chat-7',
        telegramMessageId: 7,
        status: 'sent',
      },
    });

    await runtime.close();
    await app.close();
  });

  it('exposes Telegram reply delivery state transitions and uncertain-delivery intervention creation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-telegram-delivery-states-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };

    const ingest = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hello', chatId: 'chat-9', chatType: 'private', telegramMessageId: 9, workspaceId: 'default' },
    });
    expect(ingest.statusCode).toBe(200);
    const ingressBody = ingest.json() as { jobId: string | null };
    const terminal = ingressBody.jobId ? await runtime.waitForJobTerminalState(ingressBody.jobId, 5_000) : null;

    const sending = await app.inject({
      method: 'POST',
      url: '/v1/telegram/replies/chat-9/9/mark-sending',
      headers,
      payload: { workspaceId: 'default', runId: terminal?.run?.id ?? null },
    });
    expect(sending.statusCode).toBe(200);
    expect(sending.json()).toEqual({
      chatId: 'chat-9',
      telegramMessageId: 9,
      status: 'sending',
    });

    const pending = await app.inject({
      method: 'POST',
      url: '/v1/telegram/replies/chat-9/9/mark-pending',
      headers,
      payload: { workspaceId: 'default', runId: terminal?.run?.id ?? null },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toEqual({
      chatId: 'chat-9',
      telegramMessageId: 9,
      status: 'pending',
    });

    const uncertain = await app.inject({
      method: 'POST',
      url: '/v1/telegram/replies/chat-9/9/mark-uncertain',
      headers,
      payload: { workspaceId: 'default', runId: terminal?.run?.id ?? null, reason: 'transport failed after send claim' },
    });
    expect(uncertain.statusCode).toBe(200);
    expect(uncertain.json()).toEqual({
      chatId: 'chat-9',
      telegramMessageId: 9,
      status: 'uncertain',
    });
    expect(runtime.listInterventions()).toEqual([
      expect.objectContaining({
        code: 'needs_operator_input',
        runId: terminal?.run?.id ?? null,
        reason: 'transport failed after send claim',
      }),
    ]);

    await runtime.close();
    await app.close();
  });

  it('returns 404 when saving a telegram relay checkpoint for an unknown workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-telegram-checkpoint-missing-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const headers = {
      authorization: `Bearer ${store.current.token}`,
      'x-popeye-csrf': issueCsrfToken(readAuthStore(authFile)),
      'sec-fetch-site': 'same-origin',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/telegram/relay/checkpoint',
      headers,
      payload: { workspaceId: 'missing', lastAcknowledgedUpdateId: 1 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });

    await runtime.close();
    await app.close();
  });

  it('returns 409 from /v1/runs/:id/reply when the run is not terminal yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-run-reply-pending-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    runtime.databases.app.prepare('INSERT INTO tasks (id, workspace_id, project_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'task-pending',
      'default',
      null,
      'pending run',
      'hello',
      'manual',
      'active',
      JSON.stringify({ maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 }),
      'read_only',
      '2026-03-14T00:00:00.000Z',
    );
    runtime.databases.app.prepare('INSERT INTO jobs (id, task_id, workspace_id, status, retry_count, available_at, last_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'job-pending',
      'task-pending',
      'default',
      'running',
      0,
      '2026-03-14T00:00:00.000Z',
      'run-pending',
      '2026-03-14T00:00:00.000Z',
      '2026-03-14T00:00:00.000Z',
    );
    runtime.databases.app.prepare('INSERT INTO runs (id, job_id, task_id, workspace_id, session_root_id, engine_session_ref, state, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'run-pending',
      'job-pending',
      'task-pending',
      'default',
      'session-pending',
      null,
      'running',
      '2026-03-14T00:00:00.000Z',
      null,
      null,
    );

    const app = await createControlApi({ runtime });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/runs/run-pending/reply',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'run_not_terminal' });

    await runtime.close();
    await app.close();
  });

  it('supports memory promotion propose/execute routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-promote-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };
    const memoryId = insertMemoryForPromotion(runtime);
    const targetPath = join(runtime.databases.paths.memoryDailyDir, 'promoted.md');

    const forbidden = await app.inject({
      method: 'POST',
      url: `/v1/memory/${memoryId}/promote/propose`,
      headers: { authorization: `Bearer ${store.current.token}` },
      payload: { targetPath },
    });
    expect(forbidden.statusCode).toBe(403);

    const proposed = await app.inject({
      method: 'POST',
      url: `/v1/memory/${memoryId}/promote/propose`,
      headers,
      payload: { targetPath },
    });
    expect(proposed.statusCode).toBe(200);
    expect(proposed.json()).toMatchObject({
      memoryId,
      targetPath,
      approved: false,
      promoted: false,
    });

    const executed = await app.inject({
      method: 'POST',
      url: `/v1/memory/${memoryId}/promote/execute`,
      headers,
      payload: {
        targetPath,
        diff: proposed.json().diff,
        approved: true,
        promoted: false,
      },
    });
    expect(executed.statusCode).toBe(200);
    expect(executed.json()).toMatchObject({ memoryId, targetPath, approved: true, promoted: true });
    expect(readFileSync(targetPath, 'utf8')).toBe('Promoted memory body');

    await runtime.close();
    await app.close();
  });

  it('keeps memory routes operator-only for readonly/service tokens and records forbidden audits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-memory-roles-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const operatorStore = initAuthStore(authFile);
    initAuthStore(authFile, 'service');
    initAuthStore(authFile, 'readonly');
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const readonlyToken = readAuthStore(authFile, 'readonly').current.token;
    const serviceToken = readAuthStore(authFile, 'service').current.token;
    const operatorCsrf = issueCsrfToken(readAuthStore(authFile));
    const serviceCsrf = issueCsrfToken(readAuthStore(authFile, 'service'));

    const readonlySearch = await app.inject({
      method: 'GET',
      url: '/v1/memory/search?q=test',
      headers: { authorization: `Bearer ${readonlyToken}` },
    });
    expect(readonlySearch.statusCode).toBe(403);

    const serviceSearch = await app.inject({
      method: 'GET',
      url: '/v1/memory/search?q=test',
      headers: { authorization: `Bearer ${serviceToken}` },
    });
    expect(serviceSearch.statusCode).toBe(403);

    const serviceMaintenance = await app.inject({
      method: 'POST',
      url: '/v1/memory/maintenance',
      headers: {
        authorization: `Bearer ${serviceToken}`,
        'x-popeye-csrf': serviceCsrf,
        'sec-fetch-site': 'same-origin',
      },
    });
    expect(serviceMaintenance.statusCode).toBe(403);

    const operatorSearch = await app.inject({
      method: 'GET',
      url: '/v1/memory/search?q=test',
      headers: { authorization: `Bearer ${operatorStore.current.token}` },
    });
    expect(operatorSearch.statusCode).toBe(200);

    const operatorMaintenance = await app.inject({
      method: 'POST',
      url: '/v1/memory/maintenance',
      headers: {
        authorization: `Bearer ${operatorStore.current.token}`,
        'x-popeye-csrf': operatorCsrf,
        'sec-fetch-site': 'same-origin',
      },
    });
    expect(operatorMaintenance.statusCode).toBe(200);

    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'auth_role_forbidden', severity: 'warn' })]),
    );

    await runtime.close();
    await app.close();
  });

  it('allows browser-session operator auth on explicit operator-only memory routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-memory-browser-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({
      runtime,
      validateAuthExchangeNonce: (nonce) => nonce === 'accepted-nonce' ? 'accepted' : 'invalid',
    });

    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      headers: { authorization: `Bearer ${store.current.token}` },
      payload: { nonce: 'accepted-nonce' },
    });
    expect(exchange.statusCode).toBe(200);
    const authCookie = Array.isArray(exchange.headers['set-cookie'])
      ? exchange.headers['set-cookie'][0]
      : exchange.headers['set-cookie'];

    const response = await app.inject({
      method: 'GET',
      url: '/v1/memory/search?q=test',
      headers: { cookie: authCookie ?? '' },
    });
    expect(response.statusCode).toBe(200);

    await runtime.close();
    await app.close();
  });

  it('accepts legacy single-token auth files on operator-only memory routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-legacy-auth-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const now = new Date().toISOString();
    const legacyToken = 'a'.repeat(64);
    writeFileSync(authFile, JSON.stringify({
      current: {
        token: legacyToken,
        createdAt: now,
      },
    }, null, 2), { mode: 0o600 });

    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/memory/search?q=test',
      headers: { authorization: `Bearer ${legacyToken}` },
    });
    expect(response.statusCode).toBe(200);

    await runtime.close();
    await app.close();
  });

  it('keeps unified recall routes operator-only while serving operator callers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-recall-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    initAuthStore(authFile);
    initAuthStore(authFile, 'readonly');
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const now = new Date().toISOString();
    runtime.databases.app.prepare(
      'INSERT INTO tasks (id, workspace_id, project_id, profile_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('task-recall', 'default', null, 'default', 'Recall task', 'noop', 'manual', 'completed', JSON.stringify({ maxAttempts: 1 }), 'read_only', now);
    runtime.databases.app.prepare(
      'INSERT INTO jobs (id, task_id, workspace_id, status, retry_count, available_at, last_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('job-recall', 'task-recall', 'default', 'completed', 0, now, 'run-recall', now, now);
    runtime.databases.app.prepare(
      'INSERT INTO runs (id, job_id, task_id, workspace_id, profile_id, session_root_id, engine_session_ref, state, started_at, finished_at, error, iterations_used, parent_run_id, delegation_depth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('run-recall', 'job-recall', 'task-recall', 'default', 'default', 'session-recall', null, 'completed', now, now, null, null, null, 0);
    runtime.databases.app.prepare(
      'INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('receipt-recall', 'run-recall', 'job-recall', 'task-recall', 'default', 'failed', 'Recall credentials issue', 'Credentials were missing during deploy.', '{}', now);
    runtime.databases.app.prepare(
      'INSERT INTO receipts_fts (receipt_id, run_id, workspace_id, status, summary, details) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('receipt-recall', 'run-recall', 'default', 'failed', 'Recall credentials issue', 'Credentials were missing during deploy.');

    const readonlyToken = readAuthStore(authFile, 'readonly').current.token;
    const readonlyResponse = await app.inject({
      method: 'GET',
      url: '/v1/recall/search?q=credentials&workspaceId=default',
      headers: { authorization: `Bearer ${readonlyToken}` },
    });
    expect(readonlyResponse.statusCode).toBe(403);

    const operatorToken = readAuthStore(authFile).current.token;
    const searchResponse = await app.inject({
      method: 'GET',
      url: '/v1/recall/search?q=credentials&workspaceId=default',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(searchResponse.statusCode).toBe(200);
    expect(searchResponse.json()).toMatchObject({
      query: 'credentials',
      results: expect.arrayContaining([
        expect.objectContaining({
          sourceKind: 'receipt',
          sourceId: 'receipt-recall',
          workspaceId: 'default',
        }),
      ]),
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: '/v1/recall/receipt/receipt-recall',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      sourceKind: 'receipt',
      sourceId: 'receipt-recall',
      workspaceId: 'default',
      content: 'Credentials were missing during deploy.',
    });

    await runtime.close();
    await app.close();
  });

  it('filters runs by state query param', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-runs-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'run-filter-task',
      prompt: 'hello',
      source: 'manual',
      autoEnqueue: true,
    });
    if (!created.job) throw new Error('expected job to be created');

    const now = new Date().toISOString();
    runtime.databases.app
      .prepare(
        'INSERT INTO runs (id, job_id, task_id, workspace_id, session_root_id, engine_session_ref, state, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'run-failed-filter',
        created.job.id,
        created.task.id,
        'default',
        'session-filter',
        null,
        'failed_final',
        now,
        now,
        'test failure',
      );

    const response = await app.inject({
      method: 'GET',
      url: '/v1/runs?state=failed_final',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const runs = response.json() as Array<{ id: string; state: string }>;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: 'run-failed-filter', state: 'failed_final' });

    await runtime.close();
    await app.close();
  });

  it('records auth_bearer_invalid audit event on bad bearer token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-auth-bearer-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const resp = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(resp.statusCode).toBe(401);
    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'auth_bearer_invalid', severity: 'warn' })]),
    );

    await runtime.close();
    await app.close();
  });

  it('records auth_browser_cookie_missing audit event when no auth provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-auth-cookie-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const resp = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(resp.statusCode).toBe(401);
    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'auth_browser_cookie_missing', severity: 'warn' })]),
    );

    await runtime.close();
    await app.close();
  });

  it('records csrf_token_invalid audit event on bad CSRF token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-csrf-token-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const resp = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': 'bad-csrf' },
      payload: { workspaceId: 'default', projectId: null, title: 't', prompt: 'hello', source: 'manual', autoEnqueue: false },
    });
    expect(resp.statusCode).toBe(403);
    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'csrf_token_invalid', severity: 'warn' })]),
    );

    await runtime.close();
    await app.close();
  });

  it('records csrf_cross_site_blocked audit event on cross-site request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-csrf-cross-site-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));

    const resp = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'cross-site',
      },
      payload: { workspaceId: 'default', projectId: null, title: 't', prompt: 'hello', source: 'manual', autoEnqueue: false },
    });
    expect(resp.statusCode).toBe(403);
    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'csrf_cross_site_blocked', severity: 'warn' })]),
    );

    await runtime.close();
    await app.close();
  });

  it('saves Telegram config, applies it, and exposes mutation receipts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-telegram-control-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const csrf = issueCsrfToken(readAuthStore(authFile));

    let currentSnapshot = {
      persisted: { enabled: false, allowedUserId: null, secretRefId: null },
      applied: { enabled: false, allowedUserId: null, secretRefId: null },
      effectiveWorkspaceId: 'default',
      secretAvailability: 'not_configured' as const,
      staleComparedToApplied: false,
      warnings: [],
      managementMode: 'launchd' as const,
      restartSupported: true,
    };

    const app = await createControlApi({
      runtime,
      telegramConfigControl: {
        getSnapshot: () => currentSnapshot,
        updateConfig: (input) => {
          currentSnapshot = {
            ...currentSnapshot,
            persisted: {
              enabled: input.enabled,
              allowedUserId: input.allowedUserId,
              secretRefId: input.secretRefId,
            },
            secretAvailability: input.secretRefId ? 'available' : 'not_configured',
            staleComparedToApplied: true,
          };
          return {
            snapshot: currentSnapshot,
            changedFields: ['enabled', 'allowedUserId', 'secretRefId'],
          };
        },
        applyTelegramConfig: async () => {
          currentSnapshot = {
            ...currentSnapshot,
            applied: currentSnapshot.persisted,
            staleComparedToApplied: false,
          };
          return {
            status: 'reloaded_active',
            summary: 'Telegram bridge reloaded and is active.',
            snapshot: currentSnapshot,
          };
        },
      },
      daemonControl: {
        getManagementStatus: () => ({ managementMode: 'launchd', restartSupported: true }),
        restartDaemonNow: () => ({ ok: true, output: 'restarted' }),
      },
    });

    const saveResponse = await app.inject({
      method: 'POST',
      url: '/v1/config/telegram',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
      payload: {
        enabled: true,
        allowedUserId: '5315323298',
        secretRefId: 'secret-telegram-bot',
      },
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json()).toMatchObject({
      persisted: {
        enabled: true,
        allowedUserId: '5315323298',
        secretRefId: 'secret-telegram-bot',
      },
      staleComparedToApplied: true,
    });

    const applyResponse = await app.inject({
      method: 'POST',
      url: '/v1/daemon/components/telegram/apply',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
    });
    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.json()).toMatchObject({
      status: 'reloaded_active',
      snapshot: {
        staleComparedToApplied: false,
      },
    });

    const receiptsResponse = await app.inject({
      method: 'GET',
      url: '/v1/governance/mutation-receipts?component=telegram&limit=10',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(receiptsResponse.statusCode).toBe(200);
    const receipts = receiptsResponse.json() as Array<{ id: string; kind: string; summary: string; status: string }>;
    expect(receipts.map((receipt) => receipt.kind)).toEqual(['telegram_apply', 'telegram_config_update']);
    expect(receipts[0]?.status).toBe('succeeded');

    const receiptDetailResponse = await app.inject({
      method: 'GET',
      url: `/v1/governance/mutation-receipts/${receipts[0]?.id}`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(receiptDetailResponse.statusCode).toBe(200);
    expect(receiptDetailResponse.json()).toMatchObject({
      kind: 'telegram_apply',
    });

    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'telegram_config_updated', severity: 'info' }),
        expect.objectContaining({ code: 'telegram_apply_succeeded', severity: 'info' }),
      ]),
    );

    await runtime.close();
    await app.close();
  });

  it('returns manual_required for unmanaged daemon restart and receipts the failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-daemon-restart-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/daemon/restart',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'manual_required',
      restartSupported: false,
      managementMode: 'manual',
    });

    const receipts = runtime.listMutationReceipts('daemon');
    expect(receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'daemon_restart',
          status: 'failed',
        }),
      ]),
    );
    expect(runtime.getSecurityAuditFindings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'daemon_restart_failed', severity: 'warn' }),
      ]),
    );

    await runtime.close();
    await app.close();
  });
});
