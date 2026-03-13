import { mkdtempSync } from 'node:fs';
import { chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initAuthStore, readAuthStore, rotateAuthStore, validateBearerToken } from './auth.js';
import { runLocalSecurityAudit } from './security-audit.js';

describe('auth store', () => {
  it('initializes and validates current token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    const store = initAuthStore(authPath);
    const persisted = readAuthStore(authPath);
    expect(persisted.current.token).toBe(store.current.token);
    expect(validateBearerToken(`Bearer ${store.current.token}`, persisted)).toBe(true);
  });

  it('accepts next token during overlap window', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-rotate-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    initAuthStore(authPath);
    const rotated = rotateAuthStore(authPath, 1);
    expect(rotated.next).toBeDefined();
    expect(validateBearerToken(`Bearer ${rotated.next?.token}`, rotated)).toBe(true);
  });

  it('reports missing permissions in security audit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-audit-'));
    chmodSync(dir, 0o755);
    const authPath = join(dir, 'auth.json');
    initAuthStore(authPath);
    const findings = runLocalSecurityAudit({
      runtimeDataDir: dir,
      authFile: authPath,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: undefined, maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'] },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    expect(findings.some((finding) => finding.code === 'runtime_dir_permissions')).toBe(true);
  });
});
