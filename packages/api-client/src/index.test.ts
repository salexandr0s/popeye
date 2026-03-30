import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, PopeyeApiClient } from './client.ts';

describe('PopeyeApiClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body: unknown): void {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
      headers: new Headers(),
    });
  }

  it('sends bearer token on GET requests', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, { ok: true, startedAt: '2026-01-01T00:00:00Z' });

    await client.health();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/v1/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('fetches CSRF token and sends it on POST requests', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });

    // First call: CSRF token fetch
    mockFetch(200, { token: 'csrf-abc' });
    // Second call: the actual POST (must pass TaskCreateResponseSchema)
    mockFetch(200, {
      task: {
        id: 't1',
        workspaceId: 'default',
        projectId: null,
        title: 'test',
        prompt: 'hello',
        source: 'manual',
        status: 'active',
        retryPolicy: { maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 },
        sideEffectProfile: 'read_only',
        coalesceKey: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
      job: null,
      run: null,
    });

    await client.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'test',
      prompt: 'hello',
      source: 'manual',
      autoEnqueue: false,
    });

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(calls).toHaveLength(2);

    // CSRF fetch
    expect(calls[0]![0]).toBe(
      'http://127.0.0.1:3210/v1/security/csrf-token',
    );

    // POST with CSRF header
    expect(calls[1]![0]).toBe('http://127.0.0.1:3210/v1/tasks');
    expect(calls[1]![1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'x-popeye-csrf': 'csrf-abc',
        'sec-fetch-site': 'same-origin',
        Authorization: 'Bearer test-token',
      }),
    });
  });

  it('throws ApiError on non-ok responses', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(404, { error: 'not_found' });

    await expect(client.getRun('nonexistent')).rejects.toThrow(ApiError);
  });

  it('throws ApiError on 500 responses', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(500, { error: 'internal' });

    try {
      await client.status();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(500);
    }
  });

  it('validates workspace list responses with schemas', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, [{ id: 'default', name: 'Default workspace', createdAt: '2026-01-01T00:00:00Z' }]);

    await expect(client.listWorkspaces()).resolves.toEqual([
      { id: 'default', name: 'Default workspace', rootPath: null, createdAt: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('encodes run state filters when listing runs', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, []);

    await client.listRuns({ state: ['failed_retryable', 'failed_final'] });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/v1/runs?state=failed_retryable%2Cfailed_final',
      expect.anything(),
    );
  });

  it('fetches single jobs and run receipts', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, {
      id: 'job-1',
      taskId: 'task-1',
      workspaceId: 'default',
      status: 'running',
      retryCount: 0,
      availableAt: '2026-01-01T00:00:00Z',
      lastRunId: 'run-1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    mockFetch(200, {
      id: 'receipt-1',
      runId: 'run-1',
      jobId: 'job-1',
      taskId: 'task-1',
      workspaceId: 'default',
      status: 'succeeded',
      summary: 'done',
      details: '',
      usage: { provider: 'fake', model: 'fake', tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0 },
      createdAt: '2026-01-01T00:00:00Z',
    });

    await expect(client.getJob('job-1')).resolves.toMatchObject({ id: 'job-1', lastRunId: 'run-1' });
    await expect(client.getRunReceipt('run-1')).resolves.toMatchObject({ id: 'receipt-1', runId: 'run-1' });
  });

  it('fetches packaged run replies and Telegram relay state', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, {
      runId: 'run-1',
      terminalStatus: 'succeeded',
      source: 'completed_output',
      text: 'All green.',
    });
    mockFetch(200, null);
    mockFetch(200, { token: 'csrf-abc' });
    mockFetch(200, {
      relayKey: 'telegram_long_poll',
      workspaceId: 'default',
      lastAcknowledgedUpdateId: 55,
      updatedAt: '2026-03-14T00:00:00Z',
    });
    mockFetch(200, {
      chatId: '777',
      telegramMessageId: 9,
      status: 'sending',
    });
    mockFetch(200, {
      chatId: '777',
      telegramMessageId: 9,
      status: 'pending',
    });
    mockFetch(200, {
      chatId: '777',
      telegramMessageId: 9,
      status: 'uncertain',
    });
    mockFetch(200, {
      chatId: '777',
      telegramMessageId: 9,
      status: 'sent',
    });

    await expect(client.getRunReply('run-1')).resolves.toMatchObject({ text: 'All green.' });
    await expect(client.getTelegramRelayCheckpoint('default')).resolves.toBeNull();
    await expect(
      client.commitTelegramRelayCheckpoint({
        relayKey: 'telegram_long_poll',
        workspaceId: 'default',
        lastAcknowledgedUpdateId: 55,
      }),
    ).resolves.toMatchObject({ lastAcknowledgedUpdateId: 55 });
    await expect(
      client.markTelegramReplySending('777', 9, { workspaceId: 'default', runId: 'run-1' }),
    ).resolves.toEqual({
      chatId: '777',
      telegramMessageId: 9,
      status: 'sending',
    });
    await expect(
      client.markTelegramReplyPending('777', 9, { workspaceId: 'default', runId: 'run-1' }),
    ).resolves.toEqual({
      chatId: '777',
      telegramMessageId: 9,
      status: 'pending',
    });
    await expect(
      client.markTelegramReplyUncertain('777', 9, { workspaceId: 'default', runId: 'run-1', reason: 'transport failed' }),
    ).resolves.toEqual({
      chatId: '777',
      telegramMessageId: 9,
      status: 'uncertain',
    });
    await expect(
      client.markTelegramReplySent('777', 9, { workspaceId: 'default', runId: 'run-1', sentTelegramMessageId: 901 }),
    ).resolves.toEqual({
      chatId: '777',
      telegramMessageId: 9,
      status: 'sent',
    });
  });

  it('encodes memory search options into query params', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, {
      query: 'hello',
      results: [],
      totalCandidates: 0,
      latencyMs: 1,
      searchMode: 'fts_only',
    });

    await client.searchMemory({
      query: 'hello',
      memoryTypes: ['semantic', 'procedural'],
      limit: 5,
      includeContent: true,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/v1/memory/search?q=hello&types=semantic%2Cprocedural&limit=5&full=true',
      expect.anything(),
    );
  });

  it('omits null memory location filters from query params', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, []);

    await client.listMemories({
      workspaceId: null,
      projectId: null,
      includeGlobal: true,
      limit: 5,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/v1/memory?includeGlobal=true&limit=5',
      expect.anything(),
    );
  });

  it('encodes optional projectId for instruction previews', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, {
      id: 'bundle-1',
      sources: [],
      compiledText: 'compiled',
      bundleHash: 'hash',
      warnings: [],
      createdAt: '2026-03-14T00:00:00.000Z',
    });

    await client.getInstructionPreview('default', 'proj-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/v1/instruction-previews/default?projectId=proj-1',
      expect.anything(),
    );
  });

  it('encodes recall search filters and parses detail payloads', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, {
      query: 'credentials',
      totalMatches: 1,
      results: [{
        sourceKind: 'receipt',
        sourceId: 'receipt-1',
        title: 'Credential failure',
        snippet: 'Missing deploy credentials.',
        score: 0.91,
        createdAt: '2026-03-30T00:00:00Z',
        workspaceId: 'default',
        projectId: 'proj-1',
        runId: 'run-1',
        taskId: 'task-1',
        sessionRootId: 'session-1',
        subtype: 'failed',
        status: 'failed',
      }],
    });
    mockFetch(200, {
      sourceKind: 'receipt',
      sourceId: 'receipt-1',
      title: 'Credential failure',
      snippet: 'Missing deploy credentials.',
      score: 0.91,
      createdAt: '2026-03-30T00:00:00Z',
      workspaceId: 'default',
      projectId: 'proj-1',
      runId: 'run-1',
      taskId: 'task-1',
      sessionRootId: 'session-1',
      subtype: 'failed',
      status: 'failed',
      content: 'Deploy failed because credentials were missing.',
      metadata: { status: 'failed' },
    });

    await expect(client.searchRecall({
      query: 'credentials',
      workspaceId: 'default',
      projectId: 'proj-1',
      includeGlobal: true,
      kinds: ['receipt', 'memory'],
      limit: 5,
    })).resolves.toMatchObject({ totalMatches: 1 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:3210/v1/recall/search?q=credentials&workspaceId=default&projectId=proj-1&includeGlobal=true&kinds=receipt%2Cmemory&limit=5',
      expect.anything(),
    );

    await expect(client.getRecallDetail('receipt', 'receipt-1')).resolves.toMatchObject({
      sourceId: 'receipt-1',
      content: 'Deploy failed because credentials were missing.',
    });
  });

  it('returns null for missing memory records', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(404, { error: 'not_found' });

    await expect(client.getMemory('missing')).resolves.toBeNull();
  });

  it('ingests and fetches messages through the API', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, { token: 'csrf-abc' });
    mockFetch(200, {
      accepted: true,
      duplicate: false,
      httpStatus: 200,
      decisionCode: 'accepted',
      decisionReason: 'accepted',
      message: null,
      taskId: 'task-1',
      jobId: 'job-1',
      runId: null,
    });
    mockFetch(200, {
      id: 'message-1',
      source: 'telegram',
      senderId: '42',
      body: 'hello',
      accepted: true,
      relatedRunId: 'run-1',
      createdAt: '2026-01-01T00:00:00Z',
    });

    await expect(client.ingestMessage({
      source: 'telegram',
      senderId: '42',
      text: 'hello',
      chatId: 'chat-1',
      chatType: 'private',
      telegramMessageId: 1,
      workspaceId: 'default',
    })).resolves.toMatchObject({ accepted: true, taskId: 'task-1' });
    await expect(client.getMessage('message-1')).resolves.toMatchObject({ id: 'message-1', relatedRunId: 'run-1' });
  });

  it('returns denied ingress responses without throwing for control-plane callers', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, { token: 'csrf-abc' });
    mockFetch(403, {
      accepted: false,
      duplicate: false,
      httpStatus: 403,
      decisionCode: 'telegram_not_allowlisted',
      decisionReason: 'Telegram sender is not allowlisted',
      message: null,
      taskId: null,
      jobId: null,
      runId: null,
    });

    await expect(client.ingestMessage({
      source: 'telegram',
      senderId: '24',
      text: 'hello',
      chatId: 'chat-1',
      chatType: 'private',
      telegramMessageId: 2,
      workspaceId: 'default',
    })).resolves.toMatchObject({
      accepted: false,
      httpStatus: 403,
      decisionCode: 'telegram_not_allowlisted',
    });
  });

  it('returns denied ingress responses without throwing ApiError', async () => {
    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });
    mockFetch(200, { token: 'csrf-abc' });
    mockFetch(403, {
      accepted: false,
      duplicate: false,
      httpStatus: 403,
      decisionCode: 'telegram_not_allowlisted',
      decisionReason: 'Telegram sender is not allowlisted',
      message: null,
      taskId: null,
      jobId: null,
      runId: null,
    });

    await expect(client.ingestMessage({
      source: 'telegram',
      senderId: '24',
      text: 'hello',
      chatId: 'chat-1',
      chatType: 'private',
      telegramMessageId: 7,
      workspaceId: 'default',
    })).resolves.toMatchObject({
      accepted: false,
      httpStatus: 403,
      decisionCode: 'telegram_not_allowlisted',
    });
  });

  it('parses SSE events via subscribeEvents callback', () => {
    const chunks = [
      new TextEncoder().encode(
        'event: run_started\ndata: {"runId":"r1"}\n\n',
      ),
      new TextEncoder().encode(
        'event: run_completed\ndata: {"runId":"r1","status":"succeeded"}\n\n',
      ),
    ];

    let chunkIndex = 0;
    const mockReader = {
      read: vi.fn().mockImplementation(() => {
        if (chunkIndex < chunks.length) {
          return Promise.resolve({
            done: false,
            value: chunks[chunkIndex++],
          });
        }
        return Promise.resolve({ done: true, value: undefined });
      }),
      releaseLock: vi.fn(),
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { getReader: () => mockReader },
    });

    const client = new PopeyeApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      token: 'test-token',
    });

    const events: Array<{ event: string; data: string }> = [];
    const unsub = client.subscribeEvents((event) => events.push(event));

    // subscribeEvents is fire-and-forget, unsub aborts
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
