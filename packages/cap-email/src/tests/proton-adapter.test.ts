import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ProtonBridgeAdapter } from '../providers/proton-adapter.js';

// Mock imapflow
vi.mock('imapflow', () => {
  return {
    ImapFlow: vi.fn(),
  };
});

import { ImapFlow } from 'imapflow';

const MockImapFlow = vi.mocked(ImapFlow);

function createMockClient(messages: Array<{
  uid: number;
  envelope: {
    date?: Date;
    subject?: string;
    from?: Array<{ name?: string; address?: string }>;
    to?: Array<{ name?: string; address?: string }>;
    cc?: Array<{ name?: string; address?: string }>;
    messageId?: string;
    inReplyTo?: string;
  };
  flags: Set<string>;
  size: number;
  headers?: Buffer;
  source?: Buffer;
}>) {
  const mockLock = { release: vi.fn() };
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockResolvedValue(mockLock),
    fetch: vi.fn().mockImplementation(function* (range: string) {
      // If range is a specific UID set (e.g. "42" or "1,2"), filter messages
      if (/^\d+(,\d+)*$/.test(range)) {
        const requestedUids = new Set(range.split(',').map(Number));
        for (const msg of messages) {
          if (requestedUids.has(msg.uid)) yield msg;
        }
      } else {
        // Range like "1:*" — yield all
        for (const msg of messages) {
          yield msg;
        }
      }
    }),
  };

  MockImapFlow.mockImplementation(() => client as unknown as ImapFlow);
  return client;
}

