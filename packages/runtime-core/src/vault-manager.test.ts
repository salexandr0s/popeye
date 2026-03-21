import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import type { RuntimePaths } from '@popeye/contracts';

import { VaultManager } from './vault-manager.js';

function makePaths(root: string): RuntimePaths {
  return {
    runtimeDataDir: root,
    configDir: join(root, 'config'),
    stateDir: join(root, 'state'),
    appDbPath: join(root, 'state', 'app.db'),
    memoryDbPath: join(root, 'state', 'memory.db'),
    logsDir: join(root, 'logs'),
    runLogsDir: join(root, 'logs', 'runs'),
    receiptsDir: join(root, 'receipts'),
    receiptsByRunDir: join(root, 'receipts', 'by-run'),
    receiptsByDayDir: join(root, 'receipts', 'by-day'),
    backupsDir: join(root, 'backups'),
    memoryDailyDir: join(root, 'memory', 'daily'),
    capabilityStoresDir: join(root, 'capabilities'),
    vaultsDir: join(root, 'vaults'),
  };
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'popeye-vault-'));
  chmodSync(root, 0o700);
  const paths = makePaths(root);
  const db = new Database(':memory:');
  const log = { info: () => {}, warn: () => {}, error: () => {} };
  const auditEvents: { eventType: string; details: Record<string, unknown>; severity: string }[] =
    [];
  const auditCallback = (event: {
    eventType: string;
    details: Record<string, unknown>;
    severity: string;
  }) => auditEvents.push(event);
  const mgr = new VaultManager(db, log, paths, auditCallback);
  return { root, paths, db, mgr, auditEvents };
}

