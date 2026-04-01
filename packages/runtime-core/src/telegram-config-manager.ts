import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { AppConfigSchema, type AppConfig, type TelegramConfigRecord, type TelegramConfigUpdateInput } from '@popeye/contracts';
import type { ZodError } from 'zod';

import { RuntimeConflictError, RuntimeValidationError } from './errors.js';
import { loadAppConfig } from './config.js';

const TELEGRAM_CONFIG_FIELDS = ['enabled', 'allowedUserId', 'secretRefId'] as const;

export type TelegramConfigField = (typeof TELEGRAM_CONFIG_FIELDS)[number];

export interface PersistedTelegramConfigUpdateResult {
  config: AppConfig;
  telegram: TelegramConfigRecord;
  changedFields: TelegramConfigField[];
}

function normalizeOptionalString(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function formatZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid Telegram config';
  const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
  return `${path}: ${issue.message}`;
}

function withConfigLock<T>(configPath: string, fn: () => T): T {
  const lockPath = `${configPath}.lock`;
  let lockFd!: number;
  try {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    lockFd = openSync(lockPath, 'wx', 0o600);
  } catch {
    throw new RuntimeConflictError(`Config file is already being updated: ${configPath}`);
  }

  try {
    return fn();
  } finally {
    closeSync(lockFd);
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  }
}

export function toTelegramConfigRecord(config: Pick<AppConfig, 'telegram'> | AppConfig): TelegramConfigRecord {
  const telegram = 'telegram' in config ? config.telegram : config;
  return {
    enabled: telegram.enabled,
    allowedUserId: telegram.allowedUserId ?? null,
    secretRefId: telegram.secretRefId ?? null,
  };
}

export function loadTelegramConfigFromFile(configPath: string): { config: AppConfig; telegram: TelegramConfigRecord } {
  const config = loadAppConfig(configPath);
  return { config, telegram: toTelegramConfigRecord(config) };
}

export function updateTelegramConfigFile(
  configPath: string,
  input: TelegramConfigUpdateInput,
): PersistedTelegramConfigUpdateResult {
  return withConfigLock(configPath, () => {
    const current = loadAppConfig(configPath);
    const previous = toTelegramConfigRecord(current);
    const nextCandidate = {
      ...current,
      telegram: {
        ...current.telegram,
        enabled: input.enabled,
        allowedUserId: normalizeOptionalString(input.allowedUserId),
        secretRefId: normalizeOptionalString(input.secretRefId),
      },
    } satisfies AppConfig;
    const validated = AppConfigSchema.safeParse(nextCandidate);
    if (!validated.success) {
      throw new RuntimeValidationError(formatZodError(validated.error));
    }

    const changedFields = TELEGRAM_CONFIG_FIELDS.filter((field) => previous[field] !== toTelegramConfigRecord(validated.data)[field]);
    const serialized = `${JSON.stringify(validated.data, null, 2)}\n`;
    const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'w' });
      renameSync(tempPath, configPath);
      chmodSync(configPath, 0o600);
    } finally {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    }

    return {
      config: validated.data,
      telegram: toTelegramConfigRecord(validated.data),
      changedFields,
    };
  });
}

export function readRawConfigFile(configPath: string): string {
  return readFileSync(configPath, 'utf8');
}