describe('ProtonBridgeAdapter', () => {
  let adapter: ProtonBridgeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ProtonBridgeAdapter({
      username: 'user@proton.me',
      password: 'bridge-password',
      host: '127.0.0.1',
      port: 1143,
    });
  });

  it('getProfile returns the configured email', async () => {
    createMockClient([]);
    const profile = await adapter.getProfile();
    expect(profile.emailAddress).toBe('user@proton.me');
    expect(profile.historyId).toBeUndefined();
  });

  it('listThreads groups messages by references', async () => {
    const rootMsgId = '<root@example.com>';
    createMockClient([
      {
        uid: 1,
        envelope: {
          date: new Date('2024-01-15T10:00:00Z'),
          subject: 'First message',
          from: [{ name: 'Alice', address: 'alice@proton.me' }],
          to: [{ address: 'user@proton.me' }],
          messageId: rootMsgId,
        },
        flags: new Set<string>(),
        size: 500,
        headers: Buffer.from(''),
      },
      {
        uid: 2,
        envelope: {
          date: new Date('2024-01-15T11:00:00Z'),
          subject: 'Re: First message',
          from: [{ address: 'user@proton.me' }],
          to: [{ address: 'alice@proton.me' }],
          messageId: '<reply@example.com>',
        },
        flags: new Set(['\\Seen']),
        size: 300,
        headers: Buffer.from(`References: ${rootMsgId}\r\n`),
      },
    ]);

    const result = await adapter.listThreads({ maxResults: 50 });
    expect(result.threads.length).toBe(1);
    expect(result.threads[0]!.messageCount).toBe(2);
    expect(result.threads[0]!.subject).toBe('First message');
  });

  it('maps IMAP flags to pseudo-labels', async () => {
    createMockClient([
      {
        uid: 1,
        envelope: {
          date: new Date('2024-01-15T10:00:00Z'),
          subject: 'Unread starred',
          from: [{ address: 'sender@test.com' }],
          to: [{ address: 'user@proton.me' }],
          messageId: '<test@example.com>',
        },
        flags: new Set(['\\Flagged']),
        size: 400,
        headers: Buffer.from(''),
      },
    ]);

    const result = await adapter.listThreads();
    const thread = result.threads[0]!;
    expect(thread.isUnread).toBe(true);
    expect(thread.isStarred).toBe(true);
    expect(thread.labelIds).toContain('UNREAD');
    expect(thread.labelIds).toContain('STARRED');
    expect(thread.labelIds).toContain('INBOX');
  });

  it('separates unrelated messages into different threads', async () => {
    createMockClient([
      {
        uid: 1,
        envelope: {
          date: new Date('2024-01-15T10:00:00Z'),
          subject: 'Topic A',
          from: [{ address: 'a@test.com' }],
          to: [{ address: 'user@proton.me' }],
          messageId: '<topic-a@test.com>',
        },
        flags: new Set<string>(),
        size: 200,
        headers: Buffer.from(''),
      },
      {
        uid: 2,
        envelope: {
          date: new Date('2024-01-15T11:00:00Z'),
          subject: 'Topic B',
          from: [{ address: 'b@test.com' }],
          to: [{ address: 'user@proton.me' }],
          messageId: '<topic-b@test.com>',
        },
        flags: new Set(['\\Seen']),
        size: 300,
        headers: Buffer.from(''),
      },
    ]);

    const result = await adapter.listThreads();
    expect(result.threads.length).toBe(2);
  });

  it('getMessage returns a single message by UID with body preview', async () => {
    createMockClient([
      {
        uid: 42,
        envelope: {
          date: new Date('2024-01-15T10:00:00Z'),
          subject: 'Test message',
          from: [{ name: 'Sender', address: 'sender@test.com' }],
          to: [{ address: 'user@proton.me' }],
          messageId: '<msg42@test.com>',
        },
        flags: new Set<string>(),
        size: 600,
        headers: Buffer.from(''),
        source: Buffer.from('From: sender@test.com\r\nTo: user@proton.me\r\n\r\nHello body text'),
      },
    ]);

    const msg = await adapter.getMessage('42');
    expect(msg.messageId).toBe('42');
    expect(msg.from).toBe('Sender <sender@test.com>');
    expect(msg.subject).toBe('Test message');
    expect(msg.bodyPreview).toContain('Hello body text');
  });

  it('handles empty mailbox', async () => {
    createMockClient([]);
    const result = await adapter.listThreads();
    expect(result.threads).toEqual([]);
  });

  it('does not implement listHistory', () => {
    expect(adapter.listHistory).toBeUndefined();
  });

  it('connects with correct credentials', async () => {
    createMockClient([]);
    await adapter.listThreads();
    expect(MockImapFlow).toHaveBeenCalledWith(expect.objectContaining({
      host: '127.0.0.1',
      port: 1143,
      secure: false,
      auth: { user: 'user@proton.me', pass: 'bridge-password' },
    }));
  });

  it('uses 1:* range for full fetch (not * which means single message)', async () => {
    const client = createMockClient([
      {
        uid: 1,
        envelope: { date: new Date(), subject: 'msg1', messageId: '<1@test>' },
        flags: new Set<string>(),
        size: 100,
        headers: Buffer.from(''),
      },
      {
        uid: 2,
        envelope: { date: new Date(), subject: 'msg2', messageId: '<2@test>' },
        flags: new Set<string>(),
        size: 100,
        headers: Buffer.from(''),
      },
    ]);

    await adapter.listThreads({ maxResults: 50 });
    // Verify the fetch was called with '1:*', not '*'
    expect(client.fetch).toHaveBeenCalledWith('1:*', expect.any(Object), expect.any(Object));
  });

  it('listThreads does NOT request source (no body download)', async () => {
    const client = createMockClient([
      {
        uid: 1,
        envelope: { date: new Date(), subject: 'test', messageId: '<1@test>' },
        flags: new Set<string>(),
        size: 100,
        headers: Buffer.from(''),
      },
    ]);

    await adapter.listThreads();
    // Verify source is NOT in the fetch query
    const fetchQuery = client.fetch.mock.calls[0]![1] as Record<string, unknown>;
    expect(fetchQuery).not.toHaveProperty('source');
  });

  it('getMessage DOES request source (body download)', async () => {
    const client = createMockClient([
      {
        uid: 1,
        envelope: { date: new Date(), subject: 'test', messageId: '<1@test>' },
        flags: new Set<string>(),
        size: 100,
        headers: Buffer.from(''),
        source: Buffer.from('From: a@b\r\n\r\nbody'),
      },
    ]);

    await adapter.getMessage('1');
    const fetchQuery = client.fetch.mock.calls[0]![1] as Record<string, unknown>;
    expect(fetchQuery).toHaveProperty('source', true);
  });

  it('getThread uses cached thread map from listThreads', async () => {
    const rootMsgId = '<root@example.com>';
    const client = createMockClient([
      {
        uid: 1,
        envelope: {
          date: new Date('2024-01-15T10:00:00Z'),
          subject: 'Cached thread',
          from: [{ address: 'sender@test.com' }],
          to: [{ address: 'user@proton.me' }],
          messageId: rootMsgId,
        },
        flags: new Set<string>(),
        size: 500,
        headers: Buffer.from(''),
      },
    ]);

    // First call populates cache
    const result = await adapter.listThreads();
    const threadId = result.threads[0]!.threadId;

    // Reset mock call count
    client.connect.mockClear();

    // getThread should hit cache — no new connection
    const thread = await adapter.getThread(threadId);
    expect(thread.subject).toBe('Cached thread');
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('snippet uses bodyPreview when available, falls back to subject', async () => {
    createMockClient([
      {
        uid: 1,
        envelope: {
          date: new Date(),
          subject: 'My Subject',
          from: [{ address: 'a@b.com' }],
          to: [{ address: 'user@proton.me' }],
          messageId: '<1@test>',
        },
        flags: new Set<string>(),
        size: 100,
        headers: Buffer.from(''),
        // No source — bodyPreview will be empty
      },
    ]);

    const result = await adapter.listThreads();
    // Without source, snippet falls back to subject
    expect(result.threads[0]!.messages[0]!.snippet).toBe('My Subject');
  });

  it('handles folded References header', async () => {
    createMockClient([
      {
        uid: 1,
        envelope: {
          date: new Date(),
          subject: 'Original',
          from: [{ address: 'a@b.com' }],
          to: [{ address: 'user@proton.me' }],
          messageId: '<orig@test>',
        },
        flags: new Set<string>(),
        size: 100,
        headers: Buffer.from(''),
      },
      {
        uid: 2,
        envelope: {
          date: new Date(),
          subject: 'Reply',
          from: [{ address: 'c@d.com' }],
          to: [{ address: 'user@proton.me' }],
          messageId: '<reply@test>',
        },
        flags: new Set<string>(),
        size: 100,
        // Folded header — continuation line starts with whitespace
        headers: Buffer.from('References: <orig@test>\r\n <mid@test>\r\n'),
      },
    ]);

    const result = await adapter.listThreads();
    // Both messages should be in the same thread (reply references orig)
    expect(result.threads.length).toBe(1);
    expect(result.threads[0]!.messageCount).toBe(2);
  });
});
