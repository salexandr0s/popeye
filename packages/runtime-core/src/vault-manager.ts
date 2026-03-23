import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import type { DomainKind, RuntimePaths, VaultRecord, VaultStatus } from '@popeye/contracts';
import { DomainKindSchema, nowIso } from '@popeye/contracts';
import { keychainGet } from './keychain.js';

const SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertSqlIdentifier(name: string, label: string): void {
  if (!SQL_IDENTIFIER_RE.test(name)) {
    throw new Error(`Invalid SQL identifier for ${label}: ${name}`);
  }
}

const UNSAFE_WHERE_RE = /;|--/;

function assertSafeWhereClause(clause: string): void {
  if (UNSAFE_WHERE_RE.test(clause)) {
    throw new Error(`Unsafe WHERE clause: ${clause}`);
  }
}

export interface VaultHandle {
  vaultId: string;
  domain: DomainKind;
  query<T>(sql: string, params?: unknown[]): T[];
  insert(table: string, data: Record<string, unknown>): void;
  update(table: string, data: Record<string, unknown>, where: string, whereParams?: unknown[]): number;
  close(): void;
}

interface OpenEntry {
  db: Database.Database;
  handle: VaultHandle;
}

export class VaultManager {
  private readonly registry = new Map<string, VaultRecord>();
  private readonly openHandles = new Map<string, OpenEntry>();
  private readonly cryptoMetadata = new Map<string, { kekRef: string; dekWrapped: string }>();

  constructor(
    private readonly db: Database.Database,
    private readonly log: { info: Function; warn: Function; error: Function },
    private readonly runtimePaths: RuntimePaths,
    private readonly auditCallback: (event: {
      eventType: string;
      details: Record<string, unknown>;
      severity: string;
    }) => void,
  ) {
    this.scanExistingVaults();
  }

  createVault(input: {
    domain: DomainKind;
    name: string;
    kind?: 'capability' | 'restricted';
  }): VaultRecord {
    const id = randomUUID();
    const kind = input.kind ?? 'capability';
    const now = nowIso();

    const baseDir =
      kind === 'restricted' ? this.runtimePaths.vaultsDir : this.runtimePaths.capabilityStoresDir;
    const vaultDir = join(baseDir, input.domain);
    if (!existsSync(vaultDir)) {
      mkdirSync(vaultDir, { recursive: true });
      chmodSync(vaultDir, 0o700);
    }

    const dbPath = join(vaultDir, `${input.name}.db`);

    const vaultDb = new Database(dbPath);
    vaultDb.pragma('journal_mode = WAL');
    vaultDb.pragma('foreign_keys = ON');
    vaultDb.close();
    chmodSync(dbPath, 0o600);

    // If restricted vault with encryption key available, encrypt the DB
    let encrypted = false;
    let encryptionKeyRef: string | null = null;
    const kekHex = kind === 'restricted' ? this.resolveKek() : null;
    if (kind === 'restricted' && kekHex) {
      const kcResult = keychainGet('vault-kek');
      const kekSource = kcResult.ok ? 'keychain:vault-kek' : 'env:POPEYE_VAULT_KEK';
      const dek = this.generateDek();
      const dekWrapped = this.wrapDekWithKek(dek, kekHex);
      this.encryptFile(dbPath, dek);
      this.cryptoMetadata.set(id, { kekRef: kekSource, dekWrapped });
      encrypted = true;
      encryptionKeyRef = kekSource;
    }

    const record: VaultRecord = {
      id,
      domain: input.domain,
      kind,
      dbPath,
      encrypted,
      encryptionKeyRef,
      status: 'closed',
      createdAt: now,
      lastAccessedAt: null,
    };

    this.registry.set(id, record);

    this.auditCallback({
      eventType: 'vault_created',
      details: { vaultId: id, domain: input.domain, kind, name: input.name },
      severity: 'info',
    });
    this.log.info({ vaultId: id, domain: input.domain, kind }, 'vault created');

    return record;
  }

