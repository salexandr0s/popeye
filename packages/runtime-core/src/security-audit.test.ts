import { chmodSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import type { AppConfig } from '@popeye/contracts';
import { describe, expect, it } from 'vitest';

import { initAuthStore, persistAuthStore } from './auth.js';
import { deriveRuntimePaths } from './config.js';
import { runLocalSecurityAudit } from './security-audit.js';

function makeConfig(dir: string, overrides?: Partial<AppConfig>): AppConfig {
  return {
    runtimeDataDir: dir,
    authFile: join(dir, 'config', 'auth.json'),
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: undefined, maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default', heartbeatEnabled: false, heartbeatIntervalSeconds: 300 }],
    ...overrides,
  } as AppConfig;
}

function setupDirs(dir: string): void {
  const paths = deriveRuntimePaths(dir);
  for (const d of [paths.configDir, paths.stateDir, paths.logsDir, paths.receiptsDir, paths.backupsDir]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
  }
}

function createWalDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS _init (id INTEGER PRIMARY KEY)');
  db.close();
}

describe('security audit', () => {
  it('reports directory permission violations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o700);
    setupDirs(dir);
    initAuthStore(join(dir, 'config', 'auth.json'));
    const paths = deriveRuntimePaths(dir);
    chmodSync(paths.configDir, 0o755);
    chmodSync(paths.stateDir, 0o755);
    chmodSync(paths.logsDir, 0o755);
    const findings = runLocalSecurityAudit(makeConfig(dir));
    expect(findings.some((f) => f.code === 'config_dir_permissions')).toBe(true);
    expect(findings.some((f) => f.code === 'state_dir_permissions')).toBe(true);
    expect(findings.some((f) => f.code === 'logs_dir_permissions')).toBe(true);
  });

  it('warns on old auth token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o700);
    setupDirs(dir);
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const authPath = join(dir, 'config', 'auth.json');
    persistAuthStore(authPath, { current: { token: 'a'.repeat(64), createdAt: oldDate } });
    const findings = runLocalSecurityAudit(makeConfig(dir));
    expect(findings.some((f) => f.code === 'token_age_warning')).toBe(true);
  });

  it('reports invalid redaction pattern', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o700);
    setupDirs(dir);
    initAuthStore(join(dir, 'config', 'auth.json'));
    const config = makeConfig(dir, {
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: ['(invalid'] },
    });
    const findings = runLocalSecurityAudit(config);
    expect(findings.some((f) => f.code === 'redaction_pattern_invalid')).toBe(true);
  });

  it('reports unsafe ReDoS redaction pattern', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o700);
    setupDirs(dir);
    initAuthStore(join(dir, 'config', 'auth.json'));
    const config = makeConfig(dir, {
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: ['(a+)+b'] },
    });
    const findings = runLocalSecurityAudit(config);
    expect(findings.some((f) => f.code === 'redaction_pattern_unsafe')).toBe(true);
  });

  it('accepts valid redaction pattern', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o700);
    setupDirs(dir);
    initAuthStore(join(dir, 'config', 'auth.json'));
    const config = makeConfig(dir, {
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: ['sk-[a-z]+'] },
    });
    const findings = runLocalSecurityAudit(config);
    expect(findings.some((f) => f.code === 'redaction_pattern_invalid')).toBe(false);
  });

  it('checks database WAL mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o700);
    setupDirs(dir);
    initAuthStore(join(dir, 'config', 'auth.json'));
    const paths = deriveRuntimePaths(dir);
    createWalDb(paths.appDbPath);
    createWalDb(paths.memoryDbPath);
    const findings = runLocalSecurityAudit(makeConfig(dir));
    expect(findings.some((f) => f.code === 'app_db_not_wal')).toBe(false);
    expect(findings.some((f) => f.code === 'memory_db_not_wal')).toBe(false);
    expect(findings.some((f) => f.code === 'app_db_missing')).toBe(false);
    expect(findings.some((f) => f.code === 'memory_db_missing')).toBe(false);
  });

  it('passes clean audit with everything correct', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o700);
    setupDirs(dir);
    initAuthStore(join(dir, 'config', 'auth.json'));
    const paths = deriveRuntimePaths(dir);
    createWalDb(paths.appDbPath);
    createWalDb(paths.memoryDbPath);
    const findings = runLocalSecurityAudit(makeConfig(dir));
    expect(findings).toHaveLength(0);
  });
});
