import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../observability/src/index.ts';

import {
  TelegramBotApiError,
  TelegramLongPollRelay,
  type TelegramBotClient,
  type TelegramRunTrackingClient,
  type TelegramUpdate,
} from './index.ts';

function createCapture(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

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
    getResendableDeliveries: vi.fn<TelegramRunTrackingClient['getResendableDeliveries']>().mockResolvedValue([]),
    recordSendAttempt: vi.fn<TelegramRunTrackingClient['recordSendAttempt']>().mockResolvedValue({
      id: 'attempt-1',
      deliveryId: 'delivery-1',
      workspaceId: 'default',
      attemptNumber: 1,
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:00:01Z',
      runId: null,
      contentHash: 'abc',
      outcome: 'sent',
      sentTelegramMessageId: null,
      errorSummary: null,
      source: 'relay',
      createdAt: '2026-01-01T00:00:00Z',
    }),
    ...overrides,
  };
}

describe('TelegramLongPollRelay structured logging', () => {
  it('logs relay started and stopping', async () => {
    const { stream, lines } = createCapture();
    const logger = createLogger('telegram', { destination: stream });
    // Gate: getUpdates blocks until we release it, allowing clean stop
    const gates: Array<() => void> = [];
    const bot: TelegramBotClient = {
      getUpdates: vi.fn().mockImplementation(() => new Promise<TelegramUpdate[]>((resolve) => {
        gates.push(() => resolve([]));
      })),
      sendMessage: vi.fn().mockResolvedValue({ messageId: 1 }),
    };
    const relay = new TelegramLongPollRelay({
      bot,
      control: createControl(),
      workspaceId: 'default',
      logger,
    });

    relay.start();
    // Wait for first getUpdates to be called
    await new Promise((r) => setTimeout(r, 20));
    // Stop — this sets running=false and awaits loopPromise
    const stopPromise = relay.stop();
    // Release the pending getUpdates so the loop can check running flag
    for (const gate of gates) gate();
    await stopPromise;

    const output = lines();
    expect(output.some((l) => l.msg === 'relay started')).toBe(true);
    expect(output.some((l) => l.msg === 'relay stopping')).toBe(true);
  });

  it('logs poll loop error on getUpdates failure', async () => {
    const { stream, lines } = createCapture();
    const logger = createLogger('telegram', { destination: stream });
    let callCount = 0;
    const gates: Array<() => void> = [];
    const bot: TelegramBotClient = {
      getUpdates: vi.fn().mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) return Promise.reject(new Error('network timeout'));
        return new Promise<TelegramUpdate[]>((resolve) => {
          gates.push(() => resolve([]));
        });
      }),
      sendMessage: vi.fn().mockResolvedValue({ messageId: 1 }),
    };
    const relay = new TelegramLongPollRelay({
      bot,
      control: createControl(),
      workspaceId: 'default',
      retryDelayMs: 10,
      logger,
    });

    relay.start();
    // Wait for error + retry to enter second getUpdates
    await new Promise((r) => setTimeout(r, 100));
    const stopPromise = relay.stop();
    for (const gate of gates) gate();
    await stopPromise;

    const output = lines();
    const pollErrorLog = output.find((l) => l.msg === 'poll loop error, retrying');
    expect(pollErrorLog).toBeDefined();
    expect(pollErrorLog).toHaveProperty('error', 'network timeout');
  });

  it('logs send failures instead of swallowing them silently', async () => {
    const { stream, lines } = createCapture();
    const logger = createLogger('telegram', { destination: stream });
    const gates: Array<() => void> = [];
    const bot: TelegramBotClient = {
      getUpdates: vi.fn()
        .mockResolvedValueOnce([{
          update_id: 1,
          message: {
            message_id: 50,
            from: { id: 42 },
            chat: { id: 777, type: 'private' },
            text: 'hi',
          },
        }])
        .mockImplementation(() => new Promise<TelegramUpdate[]>((resolve) => {
          gates.push(() => resolve([]));
        })),
      sendMessage: vi.fn().mockRejectedValue(new TelegramBotApiError('sendMessage', 400, 'Bad Request')),
    };

    const relay = new TelegramLongPollRelay({
      bot,
      control: createControl(),
      workspaceId: 'default',
      retryDelayMs: 10,
      sendRetryAttempts: 1,
      jobPollIntervalMs: 10,
      jobTimeoutMs: 500,
      logger,
    });

    relay.start();
    // Wait for the first update to be processed (ingestion + job poll + send failure)
    await new Promise((r) => setTimeout(r, 300));
    const stopPromise = relay.stop();
    for (const gate of gates) gate();
    await stopPromise;

    const output = lines();
    const sendFailLog = output.find((l) => l.msg === 'send failed, marking uncertain');
    expect(sendFailLog).toBeDefined();
    expect(sendFailLog).toHaveProperty('chatId', '777');
    expect(sendFailLog).toHaveProperty('telegramMessageId', 50);
  });
});
