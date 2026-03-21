import type { CapabilityMigration } from '@popeye/cap-common';

export function getTodoMigrations(): CapabilityMigration[] {
  return [
    {
      id: 'todos-001-accounts',
      statements: [
        `CREATE TABLE IF NOT EXISTS todo_accounts (
          id TEXT PRIMARY KEY,
          connection_id TEXT,
          provider_kind TEXT NOT NULL DEFAULT 'local',
          display_name TEXT NOT NULL,
          sync_cursor_since TEXT,
          last_sync_at TEXT,
          todo_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE INDEX IF NOT EXISTS idx_todo_accounts_connection ON todo_accounts(connection_id) WHERE connection_id IS NOT NULL;',
      ],
    },
    {
      id: 'todos-002-projects',
      statements: [
        `CREATE TABLE IF NOT EXISTS todo_projects (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES todo_accounts(id),
          external_id TEXT,
          name TEXT NOT NULL,
          color TEXT,
          todo_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_projects_account_external ON todo_projects(account_id, external_id) WHERE external_id IS NOT NULL;',
      ],
    },
    {
      id: 'todos-003-items',
      statements: [
        `CREATE TABLE IF NOT EXISTS todo_items (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES todo_accounts(id),
          external_id TEXT,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          priority INTEGER NOT NULL DEFAULT 4,
          status TEXT NOT NULL DEFAULT 'pending',
          due_date TEXT,
          due_time TEXT,
          labels TEXT NOT NULL DEFAULT '[]',
          project_name TEXT,
          parent_id TEXT,
          completed_at TEXT,
          created_at_external TEXT,
          updated_at_external TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_items_account_external ON todo_items(account_id, external_id) WHERE external_id IS NOT NULL;',
        'CREATE INDEX IF NOT EXISTS idx_todo_items_account_status ON todo_items(account_id, status);',
        'CREATE INDEX IF NOT EXISTS idx_todo_items_account_due ON todo_items(account_id, due_date);',
        'CREATE INDEX IF NOT EXISTS idx_todo_items_account_priority ON todo_items(account_id, priority);',
      ],
    },
    {
      id: 'todos-004-digests',
      statements: [
        `CREATE TABLE IF NOT EXISTS todo_digests (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES todo_accounts(id),
          workspace_id TEXT NOT NULL,
          date TEXT NOT NULL,
          pending_count INTEGER NOT NULL DEFAULT 0,
          overdue_count INTEGER NOT NULL DEFAULT 0,
          completed_today_count INTEGER NOT NULL DEFAULT 0,
          summary_markdown TEXT NOT NULL DEFAULT '',
          generated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_digests_account_date ON todo_digests(account_id, date);',
      ],
    },
    {
      id: 'todos-005-fts',
      statements: [
        `CREATE VIRTUAL TABLE IF NOT EXISTS todo_items_fts USING fts5(
          title,
          description,
          content=todo_items,
          content_rowid=rowid
        );`,
        `CREATE TRIGGER IF NOT EXISTS todo_items_ai AFTER INSERT ON todo_items BEGIN
          INSERT INTO todo_items_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS todo_items_ad AFTER DELETE ON todo_items BEGIN
          INSERT INTO todo_items_fts(todo_items_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS todo_items_au AFTER UPDATE ON todo_items BEGIN
          INSERT INTO todo_items_fts(todo_items_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
          INSERT INTO todo_items_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
        END;`,
      ],
    },
  ];
}
