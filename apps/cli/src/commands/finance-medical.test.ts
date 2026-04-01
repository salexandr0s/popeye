import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VaultRecord } from '@popeye/contracts';
import type { CommandContext } from '../formatters.js';
import { handleFinance } from './finance.js';
import { handleMedical } from './medical.js';

function makeVault(id: string, createdAt: string): VaultRecord {
  return {
    id,
    domain: 'finance',
    kind: 'restricted',
    dbPath: `/tmp/${id}.db`,
    encrypted: true,
    encryptionKeyRef: 'keychain:vault-kek',
    status: 'closed',
    createdAt,
    lastAccessedAt: null,
  };
}

function makeCtx(client: object, subcommand: string, arg1?: string): CommandContext {
  return {
    client: client as CommandContext['client'],
    subcommand,
    arg1,
    arg2: undefined,
    jsonFlag: false,
    positionalArgs: [],
  };
}

describe('finance/medical CLI vault targeting', () => {
  const originalArgv = process.argv.slice();

  afterEach(() => {
    process.argv = originalArgv.slice();
    vi.restoreAllMocks();
  });

  it('finance import defaults to the newest vault and completes CSV ingest', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'popeye-finance-import-'));
    const csvPath = join(tmp, 'sample.csv');
    writeFileSync(csvPath, 'date,description,amount,category\n2026-03-03,Groceries,-84.12,groceries\n', 'utf8');
    process.argv = ['node', 'pop'];

    const createFinanceImport = vi.fn().mockResolvedValue({ id: 'imp-1' });
    const insertFinanceTransactionBatch = vi.fn().mockResolvedValue(undefined);
    const updateFinanceImportStatus = vi.fn().mockResolvedValue(undefined);
    const client = {
      listVaults: vi.fn().mockResolvedValue([
        makeVault('old-vault', '2026-03-01T00:00:00.000Z'),
        makeVault('new-vault', '2026-04-01T00:00:00.000Z'),
      ]),
      createFinanceImport,
      insertFinanceTransactionBatch,
      updateFinanceImportStatus,
    };

    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await handleFinance(makeCtx(client, 'import', csvPath));

    expect(client.listVaults).toHaveBeenCalledWith('finance');
    expect(createFinanceImport).toHaveBeenCalledWith({
      vaultId: 'new-vault',
      importType: 'csv',
      fileName: 'sample.csv',
    });
    expect(insertFinanceTransactionBatch).toHaveBeenCalledWith({
      importId: 'imp-1',
      transactions: [
        {
          date: '2026-03-03',
          description: 'Groceries',
          amount: -84.12,
          category: 'groceries',
        },
      ],
    });
    expect(updateFinanceImportStatus).toHaveBeenCalledWith('imp-1', 'completed', 1);
    expect(info).toHaveBeenCalledWith('Imported 1 transactions from sample.csv');
  });

  it('finance import with --vault still performs CSV ingest for the explicit vault', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'popeye-finance-import-explicit-'));
    const csvPath = join(tmp, 'sample.csv');
    writeFileSync(csvPath, 'date,description,amount\n2026-03-01,Payroll,3200\n', 'utf8');
    process.argv = ['node', 'pop', 'finance', 'import', csvPath, '--vault', 'explicit-vault'];

    const createFinanceImport = vi.fn().mockResolvedValue({ id: 'imp-2' });
    const insertFinanceTransactionBatch = vi.fn().mockResolvedValue(undefined);
    const updateFinanceImportStatus = vi.fn().mockResolvedValue(undefined);
    const client = {
      listVaults: vi.fn(),
      createFinanceImport,
      insertFinanceTransactionBatch,
      updateFinanceImportStatus,
    };

    await handleFinance(makeCtx(client, 'import', csvPath));

    expect(client.listVaults).not.toHaveBeenCalled();
    expect(createFinanceImport).toHaveBeenCalledWith({
      vaultId: 'explicit-vault',
      importType: 'csv',
      fileName: 'sample.csv',
    });
    expect(insertFinanceTransactionBatch).toHaveBeenCalledWith({
      importId: 'imp-2',
      transactions: [
        {
          date: '2026-03-01',
          description: 'Payroll',
          amount: 3200,
          category: null,
        },
      ],
    });
    expect(updateFinanceImportStatus).toHaveBeenCalledWith('imp-2', 'completed', 1);
  });

  it('medical import defaults to the newest vault', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'popeye-medical-import-'));
    const filePath = join(tmp, 'sample.pdf');
    writeFileSync(filePath, 'pdf', 'utf8');
    process.argv = ['node', 'pop'];

    const createMedicalImport = vi.fn().mockResolvedValue({ id: 'med-1' });
    const client = {
      listVaults: vi.fn().mockResolvedValue([
        { ...makeVault('old-medical', '2026-03-01T00:00:00.000Z'), domain: 'medical' },
        { ...makeVault('new-medical', '2026-04-01T00:00:00.000Z'), domain: 'medical' },
      ]),
      createMedicalImport,
    };

    await handleMedical(makeCtx(client, 'import', filePath));

    expect(client.listVaults).toHaveBeenCalledWith('medical');
    expect(createMedicalImport).toHaveBeenCalledWith({
      vaultId: 'new-medical',
      importType: 'pdf',
      fileName: 'sample.pdf',
    });
  });
});
