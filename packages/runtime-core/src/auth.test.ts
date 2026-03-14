import { mkdtempSync } from 'node:fs';
import { chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AuthRotationRecord } from '@popeye/contracts';

import {
  AUTH_COOKIE_NAME,
  initAuthStore,
  issueCsrfToken,
  readAuthStore,
  readCookieValue,
  rotateAuthStore,
  validateAuthCookie,
  validateBearerToken,
  validateCsrfToken,
} from './auth.js';
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
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: true, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    expect(findings.some((finding) => finding.code === 'runtime_dir_permissions')).toBe(true);
  });

  it('rejects wrong-length token via timing-safe comparison', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    const store = initAuthStore(authPath);
    expect(validateBearerToken('Bearer short', store)).toBe(false);
  });

  it('rejects completely wrong token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    const store = initAuthStore(authPath);
    const wrongToken = 'a'.repeat(64);
    expect(validateBearerToken(`Bearer ${wrongToken}`, store)).toBe(false);
  });

  it('validates current token from auth cookie', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-cookie-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    const store = initAuthStore(authPath);
    expect(validateAuthCookie(`${AUTH_COOKIE_NAME}=${store.current.token}`, store)).toBe(true);
  });

  it('accepts next token from auth cookie during overlap window', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-cookie-next-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    initAuthStore(authPath);
    const rotated = rotateAuthStore(authPath, 1);
    expect(validateAuthCookie(`${AUTH_COOKIE_NAME}=${rotated.next?.token}`, rotated)).toBe(true);
  });

  it('rejects malformed or missing auth cookie values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-cookie-bad-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    const store = initAuthStore(authPath);
    expect(validateAuthCookie(undefined, store)).toBe(false);
    expect(validateAuthCookie('not-a-cookie', store)).toBe(false);
    expect(validateAuthCookie(`${AUTH_COOKIE_NAME}=`, store)).toBe(false);
  });

  it('reads cookie values from multi-cookie headers', () => {
    expect(readCookieValue('foo=bar; popeye_auth=abc123; theme=dark', AUTH_COOKIE_NAME)).toBe('abc123');
    expect(readCookieValue('foo=bar', AUTH_COOKIE_NAME)).toBeUndefined();
  });

  it('rejects raw token without Bearer prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    const store = initAuthStore(authPath);
    expect(validateBearerToken(store.current.token, store)).toBe(false);
  });

  it('rejects malformed Bearer header', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    const store = initAuthStore(authPath);
    expect(validateBearerToken('Bearer', store)).toBe(false);
    expect(validateBearerToken('Bearer ', store)).toBe(false);
    expect(validateBearerToken(undefined, store)).toBe(false);
  });

  it('rejects next token after overlap window expires', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    initAuthStore(authPath);
    const rotated = rotateAuthStore(authPath, 1);
    const pastOverlap = new Date(Date.now() + 2 * 60 * 60 * 1000);
    expect(validateBearerToken(`Bearer ${rotated.next!.token}`, rotated, pastOverlap)).toBe(false);
  });

  it('issues and validates a CSRF token round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    const store = initAuthStore(authPath);
    const csrf = issueCsrfToken(store);
    expect(validateCsrfToken(csrf, store)).toBe(true);
  });

  it('rejects a random CSRF token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    const store = initAuthStore(authPath);
    expect(validateCsrfToken('deadbeef1234', store)).toBe(false);
    expect(validateCsrfToken(undefined, store)).toBe(false);
  });

  it('validates CSRF token against next token seed during overlap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-auth-'));
    chmodSync(dir, 0o700);
    const authPath = join(dir, 'auth.json');
    initAuthStore(authPath);
    const rotated = rotateAuthStore(authPath, 1);
    const nextRecord: AuthRotationRecord = {
      current: rotated.next!,
    };
    const csrfFromNext = issueCsrfToken(nextRecord);
    expect(validateCsrfToken(csrfFromNext, rotated)).toBe(true);
  });

  it('validates CSRF with only current token and no next', () => {
    const now = new Date().toISOString();
    const record: AuthRotationRecord = {
      current: { token: 'a'.repeat(64), createdAt: now },
    };
    const csrf = issueCsrfToken(record);
    expect(validateCsrfToken(csrf, record)).toBe(true);
    expect(validateCsrfToken('wrongtoken', record)).toBe(false);
  });
});
