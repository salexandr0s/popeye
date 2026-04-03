export * from './config.js';
export * from './auth.js';
export * from './prompt.js';
export * from './security-audit.js';
export * from './database.js';
export * from './backup.js';
export * from './browser-sessions.js';
export * from './native-app-sessions.js';
export * from './keychain.js';
export * from './launchd.js';
export * from './telegram-config-manager.js';
export * from './mutation-receipt-manager.js';
export * from './instruction-query.js';
export * from './runtime-service.js';
export * from './memory-lifecycle.js';
export * from './secret-store.js';
export * from './approval-service.js';
export * from './vault-manager.js';
export * from './context-release-service.js';
export * from './capability-facade.js';
export * from './capability-registry.js';
export * from './run-event-search.js';
export * from './migration-manager.js';
export * from './vault-backup.js';
export * from './trajectory-export.js';
export * from './delegation-tool.js';

// Backward-compat re-exports from domain packages
export { evaluateCriticalFileMutation } from '@popeye/workspace';
export { TaskManager } from '@popeye/scheduler';
export type { TaskManagerCallbacks, SchedulerDeps } from '@popeye/scheduler';
export { ReceiptManager, renderReceipt } from '@popeye/receipts';
export type { ReceiptCallbacks, ReceiptDeps } from '@popeye/receipts';
export { SessionService } from '@popeye/sessions';
export type { SessionDeps } from '@popeye/sessions';
export { PiEngineAdapter, runPiCompatibilityCheck, cleanStalePiTempDirs } from '@popeye/engine-pi';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { redactText } from '@popeye/observability';
import { evaluateCriticalFileMutation } from '@popeye/workspace';

import { initAuthStore, readAuthStore, validateBearerToken } from './auth.js';

export const initializeAuthStore = (path: string) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return initAuthStore(path);
};
export const loadAuthStore = readAuthStore;
export const isValidBearerToken = validateBearerToken;
export const decideCriticalFileMutation = (path: string, approved: boolean) =>
  evaluateCriticalFileMutation({ path, approved });

export function processIngressMessage(input: {
  source: string;
  senderId: string;
  text: string;
  telegramMessageId?: number;
}): { redactedText: string; source: string; senderId: string; telegramMessageId?: number } {
  const redacted = redactText(input.text)
    .text.replaceAll('[REDACTED:openai-key]', '[REDACTED:api-key]')
    .replaceAll('[REDACTED:generic-key]', '[REDACTED:api-key]');
  return {
    source: input.source,
    senderId: input.senderId,
    ...(input.telegramMessageId !== undefined && { telegramMessageId: input.telegramMessageId }),
    redactedText: redacted,
  };
}
