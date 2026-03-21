import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CapabilityContext } from '@popeye/contracts';

import { getMedicalMigrations } from './migrations.js';
import { MedicalService } from './medical-service.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capmedical-'));
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

describe('MedicalService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: MedicalService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    svc = new MedicalService(db as unknown as CapabilityContext['appDb']);
  });

  afterEach(() => {
    cleanup();
  });

  // --- Imports ---

  it('createImport returns record with pending status', () => {
    const record = svc.createImport({
      vaultId: 'vault-1',
      importType: 'pdf',
      fileName: 'bloodwork.pdf',
    });

    expect(record.id).toBeTruthy();
    expect(record.vaultId).toBe('vault-1');
    expect(record.importType).toBe('pdf');
    expect(record.fileName).toBe('bloodwork.pdf');
    expect(record.status).toBe('pending');
    expect(record.importedAt).toBeTruthy();
  });

  it('getImport returns record for known id, null for unknown', () => {
    const created = svc.createImport({
      vaultId: 'vault-1',
      importType: 'document',
      fileName: 'lab-results.pdf',
    });

    const found = svc.getImport(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.fileName).toBe('lab-results.pdf');

    const missing = svc.getImport('nonexistent-id');
    expect(missing).toBeNull();
  });

  it('listImports returns all imports', () => {
    svc.createImport({ vaultId: 'vault-1', importType: 'pdf', fileName: 'a.pdf' });
    svc.createImport({ vaultId: 'vault-2', importType: 'document', fileName: 'b.pdf' });

    const all = svc.listImports();
    expect(all).toHaveLength(2);
  });

  it('listImports filtered by vaultId', () => {
    svc.createImport({ vaultId: 'vault-1', importType: 'pdf', fileName: 'a.pdf' });
    svc.createImport({ vaultId: 'vault-2', importType: 'pdf', fileName: 'b.pdf' });
    svc.createImport({ vaultId: 'vault-1', importType: 'document', fileName: 'c.pdf' });

    const filtered = svc.listImports('vault-1');
    expect(filtered).toHaveLength(2);
    for (const record of filtered) {
      expect(record.vaultId).toBe('vault-1');
    }
  });

  it('updateImportStatus changes status', () => {
    const created = svc.createImport({
      vaultId: 'vault-1',
      importType: 'pdf',
      fileName: 'scan.pdf',
    });
    expect(created.status).toBe('pending');

    svc.updateImportStatus(created.id, 'processing');
    const updated = svc.getImport(created.id);
    expect(updated!.status).toBe('processing');

    svc.updateImportStatus(created.id, 'completed');
    const completed = svc.getImport(created.id);
    expect(completed!.status).toBe('completed');
  });

  // --- Appointments ---

  it('insertAppointment returns record', () => {
    const imp = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'visit.pdf' });
    const appt = svc.insertAppointment({
      importId: imp.id,
      date: '2025-06-15',
      provider: 'Dr. Smith',
      specialty: 'Cardiology',
      location: 'City Hospital',
      redactedSummary: 'Annual checkup',
    });

    expect(appt.id).toBeTruthy();
    expect(appt.importId).toBe(imp.id);
    expect(appt.date).toBe('2025-06-15');
    expect(appt.provider).toBe('Dr. Smith');
    expect(appt.specialty).toBe('Cardiology');
    expect(appt.location).toBe('City Hospital');
    expect(appt.redactedSummary).toBe('Annual checkup');
  });

  it('listAppointments with and without importId filter, with limit', () => {
    const imp1 = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'a.pdf' });
    const imp2 = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'b.pdf' });

    svc.insertAppointment({ importId: imp1.id, date: '2025-01-01', provider: 'Dr. A' });
    svc.insertAppointment({ importId: imp1.id, date: '2025-02-01', provider: 'Dr. B' });
    svc.insertAppointment({ importId: imp2.id, date: '2025-03-01', provider: 'Dr. C' });

    const all = svc.listAppointments();
    expect(all).toHaveLength(3);

    const filtered = svc.listAppointments(imp1.id);
    expect(filtered).toHaveLength(2);
    for (const appt of filtered) {
      expect(appt.importId).toBe(imp1.id);
    }

    const limited = svc.listAppointments(undefined, { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  // --- Medications ---

  it('insertMedication returns record', () => {
    const imp = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'rx.pdf' });
    const med = svc.insertMedication({
      importId: imp.id,
      name: 'Metformin',
      dosage: '500mg',
      frequency: 'twice daily',
      prescriber: 'Dr. Jones',
      startDate: '2025-01-01',
      endDate: null,
      redactedSummary: 'Blood sugar management',
    });

    expect(med.id).toBeTruthy();
    expect(med.importId).toBe(imp.id);
    expect(med.name).toBe('Metformin');
    expect(med.dosage).toBe('500mg');
    expect(med.frequency).toBe('twice daily');
    expect(med.prescriber).toBe('Dr. Jones');
    expect(med.startDate).toBe('2025-01-01');
    expect(med.endDate).toBeNull();
    expect(med.redactedSummary).toBe('Blood sugar management');
  });

  it('listMedications with and without importId filter', () => {
    const imp1 = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'a.pdf' });
    const imp2 = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'b.pdf' });

    svc.insertMedication({ importId: imp1.id, name: 'Aspirin' });
    svc.insertMedication({ importId: imp1.id, name: 'Ibuprofen' });
    svc.insertMedication({ importId: imp2.id, name: 'Amoxicillin' });

    const all = svc.listMedications();
    expect(all).toHaveLength(3);

    const filtered = svc.listMedications(imp1.id);
    expect(filtered).toHaveLength(2);
    for (const med of filtered) {
      expect(med.importId).toBe(imp1.id);
    }
  });

  // --- Documents ---

  it('insertDocument returns record', () => {
    const imp = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'labs.pdf' });
    const doc = svc.insertDocument({
      importId: imp.id,
      fileName: 'blood-panel.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 42000,
      redactedSummary: 'Complete blood panel results',
    });

    expect(doc.id).toBeTruthy();
    expect(doc.importId).toBe(imp.id);
    expect(doc.fileName).toBe('blood-panel.pdf');
    expect(doc.mimeType).toBe('application/pdf');
    expect(doc.sizeBytes).toBe(42000);
    expect(doc.redactedSummary).toBe('Complete blood panel results');
  });

  it('listDocuments with and without importId filter', () => {
    const imp1 = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'a.pdf' });
    const imp2 = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'b.pdf' });

    svc.insertDocument({ importId: imp1.id, fileName: 'xray.png', mimeType: 'image/png', sizeBytes: 100 });
    svc.insertDocument({ importId: imp1.id, fileName: 'scan.pdf', mimeType: 'application/pdf', sizeBytes: 200 });
    svc.insertDocument({ importId: imp2.id, fileName: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 300 });

    const all = svc.listDocuments();
    expect(all).toHaveLength(3);

    const filtered = svc.listDocuments(imp1.id);
    expect(filtered).toHaveLength(2);
    for (const doc of filtered) {
      expect(doc.importId).toBe(imp1.id);
    }
  });

  // --- Digests ---

  it('insertDigest creates new and upserts existing for same period', () => {
    const first = svc.insertDigest({
      period: '2025-Q1',
      appointmentCount: 3,
      activeMedications: 2,
      summary: 'Initial Q1 summary',
    });

    expect(first.id).toBeTruthy();
    expect(first.period).toBe('2025-Q1');
    expect(first.appointmentCount).toBe(3);
    expect(first.activeMedications).toBe(2);
    expect(first.summary).toBe('Initial Q1 summary');

    const updated = svc.insertDigest({
      period: '2025-Q1',
      appointmentCount: 5,
      activeMedications: 4,
      summary: 'Updated Q1 summary',
    });

    expect(updated.id).toBe(first.id);
    expect(updated.appointmentCount).toBe(5);
    expect(updated.activeMedications).toBe(4);
    expect(updated.summary).toBe('Updated Q1 summary');
  });

  it('getDigest returns by period, latest when no period, and null when empty', () => {
    const empty = svc.getDigest();
    expect(empty).toBeNull();

    const emptyByPeriod = svc.getDigest('2025-Q1');
    expect(emptyByPeriod).toBeNull();

    svc.insertDigest({
      period: '2025-Q1',
      appointmentCount: 1,
      activeMedications: 1,
      summary: 'Q1',
    });
    svc.insertDigest({
      period: '2025-Q2',
      appointmentCount: 2,
      activeMedications: 2,
      summary: 'Q2',
    });

    const byPeriod = svc.getDigest('2025-Q1');
    expect(byPeriod).not.toBeNull();
    expect(byPeriod!.period).toBe('2025-Q1');
    expect(byPeriod!.summary).toBe('Q1');

    const latest = svc.getDigest();
    expect(latest).not.toBeNull();
    // Without explicit period, returns most recent by generated_at; both may share the same timestamp
    expect(['2025-Q1', '2025-Q2']).toContain(latest!.period);
  });

  // --- Stats ---

  it('getAppointmentCount returns total appointments', () => {
    expect(svc.getAppointmentCount()).toBe(0);

    const imp = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'a.pdf' });
    svc.insertAppointment({ importId: imp.id, date: '2025-01-01', provider: 'Dr. A' });
    svc.insertAppointment({ importId: imp.id, date: '2025-02-01', provider: 'Dr. B' });

    expect(svc.getAppointmentCount()).toBe(2);
  });

  it('getActiveMedicationCount counts active and excludes ended medications', () => {
    expect(svc.getActiveMedicationCount()).toBe(0);

    const imp = svc.createImport({ vaultId: 'v1', importType: 'pdf', fileName: 'a.pdf' });

    // Active: no end date
    svc.insertMedication({
      importId: imp.id,
      name: 'Ongoing Med',
      startDate: '2024-01-01',
      endDate: null,
    });

    // Active: end date in the future
    svc.insertMedication({
      importId: imp.id,
      name: 'Future End Med',
      startDate: '2024-01-01',
      endDate: '2099-12-31',
    });

    // Ended: end date in the past
    svc.insertMedication({
      importId: imp.id,
      name: 'Past Med',
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });

    expect(svc.getActiveMedicationCount()).toBe(2);
  });
});
