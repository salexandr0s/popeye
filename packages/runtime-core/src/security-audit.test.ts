import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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

function createFakePiCheckout(rootVersion: string, codingAgentVersion: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-pi-'));
  chmodSync(dir, 0o700);
  mkdirSync(join(dir, 'packages', 'coding-agent'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-pi', version: rootVersion, private: true }, null, 2));
  writeFileSync(
    join(dir, 'packages', 'coding-agent', 'package.json'),
    JSON.stringify({ name: '@fake/coding-agent', version: codingAgentVersion, private: true }, null, 2),
  );
  return dir;
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

  it('reports secret store permission violations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o700);
    setupDirs(dir);
    initAuthStore(join(dir, 'config', 'auth.json'));
    const secretsDir = join(dir, 'secrets');
    mkdirSync(secretsDir, { recursive: true, mode: 0o755 });
    chmodSync(secretsDir, 0o755);
    const secretFile = join(secretsDir, 'test.enc');
    writeFileSync(secretFile, 'secret', { mode: 0o644 });
    chmodSync(secretFile, 0o644);

    const findings = runLocalSecurityAudit(makeConfig(dir));
    expect(findings.some((f) => f.code === 'secrets_dir_permissions')).toBe(true);
    expect(findings.some((f) => f.code === 'secret_file_permissions')).toBe(true);
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
    const platformCodes = new Set(['keychain_unavailable', 'keychain_secret_in_proclist']);
    expect(findings.filter((f) => f.severity !== 'info' && !platformCodes.has(f.code))).toHaveLength(0);
  });

  it('checks configured piVersion against coding-agent version instead of repo root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o700);
    setupDirs(dir);
    initAuthStore(join(dir, 'config', 'auth.json'));
    const piPath = createFakePiCheckout('9.9.9', '0.57.1');
    const findings = runLocalSecurityAudit(
      makeConfig(dir, {
        engine: { kind: 'pi', command: 'node', args: [], piPath, piVersion: '0.57.1' },
      }),
    );
    expect(findings.some((f) => f.code === 'pi_version_mismatch')).toBe(false);
  });

  it('warns when Pi runtime-tool bridge fallback remains enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o700);
    setupDirs(dir);
    initAuthStore(join(dir, 'config', 'auth.json'));
    const piPath = createFakePiCheckout('0.57.1', '0.57.1');
    const findings = runLocalSecurityAudit(
      makeConfig(dir, {
        engine: { kind: 'pi', command: 'node', args: [], piPath, piVersion: '0.57.1', allowRuntimeToolBridgeFallback: true },
      }),
    );
    expect(findings.some((f) => f.code === 'pi_runtime_tool_bridge_fallback_enabled')).toBe(true);
  });
});
