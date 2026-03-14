import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { AppConfig } from '@popeye/contracts';
import { initAuthStore } from '@popeye/runtime-core';
import type { TelegramBotClient, TelegramRunTrackingClient } from '@popeye/telegram';

import { resolveTelegramWorkspaceId, startTelegramBridge } from './telegram-bridge.js';

function makeConfig(dir: string): AppConfig {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
    telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: true, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  };
}

describe('telegram-bridge', () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalWorkspace = process.env.POPEYE_TELEGRAM_WORKSPACE_ID;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    delete process.env.POPEYE_TELEGRAM_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalWorkspace === undefined) delete process.env.POPEYE_TELEGRAM_WORKSPACE_ID;
    else process.env.POPEYE_TELEGRAM_WORKSPACE_ID = originalWorkspace;
  });

  it('resolves telegram workspace from env override when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-telegram-workspace-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    process.env.POPEYE_TELEGRAM_WORKSPACE_ID = 'ops';
    expect(resolveTelegramWorkspaceId(config)).toBe('ops');
  });

  it('starts the Telegram bridge with injected bot/control clients', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-telegram-bridge-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const bot: TelegramBotClient = {
      getUpdates: vi.fn<TelegramBotClient['getUpdates']>()
        .mockResolvedValueOnce([{ update_id: 1, message: { message_id: 2, from: { id: 42 }, chat: { id: 777, type: 'private' }, text: 'hello' } }])
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
        updatedAt: '2026-01-01T00:00:00Z',
      }),
      listRunEvents: vi.fn<TelegramRunTrackingClient['listRunEvents']>().mockResolvedValue([
        { id: 'evt-1', runId: 'run-1', type: 'message', payload: JSON.stringify({ role: 'assistant', text: 'done' }), createdAt: '2026-01-01T00:00:00Z' },
      ]),
      getRunReceipt: vi.fn<TelegramRunTrackingClient['getRunReceipt']>().mockResolvedValue(null),
    };

    const bridge = await startTelegramBridge(config, {
      createBotClient: () => bot,
      createControlClient: () => control,
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    await bridge?.stop();

    expect(control.ingestMessage).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'default', text: 'hello' }));
    expect(bot.sendMessage).toHaveBeenCalledWith({ chatId: '777', text: 'done', replyToMessageId: 2 });
  });
});
