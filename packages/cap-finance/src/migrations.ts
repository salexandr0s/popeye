import type { CapabilityMigration } from '@popeye/cap-common';

export function getFinanceMigrations(): CapabilityMigration[] {
  return [
    {
      id: 'finance-001-imports',
      statements: [
        `CREATE TABLE IF NOT EXISTS finance_imports (
          id TEXT PRIMARY KEY,
          vault_id TEXT NOT NULL,
          import_type TEXT NOT NULL DEFAULT 'csv',
          file_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          record_count INTEGER NOT NULL DEFAULT 0,
          imported_at TEXT NOT NULL
        );`,
        'CREATE INDEX IF NOT EXISTS idx_finance_imports_vault ON finance_imports(vault_id);',
        'CREATE INDEX IF NOT EXISTS idx_finance_imports_status ON finance_imports(status);',
      ],
    },
    {
      id: 'finance-002-transactions',
      statements: [
        `CREATE TABLE IF NOT EXISTS finance_transactions (
          id TEXT PRIMARY KEY,
          import_id TEXT NOT NULL REFERENCES finance_imports(id),
          date TEXT NOT NULL,
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'USD',
          category TEXT,
          merchant_name TEXT,
          account_label TEXT,
          redacted_summary TEXT NOT NULL DEFAULT ''
        );`,
        'CREATE INDEX IF NOT EXISTS idx_finance_transactions_import ON finance_transactions(import_id);',
        'CREATE INDEX IF NOT EXISTS idx_finance_transactions_date ON finance_transactions(date);',
        'CREATE INDEX IF NOT EXISTS idx_finance_transactions_category ON finance_transactions(category) WHERE category IS NOT NULL;',
      ],
    },
    {
      id: 'finance-003-documents',
      statements: [
        `CREATE TABLE IF NOT EXISTS finance_documents (
          id TEXT PRIMARY KEY,
          import_id TEXT NOT NULL REFERENCES finance_imports(id),
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          redacted_summary TEXT NOT NULL DEFAULT ''
        );`,
        'CREATE INDEX IF NOT EXISTS idx_finance_documents_import ON finance_documents(import_id);',
      ],
    },
    {
      id: 'finance-004-digests',
      statements: [
        `CREATE TABLE IF NOT EXISTS finance_digests (
          id TEXT PRIMARY KEY,
          period TEXT NOT NULL,
          total_income REAL NOT NULL DEFAULT 0,
          total_expenses REAL NOT NULL DEFAULT 0,
          category_breakdown TEXT NOT NULL DEFAULT '{}',
          anomaly_flags TEXT NOT NULL DEFAULT '[]',
          generated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_digests_period ON finance_digests(period);',
      ],
    },
    {
      id: 'finance-005-fts',
      statements: [
        `CREATE VIRTUAL TABLE IF NOT EXISTS finance_transactions_fts USING fts5(
          description,
          redacted_summary,
          content=finance_transactions,
          content_rowid=rowid
        );`,
        `CREATE TRIGGER IF NOT EXISTS finance_transactions_ai AFTER INSERT ON finance_transactions BEGIN
          INSERT INTO finance_transactions_fts(rowid, description, redacted_summary) VALUES (new.rowid, new.description, new.redacted_summary);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS finance_transactions_ad AFTER DELETE ON finance_transactions BEGIN
          INSERT INTO finance_transactions_fts(finance_transactions_fts, rowid, description, redacted_summary) VALUES('delete', old.rowid, old.description, old.redacted_summary);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS finance_transactions_au AFTER UPDATE ON finance_transactions BEGIN
          INSERT INTO finance_transactions_fts(finance_transactions_fts, rowid, description, redacted_summary) VALUES('delete', old.rowid, old.description, old.redacted_summary);
          INSERT INTO finance_transactions_fts(rowid, description, redacted_summary) VALUES (new.rowid, new.description, new.redacted_summary);
        END;`,
      ],
    },
  ];
}