  openVault(vaultId: string, runId?: string): VaultHandle | null {
    const record = this.registry.get(vaultId);
    if (!record) return null;
    if (record.status === 'sealed') return null;

    if (this.openHandles.has(vaultId)) {
      return this.openHandles.get(vaultId)!.handle;
    }

    // Decrypt-on-open for encrypted vaults
    const encPath = `${record.dbPath}.enc`;
    if (record.encrypted && existsSync(encPath)) {
      const kekHex = this.resolveKek();
      if (!kekHex) {
        this.log.warn({ vaultId }, 'cannot open encrypted vault: no KEK available');
        return null;
      }
      const meta = this.cryptoMetadata.get(vaultId);
      if (!meta) {
        this.log.warn({ vaultId }, 'cannot open encrypted vault: no crypto metadata');
        return null;
      }
      const dek = this.unwrapDek(meta.dekWrapped, kekHex);
      this.decryptFile(encPath, dek, record.dbPath);
    }

    if (!existsSync(record.dbPath)) return null;

    const vaultDb = new Database(record.dbPath);
    vaultDb.pragma('journal_mode = WAL');
    vaultDb.pragma('foreign_keys = ON');

    const now = nowIso();
    record.status = 'open';
    record.lastAccessedAt = now;

    const handle: VaultHandle = {
      vaultId,
      domain: record.domain,
      query<T>(sql: string, params?: unknown[]): T[] {
        const stmt = vaultDb.prepare(sql);
        if (stmt.reader) {
          return stmt.all(...(params ?? [])) as T[];
        }
        stmt.run(...(params ?? []));
        return [];
      },
      insert(table: string, data: Record<string, unknown>): void {
        assertSqlIdentifier(table, 'table');
        const keys = Object.keys(data);
        for (const k of keys) assertSqlIdentifier(k, 'column');
        const placeholders = keys.map(() => '?').join(', ');
        const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
        vaultDb.prepare(sql).run(...keys.map((k) => data[k]));
      },
      update(
        table: string,
        data: Record<string, unknown>,
        where: string,
        whereParams?: unknown[],
      ): number {
        assertSqlIdentifier(table, 'table');
        for (const k of Object.keys(data)) assertSqlIdentifier(k, 'column');
        assertSafeWhereClause(where);
        const setClause = Object.keys(data)
          .map((k) => `${k} = ?`)
          .join(', ');
        const sql = `UPDATE ${table} SET ${setClause} WHERE ${where}`;
        const values = [...Object.values(data), ...(whereParams ?? [])];
        return vaultDb.prepare(sql).run(...values).changes;
      },
      close(): void {
        // no-op: callers should use VaultManager.closeVault
      },
    };

    this.openHandles.set(vaultId, { db: vaultDb, handle });

    this.auditCallback({
      eventType: 'vault_opened',
      details: { vaultId, domain: record.domain, runId: runId ?? null },
      severity: 'info',
    });
    this.log.info({ vaultId, domain: record.domain }, 'vault opened');

    return handle;
  }

  closeVault(vaultId: string): boolean {
    const entry = this.openHandles.get(vaultId);
    if (!entry) return false;

    entry.db.close();
    this.openHandles.delete(vaultId);

    const record = this.registry.get(vaultId);

    // Re-encrypt on close if the vault was encrypted
    if (record?.encrypted && existsSync(record.dbPath)) {
      const meta = this.cryptoMetadata.get(vaultId);
      const kekHex = this.resolveKek();
      if (meta && kekHex) {
        const dek = this.unwrapDek(meta.dekWrapped, kekHex);
        this.encryptFile(record.dbPath, dek);
      } else {
        this.log.error({ vaultId }, 'cannot re-encrypt vault on close: KEK or crypto metadata unavailable — deleting plaintext DB');
        unlinkSync(record.dbPath);
        for (const suffix of ['-wal', '-shm']) {
          const walPath = `${record.dbPath}${suffix}`;
          if (existsSync(walPath)) unlinkSync(walPath);
        }
        record.status = 'sealed';
        this.auditCallback({
          eventType: 'vault_reencrypt_failed',
          details: { vaultId, reason: !meta ? 'missing_crypto_metadata' : 'kek_unavailable', action: 'plaintext_deleted_and_sealed' },
          severity: 'error',
        });
      }
    }

    if (record && record.status === 'open') {
      record.status = 'closed';
    }

    this.auditCallback({
      eventType: 'vault_closed',
      details: { vaultId },
      severity: 'info',
    });
    this.log.info({ vaultId }, 'vault closed');

    return true;
  }

