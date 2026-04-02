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

import { AppConfigSchema, type AppConfig } from '@popeye/contracts';
import type { ZodError } from 'zod';

import { RuntimeConflictError, RuntimeNotFoundError, RuntimeValidationError } from './errors.js';
import { loadAppConfig } from './config.js';

export interface WorkspaceHeartbeatConfigUpdateResult {
  config: AppConfig;
  enabled: boolean;
  intervalSeconds: number;
  changedFields: Array<'heartbeatEnabled' | 'heartbeatIntervalSeconds'>;
}

function formatZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid workspace config';
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

export function updateWorkspaceHeartbeatConfigFile(
  configPath: string,
  workspaceId: string,
  input: { enabled?: boolean; intervalSeconds?: number },
): WorkspaceHeartbeatConfigUpdateResult {
  return withConfigLock(configPath, () => {
    const current = loadAppConfig(configPath);
    const workspace = current.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new RuntimeNotFoundError(`Workspace ${workspaceId} was not found in config.`);
    }

    const nextEnabled = input.enabled ?? workspace.heartbeatEnabled;
    const nextIntervalSeconds = input.intervalSeconds ?? workspace.heartbeatIntervalSeconds;
    const changedFields: Array<'heartbeatEnabled' | 'heartbeatIntervalSeconds'> = [];
    if (nextEnabled !== workspace.heartbeatEnabled) {
      changedFields.push('heartbeatEnabled');
    }
    if (nextIntervalSeconds !== workspace.heartbeatIntervalSeconds) {
      changedFields.push('heartbeatIntervalSeconds');
    }

    const nextCandidate = {
      ...current,
      workspaces: current.workspaces.map((item) =>
        item.id === workspaceId
          ? {
              ...item,
              heartbeatEnabled: nextEnabled,
              heartbeatIntervalSeconds: nextIntervalSeconds,
            }
          : item,
      ),
    } satisfies AppConfig;

    const validated = AppConfigSchema.safeParse(nextCandidate);
    if (!validated.success) {
      throw new RuntimeValidationError(formatZodError(validated.error));
    }

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
      enabled: nextEnabled,
      intervalSeconds: nextIntervalSeconds,
      changedFields,
    };
  });
}
