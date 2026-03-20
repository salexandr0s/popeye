import { randomUUID } from 'node:crypto';

import type {
  FinanceImportRecord,
  FinanceTransactionRecord,
  FinanceDocumentRecord,
  FinanceDigestRecord,
  FinanceAnomalyFlag,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type {
  FinanceCapabilityDb,
  FinanceImportRow,
  FinanceTransactionRow,
  FinanceDocumentRow,
  FinanceDigestRow,
} from './types.js';
import { prepareGet, prepareAll, prepareRun } from './types.js';

// --- Row mappers ---

function parseJsonObject(json: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'number') result[key] = value;
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

function parseAnomalyFlags(json: string): FinanceAnomalyFlag[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is FinanceAnomalyFlag =>
      typeof item === 'object'
      && item !== null
      && typeof (item as Record<string, unknown>).description === 'string'
      && typeof (item as Record<string, unknown>).severity === 'string',
    );
  } catch {
    return [];
  }
}

const VALID_IMPORT_STATUS = new Set(['pending', 'processing', 'completed', 'failed']);

function mapImportRow(row: FinanceImportRow): FinanceImportRecord {
  return {
    id: row.id,
    vaultId: row.vault_id,
    importType: row.import_type as FinanceImportRecord['importType'],
    fileName: row.file_name,
    status: VALID_IMPORT_STATUS.has(row.status)
      ? row.status as FinanceImportRecord['status']
      : 'pending',
    recordCount: row.record_count,
    importedAt: row.imported_at,
  };
}

function mapTransactionRow(row: FinanceTransactionRow): FinanceTransactionRecord {
  return {
    id: row.id,
    importId: row.import_id,
    date: row.date,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    category: row.category,
    merchantName: row.merchant_name,
    accountLabel: row.account_label,
    redactedSummary: row.redacted_summary,
  };
}

function mapDocumentRow(row: FinanceDocumentRow): FinanceDocumentRecord {
  return {
    id: row.id,
    importId: row.import_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    redactedSummary: row.redacted_summary,
  };
}

function mapDigestRow(row: FinanceDigestRow): FinanceDigestRecord {
  return {
    id: row.id,
    period: row.period,
    totalIncome: row.total_income,
    totalExpenses: row.total_expenses,
    categoryBreakdown: parseJsonObject(row.category_breakdown),
    anomalyFlags: parseAnomalyFlags(row.anomaly_flags),
    generatedAt: row.generated_at,
  };
}

// --- Service ---

export class FinanceService {
  constructor(private readonly db: FinanceCapabilityDb) {}

  // --- Imports ---

  listImports(vaultId?: string): FinanceImportRecord[] {
    if (vaultId) {
      const rows = prepareAll<FinanceImportRow>(this.db,
        'SELECT * FROM finance_imports WHERE vault_id = ? ORDER BY imported_at DESC',
      )(vaultId);
      return rows.map(mapImportRow);
    }
    const rows = prepareAll<FinanceImportRow>(this.db,
      'SELECT * FROM finance_imports ORDER BY imported_at DESC',
    )();
    return rows.map(mapImportRow);
  }

  getImport(id: string): FinanceImportRecord | null {
    const row = prepareGet<FinanceImportRow>(this.db,
      'SELECT * FROM finance_imports WHERE id = ?',
    )(id);
    return row ? mapImportRow(row) : null;
  }

  createImport(data: {
    vaultId: string;
    importType: FinanceImportRecord['importType'];
    fileName: string;
  }): FinanceImportRecord {
    const id = randomUUID();
    const now = nowIso();
    prepareRun(this.db,
      `INSERT INTO finance_imports (id, vault_id, import_type, file_name, status, record_count, imported_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?)`,
    )(id, data.vaultId, data.importType, data.fileName, now);
    const result = this.getImport(id);
    if (!result) throw new Error('Failed to create finance import');
    return result;
  }

  updateImportStatus(id: string, status: FinanceImportRecord['status'], recordCount?: number): void {
    if (recordCount !== undefined) {
      prepareRun(this.db,
        'UPDATE finance_imports SET status = ?, record_count = ? WHERE id = ?',
      )(status, recordCount, id);
    } else {
      prepareRun(this.db,
        'UPDATE finance_imports SET status = ? WHERE id = ?',
      )(status, id);
    }
  }

  // --- Transactions ---

  listTransactions(importId?: string, options: {
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    category?: string | undefined;
    limit?: number | undefined;
  } = {}): FinanceTransactionRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (importId) {
      clauses.push('import_id = ?');
      params.push(importId);
    }
    if (options.dateFrom) {
      clauses.push('date >= ?');
      params.push(options.dateFrom);
    }
    if (options.dateTo) {
      clauses.push('date <= ?');
      params.push(options.dateTo);
    }
    if (options.category) {
      clauses.push('category = ?');
      params.push(options.category);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = options.limit ?? 50;
    const rows = prepareAll<FinanceTransactionRow>(this.db,
      `SELECT * FROM finance_transactions ${where} ORDER BY date DESC LIMIT ?`,
    )(...params, limit);
    return rows.map(mapTransactionRow);
  }

  getTransaction(id: string): FinanceTransactionRecord | null {
    const row = prepareGet<FinanceTransactionRow>(this.db,
      'SELECT * FROM finance_transactions WHERE id = ?',
    )(id);
    return row ? mapTransactionRow(row) : null;
  }

