import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { AppConfigSchema, type AppConfig, type RuntimePaths } from '@popeye/contracts';

export function loadAppConfig(filePath: string): AppConfig {
  const raw = readFileSync(filePath, 'utf8');
  return AppConfigSchema.parse(JSON.parse(raw));
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
