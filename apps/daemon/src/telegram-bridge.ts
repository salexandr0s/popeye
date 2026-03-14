import type { AppConfig } from '@popeye/contracts';
import { PopeyeApiClient } from '@popeye/api-client';
import { createLogger } from '@popeye/observability';
import { loadAuthStore } from '@popeye/runtime-core';
import {
  TelegramLongPollRelay,
  createTelegramBotClient,
  type TelegramBotClient,
  type TelegramRunTrackingClient,
} from '@popeye/telegram';

export interface StartedTelegramBridge {
  stop(): Promise<void>;
}

export interface TelegramBridgeDeps {
  createBotClient?: (token: string) => TelegramBotClient;
  createControlClient?: (baseUrl: string, token: string) => TelegramRunTrackingClient;
}

export function resolveTelegramWorkspaceId(config: AppConfig): string {
  return process.env.POPEYE_TELEGRAM_WORKSPACE_ID ?? config.workspaces[0]?.id ?? 'default';
}

export async function startTelegramBridge(
  config: AppConfig,
  deps: TelegramBridgeDeps = {},
): Promise<StartedTelegramBridge | null> {
  if (!config.telegram.enabled) return null;

  const log = createLogger('telegram-bridge');
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    log.warn('Telegram enabled but TELEGRAM_BOT_TOKEN is not set; skipping bridge startup');
    return null;
  }

  const authStore = loadAuthStore(config.authFile);
  const baseUrl = `http://${config.security.bindHost}:${config.security.bindPort}`;
  const bot = deps.createBotClient?.(botToken) ?? createTelegramBotClient({ token: botToken });
  const control = deps.createControlClient?.(baseUrl, authStore.current.token)
    ?? new PopeyeApiClient({ baseUrl, token: authStore.current.token });
  const relay = new TelegramLongPollRelay({
    bot,
    control,
    workspaceId: resolveTelegramWorkspaceId(config),
    maxConcurrentPreparations: config.telegram.maxConcurrentPreparations,
  });
  relay.start();

  return {
    stop: () => relay.stop(),
  };
}