describe('VaultManager', () => {
  it('createVault creates DB file with correct permissions (0o600)', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'test-vault' });
    expect(record.id).toBeTruthy();
    expect(record.domain).toBe('general');
    expect(record.kind).toBe('capability');
    expect(record.status).toBe('closed');
    expect(existsSync(record.dbPath)).toBe(true);
    const mode = statSync(record.dbPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('createVault creates directory with 0o700', () => {
    const { mgr, paths } = makeFixture();
    mgr.createVault({ domain: 'email', name: 'mail-vault' });
    const dirPath = join(paths.capabilityStoresDir, 'email');
    const mode = statSync(dirPath).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('createVault creates restricted vault in vaults dir', () => {
    const { mgr, paths } = makeFixture();
    const record = mgr.createVault({ domain: 'finance', name: 'fin', kind: 'restricted' });
    expect(record.kind).toBe('restricted');
    expect(record.dbPath).toContain(paths.vaultsDir);
  });

  it('openVault returns a working VaultHandle', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'ops' });
    const handle = mgr.openVault(record.id);
    expect(handle).not.toBeNull();
    expect(handle!.vaultId).toBe(record.id);
    expect(handle!.domain).toBe('general');
    mgr.closeVault(record.id);
  });

  it('VaultHandle query/insert work correctly', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'data' });
    const handle = mgr.openVault(record.id)!;

    // Create a table and insert data via handle
    handle.query('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, value TEXT)');
    handle.insert('items', { id: '1', value: 'hello' });
    const rows = handle.query<{ id: string; value: string }>('SELECT * FROM items');
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('hello');

    mgr.closeVault(record.id);
  });

  it('VaultHandle update works correctly', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'upd' });
    const handle = mgr.openVault(record.id)!;

    handle.query('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, value TEXT)');
    handle.insert('items', { id: '1', value: 'old' });
    const changed = handle.update('items', { value: 'new' }, 'id = ?', ['1']);
    expect(changed).toBe(1);
    const rows = handle.query<{ id: string; value: string }>('SELECT * FROM items WHERE id = ?', [
      '1',
    ]);
    expect(rows[0].value).toBe('new');

    mgr.closeVault(record.id);
  });

  it('closeVault closes the DB connection', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'cls' });
    mgr.openVault(record.id);
    expect(mgr.closeVault(record.id)).toBe(true);
    // Closing again should return false
    expect(mgr.closeVault(record.id)).toBe(false);
  });

  it('closeAllVaults on shutdown', () => {
    const { mgr } = makeFixture();
    const r1 = mgr.createVault({ domain: 'general', name: 'a' });
    const r2 = mgr.createVault({ domain: 'email', name: 'b' });
    mgr.openVault(r1.id);
    mgr.openVault(r2.id);
    mgr.closeAllVaults();
    // Both should be closed now
    expect(mgr.closeVault(r1.id)).toBe(false);
    expect(mgr.closeVault(r2.id)).toBe(false);
  });

  it('sealVault prevents further opens', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'finance', name: 'sealed', kind: 'restricted' });
    expect(mgr.sealVault(record.id)).toBe(true);
    expect(mgr.getVault(record.id)!.status).toBe('sealed');
    // Opening a sealed vault returns null
    expect(mgr.openVault(record.id)).toBeNull();
  });

  it('sealVault closes an open vault before sealing', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'seal-open' });
    mgr.openVault(record.id);
    expect(mgr.sealVault(record.id)).toBe(true);
    expect(mgr.getVault(record.id)!.status).toBe('sealed');
  });

  it('listVaults returns all, filtered by domain', () => {
    const { mgr } = makeFixture();
    mgr.createVault({ domain: 'general', name: 'v1' });
    mgr.createVault({ domain: 'email', name: 'v2' });
    mgr.createVault({ domain: 'general', name: 'v3' });

    expect(mgr.listVaults()).toHaveLength(3);
    expect(mgr.listVaults('general')).toHaveLength(2);
    expect(mgr.listVaults('email')).toHaveLength(1);
    expect(mgr.listVaults('finance')).toHaveLength(0);
  });

  it('getVault returns null for unknown id', () => {
    const { mgr } = makeFixture();
    expect(mgr.getVault('nonexistent')).toBeNull();
  });

  it('openVault returns null for unknown id', () => {
    const { mgr } = makeFixture();
    expect(mgr.openVault('nonexistent')).toBeNull();
  });

  it('openVault returns existing handle if already open', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'reopen' });
    const h1 = mgr.openVault(record.id);
    const h2 = mgr.openVault(record.id);
    expect(h1).toBe(h2);
    mgr.closeVault(record.id);
  });

  it('audit events emitted for create/open/close/seal', () => {
    const { mgr, auditEvents } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'audit' });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].eventType).toBe('vault_created');

    mgr.openVault(record.id);
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents[1].eventType).toBe('vault_opened');

    mgr.closeVault(record.id);
    expect(auditEvents).toHaveLength(3);
    expect(auditEvents[2].eventType).toBe('vault_closed');

    mgr.sealVault(record.id);
    expect(auditEvents).toHaveLength(4);
    expect(auditEvents[3].eventType).toBe('vault_sealed');
  });
});

describe('VaultManager encryption', () => {
  it('restricted vault with KEK creates .enc file and removes .db', () => {
    const originalKek = process.env['POPEYE_VAULT_KEK'];
    try {
      process.env['POPEYE_VAULT_KEK'] = randomBytes(32).toString('hex');
      const { mgr } = makeFixture();
      const record = mgr.createVault({ domain: 'finance', name: 'encrypted', kind: 'restricted' });
      expect(record.encrypted).toBe(true);
      expect(existsSync(`${record.dbPath}.enc`)).toBe(true);
      expect(existsSync(record.dbPath)).toBe(false);
    } finally {
      if (originalKek !== undefined) {
        process.env['POPEYE_VAULT_KEK'] = originalKek;
      } else {
        delete process.env['POPEYE_VAULT_KEK'];
      }
    }
  });
});

