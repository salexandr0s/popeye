import { describe, expect, it, vi } from 'vitest';

import { formatTelegramReply, ingestTelegramUpdate, normalizeTelegramUpdate, type TelegramIngressClient } from './index.js';

describe('@popeye/telegram', () => {
  it('normalizes private chat updates', () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 10,
      message: {
        message_id: 22,
        from: { id: 42 },
        chat: { id: 777, type: 'private' },
        text: 'hello',
      },
    });

    expect(normalized).toEqual({
      senderId: '42',
      chatId: '777',
      chatType: 'private',
      telegramMessageId: 22,
      text: 'hello',
    });
  });

  it('uses caption when text is missing', () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 11,
      message: {
        message_id: 23,
        from: { id: '42' },
        chat: { id: '777', type: 'private' },
        caption: 'photo caption',
      },
    });

    expect(normalized?.text).toBe('photo caption');
  });

  it('returns null for unsupported updates', () => {
    expect(normalizeTelegramUpdate({ update_id: 12 })).toBeNull();
    expect(
      normalizeTelegramUpdate({
        update_id: 13,
        message: {
          message_id: 24,
          chat: { id: 777, type: 'private' },
          text: 'missing sender',
        },
      }),
    ).toBeNull();
  });

  it('formats replies by trimming normalized line endings', () => {
    expect(formatTelegramReply('  hi\r\nthere  \n')).toBe('hi\nthere');
  });

  it('bridges normalized updates through the control API client', async () => {
    const ingestMessage = vi.fn<TelegramIngressClient['ingestMessage']>().mockResolvedValue({
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
    const client: TelegramIngressClient = { ingestMessage };

    const result = await ingestTelegramUpdate(
      client,
      {
        update_id: 14,
        message: {
          message_id: 25,
          from: { id: 42 },
          chat: { id: 777, type: 'private' },
          text: 'hello',
        },
      },
      'default',
    );

    expect(result?.decisionCode).toBe('accepted');
    expect(ingestMessage).toHaveBeenCalledWith({
      source: 'telegram',
      senderId: '42',
      text: 'hello',
      chatId: '777',
      chatType: 'private',
      telegramMessageId: 25,
      workspaceId: 'default',
    });
  });
});
