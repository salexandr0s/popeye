import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { GmailAdapter } from '../providers/gmail-adapter.js';

// Mock fetch globally
const mockFetch = vi.fn();

describe('GmailAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches profile', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        emailAddress: 'user@gmail.com',
        messagesTotal: 100,
        threadsTotal: 50,
        historyId: '12345',
      }),
    });

    const adapter = new GmailAdapter({ accessToken: 'test-token' });
    const profile = await adapter.getProfile();

    expect(profile.emailAddress).toBe('user@gmail.com');
    expect(profile.historyId).toBe('12345');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    );
  });

  it('lists threads with pagination', async () => {
    // First call: threads.list
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        threads: [
          { id: 'thread-1', snippet: 'Hello', historyId: '100' },
        ],
        nextPageToken: 'next-page',
      }),
    });

    // Second call: threads.get for thread-1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'thread-1',
        historyId: '100',
        snippet: 'Hello',
        messages: [{
          id: 'msg-1',
          threadId: 'thread-1',
          snippet: 'Hello',
          historyId: '100',
          internalDate: '1705312000000',
          sizeEstimate: 500,
          labelIds: ['INBOX', 'UNREAD'],
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'sender@test.com' },
              { name: 'To', value: 'user@test.com' },
              { name: 'Subject', value: 'Hello World' },
            ],
            body: { size: 5, data: 'SGVsbG8=' }, // "Hello" in base64
          },
        }],
      }),
    });

    const adapter = new GmailAdapter({ accessToken: 'test-token' });
    const page = await adapter.listThreads({ maxResults: 10 });

    expect(page.threads.length).toBe(1);
    expect(page.threads[0]!.threadId).toBe('thread-1');
    expect(page.threads[0]!.subject).toBe('Hello World');
    expect(page.threads[0]!.isUnread).toBe(true);
    expect(page.threads[0]!.messages.length).toBe(1);
    expect(page.threads[0]!.messages[0]!.from).toBe('sender@test.com');
    expect(page.nextPageToken).toBe('next-page');
  });

  it('handles empty thread list', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ resultSizeEstimate: 0 }),
    });

    const adapter = new GmailAdapter({ accessToken: 'test-token' });
    const page = await adapter.listThreads();

    expect(page.threads.length).toBe(0);
    expect(page.nextPageToken).toBeUndefined();
  });

  it('retries on 429 with backoff', async () => {
    // First call: 429
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    // Second call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        emailAddress: 'user@gmail.com',
        messagesTotal: 100,
        threadsTotal: 50,
        historyId: '12345',
      }),
    });

    const adapter = new GmailAdapter({ accessToken: 'test-token' });
    const profile = await adapter.getProfile();

    expect(profile.emailAddress).toBe('user@gmail.com');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('attempts token refresh on 401', async () => {
    // First call: 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    // Token refresh call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'new-token' }),
    });

    // Retry with new token
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        emailAddress: 'user@gmail.com',
        messagesTotal: 100,
        threadsTotal: 50,
        historyId: '12345',
      }),
    });

    const adapter = new GmailAdapter({
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    const profile = await adapter.getProfile();
    expect(profile.emailAddress).toBe('user@gmail.com');
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify refresh request
    const refreshCall = mockFetch.mock.calls[1]!;
    expect(refreshCall[0]).toBe('https://oauth2.googleapis.com/token');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    const adapter = new GmailAdapter({ accessToken: 'test-token' });
    await expect(adapter.getProfile()).rejects.toThrow('Gmail API error 403: Forbidden');
  });

  it('normalizes message body preview', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'msg-1',
        threadId: 'thread-1',
        snippet: 'Preview',
        historyId: '100',
        internalDate: '1705312000000',
        sizeEstimate: 500,
        labelIds: ['INBOX'],
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: 'sender@test.com' },
            { name: 'Subject', value: 'Test' },
          ],
          body: { size: 0 },
          parts: [
            {
              mimeType: 'text/plain',
              headers: [],
              body: { size: 11, data: 'SGVsbG8gV29ybGQ=' }, // "Hello World" base64
            },
            {
              mimeType: 'text/html',
              headers: [],
              body: { size: 20, data: 'PGI-SGVsbG88L2I-' },
            },
          ],
        },
      }),
    });

    const adapter = new GmailAdapter({ accessToken: 'test-token' });
    const msg = await adapter.getMessage('msg-1');
    expect(msg.bodyPreview).toBe('Hello World');
  });
});
