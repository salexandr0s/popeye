import { randomUUID } from 'node:crypto';

import type {
  MedicalImportRecord,
  MedicalAppointmentRecord,
  MedicalMedicationRecord,
  MedicalDocumentRecord,
  MedicalDigestRecord,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type {
  MedicalCapabilityDb,
  MedicalImportRow,
  MedicalAppointmentRow,
  MedicalMedicationRow,
  MedicalDocumentRow,
  MedicalDigestRow,
} from './types.js';
import { prepareGet, prepareAll, prepareRun } from './types.js';

// --- Row mappers ---

function mapImportRow(row: MedicalImportRow): MedicalImportRecord {
  return {
    id: row.id,
    vaultId: row.vault_id,
    importType: row.import_type as MedicalImportRecord['importType'],
    fileName: row.file_name,
    status: row.status as MedicalImportRecord['status'],
    importedAt: row.imported_at,
  };
}

function mapAppointmentRow(row: MedicalAppointmentRow): MedicalAppointmentRecord {
  return {
    id: row.id,
    importId: row.import_id,
    date: row.date,
    provider: row.provider,
    specialty: row.specialty,
    location: row.location,
    redactedSummary: row.redacted_summary,
  };
}

function mapMedicationRow(row: MedicalMedicationRow): MedicalMedicationRecord {
  return {
    id: row.id,
    importId: row.import_id,
    name: row.name,
    dosage: row.dosage,
    frequency: row.frequency,
    prescriber: row.prescriber,
    startDate: row.start_date,
    endDate: row.end_date,
    redactedSummary: row.redacted_summary,
  };
}

function mapDocumentRow(row: MedicalDocumentRow): MedicalDocumentRecord {
  return {
    id: row.id,
    importId: row.import_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    redactedSummary: row.redacted_summary,
  };
}

function mapDigestRow(row: MedicalDigestRow): MedicalDigestRecord {
  return {
    id: row.id,
    period: row.period,
    appointmentCount: row.appointment_count,
    activeMedications: row.active_medications,
    summary: row.summary,
    generatedAt: row.generated_at,
  };
}

// --- Service ---

export class MedicalService {
  constructor(private readonly db: MedicalCapabilityDb) {}

  // --- Imports ---

  listImports(vaultId?: string): MedicalImportRecord[] {
    if (vaultId) {
      const rows = prepareAll<MedicalImportRow>(this.db,
        'SELECT * FROM medical_imports WHERE vault_id = ? ORDER BY imported_at DESC',
      )(vaultId);
      return rows.map(mapImportRow);
    }
    const rows = prepareAll<MedicalImportRow>(this.db,
      'SELECT * FROM medical_imports ORDER BY imported_at DESC',
    )();
    return rows.map(mapImportRow);
  }

  getImport(id: string): MedicalImportRecord | null {
    const row = prepareGet<MedicalImportRow>(this.db, 'SELECT * FROM medical_imports WHERE id = ?')(id);
    return row ? mapImportRow(row) : null;
  }

  createImport(data: {
    vaultId: string;
    importType: MedicalImportRecord['importType'];
    fileName: string;
  }): MedicalImportRecord {
    const id = randomUUID();
    const now = nowIso();
    prepareRun(this.db,
      `INSERT INTO medical_imports (id, vault_id, import_type, file_name, status, imported_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )(id, data.vaultId, data.importType, data.fileName, now);
    const result = this.getImport(id);
    if (!result) throw new Error('Failed to create medical import');
    return result;
  }

  // --- Appointments ---

  listAppointments(importId?: string, options: { limit?: number | undefined } = {}): MedicalAppointmentRecord[] {
    const limit = options.limit ?? 50;
    if (importId) {
      const rows = prepareAll<MedicalAppointmentRow>(this.db,
        'SELECT * FROM medical_appointments WHERE import_id = ? ORDER BY date DESC LIMIT ?',
      )(importId, limit);
      return rows.map(mapAppointmentRow);
    }
    const rows = prepareAll<MedicalAppointmentRow>(this.db,
      'SELECT * FROM medical_appointments ORDER BY date DESC LIMIT ?',
    )(limit);
    return rows.map(mapAppointmentRow);
  }

  // --- Medications ---

  listMedications(importId?: string): MedicalMedicationRecord[] {
    if (importId) {
      const rows = prepareAll<MedicalMedicationRow>(this.db,
        'SELECT * FROM medical_medications WHERE import_id = ? ORDER BY name ASC',
      )(importId);
      return rows.map(mapMedicationRow);
    }
    const rows = prepareAll<MedicalMedicationRow>(this.db,
      'SELECT * FROM medical_medications ORDER BY name ASC',
    )();
    return rows.map(mapMedicationRow);
  }

  // --- Documents ---

  listDocuments(importId?: string): MedicalDocumentRecord[] {
    if (importId) {
      const rows = prepareAll<MedicalDocumentRow>(this.db,
        'SELECT * FROM medical_documents WHERE import_id = ? ORDER BY file_name ASC',
      )(importId);
      return rows.map(mapDocumentRow);
    }
    const rows = prepareAll<MedicalDocumentRow>(this.db,
      'SELECT * FROM medical_documents ORDER BY file_name ASC',
    )();
    return rows.map(mapDocumentRow);
  }

  // --- Digests ---

  getDigest(period?: string): MedicalDigestRecord | null {
    if (period) {
      const row = prepareGet<MedicalDigestRow>(this.db,
        'SELECT * FROM medical_digests WHERE period = ?',
      )(period);
      return row ? mapDigestRow(row) : null;
    }
    const row = prepareGet<MedicalDigestRow>(this.db,
      'SELECT * FROM medical_digests ORDER BY generated_at DESC LIMIT 1',
    )();
    return row ? mapDigestRow(row) : null;
  }

  insertDigest(data: {
    period: string;
    appointmentCount: number;
    activeMedications: number;
    summary: string;
  }): MedicalDigestRecord {
    const now = nowIso();
    const existing = prepareGet<MedicalDigestRow>(this.db,
      'SELECT * FROM medical_digests WHERE period = ?',
    )(data.period);

    if (existing) {
      prepareRun(this.db,
        `UPDATE medical_digests SET appointment_count = ?, active_medications = ?,
         summary = ?, generated_at = ? WHERE id = ?`,
      )(data.appointmentCount, data.activeMedications, data.summary, now, existing.id);
      return this.getDigest(existing.period)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO medical_digests (id, period, appointment_count, active_medications, summary, generated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )(id, data.period, data.appointmentCount, data.activeMedications, data.summary, now);
    return this.getDigest(data.period)!;
  }

  // --- Stats ---

  getAppointmentCount(): number {
    const result = prepareGet<{ cnt: number }>(this.db,
      'SELECT COUNT(*) as cnt FROM medical_appointments',
    )();
    return result?.cnt ?? 0;
  }

  getActiveMedicationCount(): number {
    const result = prepareGet<{ cnt: number }>(this.db,
      'SELECT COUNT(*) as cnt FROM medical_medications WHERE end_date IS NULL OR end_date >= ?',
    )(nowIso().slice(0, 10));
    return result?.cnt ?? 0;
  }
}
