import type { CapabilityMigration } from '@popeye/cap-common';

export function getEmailMigrations(): CapabilityMigration[] {
  return [
    {
      id: 'email-001-accounts',
      statements: [
        `CREATE TABLE IF NOT EXISTS email_accounts (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          email_address TEXT NOT NULL,
          display_name TEXT NOT NULL,
          sync_cursor_page_token TEXT,
          sync_cursor_history_id TEXT,
          last_sync_at TEXT,
          message_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_email_accounts_connection ON email_accounts(connection_id);',
        'CREATE INDEX IF NOT EXISTS idx_email_accounts_email ON email_accounts(email_address);',
      ],
    },
    {
      id: 'email-002-threads',
      statements: [
        `CREATE TABLE IF NOT EXISTS email_threads (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES email_accounts(id),
          gmail_thread_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          snippet TEXT NOT NULL DEFAULT '',
          last_message_at TEXT NOT NULL,
          message_count INTEGER NOT NULL DEFAULT 1,
          label_ids TEXT NOT NULL DEFAULT '[]',
          is_unread INTEGER NOT NULL DEFAULT 0,
          is_starred INTEGER NOT NULL DEFAULT 0,
          importance TEXT NOT NULL DEFAULT 'normal',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_email_threads_account_gmail ON email_threads(account_id, gmail_thread_id);',
        'CREATE INDEX IF NOT EXISTS idx_email_threads_account_date ON email_threads(account_id, last_message_at);',
        'CREATE INDEX IF NOT EXISTS idx_email_threads_account_unread ON email_threads(account_id, is_unread);',
      ],
    },
    {
      id: 'email-003-messages',
      statements: [
        `CREATE TABLE IF NOT EXISTS email_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES email_threads(id),
          account_id TEXT NOT NULL REFERENCES email_accounts(id),
          gmail_message_id TEXT NOT NULL,
          from_address TEXT NOT NULL,
          to_addresses TEXT NOT NULL DEFAULT '[]',
          cc_addresses TEXT NOT NULL DEFAULT '[]',
          subject TEXT NOT NULL,
          snippet TEXT NOT NULL DEFAULT '',
          body_preview TEXT NOT NULL DEFAULT '',
          received_at TEXT NOT NULL,
          size_estimate INTEGER NOT NULL DEFAULT 0,
          label_ids TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_account_gmail ON email_messages(account_id, gmail_message_id);',
        'CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON email_messages(thread_id);',
        'CREATE INDEX IF NOT EXISTS idx_email_messages_account_date ON email_messages(account_id, received_at);',
      ],
    },
    {
      id: 'email-004-digests',
      statements: [
        `CREATE TABLE IF NOT EXISTS email_digests (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES email_accounts(id),
          workspace_id TEXT NOT NULL,
          date TEXT NOT NULL,
          unread_count INTEGER NOT NULL DEFAULT 0,
          high_signal_count INTEGER NOT NULL DEFAULT 0,
          summary_markdown TEXT NOT NULL DEFAULT '',
          generated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_email_digests_account_date ON email_digests(account_id, date);',
      ],
    },
    {
      id: 'email-005-threads-fts',
      statements: [
        `CREATE VIRTUAL TABLE IF NOT EXISTS email_threads_fts USING fts5(
          subject,
          snippet,
          content=email_threads,
          content_rowid=rowid
        );`,
        // Triggers to keep FTS in sync
        `CREATE TRIGGER IF NOT EXISTS email_threads_ai AFTER INSERT ON email_threads BEGIN
          INSERT INTO email_threads_fts(rowid, subject, snippet) VALUES (new.rowid, new.subject, new.snippet);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS email_threads_ad AFTER DELETE ON email_threads BEGIN
          INSERT INTO email_threads_fts(email_threads_fts, rowid, subject, snippet) VALUES('delete', old.rowid, old.subject, old.snippet);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS email_threads_au AFTER UPDATE ON email_threads BEGIN
          INSERT INTO email_threads_fts(email_threads_fts, rowid, subject, snippet) VALUES('delete', old.rowid, old.subject, old.snippet);
          INSERT INTO email_threads_fts(rowid, subject, snippet) VALUES (new.rowid, new.subject, new.snippet);
        END;`,
      ],
    },
    {
      id: 'email-006-drafts',
      statements: [
        `CREATE TABLE IF NOT EXISTS email_drafts (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES email_accounts(id),
          connection_id TEXT NOT NULL,
          provider_draft_id TEXT NOT NULL,
          provider_message_id TEXT,
          to_addresses TEXT NOT NULL DEFAULT '[]',
          cc_addresses TEXT NOT NULL DEFAULT '[]',
          subject TEXT NOT NULL DEFAULT '',
          body_preview TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_email_drafts_provider_draft ON email_drafts(provider_draft_id);',
        'CREATE INDEX IF NOT EXISTS idx_email_drafts_account ON email_drafts(account_id);',
      ],
    },
  ];
}