  closeAllVaults(): void {
    for (const [id] of this.openHandles) {
      this.closeVault(id);
    }
  }

  sealVault(vaultId: string): boolean {
    const record = this.registry.get(vaultId);
    if (!record) return false;

    if (this.openHandles.has(vaultId)) {
      this.closeVault(vaultId);
    }

    record.status = 'sealed';

    this.auditCallback({
      eventType: 'vault_sealed',
      details: { vaultId, domain: record.domain },
      severity: 'info',
    });
    this.log.info({ vaultId, domain: record.domain }, 'vault sealed');

    return true;
  }

  listVaults(domain?: DomainKind): VaultRecord[] {
    const all = Array.from(this.registry.values());
    if (domain) return all.filter((v) => v.domain === domain);
    return all;
  }

  getVault(vaultId: string): VaultRecord | null {
    return this.registry.get(vaultId) ?? null;
  }

  private resolveKek(): string | null {
    const kcResult = keychainGet('vault-kek');
    if (kcResult.ok && kcResult.value) return kcResult.value;
    const envKek = process.env['POPEYE_VAULT_KEK'];
    if (envKek) return envKek;
    return null;
  }

  private generateDek(): Buffer {
    return randomBytes(32);
  }

  private wrapDekWithKek(dek: Buffer, kekHex: string): string {
    const kek = Buffer.from(kekHex, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', kek, iv);
    const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  private unwrapDek(wrappedDek: string, kekHex: string): Buffer {
    const kek = Buffer.from(kekHex, 'hex');
    const raw = Buffer.from(wrappedDek, 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', kek, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  private encryptFile(filePath: string, dek: Buffer): void {
    const plaintext = readFileSync(filePath);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const output = Buffer.concat([iv, authTag, encrypted]);
    writeFileSync(`${filePath}.enc`, output);
    unlinkSync(filePath);
    // Also clean up WAL/SHM files
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${filePath}${suffix}`)) unlinkSync(`${filePath}${suffix}`);
    }
  }

  private decryptFile(encPath: string, dek: Buffer, outputPath: string): void {
    const raw = readFileSync(encPath);
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', dek, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    writeFileSync(outputPath, plaintext, { mode: 0o600 });
    chmodSync(outputPath, 0o600);
  }

  private scanExistingVaults(): void {
    for (const [kind, baseDir] of [
      ['restricted', this.runtimePaths.vaultsDir],
      ['capability', this.runtimePaths.capabilityStoresDir],
    ] as const) {
      if (!existsSync(baseDir)) continue;
      let domainDirs: string[];
      try {
        domainDirs = readdirSync(baseDir);
      } catch {
        continue;
      }
      for (const domain of domainDirs) {
        const parsed = DomainKindSchema.safeParse(domain);
        if (!parsed.success) continue;
        const domainPath = join(baseDir, domain);
        let files: string[];
        try {
          files = readdirSync(domainPath);
        } catch {
          continue;
        }
        for (const file of files) {
          if (!file.endsWith('.db')) continue;
          const dbPath = join(domainPath, file);
          const id = randomUUID();
          this.registry.set(id, {
            id,
            domain: parsed.data,
            kind,
            dbPath,
            encrypted: false,
            encryptionKeyRef: null,
            status: 'closed' as VaultStatus,
            createdAt: nowIso(),
            lastAccessedAt: null,
          });
        }
      }
    }
  }
}
