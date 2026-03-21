export { type CapabilityDb, prepareGet, prepareAll, prepareRun } from '@popeye/cap-common';
import type { CapabilityDb } from '@popeye/cap-common';

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

export type FinanceCapabilityDb = CapabilityDb;
