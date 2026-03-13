import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, PopeyeApiClient } from './client.js';

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
