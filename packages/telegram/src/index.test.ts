import { describe, expect, it, vi } from 'vitest';

import {
  TelegramBotApiError,
  TelegramBotTransportError,
  TelegramLongPollRelay,
  buildTelegramRunReply,
  createTelegramBotClient,
  extractTelegramReplyFromRunEvents,
  formatTelegramReply,
  ingestTelegramUpdate,
  normalizeTelegramUpdate,
  type TelegramBotClient,
  type TelegramIngressClient,
  type TelegramRunTrackingClient,
} from './index.ts';

function createControl(overrides: Partial<TelegramRunTrackingClient> = {}): TelegramRunTrackingClient {
  return {
    ingestMessage: vi.fn<TelegramRunTrackingClient['ingestMessage']>().mockResolvedValue({
      accepted: true,
      duplicate: false,
      httpStatus: 200,
      decisionCode: 'accepted',
      decisionReason: 'accepted',
      message: null,
      taskId: 'task-1',
      jobId: 'job-1',
      runId: null,
      telegramDelivery: { chatId: '777', telegramMessageId: 50, status: 'pending' },
    }),
    getJob: vi.fn<TelegramRunTrackingClient['getJob']>().mockResolvedValue({
      id: 'job-1',
      taskId: 'task-1',
      workspaceId: 'default',
      status: 'succeeded',
      retryCount: 0,
      availableAt: '2026-01-01T00:00:00Z',
      lastRunId: 'run-1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:01Z',
    }),
    getRunReply: vi.fn<TelegramRunTrackingClient['getRunReply']>().mockResolvedValue({
      runId: 'run-1',
      terminalStatus: 'succeeded',
      source: 'completed_output',
      text: 'All green.',
    }),
    getTelegramRelayCheckpoint: vi.fn<TelegramRunTrackingClient['getTelegramRelayCheckpoint']>().mockResolvedValue(null),
    commitTelegramRelayCheckpoint: vi.fn<TelegramRunTrackingClient['commitTelegramRelayCheckpoint']>().mockImplementation(async (input) => ({
      relayKey: input.relayKey ?? 'telegram_long_poll',
      workspaceId: input.workspaceId,
      lastAcknowledgedUpdateId: input.lastAcknowledgedUpdateId,
      updatedAt: '2026-03-14T00:00:00Z',
    })),
    markTelegramReplySending: vi.fn<TelegramRunTrackingClient['markTelegramReplySending']>().mockResolvedValue({
      chatId: '777',
      telegramMessageId: 50,
      status: 'sending',
    }),
    markTelegramReplyPending: vi.fn<TelegramRunTrackingClient['markTelegramReplyPending']>().mockResolvedValue({
      chatId: '777',
      telegramMessageId: 50,
      status: 'pending',
    }),
    markTelegramReplyUncertain: vi.fn<TelegramRunTrackingClient['markTelegramReplyUncertain']>().mockResolvedValue({
      chatId: '777',
      telegramMessageId: 50,
      status: 'uncertain',
    }),
    markTelegramReplySent: vi.fn<TelegramRunTrackingClient['markTelegramReplySent']>().mockResolvedValue({
      chatId: '777',
      telegramMessageId: 50,
      status: 'sent',
    }),
    ...overrides,
  };
}

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
      telegramDelivery: { chatId: '777', telegramMessageId: 25, status: 'pending' },
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

  it('creates a Telegram Bot API client for getUpdates and sendMessage', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: [{ update_id: 1 }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 901 } }),
      });

    const client = createTelegramBotClient({ token: 'bot-token', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getUpdates({ offset: 10, timeoutSeconds: 5 })).resolves.toEqual([{ update_id: 1 }]);
    await expect(client.sendMessage({ chatId: '777', text: 'hello', replyToMessageId: 25 })).resolves.toEqual({ messageId: 901 });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://api.telegram.org/botbot-token/getUpdates',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('extracts final assistant text from run events and formats receipt fallback text', () => {
    expect(extractTelegramReplyFromRunEvents([
      { id: 'e0', runId: 'run-1', type: 'message', payload: JSON.stringify({ role: 'assistant', text: 'older text' }), createdAt: '2026-01-01T00:00:00Z' },
      { id: 'e1', runId: 'run-1', type: 'completed', payload: JSON.stringify({ output: 'done here' }), createdAt: '2026-01-01T00:00:01Z' },
    ])).toBe('done here');

    expect(buildTelegramRunReply({
      id: 'receipt-1',
      runId: 'run-1',
      jobId: 'job-1',
      taskId: 'task-1',
      workspaceId: 'default',
      status: 'failed',
      summary: 'Run failed',
      details: 'bad credentials',
      usage: { provider: 'pi', model: 'claude', tokensIn: 1, tokensOut: 0, estimatedCostUsd: 0.02 },
      createdAt: '2026-01-01T00:00:00Z',
    })).toContain('Run failed');
  });

  it('loads the durable checkpoint, claims delivery, and acknowledges after reply delivery', async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn<TelegramBotClient['getUpdates']>()
        .mockResolvedValueOnce([
          {
            update_id: 100,
            message: {
              message_id: 50,
              from: { id: 42 },
              chat: { id: 777, type: 'private' },
              text: 'status?',
            },
          },
        ])
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [];
        }),
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>().mockResolvedValue({ messageId: 901 }),
    };
    const control = createControl({
      getTelegramRelayCheckpoint: vi.fn<TelegramRunTrackingClient['getTelegramRelayCheckpoint']>().mockResolvedValue({
        relayKey: 'telegram_long_poll',
        workspaceId: 'default',
        lastAcknowledgedUpdateId: 99,
        updatedAt: '2026-03-14T00:00:00Z',
      }),
    });

    const relay = new TelegramLongPollRelay({
      bot,
      control,
      workspaceId: 'default',
      longPollTimeoutSeconds: 0,
      retryDelayMs: 1,
      jobPollIntervalMs: 1,
      jobTimeoutMs: 100,
    });

    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await relay.stop();

    expect(bot.getUpdates).toHaveBeenCalledWith({ offset: 100, timeoutSeconds: 0 });
    expect(control.markTelegramReplySending).toHaveBeenCalledWith('777', 50, {
      workspaceId: 'default',
      runId: 'run-1',
    });
    expect(control.markTelegramReplySent).toHaveBeenCalledWith('777', 50, {
      workspaceId: 'default',
      runId: 'run-1',
      sentTelegramMessageId: 901,
    });
    expect(control.commitTelegramRelayCheckpoint).toHaveBeenLastCalledWith({
      relayKey: 'telegram_long_poll',
      workspaceId: 'default',
      lastAcknowledgedUpdateId: 100,
    });
    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId: '777',
      text: 'All green.',
      replyToMessageId: 50,
    });
  });

  it('prepares multiple updates concurrently but preserves reply send and ack order', async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn<TelegramBotClient['getUpdates']>()
        .mockResolvedValueOnce([
          {
            update_id: 200,
            message: {
              message_id: 60,
              from: { id: 42 },
              chat: { id: 777, type: 'private' },
              text: 'first',
            },
          },
          {
            update_id: 201,
            message: {
              message_id: 61,
              from: { id: 42 },
              chat: { id: 777, type: 'private' },
              text: 'second',
            },
          },
        ])
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [];
        }),
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>()
        .mockResolvedValueOnce({ messageId: 910 })
        .mockResolvedValueOnce({ messageId: 911 }),
    };
    const jobTimings = new Map([
      ['job-1', 15],
      ['job-2', 0],
    ]);
    const control = createControl({
      ingestMessage: vi.fn<TelegramRunTrackingClient['ingestMessage']>()
        .mockResolvedValueOnce({
          accepted: true,
          duplicate: false,
          httpStatus: 200,
          decisionCode: 'accepted',
          decisionReason: 'accepted',
          message: null,
          taskId: 'task-1',
          jobId: 'job-1',
          runId: null,
          telegramDelivery: { chatId: '777', telegramMessageId: 60, status: 'pending' },
        })
        .mockResolvedValueOnce({
          accepted: true,
          duplicate: false,
          httpStatus: 200,
          decisionCode: 'accepted',
          decisionReason: 'accepted',
          message: null,
          taskId: 'task-2',
          jobId: 'job-2',
          runId: null,
          telegramDelivery: { chatId: '777', telegramMessageId: 61, status: 'pending' },
        }),
      getJob: vi.fn<TelegramRunTrackingClient['getJob']>().mockImplementation(async (jobId) => {
        const delayMs = jobTimings.get(jobId) ?? 0;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return {
          id: jobId,
          taskId: jobId === 'job-1' ? 'task-1' : 'task-2',
          workspaceId: 'default',
          status: 'succeeded',
          retryCount: 0,
          availableAt: '2026-01-01T00:00:00Z',
          lastRunId: jobId === 'job-1' ? 'run-1' : 'run-2',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:01Z',
        };
      }),
      getRunReply: vi.fn<TelegramRunTrackingClient['getRunReply']>().mockImplementation(async (runId) => ({
        runId,
        terminalStatus: 'succeeded',
        source: 'completed_output',
        text: runId === 'run-1' ? 'first reply' : 'second reply',
      })),
    });

    const relay = new TelegramLongPollRelay({
      bot,
      control,
      workspaceId: 'default',
      longPollTimeoutSeconds: 0,
      retryDelayMs: 1,
      jobPollIntervalMs: 1,
      jobTimeoutMs: 100,
      maxConcurrentPreparations: 2,
    });

    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await relay.stop();

    expect(bot.sendMessage).toHaveBeenNthCalledWith(1, {
      chatId: '777',
      text: 'first reply',
      replyToMessageId: 60,
    });
    expect(bot.sendMessage).toHaveBeenNthCalledWith(2, {
      chatId: '777',
      text: 'second reply',
      replyToMessageId: 61,
    });
    expect(control.commitTelegramRelayCheckpoint).toHaveBeenNthCalledWith(1, {
      relayKey: 'telegram_long_poll',
      workspaceId: 'default',
      lastAcknowledgedUpdateId: 200,
    });
    expect(control.commitTelegramRelayCheckpoint).toHaveBeenNthCalledWith(2, {
      relayKey: 'telegram_long_poll',
      workspaceId: 'default',
      lastAcknowledgedUpdateId: 201,
    });
  });

  it('does not send a second reply for duplicate deliveries already marked sent', async () => {
    const update = {
      update_id: 101,
      message: {
        message_id: 51,
        from: { id: 42 },
        chat: { id: 777, type: 'private' as const },
        text: 'status?',
      },
    };
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn<TelegramBotClient['getUpdates']>()
        .mockResolvedValueOnce([update])
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [];
        }),
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>().mockResolvedValue({ messageId: 902 }),
    };
    const control = createControl({
      ingestMessage: vi.fn<TelegramRunTrackingClient['ingestMessage']>().mockResolvedValue({
        accepted: true,
        duplicate: true,
        httpStatus: 200,
        decisionCode: 'duplicate_replayed',
        decisionReason: 'duplicate delivery replayed: accepted',
        message: null,
        taskId: 'task-1',
        jobId: 'job-1',
        runId: 'run-1',
        telegramDelivery: { chatId: '777', telegramMessageId: 51, status: 'sent' },
      }),
    });

    const relay = new TelegramLongPollRelay({
      bot,
      control,
      workspaceId: 'default',
      longPollTimeoutSeconds: 0,
      retryDelayMs: 1,
    });

    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await relay.stop();

    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(control.getJob).not.toHaveBeenCalled();
    expect(control.commitTelegramRelayCheckpoint).toHaveBeenCalledWith({
      relayKey: 'telegram_long_poll',
      workspaceId: 'default',
      lastAcknowledgedUpdateId: 101,
    });
  });

  it('marks replayed claimed deliveries uncertain instead of sending a duplicate reply', async () => {
    const update = {
      update_id: 111,
      message: {
        message_id: 55,
        from: { id: 42 },
        chat: { id: 777, type: 'private' as const },
        text: 'status?',
      },
    };
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn<TelegramBotClient['getUpdates']>()
        .mockResolvedValueOnce([update])
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [];
        }),
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>().mockResolvedValue({ messageId: 905 }),
    };
    const control = createControl({
      ingestMessage: vi.fn<TelegramRunTrackingClient['ingestMessage']>().mockResolvedValue({
        accepted: true,
        duplicate: true,
        httpStatus: 200,
        decisionCode: 'duplicate_replayed',
        decisionReason: 'duplicate delivery replayed: accepted',
        message: null,
        taskId: 'task-1',
        jobId: 'job-1',
        runId: 'run-1',
        telegramDelivery: { chatId: '777', telegramMessageId: 55, status: 'sending' },
      }),
    });

    const relay = new TelegramLongPollRelay({
      bot,
      control,
      workspaceId: 'default',
      longPollTimeoutSeconds: 0,
      retryDelayMs: 1,
    });

    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await relay.stop();

    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(control.markTelegramReplyUncertain).toHaveBeenCalledWith('777', 55, {
      workspaceId: 'default',
      runId: 'run-1',
      reason: 'Telegram delivery replay observed after a durable send claim; original send may have succeeded before relay recovery.',
    });
    expect(control.commitTelegramRelayCheckpoint).toHaveBeenCalledWith({
      relayKey: 'telegram_long_poll',
      workspaceId: 'default',
      lastAcknowledgedUpdateId: 111,
    });
  });

  it('does not reply when ingress is denied and still acknowledges the update', async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn<TelegramBotClient['getUpdates']>()
        .mockResolvedValueOnce([
          {
            update_id: 102,
            message: {
              message_id: 52,
              from: { id: 24 },
              chat: { id: 777, type: 'private' },
              text: 'status?',
            },
          },
        ])
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [];
        }),
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>().mockResolvedValue({ messageId: 903 }),
    };
    const control = createControl({
      ingestMessage: vi.fn<TelegramRunTrackingClient['ingestMessage']>().mockResolvedValue({
        accepted: false,
        duplicate: false,
        httpStatus: 403,
        decisionCode: 'telegram_not_allowlisted',
        decisionReason: 'Telegram sender is not allowlisted',
        message: null,
        taskId: null,
        jobId: null,
        runId: null,
        telegramDelivery: null,
      }),
    });

    const relay = new TelegramLongPollRelay({
      bot,
      control,
      workspaceId: 'default',
      longPollTimeoutSeconds: 0,
      retryDelayMs: 1,
    });

    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await relay.stop();

    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(control.getJob).not.toHaveBeenCalled();
    expect(control.commitTelegramRelayCheckpoint).toHaveBeenCalledWith({
      relayKey: 'telegram_long_poll',
      workspaceId: 'default',
      lastAcknowledgedUpdateId: 102,
    });
  });

  it('retries retryable Telegram API failures, resets delivery to pending, and leaves the update unacked', async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn<TelegramBotClient['getUpdates']>()
        .mockResolvedValueOnce([
          {
            update_id: 103,
            message: {
              message_id: 53,
              from: { id: 42 },
              chat: { id: 777, type: 'private' },
              text: 'status?',
            },
          },
        ])
        .mockRejectedValueOnce(new Error('stop loop after failure')),
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>()
        .mockRejectedValueOnce(new TelegramBotApiError('sendMessage', 503, 'temporary bot api error'))
        .mockRejectedValueOnce(new TelegramBotApiError('sendMessage', 503, 'still failing')),
    };
    const control = createControl({
      ingestMessage: vi.fn<TelegramRunTrackingClient['ingestMessage']>().mockResolvedValue({
        accepted: true,
        duplicate: false,
        httpStatus: 200,
        decisionCode: 'accepted',
        decisionReason: 'accepted',
        message: null,
        taskId: 'task-1',
        jobId: 'job-1',
        runId: null,
        telegramDelivery: { chatId: '777', telegramMessageId: 53, status: 'pending' },
      }),
    });

    const relay = new TelegramLongPollRelay({
      bot,
      control,
      workspaceId: 'default',
      longPollTimeoutSeconds: 0,
      retryDelayMs: 1,
      sendRetryAttempts: 2,
      sendRetryDelayMs: 1,
      jobPollIntervalMs: 1,
      jobTimeoutMs: 100,
    });

    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await relay.stop();

    expect(control.markTelegramReplySending).toHaveBeenCalledWith('777', 53, {
      workspaceId: 'default',
      runId: 'run-1',
    });
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
    expect(control.markTelegramReplyPending).toHaveBeenCalledWith('777', 53, {
      workspaceId: 'default',
      runId: 'run-1',
    });
    expect(control.markTelegramReplyUncertain).not.toHaveBeenCalled();
    expect(control.markTelegramReplySent).not.toHaveBeenCalled();
    expect(control.commitTelegramRelayCheckpoint).not.toHaveBeenCalled();
  });

  it('marks ambiguous Telegram transport failures uncertain and acknowledges the update once', async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn<TelegramBotClient['getUpdates']>()
        .mockResolvedValueOnce([
          {
            update_id: 112,
            message: {
              message_id: 56,
              from: { id: 42 },
              chat: { id: 777, type: 'private' },
              text: 'status?',
            },
          },
        ])
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [];
        }),
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>()
        .mockRejectedValueOnce(new TelegramBotTransportError('sendMessage', new Error('socket hang up'))),
    };
    const control = createControl({
      ingestMessage: vi.fn<TelegramRunTrackingClient['ingestMessage']>().mockResolvedValue({
        accepted: true,
        duplicate: false,
        httpStatus: 200,
        decisionCode: 'accepted',
        decisionReason: 'accepted',
        message: null,
        taskId: 'task-1',
        jobId: 'job-1',
        runId: null,
        telegramDelivery: { chatId: '777', telegramMessageId: 56, status: 'pending' },
      }),
    });

    const relay = new TelegramLongPollRelay({
      bot,
      control,
      workspaceId: 'default',
      longPollTimeoutSeconds: 0,
      retryDelayMs: 1,
      sendRetryAttempts: 3,
      sendRetryDelayMs: 1,
      jobPollIntervalMs: 1,
      jobTimeoutMs: 100,
    });

    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await relay.stop();

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(control.markTelegramReplyPending).not.toHaveBeenCalled();
    expect(control.markTelegramReplyUncertain).toHaveBeenCalledWith('777', 56, {
      workspaceId: 'default',
      runId: 'run-1',
      reason: 'Telegram Bot API sendMessage transport failed: socket hang up',
    });
    expect(control.commitTelegramRelayCheckpoint).toHaveBeenCalledWith({
      relayKey: 'telegram_long_poll',
      workspaceId: 'default',
      lastAcknowledgedUpdateId: 112,
    });
  });
});
