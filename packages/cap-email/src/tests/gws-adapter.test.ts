import { describe, expect, it, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';

import { GwsCliAdapter } from '../providers/gws-adapter.js';

// Mock child_process.execFile
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

function stubExec(stdout: string, exitCode = 0) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    if (exitCode !== 0) {
      const err = new Error(`Command failed with exit code ${exitCode}`);
      (callback as Function)(err, '', 'error output');
    } else {
      (callback as Function)(null, stdout, '');
    }
    return undefined as never;
  });
}

describe('GwsCliAdapter', () => {
  let adapter: GwsCliAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GwsCliAdapter({ gwsPath: '/usr/local/bin/gws' });
  });

  it('getProfile parses JSON output from gws', async () => {
    stubExec(JSON.stringify({
      emailAddress: 'user@gmail.com',
      messagesTotal: 1500,
      threadsTotal: 800,
      historyId: '12345',
    }));

    const profile = await adapter.getProfile();
    expect(profile.emailAddress).toBe('user@gmail.com');
    expect(profile.historyId).toBe('12345');
    expect(mockExecFile).toHaveBeenCalledWith(
      '/usr/local/bin/gws',
      ['gmail', 'users', 'getProfile'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('listThreads returns empty when no threads', async () => {
    stubExec(JSON.stringify({ resultSizeEstimate: 0 }));

    const result = await adapter.listThreads({ maxResults: 10 });
    expect(result.threads).toEqual([]);
  });

  it('getThread normalizes Gmail thread response', async () => {
    stubExec(JSON.stringify({
      id: 'thread-1',
      historyId: '999',
      snippet: 'Hello world',
      messages: [{
        id: 'msg-1',
        threadId: 'thread-1',
        labelIds: ['INBOX', 'UNREAD'],
        snippet: 'Hello world',
        historyId: '998',
        internalDate: '1700000000000',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'sender@test.com' },
            { name: 'To', value: 'user@test.com' },
            { name: 'Subject', value: 'Test Subject' },
          ],
          body: { size: 100, data: Buffer.from('Hello body').toString('base64url') },
        },
        sizeEstimate: 500,
      }],
    }));

    const thread = await adapter.getThread('thread-1');
    expect(thread.threadId).toBe('thread-1');
    expect(thread.subject).toBe('Test Subject');
    expect(thread.isUnread).toBe(true);
    expect(thread.messages.length).toBe(1);
    expect(thread.messages[0]!.from).toBe('sender@test.com');
  });

  it('getMessage normalizes Gmail message response', async () => {
    stubExec(JSON.stringify({
      id: 'msg-1',
      threadId: 'thread-1',
      labelIds: ['INBOX'],
      snippet: 'Message snippet',
      historyId: '998',
      internalDate: '1700000000000',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'sender@test.com' },
          { name: 'To', value: 'a@test.com, b@test.com' },
          { name: 'Cc', value: '' },
          { name: 'Subject', value: 'Single Message' },
        ],
        body: { size: 50 },
      },
      sizeEstimate: 200,
    }));

    const msg = await adapter.getMessage('msg-1');
    expect(msg.messageId).toBe('msg-1');
    expect(msg.to).toEqual(['a@test.com', 'b@test.com']);
  });

  it('listHistory returns changed thread IDs', async () => {
    stubExec(JSON.stringify({
      history: [
        {
          id: '100',
          messagesAdded: [
            { message: { id: 'm1', threadId: 't1', labelIds: ['INBOX'] } },
            { message: { id: 'm2', threadId: 't2', labelIds: ['INBOX'] } },
          ],
        },
        {
          id: '101',
          messagesAdded: [
            { message: { id: 'm3', threadId: 't1', labelIds: ['INBOX'] } }, // duplicate thread
          ],
        },
      ],
      historyId: '102',
    }));

    const change = await adapter.listHistory('99');
    expect(change.changedThreadIds).toEqual(['t1', 't2']); // deduplicated
    expect(change.newHistoryId).toBe('102');
  });

  it('throws on CLI error', async () => {
    stubExec('', 1);
    await expect(adapter.getProfile()).rejects.toThrow('gws CLI error');
  });

  it('throws on invalid JSON output', async () => {
    stubExec('not json');
    await expect(adapter.getProfile()).rejects.toThrow('Failed to parse gws output');
  });

  it('detects auth errors', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      const err = new Error('unauthenticated: run gws auth login');
      (callback as Function)(err, '', '');
      return undefined as never;
    });
    await expect(adapter.getProfile()).rejects.toThrow('gws auth error');
  });
});