  insertTransaction(data: {
    importId: string;
    date: string;
    description: string;
    amount: number;
    currency?: string;
    category?: string | null;
    merchantName?: string | null;
    accountLabel?: string | null;
    redactedSummary?: string;
  }): FinanceTransactionRecord {
    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO finance_transactions (id, import_id, date, description, amount, currency, category, merchant_name, account_label, redacted_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(
      id, data.importId, data.date, data.description, data.amount,
      data.currency ?? 'USD', data.category ?? null, data.merchantName ?? null,
      data.accountLabel ?? null, data.redactedSummary ?? '',
    );
    return this.getTransaction(id)!;
  }

  insertTransactionBatch(records: Array<{
    importId: string;
    date: string;
    description: string;
    amount: number;
    currency?: string;
    category?: string | null;
    merchantName?: string | null;
    accountLabel?: string | null;
    redactedSummary?: string;
  }>): FinanceTransactionRecord[] {
    const dbUnknown = this.db as unknown as { transaction: (fn: () => FinanceTransactionRecord[]) => () => FinanceTransactionRecord[] };
    const txn = dbUnknown.transaction(() => {
      return records.map((data) => this.insertTransaction(data));
    });
    return txn();
  }

  // --- Documents ---

  listDocuments(importId?: string): FinanceDocumentRecord[] {
    if (importId) {
      const rows = prepareAll<FinanceDocumentRow>(this.db,
        'SELECT * FROM finance_documents WHERE import_id = ? ORDER BY file_name',
      )(importId);
      return rows.map(mapDocumentRow);
    }
    const rows = prepareAll<FinanceDocumentRow>(this.db,
      'SELECT * FROM finance_documents ORDER BY file_name',
    )();
    return rows.map(mapDocumentRow);
  }

  insertDocument(data: {
    importId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    redactedSummary?: string;
  }): FinanceDocumentRecord {
    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO finance_documents (id, import_id, file_name, mime_type, size_bytes, redacted_summary)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )(id, data.importId, data.fileName, data.mimeType, data.sizeBytes, data.redactedSummary ?? '');
    const row = prepareGet<FinanceDocumentRow>(this.db,
      'SELECT * FROM finance_documents WHERE id = ?',
    )(id);
    if (!row) throw new Error('Failed to insert finance document');
    return mapDocumentRow(row);
  }

  // --- Digests ---

  getDigest(period?: string): FinanceDigestRecord | null {
    if (period) {
      const row = prepareGet<FinanceDigestRow>(this.db,
        'SELECT * FROM finance_digests WHERE period = ?',
      )(period);
      return row ? mapDigestRow(row) : null;
    }
    const row = prepareGet<FinanceDigestRow>(this.db,
      'SELECT * FROM finance_digests ORDER BY generated_at DESC LIMIT 1',
    )();
    return row ? mapDigestRow(row) : null;
  }

  insertDigest(data: {
    period: string;
    totalIncome: number;
    totalExpenses: number;
    categoryBreakdown: Record<string, number>;
    anomalyFlags: FinanceAnomalyFlag[];
  }): FinanceDigestRecord {
    const now = nowIso();
    const existing = prepareGet<FinanceDigestRow>(this.db,
      'SELECT * FROM finance_digests WHERE period = ?',
    )(data.period);

    if (existing) {
      prepareRun(this.db,
        `UPDATE finance_digests SET total_income = ?, total_expenses = ?,
         category_breakdown = ?, anomaly_flags = ?, generated_at = ? WHERE id = ?`,
      )(
        data.totalIncome, data.totalExpenses,
        JSON.stringify(data.categoryBreakdown), JSON.stringify(data.anomalyFlags),
        now, existing.id,
      );
      return this.getDigest(data.period)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO finance_digests (id, period, total_income, total_expenses, category_breakdown, anomaly_flags, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )(
      id, data.period, data.totalIncome, data.totalExpenses,
      JSON.stringify(data.categoryBreakdown), JSON.stringify(data.anomalyFlags), now,
    );
    return this.getDigest(data.period)!;
  }

  // --- Stats ---

  getTransactionCount(importId?: string): number {
    if (importId) {
      const result = prepareGet<{ cnt: number }>(this.db,
        'SELECT COUNT(*) as cnt FROM finance_transactions WHERE import_id = ?',
      )(importId);
      return result?.cnt ?? 0;
    }
    const result = prepareGet<{ cnt: number }>(this.db,
      'SELECT COUNT(*) as cnt FROM finance_transactions',
    )();
    return result?.cnt ?? 0;
  }

  getTotalByCategory(dateFrom?: string, dateTo?: string): Record<string, number> {
    const clauses: string[] = ['category IS NOT NULL'];
    const params: unknown[] = [];
    if (dateFrom) {
      clauses.push('date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      clauses.push('date <= ?');
      params.push(dateTo);
    }

    const rows = prepareAll<{ category: string; total: number }>(this.db,
      `SELECT category, SUM(amount) as total FROM finance_transactions
       WHERE ${clauses.join(' AND ')} GROUP BY category ORDER BY total ASC`,
    )(...params);

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.category] = row.total;
    }
    return result;
  }
}
