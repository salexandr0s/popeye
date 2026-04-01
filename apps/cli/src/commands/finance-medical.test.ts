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
    const insertMedicalDocument = vi.fn().mockResolvedValue({ id: 'doc-1' });
    const updateMedicalImportStatus = vi.fn().mockResolvedValue(undefined);
    const client = {
      listVaults: vi.fn().mockResolvedValue([
        { ...makeVault('old-medical', '2026-03-01T00:00:00.000Z'), domain: 'medical' },
        { ...makeVault('new-medical', '2026-04-01T00:00:00.000Z'), domain: 'medical' },
      ]),
      createMedicalImport,
      insertMedicalDocument,
      updateMedicalImportStatus,
    };

    await handleMedical(makeCtx(client, 'import', filePath));

    expect(client.listVaults).toHaveBeenCalledWith('medical');
    expect(createMedicalImport).toHaveBeenCalledWith({
      vaultId: 'new-medical',
      importType: 'pdf',
      fileName: 'sample.pdf',
    });
    expect(insertMedicalDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        importId: 'med-1',
        fileName: 'sample.pdf',
        mimeType: 'application/pdf',
      }),
    );
    expect(updateMedicalImportStatus).toHaveBeenCalledWith('med-1', 'completed');
  });

  it('finance digest --generate calls the digest generation API', async () => {
    process.argv = ['node', 'pop', 'finance', 'digest', '--period', '2026-03', '--generate'];
    const generateFinanceDigest = vi.fn().mockResolvedValue({
      id: 'fd-1',
      period: '2026-03',
      totalIncome: 4200,
      totalExpenses: 84.12,
      categoryBreakdown: { groceries: -84.12 },
      anomalyFlags: [],
      generatedAt: '2026-04-01T00:00:00.000Z',
    });

    await handleFinance(makeCtx({ generateFinanceDigest }, 'digest'));

    expect(generateFinanceDigest).toHaveBeenCalledWith('2026-03');
  });

  it('medical digest --generate calls the digest generation API', async () => {
    process.argv = ['node', 'pop', 'medical', 'digest', '--period', '2026-03', '--generate'];
    const generateMedicalDigest = vi.fn().mockResolvedValue({
      id: 'md-1',
      period: '2026-03',
      appointmentCount: 1,
      activeMedications: 1,
      summary: 'Digest summary',
      generatedAt: '2026-04-01T00:00:00.000Z',
    });

    await handleMedical(makeCtx({ generateMedicalDigest }, 'digest'));

    expect(generateMedicalDigest).toHaveBeenCalledWith('2026-03');
  });

  it('medical add-appointment creates a structured appointment record', async () => {
    process.argv = ['node', 'pop', 'medical', 'add-appointment', 'imp-1', '--date', '2026-03-10', '--provider', 'Dr. Smith', '--specialty', 'cardiology', '--location', 'Vienna', '--summary', 'Follow-up'];
    const insertMedicalAppointment = vi.fn().mockResolvedValue({
      id: 'appt-1',
      importId: 'imp-1',
      date: '2026-03-10',
      provider: 'Dr. Smith',
      specialty: 'cardiology',
      location: 'Vienna',
      redactedSummary: 'Follow-up',
    });

    await handleMedical(makeCtx({ insertMedicalAppointment }, 'add-appointment', 'imp-1'));

    expect(insertMedicalAppointment).toHaveBeenCalledWith({
      importId: 'imp-1',
      date: '2026-03-10',
      provider: 'Dr. Smith',
      specialty: 'cardiology',
      location: 'Vienna',
      redactedSummary: 'Follow-up',
    });
  });

  it('medical add-medication creates a structured medication record', async () => {
    process.argv = ['node', 'pop', 'medical', 'add-medication', 'imp-1', 'Metformin', '--dosage', '500mg', '--frequency', 'twice daily', '--prescriber', 'Dr. Smith', '--start-date', '2026-03-10', '--summary', 'Blood sugar management'];
    const insertMedicalMedication = vi.fn().mockResolvedValue({
      id: 'med-1',
      importId: 'imp-1',
      name: 'Metformin',
      dosage: '500mg',
      frequency: 'twice daily',
      prescriber: 'Dr. Smith',
      startDate: '2026-03-10',
      endDate: null,
      redactedSummary: 'Blood sugar management',
    });

    await handleMedical({
      ...makeCtx({ insertMedicalMedication }, 'add-medication', 'imp-1'),
      arg2: 'Metformin',
    });

    expect(insertMedicalMedication).toHaveBeenCalledWith({
      importId: 'imp-1',
      name: 'Metformin',
      dosage: '500mg',
      frequency: 'twice daily',
      prescriber: 'Dr. Smith',
      startDate: '2026-03-10',
      endDate: null,
      redactedSummary: 'Blood sugar management',
    });
  });
});
