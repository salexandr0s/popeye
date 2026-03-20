import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { AppConfigSchema, type AppConfig, type RuntimePaths } from '@popeye/contracts';

export const DEFAULT_RUNTIME_DATA_DIR = join(homedir(), 'Library', 'Application Support', 'Popeye');

export function defaultAuthFilePath(runtimeDataDir = DEFAULT_RUNTIME_DATA_DIR): string {
  return join(runtimeDataDir, 'config', 'auth.json');
}

export function loadAppConfig(filePath: string): AppConfig {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const normalized = parsed as Record<string, unknown>;
    const runtimeDataDir = typeof normalized['runtimeDataDir'] === 'string' && normalized['runtimeDataDir'].trim().length > 0
      ? normalized['runtimeDataDir']
      : DEFAULT_RUNTIME_DATA_DIR;
    const authFile = typeof normalized['authFile'] === 'string' && normalized['authFile'].trim().length > 0
      ? normalized['authFile']
      : defaultAuthFilePath(runtimeDataDir);
    return AppConfigSchema.parse({
      ...normalized,
      runtimeDataDir,
      authFile,
    });
  }
  return AppConfigSchema.parse(parsed);
}

export function deriveRuntimePaths(runtimeDataDir: string): RuntimePaths {
  const root = resolve(runtimeDataDir);
  return {
    runtimeDataDir: root,
    configDir: join(root, 'config'),
    stateDir: join(root, 'state'),
    appDbPath: join(root, 'state', 'app.db'),
    memoryDbPath: join(root, 'state', 'memory.db'),
    logsDir: join(root, 'logs'),
    runLogsDir: join(root, 'logs', 'runs'),
    receiptsDir: join(root, 'receipts'),
    receiptsByRunDir: join(root, 'receipts', 'by-run'),
    receiptsByDayDir: join(root, 'receipts', 'by-day'),
    backupsDir: join(root, 'backups'),
    memoryDailyDir: join(root, 'memory', 'daily'),
    capabilityStoresDir: join(root, 'capabilities'),
    vaultsDir: join(root, 'vaults'),
  };
}

export function ensureSecurePath(path: string, expectedMode: number): void {
  const stats = statSync(path);
  const mode = stats.mode & 0o777;
  if (mode !== expectedMode) {
    throw new Error(`Expected ${path} to have mode ${expectedMode.toString(8)}, received ${mode.toString(8)}`);
  }
}

export function ensureRuntimePaths(config: AppConfig): RuntimePaths {
  const paths = deriveRuntimePaths(config.runtimeDataDir);
  const dirs = [
    paths.runtimeDataDir,
    paths.configDir,
    paths.stateDir,
    paths.logsDir,
    paths.runLogsDir,
    paths.receiptsDir,
    paths.receiptsByRunDir,
    paths.receiptsByDayDir,
    paths.backupsDir,
    paths.memoryDailyDir,
    paths.capabilityStoresDir,
    paths.vaultsDir,
    dirname(resolve(config.authFile)),
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (existsSync(dir)) {
      chmodSync(dir, 0o700);
    }
  }

  return paths;
}
