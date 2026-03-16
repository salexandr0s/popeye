import { existsSync, statSync } from 'node:fs';

import Database from 'better-sqlite3';
import safe from 'safe-regex2';
import type { AppConfig, SecurityAuditFinding } from '@popeye/contracts';
import { checkPiVersion } from '@popeye/engine-pi';
import { z } from 'zod';

import { readAuthStore } from './auth.js';
import { deriveRuntimePaths } from './config.js';
import { isKeychainAvailable } from './keychain.js';

const JournalModeRowSchema = z.object({
  journal_mode: z.string(),
});

export function runLocalSecurityAudit(config: AppConfig): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const paths = deriveRuntimePaths(config.runtimeDataDir);

  if (config.security.bindHost !== '127.0.0.1') {
    findings.push({
      code: 'bind_host_not_loopback',
      severity: 'error',
      message: 'Control API must bind to 127.0.0.1 only',
    });
  }

  for (const [label, path, expected] of [
    ['auth_file', config.authFile, 0o600],
    ['runtime_dir', config.runtimeDataDir, 0o700],
  ] as const) {
    if (!existsSync(path)) {
      findings.push({ code: `${label}_missing`, severity: 'error', message: `${label} is missing` });
      continue;
    }
    const mode = statSync(path).mode & 0o777;
    if (mode !== expected) {
      findings.push({ code: `${label}_permissions`, severity: 'error', message: `${label} must be ${expected.toString(8)}, received ${mode.toString(8)}` });
    }
  }

  for (const [label, dirPath] of [
    ['config_dir', paths.configDir],
    ['state_dir', paths.stateDir],
    ['logs_dir', paths.logsDir],
    ['receipts_dir', paths.receiptsDir],
    ['backups_dir', paths.backupsDir],
  ] as const) {
    if (!existsSync(dirPath)) {
      continue;
    }
    const mode = statSync(dirPath).mode & 0o777;
    if (mode !== 0o700) {
      findings.push({ code: `${label}_permissions`, severity: 'error', message: `${label} must be 700, received ${mode.toString(8)}` });
    }
  }

  if (!existsSync(paths.appDbPath)) {
    findings.push({ code: 'app_db_missing', severity: 'warn', message: 'app.db has not been initialized yet' });
  }
  if (!existsSync(paths.memoryDbPath)) {
    findings.push({ code: 'memory_db_missing', severity: 'warn', message: 'memory.db has not been initialized yet' });
  }

  for (const [label, dbPath] of [
    ['app_db', paths.appDbPath],
    ['memory_db', paths.memoryDbPath],
  ] as const) {
    if (!existsSync(dbPath)) {
      continue;
    }
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        const row = z.array(JournalModeRowSchema).parse(db.pragma('journal_mode'));
        if (row[0]?.journal_mode !== 'wal') {
          findings.push({ code: `${label}_not_wal`, severity: 'warn', message: `${label} journal_mode is not WAL` });
        }
      } finally {
        db.close();
      }
    } catch {
      findings.push({ code: `${label}_open_failed`, severity: 'warn', message: `Could not open ${label} for WAL check` });
    }
  }

  if (existsSync(config.authFile)) {
    try {
      const store = readAuthStore(config.authFile);
      const createdAt = new Date(store.current.createdAt);
      const ageMs = Date.now() - createdAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays > 90) {
        findings.push({ code: 'token_age_warning', severity: 'warn', message: `Auth token is ${Math.round(ageDays)} days old \u2014 consider rotating` });
      }
    } catch {
      // Auth file unreadable
    }
  }

  for (const pattern of config.security.redactionPatterns) {
    try {
      const re = new RegExp(pattern, 'g');
      if (!safe(re)) {
        findings.push({ code: 'redaction_pattern_unsafe', severity: 'error', message: `Redaction pattern is vulnerable to ReDoS: ${pattern}` });
      }
    } catch {
      findings.push({ code: 'redaction_pattern_invalid', severity: 'error', message: `Invalid redaction pattern: ${pattern}` });
    }
  }

  if (!isKeychainAvailable()) {
    findings.push({
      code: 'keychain_unavailable',
      severity: 'warn',
      message: 'macOS Keychain is not available — secrets must use file-based storage',
    });
  } else {
    // POP-SEC-004: Mitigated — secrets are now passed via temp file with 0600
    // permissions and deleted immediately after use. The secret no longer appears
    // in the process argument list. A native Keychain API binding would eliminate
    // even the brief temp-file window.
    findings.push({
      code: 'keychain_secret_in_proclist',
      severity: 'info',
      message: 'Keychain secrets passed via temp file (not process args) — residual risk is brief file existence',
    });
  }

  if (config.engine.kind === 'pi') {
    if (!config.engine.piVersion) {
      findings.push({ code: 'pi_version_not_pinned', severity: 'warn', message: 'No piVersion configured — engine dependency is unpinned' });
    }
    const versionCheck = checkPiVersion(config.engine.piVersion, config.engine.piPath);
    if (!versionCheck.ok) {
      findings.push({ code: 'pi_version_mismatch', severity: 'warn', message: versionCheck.message });
    }
  }

  return findings;
}
