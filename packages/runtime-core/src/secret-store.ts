import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import type Database from 'better-sqlite3';
import { type SecretRefRecord, type RuntimePaths, nowIso } from '@popeye/contracts';

import { isKeychainAvailable, keychainSet, keychainGet, keychainDelete } from './keychain.js';

interface SecretStoreAuditEvent {
  eventType: string;
  details: Record<string, unknown>;
  severity: 'info' | 'warning' | 'error';
}

interface SecretStoreLog {
  info: (msg: string, details?: Record<string, unknown>) => void;
  warn: (msg: string, details?: Record<string, unknown>) => void;
  error: (msg: string, details?: Record<string, unknown>) => void;
}

export class SecretStore {
  private readonly secretsDir: string;

  constructor(
    private readonly db: Database.Database,
    private readonly log: SecretStoreLog,
    private readonly runtimePaths: RuntimePaths,
    private readonly auditCallback: (event: SecretStoreAuditEvent) => void,
  ) {
    this.secretsDir = join(runtimePaths.runtimeDataDir, 'secrets');
  }

  setSecret(input: {
    id?: string;
    provider?: string;
    key: string;
    value: string;
    connectionId?: string;
    description?: string;
    expiresAt?: string;
  }): SecretRefRecord {
    const id = input.id ?? randomUUID();
    const provider = input.provider ?? (isKeychainAvailable() ? 'keychain' : 'file');
    const now = nowIso();

    if (provider === 'keychain') {
      const result = keychainSet(id, input.value);
      if (!result.ok) {
        throw new Error(`Failed to store secret in keychain: ${result.error}`);
      }
    } else {
      this.setFileValue(id, input.value);
    }

    this.db
      .prepare(
        `INSERT INTO secret_refs (id, provider, key, connection_id, description, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, provider, input.key, input.connectionId ?? null, input.description ?? '', now, input.expiresAt ?? null);

    this.auditCallback({
      eventType: 'secret_stored',
      details: { secretId: id, provider },
      severity: 'info',
    });
    this.log.info('secret stored', { secretId: id, provider });

    return this.getSecret(id)!;
  }

  getSecretValue(id: string): string | null {
    const ref = this.getSecret(id);
    if (!ref) return null;

    let value: string | null = null;
    if (ref.provider === 'keychain') {
      const result = keychainGet(id);
      value = result.ok ? (result.value ?? null) : null;
    } else if (ref.provider === 'file') {
      value = this.getFileValue(id);
    } else if (ref.provider === 'env') {
      value = process.env[ref.key] ?? null;
    }

    this.auditCallback({
      eventType: 'secret_accessed',
      details: { secretId: id, provider: ref.provider },
      severity: 'info',
    });

    return value;
  }

  hasSecret(id: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM secret_refs WHERE id = ?').get(id);
    return !!row;
  }

  listSecrets(connectionId?: string): SecretRefRecord[] {
    if (connectionId) {
      return (this.db.prepare('SELECT * FROM secret_refs WHERE connection_id = ?').all(connectionId) as Record<string, unknown>[]).map(
        (r) => this.mapRow(r),
      );
    }
    return (this.db.prepare('SELECT * FROM secret_refs').all() as Record<string, unknown>[]).map((r) => this.mapRow(r));
  }

  getSecret(id: string): SecretRefRecord | null {
    const row = this.db.prepare('SELECT * FROM secret_refs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  deleteSecret(id: string): boolean {
    const ref = this.getSecret(id);
    if (!ref) return false;

    if (ref.provider === 'keychain') {
      keychainDelete(id);
    } else if (ref.provider === 'file') {
      this.deleteFileValue(id);
    }

    this.db.prepare('DELETE FROM secret_refs WHERE id = ?').run(id);

    this.auditCallback({
      eventType: 'secret_deleted',
      details: { secretId: id },
      severity: 'info',
    });
    this.log.info('secret deleted', { secretId: id });

    return true;
  }

  rotateSecret(id: string, newValue: string): SecretRefRecord | null {
    const ref = this.getSecret(id);
    if (!ref) return null;

    const now = nowIso();
    if (ref.provider === 'keychain') {
      const result = keychainSet(id, newValue);
      if (!result.ok) {
        throw new Error(`Failed to rotate secret in keychain: ${result.error}`);
      }
    } else if (ref.provider === 'file') {
      this.setFileValue(id, newValue);
    }

    this.db.prepare('UPDATE secret_refs SET rotated_at = ? WHERE id = ?').run(now, id);

    this.auditCallback({
      eventType: 'secret_rotated',
      details: { secretId: id },
      severity: 'info',
    });
    this.log.info('secret rotated', { secretId: id });

    return this.getSecret(id);
  }

  // --- File-based secret storage ---

  private ensureSecretsDir(): void {
    if (!existsSync(this.secretsDir)) {
      mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    }
    chmodSync(this.secretsDir, 0o700);
  }

  private setFileValue(id: string, value: string): void {
    this.ensureSecretsDir();
    const filePath = join(this.secretsDir, `${id}.enc`);
    writeFileSync(filePath, value, { mode: 0o600 });
    chmodSync(filePath, 0o600);
  }

  private getFileValue(id: string): string | null {
    const filePath = join(this.secretsDir, `${id}.enc`);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf8');
  }

  private deleteFileValue(id: string): void {
    const filePath = join(this.secretsDir, `${id}.enc`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  // --- Row mapping ---

  private mapRow(row: Record<string, unknown>): SecretRefRecord {
    return {
      id: row['id'] as string,
      provider: row['provider'] as SecretRefRecord['provider'],
      key: row['key'] as string,
      connectionId: (row['connection_id'] as string) ?? null,
      description: (row['description'] as string) ?? '',
      createdAt: row['created_at'] as string,
      rotatedAt: (row['rotated_at'] as string) ?? null,
      expiresAt: (row['expires_at'] as string) ?? null,
    };
  }
}
