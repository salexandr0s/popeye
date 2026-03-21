import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CapabilityContext } from '@popeye/contracts';

import { getMedicalMigrations } from './migrations.js';
import { MedicalService } from './medical-service.js';
import { MedicalSearchService } from './search-service.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capmedical-search-'));
  const db = new Database(join(dir, 'medical.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
  const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
  const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of getMedicalMigrations()) {
    if (getMigration.get(migration.id)) continue;
    const tx = db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      addMigration.run(migration.id, new Date().toISOString());
    });
    tx();
  }

  return { db, cleanup: () => db.close() };
}

describe('MedicalSearchService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let medSvc: MedicalService;
  let searchSvc: MedicalSearchService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    const dbHandle = db as unknown as CapabilityContext['appDb'];
    medSvc = new MedicalService(dbHandle);
    searchSvc = new MedicalSearchService(dbHandle);
  });

  afterEach(() => {
    cleanup();
  });

  function seedData() {
    const imp = medSvc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'records.pdf' });
    medSvc.insertAppointment({
      importId: imp.id,
      date: '2025-03-10',
      provider: 'Dr. Martinez',
      specialty: 'Dermatology',
      redactedSummary: 'Skin examination and mole check',
    });
    medSvc.insertMedication({
      importId: imp.id,
      name: 'Lisinopril',
      dosage: '10mg',
      prescriber: 'Dr. Nguyen',
      startDate: '2025-01-01',
      redactedSummary: 'Blood pressure management',
    });
    medSvc.insertDocument({
      importId: imp.id,
      fileName: 'ecg-report-2025.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 15000,
      redactedSummary: 'Electrocardiogram normal sinus rhythm',
    });
    return imp;
  }

  it('search by provider name matches appointment', () => {
    seedData();
    const result = searchSvc.search('martinez');

    expect(result.query).toBe('martinez');
    expect(result.results.length).toBeGreaterThanOrEqual(1);

    const apptMatch = result.results.find((r) => r.recordType === 'appointment');
    expect(apptMatch).toBeTruthy();
    expect(apptMatch!.recordId).toBeTruthy();
    expect(apptMatch!.date).toBe('2025-03-10');
  });

  it('search by medication name matches medication', () => {
    seedData();
    const result = searchSvc.search('lisinopril');

    expect(result.results.length).toBeGreaterThanOrEqual(1);

    const medMatch = result.results.find((r) => r.recordType === 'medication');
    expect(medMatch).toBeTruthy();
    expect(medMatch!.recordId).toBeTruthy();
  });

  it('search by document file_name matches document', () => {
    seedData();
    const result = searchSvc.search('ecg-report');

    expect(result.results.length).toBeGreaterThanOrEqual(1);

    const docMatch = result.results.find((r) => r.recordType === 'document');
    expect(docMatch).toBeTruthy();
    expect(docMatch!.recordId).toBeTruthy();
  });

  it('results sorted by score descending', () => {
    const imp = medSvc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'test.pdf' });

    // Exact name match should score highest
    medSvc.insertMedication({
      importId: imp.id,
      name: 'Aspirin',
      redactedSummary: 'Pain management with aspirin tablets',
    });

    // Partial match in summary only
    medSvc.insertAppointment({
      importId: imp.id,
      date: '2025-05-01',
      provider: 'Dr. Wilson',
      redactedSummary: 'Discussed aspirin dosage adjustment',
    });

    const result = searchSvc.search('aspirin');
    expect(result.results.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < result.results.length; i++) {
      expect(result.results[i - 1]!.score).toBeGreaterThanOrEqual(result.results[i]!.score);
    }
  });

  it('empty result for unmatched query', () => {
    seedData();
    const result = searchSvc.search('zzzznonexistent');

    expect(result.query).toBe('zzzznonexistent');
    expect(result.results).toHaveLength(0);
  });

  it('limit restricts the number of results', () => {
    const imp = medSvc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'bulk.pdf' });

    for (let i = 0; i < 5; i++) {
      medSvc.insertMedication({
        importId: imp.id,
        name: `TestDrug-${i}`,
        redactedSummary: 'Common treatment note',
      });
    }

    const unlimited = searchSvc.search('testdrug');
    expect(unlimited.results.length).toBe(5);

    const limited = searchSvc.search('testdrug', 2);
    expect(limited.results.length).toBe(2);
  });
});