describe('VaultManager encryption round-trip', () => {
  it('create encrypted → open → read/write → close → verify re-encrypted', () => {
    const originalKek = process.env['POPEYE_VAULT_KEK'];
    try {
      process.env['POPEYE_VAULT_KEK'] = randomBytes(32).toString('hex');
      const { mgr } = makeFixture();
      const record = mgr.createVault({ domain: 'finance', name: 'rt', kind: 'restricted' });

      const handle = mgr.openVault(record.id);
      expect(handle).not.toBeNull();

      handle!.query('CREATE TABLE items (id TEXT, value TEXT)');
      handle!.insert('items', { id: '1', value: 'test' });

      mgr.closeVault(record.id);

      expect(existsSync(`${record.dbPath}.enc`)).toBe(true);
      expect(existsSync(record.dbPath)).toBe(false);
    } finally {
      if (originalKek !== undefined) {
        process.env['POPEYE_VAULT_KEK'] = originalKek;
      } else {
        delete process.env['POPEYE_VAULT_KEK'];
      }
    }
  });

  it('multi-cycle — data persists across open/close', () => {
    const originalKek = process.env['POPEYE_VAULT_KEK'];
    try {
      process.env['POPEYE_VAULT_KEK'] = randomBytes(32).toString('hex');
      const { mgr } = makeFixture();
      const record = mgr.createVault({ domain: 'finance', name: 'mc', kind: 'restricted' });

      // Cycle 1: write data
      const h1 = mgr.openVault(record.id)!;
      h1.query('CREATE TABLE items (id TEXT, value TEXT)');
      h1.insert('items', { id: '1', value: 'persisted' });
      mgr.closeVault(record.id);

      // Cycle 2: read data back
      const h2 = mgr.openVault(record.id)!;
      expect(h2).not.toBeNull();
      const rows = h2.query<{ id: string; value: string }>('SELECT * FROM items');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('1');
      expect(rows[0].value).toBe('persisted');
      mgr.closeVault(record.id);

      expect(existsSync(`${record.dbPath}.enc`)).toBe(true);
      expect(existsSync(record.dbPath)).toBe(false);
    } finally {
      if (originalKek !== undefined) {
        process.env['POPEYE_VAULT_KEK'] = originalKek;
      } else {
        delete process.env['POPEYE_VAULT_KEK'];
      }
    }
  });

  it('open fails when KEK is unavailable', () => {
    const originalKek = process.env['POPEYE_VAULT_KEK'];
    try {
      process.env['POPEYE_VAULT_KEK'] = randomBytes(32).toString('hex');
      const { mgr } = makeFixture();
      const record = mgr.createVault({ domain: 'finance', name: 'nokey', kind: 'restricted' });
      expect(existsSync(`${record.dbPath}.enc`)).toBe(true);

      delete process.env['POPEYE_VAULT_KEK'];

      const handle = mgr.openVault(record.id);
      expect(handle).toBeNull();

      // .enc must still be intact
      expect(existsSync(`${record.dbPath}.enc`)).toBe(true);
    } finally {
      if (originalKek !== undefined) {
        process.env['POPEYE_VAULT_KEK'] = originalKek;
      } else {
        delete process.env['POPEYE_VAULT_KEK'];
      }
    }
  });

  it('close without KEK deletes plaintext and seals vault', () => {
    const originalKek = process.env['POPEYE_VAULT_KEK'];
    try {
      process.env['POPEYE_VAULT_KEK'] = randomBytes(32).toString('hex');
      const { mgr, auditEvents } = makeFixture();
      const record = mgr.createVault({ domain: 'finance', name: 'nokek-close', kind: 'restricted' });

      mgr.openVault(record.id);

      delete process.env['POPEYE_VAULT_KEK'];

      expect(mgr.closeVault(record.id)).toBe(true);

      const reencryptFailed = auditEvents.find((e) => e.eventType === 'vault_reencrypt_failed');
      expect(reencryptFailed).toBeDefined();
      expect(reencryptFailed!.details['action']).toBe('plaintext_deleted_and_sealed');

      // Plaintext must be deleted, vault must be sealed
      expect(existsSync(record.dbPath)).toBe(false);
      expect(mgr.getVault(record.id)!.status).toBe('sealed');
    } finally {
      if (originalKek !== undefined) {
        process.env['POPEYE_VAULT_KEK'] = originalKek;
      } else {
        delete process.env['POPEYE_VAULT_KEK'];
      }
    }
  });

  it('decrypted vault file has 0o600 permissions', () => {
    const originalKek = process.env['POPEYE_VAULT_KEK'];
    try {
      process.env['POPEYE_VAULT_KEK'] = randomBytes(32).toString('hex');
      const { mgr } = makeFixture();
      const record = mgr.createVault({ domain: 'finance', name: 'perms', kind: 'restricted' });

      mgr.openVault(record.id);
      // After open, decrypted file should have restrictive permissions
      expect(existsSync(record.dbPath)).toBe(true);
      const mode = statSync(record.dbPath).mode & 0o777;
      expect(mode).toBe(0o600);

      mgr.closeVault(record.id);
    } finally {
      if (originalKek !== undefined) {
        process.env['POPEYE_VAULT_KEK'] = originalKek;
      } else {
        delete process.env['POPEYE_VAULT_KEK'];
      }
    }
  });
});

