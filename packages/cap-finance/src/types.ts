import type { CapabilityContext } from '@popeye/contracts';

export interface FinanceImportRow {
  id: string;
  vault_id: string;
  import_type: string;
  file_name: string;
  status: string;
  record_count: number;
  imported_at: string;
}

export interface FinanceTransactionRow {
  id: string;
  import_id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  category: string | null;
  merchant_name: string | null;
  account_label: string | null;
  redacted_summary: string;
}

export interface FinanceDocumentRow {
  id: string;
  import_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  redacted_summary: string;
}

export interface FinanceDigestRow {
  id: string;
  period: string;
  total_income: number;
  total_expenses: number;
  category_breakdown: string; // JSON object
  anomaly_flags: string; // JSON array
  generated_at: string;
}

export type FinanceCapabilityDb = CapabilityContext['appDb'];

// --- Typed DB helpers ---

interface PreparedStatement<TRow> {
  get(...args: unknown[]): TRow | undefined;
  all(...args: unknown[]): TRow[];
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export function prepareGet<TRow>(db: FinanceCapabilityDb, sql: string): (...args: unknown[]) => TRow | undefined {
  const stmt = (db.prepare as (input: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.get(...args);
}

export function prepareAll<TRow>(db: FinanceCapabilityDb, sql: string): (...args: unknown[]) => TRow[] {
  const stmt = (db.prepare as (input: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.all(...args);
}

export function prepareRun(db: FinanceCapabilityDb, sql: string): (...args: unknown[]) => { changes: number } {
  const stmt = (db.prepare as (input: string) => PreparedStatement<never>)(sql);
  return (...args: unknown[]) => ({ changes: stmt.run(...args).changes });
}
