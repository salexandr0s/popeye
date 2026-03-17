import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ApprovalRecordSchema,
  ConnectionRecordSchema,
  ContextReleasePreviewSchema,
  SecurityPolicyResponseSchema,
} from '@popeye/contracts';
import { createRuntimeService, initAuthStore, issueCsrfToken, readAuthStore } from '@popeye/runtime-core';

import { createControlApi } from './index.js';

function createTestEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-policy-'));
  chmodSync(dir, 0o700);
  const authFile = join(dir, 'auth.json');
  const store = initAuthStore(authFile);
  const runtime = createRuntimeService({
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'] },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    approvalPolicy: { rules: [], defaultRiskClass: 'ask', pendingExpiryMinutes: 60 },
    vaults: { autoOpenOnRun: false, defaultKind: 'capability' },
  });
  const csrf = issueCsrfToken(readAuthStore(authFile));
  const authHeaders = { authorization: `Bearer ${store.current.token}` };
  const mutationHeaders = { ...authHeaders, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };
  return { dir, authFile, store, runtime, authHeaders, mutationHeaders, csrf };
}

describe('policy substrate API routes', () => {
  // --- Approvals ---

  it('POST /v1/approvals creates a pending approval', async () => {
    const { runtime, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: mutationHeaders,
      payload: {
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'sec-1',
        requestedBy: 'test-agent',
      },
    });

    expect(response.statusCode).toBe(200);
    const approval = ApprovalRecordSchema.parse(response.json());
    expect(approval.status).toBe('pending');
    expect(approval.scope).toBe('secret_access');

    await runtime.close();
    await app.close();
  });

  it('GET /v1/approvals lists approvals with optional filters', async () => {
    const { runtime, authHeaders, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    // Create two approvals in different domains
    await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: mutationHeaders,
      payload: { scope: 'secret_access', domain: 'general', riskClass: 'ask', resourceType: 'secret', resourceId: 's1', requestedBy: 'agent' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: mutationHeaders,
      payload: { scope: 'vault_open', domain: 'email', riskClass: 'ask', resourceType: 'vault', resourceId: 'v1', requestedBy: 'agent' },
    });

    const allResponse = await app.inject({ method: 'GET', url: '/v1/approvals', headers: authHeaders });
    expect(allResponse.statusCode).toBe(200);
    const all = z.array(ApprovalRecordSchema).parse(allResponse.json());
    expect(all.length).toBe(2);

    const filteredResponse = await app.inject({ method: 'GET', url: '/v1/approvals?domain=email', headers: authHeaders });
    expect(filteredResponse.statusCode).toBe(200);
    const filtered = z.array(ApprovalRecordSchema).parse(filteredResponse.json());
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.domain).toBe('email');

    await runtime.close();
    await app.close();
  });

  it('GET /v1/approvals/:id returns a single approval', async () => {
    const { runtime, authHeaders, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: mutationHeaders,
      payload: { scope: 'context_release', domain: 'general', riskClass: 'ask', resourceType: 'ctx', resourceId: 'c1', requestedBy: 'agent' },
    });
    const created = ApprovalRecordSchema.parse(createResponse.json());

    const getResponse = await app.inject({ method: 'GET', url: `/v1/approvals/${created.id}`, headers: authHeaders });
    expect(getResponse.statusCode).toBe(200);
    const fetched = ApprovalRecordSchema.parse(getResponse.json());
    expect(fetched.id).toBe(created.id);

    await runtime.close();
    await app.close();
  });

  it('GET /v1/approvals/:id returns 404 for unknown id', async () => {
    const { runtime, authHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({ method: 'GET', url: '/v1/approvals/nonexistent', headers: authHeaders });
    expect(response.statusCode).toBe(404);

    await runtime.close();
    await app.close();
  });

  it('POST /v1/approvals/:id/resolve approves a pending approval', async () => {
    const { runtime, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: mutationHeaders,
      payload: { scope: 'secret_access', domain: 'general', riskClass: 'ask', resourceType: 'secret', resourceId: 's1', requestedBy: 'agent' },
    });
    const created = ApprovalRecordSchema.parse(createResponse.json());

    const resolveResponse = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${created.id}/resolve`,
      headers: mutationHeaders,
      payload: { decision: 'approved', decisionReason: 'Operator approved' },
    });
    expect(resolveResponse.statusCode).toBe(200);
    const resolved = ApprovalRecordSchema.parse(resolveResponse.json());
    expect(resolved.status).toBe('approved');
    expect(resolved.decisionReason).toBe('Operator approved');

    await runtime.close();
    await app.close();
  });

  it('POST /v1/approvals/:id/resolve returns 409 on double-resolve', async () => {
    const { runtime, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: mutationHeaders,
      payload: { scope: 'secret_access', domain: 'general', riskClass: 'ask', resourceType: 'secret', resourceId: 's1', requestedBy: 'agent' },
    });
    const created = ApprovalRecordSchema.parse(createResponse.json());

    await app.inject({
      method: 'POST',
      url: `/v1/approvals/${created.id}/resolve`,
      headers: mutationHeaders,
      payload: { decision: 'approved' },
    });

    const doubleResolve = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${created.id}/resolve`,
      headers: mutationHeaders,
      payload: { decision: 'denied' },
    });
    expect(doubleResolve.statusCode).toBe(409);

    await runtime.close();
    await app.close();
  });

  it('POST /v1/approvals/:id/resolve returns 404 for unknown id', async () => {
    const { runtime, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/approvals/nonexistent/resolve',
      headers: mutationHeaders,
      payload: { decision: 'approved' },
    });
    expect(response.statusCode).toBe(404);

    await runtime.close();
    await app.close();
  });

  it('POST /v1/approvals auto-approves when riskClass is auto', async () => {
    const { runtime, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: mutationHeaders,
      payload: { scope: 'secret_access', domain: 'general', riskClass: 'auto', resourceType: 'secret', resourceId: 's1', requestedBy: 'agent' },
    });
    expect(response.statusCode).toBe(200);
    const approval = ApprovalRecordSchema.parse(response.json());
    expect(approval.status).toBe('approved');
    expect(approval.resolvedBy).toBe('policy');

    await runtime.close();
    await app.close();
  });

  // --- Security policy ---

  it('GET /v1/security/policy returns domain policies and approval rules', async () => {
    const { runtime, authHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({ method: 'GET', url: '/v1/security/policy', headers: authHeaders });
    expect(response.statusCode).toBe(200);
    const policy = SecurityPolicyResponseSchema.parse(response.json());
    expect(policy.domainPolicies.length).toBeGreaterThan(0);
    expect(Array.isArray(policy.approvalRules)).toBe(true);

    await runtime.close();
    await app.close();
  });

  // --- Connections ---

  it('POST /v1/connections creates a connection', async () => {
    const { runtime, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/connections',
      headers: mutationHeaders,
      payload: { domain: 'email', providerKind: 'gmail', label: 'My Gmail' },
    });
    expect(response.statusCode).toBe(200);
    const conn = ConnectionRecordSchema.parse(response.json());
    expect(conn.domain).toBe('email');
    expect(conn.providerKind).toBe('gmail');
    expect(conn.label).toBe('My Gmail');
    expect(conn.enabled).toBe(true);

    await runtime.close();
    await app.close();
  });

  it('GET /v1/connections lists connections with optional domain filter', async () => {
    const { runtime, authHeaders, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    await app.inject({
      method: 'POST',
      url: '/v1/connections',
      headers: mutationHeaders,
      payload: { domain: 'email', providerKind: 'gmail', label: 'Gmail' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/connections',
      headers: mutationHeaders,
      payload: { domain: 'github', providerKind: 'github', label: 'GH' },
    });

    const allResponse = await app.inject({ method: 'GET', url: '/v1/connections', headers: authHeaders });
    expect(allResponse.statusCode).toBe(200);
    const all = z.array(ConnectionRecordSchema).parse(allResponse.json());
    expect(all.length).toBe(2);

    const filteredResponse = await app.inject({ method: 'GET', url: '/v1/connections?domain=github', headers: authHeaders });
    const filtered = z.array(ConnectionRecordSchema).parse(filteredResponse.json());
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.providerKind).toBe('github');

    await runtime.close();
    await app.close();
  });

  it('PATCH /v1/connections/:id updates a connection', async () => {
    const { runtime, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/connections',
      headers: mutationHeaders,
      payload: { domain: 'email', providerKind: 'gmail', label: 'Old Label' },
    });
    const created = ConnectionRecordSchema.parse(createResponse.json());

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/connections/${created.id}`,
      headers: mutationHeaders,
      payload: { label: 'New Label', enabled: false },
    });
    expect(patchResponse.statusCode).toBe(200);
    const updated = ConnectionRecordSchema.parse(patchResponse.json());
    expect(updated.label).toBe('New Label');
    expect(updated.enabled).toBe(false);

    await runtime.close();
    await app.close();
  });

  it('PATCH /v1/connections/:id returns 404 for unknown id', async () => {
    const { runtime, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/connections/nonexistent',
      headers: mutationHeaders,
      payload: { label: 'X' },
    });
    expect(response.statusCode).toBe(404);

    await runtime.close();
    await app.close();
  });

  it('DELETE /v1/connections/:id deletes a connection', async () => {
    const { runtime, authHeaders, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/connections',
      headers: mutationHeaders,
      payload: { domain: 'email', providerKind: 'gmail', label: 'To Delete' },
    });
    const created = ConnectionRecordSchema.parse(createResponse.json());

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/connections/${created.id}`,
      headers: mutationHeaders,
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ ok: true });

    // Verify it's gone
    const listResponse = await app.inject({ method: 'GET', url: '/v1/connections', headers: authHeaders });
    expect(z.array(ConnectionRecordSchema).parse(listResponse.json()).length).toBe(0);

    await runtime.close();
    await app.close();
  });

  it('DELETE /v1/connections/:id returns 404 for unknown id', async () => {
    const { runtime, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/connections/nonexistent',
      headers: mutationHeaders,
    });
    expect(response.statusCode).toBe(404);

    await runtime.close();
    await app.close();
  });

  // --- Context release preview ---

  it('POST /v1/context-release/preview returns a release preview', async () => {
    const { runtime, mutationHeaders } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/context-release/preview',
      headers: mutationHeaders,
      payload: { domain: 'email', sourceRef: 'inbox/msg-123' },
    });
    expect(response.statusCode).toBe(200);
    const preview = ContextReleasePreviewSchema.parse(response.json());
    expect(preview.domain).toBe('email');
    expect(preview.sourceRef).toBe('inbox/msg-123');
    expect(typeof preview.requiresApproval).toBe('boolean');

    await runtime.close();
    await app.close();
  });
});