describe('VaultHandle SQL identifier validation', () => {
  it('insert rejects table name with SQL metacharacters', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'sqli' });
    const handle = mgr.openVault(record.id)!;
    handle.query('CREATE TABLE items (id TEXT, value TEXT)');

    expect(() => handle.insert('items; DROP TABLE items', { id: '1' })).toThrow('Invalid SQL identifier for table');
    mgr.closeVault(record.id);
  });

  it('insert rejects column name with SQL metacharacters', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'sqli2' });
    const handle = mgr.openVault(record.id)!;
    handle.query('CREATE TABLE items (id TEXT, value TEXT)');

    expect(() => handle.insert('items', { 'id; --': '1' })).toThrow('Invalid SQL identifier for column');
    mgr.closeVault(record.id);
  });

  it('update rejects table name with metacharacters', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'sqli3' });
    const handle = mgr.openVault(record.id)!;

    expect(() => handle.update('items; DROP TABLE x', { value: 'x' }, 'id = ?', ['1'])).toThrow('Invalid SQL identifier for table');
    mgr.closeVault(record.id);
  });

  it('update rejects WHERE clause with semicolons', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'sqli4' });
    const handle = mgr.openVault(record.id)!;
    handle.query('CREATE TABLE items (id TEXT, value TEXT)');
    handle.insert('items', { id: '1', value: 'old' });

    expect(() => handle.update('items', { value: 'x' }, '1=1; DROP TABLE items', [])).toThrow('Unsafe WHERE clause');
    mgr.closeVault(record.id);
  });

  it('update rejects WHERE clause with comment markers', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'sqli5' });
    const handle = mgr.openVault(record.id)!;
    handle.query('CREATE TABLE items (id TEXT, value TEXT)');

    expect(() => handle.update('items', { value: 'x' }, 'id = ? -- comment', ['1'])).toThrow('Unsafe WHERE clause');
    mgr.closeVault(record.id);
  });

  it('insert and update accept valid SQL identifiers', () => {
    const { mgr } = makeFixture();
    const record = mgr.createVault({ domain: 'general', name: 'valid' });
    const handle = mgr.openVault(record.id)!;

    handle.query('CREATE TABLE test_items (_id TEXT PRIMARY KEY, my_value TEXT, Count INTEGER)');
    expect(() => handle.insert('test_items', { _id: '1', my_value: 'hello', Count: 42 })).not.toThrow();
    expect(() => handle.update('test_items', { my_value: 'updated' }, '_id = ?', ['1'])).not.toThrow();

    mgr.closeVault(record.id);
  });
});
