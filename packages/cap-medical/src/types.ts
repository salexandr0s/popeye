export { type CapabilityDb, prepareGet, prepareAll, prepareRun } from '@popeye/cap-common';
import type { CapabilityDb } from '@popeye/cap-common';

export interface MedicalImportRow {
  id: string;
  vault_id: string;
  import_type: string;
  file_name: string;
  status: string;
  imported_at: string;
}

export interface MedicalAppointmentRow {
  id: string;
  import_id: string;
  date: string;
  provider: string;
  specialty: string | null;
  location: string | null;
  redacted_summary: string;
}

export interface MedicalMedicationRow {
  id: string;
  import_id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  prescriber: string | null;
  start_date: string | null;
  end_date: string | null;
  redacted_summary: string;
}

export interface MedicalDocumentRow {
  id: string;
  import_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  redacted_summary: string;
}

export interface MedicalDigestRow {
  id: string;
  period: string;
  appointment_count: number;
  active_medications: number;
  summary: string;
  generated_at: string;
}

/** @deprecated Use CapabilityDb from @popeye/cap-common */
export type MedicalCapabilityDb = CapabilityDb;
