import { describe, expect, it, vi } from 'vitest';

import {
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
} from './index.js';

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

  it('creates a Telegram Bot API client for getUpdates and sendMessage', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: [{ update_id: 1 }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: true }),
      });

    const client = createTelegramBotClient({ token: 'bot-token', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getUpdates({ offset: 10, timeoutSeconds: 5 })).resolves.toEqual([{ update_id: 1 }]);
    await expect(client.sendMessage({ chatId: '777', text: 'hello', replyToMessageId: 25 })).resolves.toBeUndefined();

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

  it('extracts final assistant text from run events and falls back to receipt rendering', () => {
    expect(extractTelegramReplyFromRunEvents([
      { id: 'e0', runId: 'run-1', type: 'message', payload: JSON.stringify({ role: 'assistant', text: 'older text' }), createdAt: '2026-01-01T00:00:00Z' },
      { id: 'e1', runId: 'run-1', type: 'completed', payload: JSON.stringify({ output: 'done here' }), createdAt: '2026-01-01T00:00:01Z' },
    ])).toBe('done here');

    expect(extractTelegramReplyFromRunEvents([
      { id: 'e1', runId: 'run-1', type: 'message', payload: JSON.stringify({ role: 'assistant', text: 'done here' }), createdAt: '2026-01-01T00:00:00Z' },
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

  it('polls Telegram, ingests accepted messages, waits for job terminal state, and sends the final assistant reply', async () => {
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
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>().mockResolvedValue(undefined),
    };
    const control: TelegramRunTrackingClient = {
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
      }),
      getJob: vi
        .fn<TelegramRunTrackingClient['getJob']>()
        .mockResolvedValueOnce({
          id: 'job-1',
          taskId: 'task-1',
          workspaceId: 'default',
          status: 'running',
          retryCount: 0,
          availableAt: '2026-01-01T00:00:00Z',
          lastRunId: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        })
        .mockResolvedValueOnce({
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
      listRunEvents: vi.fn<TelegramRunTrackingClient['listRunEvents']>().mockResolvedValue([
        { id: 'e1', runId: 'run-1', type: 'message', payload: JSON.stringify({ role: 'assistant', text: 'Older assistant text.' }), createdAt: '2026-01-01T00:00:01Z' },
        { id: 'e2', runId: 'run-1', type: 'completed', payload: JSON.stringify({ output: 'All green.' }), createdAt: '2026-01-01T00:00:02Z' },
      ]),
      getRunReceipt: vi.fn<TelegramRunTrackingClient['getRunReceipt']>().mockResolvedValue({
        id: 'receipt-1',
        runId: 'run-1',
        jobId: 'job-1',
        taskId: 'task-1',
        workspaceId: 'default',
        status: 'succeeded',
        summary: 'Run completed successfully',
        details: '',
        usage: { provider: 'pi', model: 'claude', tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0.01 },
        createdAt: '2026-01-01T00:00:01Z',
      }),
    };

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
    await new Promise((resolve) => setTimeout(resolve, 25));
    await relay.stop();

    expect(control.ingestMessage).toHaveBeenCalledTimes(1);
    expect(control.getJob).toHaveBeenCalledWith('job-1');
    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId: '777',
      text: 'All green.',
      replyToMessageId: 50,
    });
  });

  it('does not send a second reply for duplicate replayed deliveries, including restart replays', async () => {
    const update = {
      update_id: 100,
      message: {
        message_id: 50,
        from: { id: 42 },
        chat: { id: 777, type: 'private' as const },
        text: 'status?',
      },
    };
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn<TelegramBotClient['getUpdates']>()
        .mockResolvedValueOnce([update])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([update])
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [];
        }),
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>().mockResolvedValue(undefined),
    };
    const control: TelegramRunTrackingClient = {
      ingestMessage: vi
        .fn<TelegramRunTrackingClient['ingestMessage']>()
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
        })
        .mockResolvedValueOnce({
          accepted: true,
          duplicate: true,
          httpStatus: 200,
          decisionCode: 'duplicate_replayed',
          decisionReason: 'duplicate delivery replayed: accepted',
          message: null,
          taskId: 'task-1',
          jobId: 'job-1',
          runId: 'run-1',
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
      listRunEvents: vi.fn<TelegramRunTrackingClient['listRunEvents']>().mockResolvedValue([
        { id: 'e1', runId: 'run-1', type: 'completed', payload: JSON.stringify({ output: 'All green.' }), createdAt: '2026-01-01T00:00:01Z' },
      ]),
      getRunReceipt: vi.fn<TelegramRunTrackingClient['getRunReceipt']>().mockResolvedValue(null),
    };

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
    await new Promise((resolve) => setTimeout(resolve, 35));
    await relay.stop();

    expect(control.ingestMessage).toHaveBeenCalledTimes(2);
    expect(control.getJob).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not reply when ingress is denied', async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn<TelegramBotClient['getUpdates']>()
        .mockResolvedValueOnce([
          {
            update_id: 100,
            message: {
              message_id: 50,
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
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>().mockResolvedValue(undefined),
    };
    const control: TelegramRunTrackingClient = {
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
      }),
      getJob: vi.fn<TelegramRunTrackingClient['getJob']>(),
      listRunEvents: vi.fn<TelegramRunTrackingClient['listRunEvents']>(),
      getRunReceipt: vi.fn<TelegramRunTrackingClient['getRunReceipt']>(),
    };

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
  });

  it('retries Telegram send failures without crashing the relay loop', async () => {
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
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>()
        .mockRejectedValueOnce(new Error('temporary bot api error'))
        .mockResolvedValueOnce(undefined),
    };
    const control: TelegramRunTrackingClient = {
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
      listRunEvents: vi.fn<TelegramRunTrackingClient['listRunEvents']>().mockResolvedValue([
        { id: 'e1', runId: 'run-1', type: 'completed', payload: JSON.stringify({ output: 'All green.' }), createdAt: '2026-01-01T00:00:01Z' },
      ]),
      getRunReceipt: vi.fn<TelegramRunTrackingClient['getRunReceipt']>().mockResolvedValue(null),
    };

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

    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
    expect(control.ingestMessage).toHaveBeenCalledTimes(1);
  });

  it('retries getUpdates failures on the polling loop and still processes the later delivery', async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn<TelegramBotClient['getUpdates']>()
        .mockRejectedValueOnce(new Error('temporary poll error'))
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
      sendMessage: vi.fn<TelegramBotClient['sendMessage']>().mockResolvedValue(undefined),
    };
    const control: TelegramRunTrackingClient = {
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
      listRunEvents: vi.fn<TelegramRunTrackingClient['listRunEvents']>().mockResolvedValue([
        { id: 'e1', runId: 'run-1', type: 'completed', payload: JSON.stringify({ output: 'Recovered after poll retry.' }), createdAt: '2026-01-01T00:00:01Z' },
      ]),
      getRunReceipt: vi.fn<TelegramRunTrackingClient['getRunReceipt']>().mockResolvedValue(null),
    };

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
    await new Promise((resolve) => setTimeout(resolve, 35));
    await relay.stop();

    expect(bot.getUpdates.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(control.ingestMessage).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId: '777',
      text: 'Recovered after poll retry.',
      replyToMessageId: 50,
    });
  });
});
