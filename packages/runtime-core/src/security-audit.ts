import { existsSync, statSync } from 'node:fs';

import type { AppConfig, SecurityAuditFinding } from '@popeye/contracts';

import { deriveRuntimePaths } from './config.js';

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

  if (!existsSync(paths.appDbPath)) {
    findings.push({ code: 'app_db_missing', severity: 'warn', message: 'app.db has not been initialized yet' });
  }
  if (!existsSync(paths.memoryDbPath)) {
    findings.push({ code: 'memory_db_missing', severity: 'warn', message: 'memory.db has not been initialized yet' });
  }

  return findings;
}
