export * from './config.js';
export * from './auth.js';
export * from './prompt.js';
export * from './policy.js';
export * from './security-audit.js';
export * from './database.js';
export * from './backup.js';
export * from './keychain.js';
export * from './launchd.js';
export * from './runtime-service.js';
export * from './memory-lifecycle.js';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { redactText } from '@popeye/observability';

import { initAuthStore, readAuthStore, validateBearerToken } from './auth.js';
import { evaluateCriticalFileMutation } from './policy.js';

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
    telegramMessageId: input.telegramMessageId,
    redactedText: redacted,
  };
}
