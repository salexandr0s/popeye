import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SecretRefRecord } from '@popeye/contracts';

import { initAuthStore } from './auth.js';
import { openRuntimeDatabases } from './database.js';
import { SecretStore } from './secret-store.js';

function makeConfig(dir: string) {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1' as const, bindPort: 3210, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: undefined, maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled' as const, allowedClassifications: ['embeddable' as const], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: true, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake' as const, command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-secret-'));
  chmodSync(dir, 0o700);
  const config = makeConfig(dir);
  const databases = openRuntimeDatabases(config);
  const auditEvents: Array<{ eventType: string; details: Record<string, unknown>; severity: string }> = [];
  const log = {
    info: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
  };
  const store = new SecretStore(databases.app, log, databases.paths, (event) => {
    auditEvents.push(event);
  });
  return { databases, store, auditEvents, dir };
}

describe('SecretStore', () => {
  it('set + get + delete lifecycle with file provider', () => {
    const { databases, store } = setup();
    try {
      const ref = store.setSecret({ key: 'api-key', value: 'super-secret-123', provider: 'file' });
      expect(ref.id).toBeDefined();
      expect(ref.provider).toBe('file');
      expect(ref.key).toBe('api-key');

      const value = store.getSecretValue(ref.id);
      expect(value).toBe('super-secret-123');

      const deleted = store.deleteSecret(ref.id);
      expect(deleted).toBe(true);

      const valueAfterDelete = store.getSecretValue(ref.id);
      expect(valueAfterDelete).toBeNull();
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('list by connectionId filters correctly', () => {
    const { databases, store } = setup();
    try {
      store.setSecret({ key: 'k1', value: 'v1', provider: 'file', connectionId: 'conn-a' });
      store.setSecret({ key: 'k2', value: 'v2', provider: 'file', connectionId: 'conn-a' });
      store.setSecret({ key: 'k3', value: 'v3', provider: 'file', connectionId: 'conn-b' });

      const connA = store.listSecrets('conn-a');
      expect(connA).toHaveLength(2);
      expect(connA.every((s: SecretRefRecord) => s.connectionId === 'conn-a')).toBe(true);

      const connB = store.listSecrets('conn-b');
      expect(connB).toHaveLength(1);

      const all = store.listSecrets();
      expect(all).toHaveLength(3);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('rotation updates rotatedAt metadata', () => {
    const { databases, store } = setup();
    try {
      const ref = store.setSecret({ key: 'rotate-key', value: 'old-value', provider: 'file' });
      expect(ref.rotatedAt).toBeNull();

      const rotated = store.rotateSecret(ref.id, 'new-value');
      expect(rotated).not.toBeNull();
      expect(rotated!.rotatedAt).not.toBeNull();

      const value = store.getSecretValue(ref.id);
      expect(value).toBe('new-value');
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('hasSecret returns false after delete', () => {
    const { databases, store } = setup();
    try {
      const ref = store.setSecret({ key: 'has-key', value: 'val', provider: 'file' });
      expect(store.hasSecret(ref.id)).toBe(true);

      store.deleteSecret(ref.id);
      expect(store.hasSecret(ref.id)).toBe(false);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('audit events are emitted for each operation', () => {
    const { databases, store, auditEvents } = setup();
    try {
      const ref = store.setSecret({ key: 'audit-key', value: 'val', provider: 'file' });
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].eventType).toBe('secret_stored');

      store.getSecretValue(ref.id);
      expect(auditEvents).toHaveLength(2);
      expect(auditEvents[1].eventType).toBe('secret_accessed');

      store.rotateSecret(ref.id, 'new-val');
      expect(auditEvents).toHaveLength(3);
      expect(auditEvents[2].eventType).toBe('secret_rotated');

      store.deleteSecret(ref.id);
      expect(auditEvents).toHaveLength(4);
      expect(auditEvents[3].eventType).toBe('secret_deleted');
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('getSecretValue never appears in audit event details', () => {
    const { databases, store, auditEvents } = setup();
    try {
      const ref = store.setSecret({ key: 'leak-key', value: 'do-not-leak-this', provider: 'file' });
      store.getSecretValue(ref.id);
      store.rotateSecret(ref.id, 'also-secret');
      store.deleteSecret(ref.id);

      for (const event of auditEvents) {
        const detailsStr = JSON.stringify(event.details);
        expect(detailsStr).not.toContain('do-not-leak-this');
        expect(detailsStr).not.toContain('also-secret');
      }
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('rotateSecret returns null for non-existent secret', () => {
    const { databases, store } = setup();
    try {
      const result = store.rotateSecret('non-existent-id', 'val');
      expect(result).toBeNull();
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('deleteSecret returns false for non-existent secret', () => {
    const { databases, store } = setup();
    try {
      const result = store.deleteSecret('non-existent-id');
      expect(result).toBe(false);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('supports custom id on setSecret', () => {
    const { databases, store } = setup();
    try {
      const ref = store.setSecret({ id: 'custom-id-123', key: 'my-key', value: 'val', provider: 'file' });
      expect(ref.id).toBe('custom-id-123');

      const retrieved = store.getSecret('custom-id-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.key).toBe('my-key');
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('supports env provider for reading', () => {
    const { databases, store } = setup();
    try {
      // Manually insert an env-type secret ref
      databases.app.prepare(
        "INSERT INTO secret_refs (id, provider, key, created_at) VALUES ('env-1', 'env', 'TEST_SECRET_ENV_VAR', ?)",
      ).run(new Date().toISOString());

      process.env['TEST_SECRET_ENV_VAR'] = 'env-value-123';
      try {
        const value = store.getSecretValue('env-1');
        expect(value).toBe('env-value-123');
      } finally {
        delete process.env['TEST_SECRET_ENV_VAR'];
      }
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });
});
