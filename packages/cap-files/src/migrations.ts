import type { CapabilityMigration } from '@popeye/contracts';

export function getFilesMigrations(): CapabilityMigration[] {
  return [
    {
      id: '001-file-roots',
      db: 'app',
      statements: [
        `CREATE TABLE IF NOT EXISTS file_roots (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          label TEXT NOT NULL,
          root_path TEXT NOT NULL,
          permission TEXT NOT NULL DEFAULT 'index',
          file_patterns TEXT NOT NULL DEFAULT '["**/*.md","**/*.txt"]',
          exclude_patterns TEXT NOT NULL DEFAULT '[]',
          max_file_size_bytes INTEGER NOT NULL DEFAULT 1048576,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_indexed_at TEXT,
          last_indexed_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_file_roots_workspace_path ON file_roots(workspace_id, root_path);',
      ],
    },
    {
      id: '002-file-documents',
      db: 'app',
      statements: [
        `CREATE TABLE IF NOT EXISTS file_documents (
          id TEXT PRIMARY KEY,
          file_root_id TEXT NOT NULL REFERENCES file_roots(id),
          relative_path TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          memory_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_file_documents_root_path ON file_documents(file_root_id, relative_path);',
      ],
    },
  ];
}
