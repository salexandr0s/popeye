import type { CapabilityContext } from '@popeye/contracts';

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

export type MedicalCapabilityDb = CapabilityContext['appDb'];

// --- Typed DB helpers ---

interface PreparedStatement<TRow> {
  get(...args: unknown[]): TRow | undefined;
  all(...args: unknown[]): TRow[];
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export function prepareGet<TRow>(db: MedicalCapabilityDb, sql: string): (...args: unknown[]) => TRow | undefined {
  const stmt = (db.prepare as (input: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.get(...args);
}

export function prepareAll<TRow>(db: MedicalCapabilityDb, sql: string): (...args: unknown[]) => TRow[] {
  const stmt = (db.prepare as (input: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.all(...args);
}

export function prepareRun(db: MedicalCapabilityDb, sql: string): (...args: unknown[]) => { changes: number } {
  const stmt = (db.prepare as (input: string) => PreparedStatement<never>)(sql);
  return (...args: unknown[]) => ({ changes: stmt.run(...args).changes });
}
