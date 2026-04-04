import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import {
  AppConfigSchema,
  type AppConfig,
  type ProviderAuthConfigRecord,
  type ProviderAuthConfigListResponse,
  type ProviderAuthProvider,
} from '@popeye/contracts';
import type { ZodError } from 'zod';

import { RuntimeConflictError, RuntimeValidationError } from './errors.js';
import { loadAppConfig } from './config.js';
import { getProviderAuthConfigRecord, listProviderAuthConfigRecords, type ProviderSecretResolver } from './provider-oauth.js';

const PROVIDER_AUTH_FIELDS = ['clientId', 'clientSecretRefId'] as const;

export type ProviderAuthConfigField = (typeof PROVIDER_AUTH_FIELDS)[number];

export interface PersistedProviderAuthConfigUpdateResult {
  config: AppConfig;
  record: ProviderAuthConfigRecord;
  changedFields: ProviderAuthConfigField[];
  previousSecretRefId: string | null;
}

function normalizeOptionalString(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function formatZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid provider auth config';
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

export function loadProviderAuthConfigFromFile(
  configPath: string,
  getSecretValue: ProviderSecretResolver,
): ProviderAuthConfigListResponse {
  const config = loadAppConfig(configPath);
  return listProviderAuthConfigRecords(config, getSecretValue);
}

export function updateProviderAuthConfigFile(
  configPath: string,
  provider: ProviderAuthProvider,
  input: { clientId: string | null; clientSecretRefId: string | null },
  getSecretValue: ProviderSecretResolver,
): PersistedProviderAuthConfigUpdateResult {
  return withConfigLock(configPath, () => {
    const current = loadAppConfig(configPath);
    const previous = getProviderAuthConfigRecord(current, provider, getSecretValue);
    const nextProviderRecord = {
      clientId: normalizeOptionalString(input.clientId),
      clientSecretRefId: normalizeOptionalString(input.clientSecretRefId),
    };
    const nextCandidate = {
      ...current,
      providerAuth: {
        ...current.providerAuth,
        [provider]: nextProviderRecord,
      },
    } satisfies AppConfig;

    const validated = AppConfigSchema.safeParse(nextCandidate);
    if (!validated.success) {
      throw new RuntimeValidationError(formatZodError(validated.error));
    }

    const nextRecord = getProviderAuthConfigRecord(validated.data, provider, getSecretValue);
    const changedFields = PROVIDER_AUTH_FIELDS.filter((field) => previous[field] !== nextRecord[field]);
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
      record: nextRecord,
      changedFields,
      previousSecretRefId: previous.clientSecretRefId,
    };
  });
}
