export interface MedicalMigration {
  id: string;
  statements: string[];
}

export function getMedicalMigrations(): MedicalMigration[] {
  return [
    {
      id: 'medical-001-imports',
      statements: [
        `CREATE TABLE IF NOT EXISTS medical_imports (
          id TEXT PRIMARY KEY,
          vault_id TEXT NOT NULL,
          import_type TEXT NOT NULL DEFAULT 'pdf',
          file_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          imported_at TEXT NOT NULL
        );`,
        'CREATE INDEX IF NOT EXISTS idx_medical_imports_vault ON medical_imports(vault_id);',
        'CREATE INDEX IF NOT EXISTS idx_medical_imports_status ON medical_imports(status);',
      ],
    },
    {
      id: 'medical-002-appointments',
      statements: [
        `CREATE TABLE IF NOT EXISTS medical_appointments (
          id TEXT PRIMARY KEY,
          import_id TEXT NOT NULL REFERENCES medical_imports(id),
          date TEXT NOT NULL,
          provider TEXT NOT NULL,
          specialty TEXT,
          location TEXT,
          redacted_summary TEXT NOT NULL DEFAULT ''
        );`,
        'CREATE INDEX IF NOT EXISTS idx_medical_appointments_import ON medical_appointments(import_id);',
        'CREATE INDEX IF NOT EXISTS idx_medical_appointments_date ON medical_appointments(date);',
      ],
    },
    {
      id: 'medical-003-medications',
      statements: [
        `CREATE TABLE IF NOT EXISTS medical_medications (
          id TEXT PRIMARY KEY,
          import_id TEXT NOT NULL REFERENCES medical_imports(id),
          name TEXT NOT NULL,
          dosage TEXT,
          frequency TEXT,
          prescriber TEXT,
          start_date TEXT,
          end_date TEXT,
          redacted_summary TEXT NOT NULL DEFAULT ''
        );`,
        'CREATE INDEX IF NOT EXISTS idx_medical_medications_import ON medical_medications(import_id);',
        'CREATE INDEX IF NOT EXISTS idx_medical_medications_name ON medical_medications(name);',
      ],
    },
    {
      id: 'medical-004-documents',
      statements: [
        `CREATE TABLE IF NOT EXISTS medical_documents (
          id TEXT PRIMARY KEY,
          import_id TEXT NOT NULL REFERENCES medical_imports(id),
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          redacted_summary TEXT NOT NULL DEFAULT ''
        );`,
        'CREATE INDEX IF NOT EXISTS idx_medical_documents_import ON medical_documents(import_id);',
      ],
    },
    {
      id: 'medical-005-digests',
      statements: [
        `CREATE TABLE IF NOT EXISTS medical_digests (
          id TEXT PRIMARY KEY,
          period TEXT NOT NULL,
          appointment_count INTEGER NOT NULL DEFAULT 0,
          active_medications INTEGER NOT NULL DEFAULT 0,
          summary TEXT NOT NULL DEFAULT '',
          generated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_medical_digests_period ON medical_digests(period);',
      ],
    },
  ];
}
