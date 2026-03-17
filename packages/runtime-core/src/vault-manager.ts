import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import type { DomainKind, RuntimePaths, VaultRecord, VaultStatus } from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

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

    const record: VaultRecord = {
      id,
      domain: input.domain,
      kind,
      dbPath,
      encrypted: false,
      encryptionKeyRef: null,
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
        const keys = Object.keys(data);
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
            domain: domain as DomainKind,
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
