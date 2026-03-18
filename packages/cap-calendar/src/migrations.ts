export interface CalendarMigration {
  id: string;
  statements: string[];
}

export function getCalendarMigrations(): CalendarMigration[] {
  return [
    {
      id: 'calendar-001-accounts',
      statements: [
        `CREATE TABLE IF NOT EXISTS calendar_accounts (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          calendar_email TEXT NOT NULL,
          display_name TEXT NOT NULL,
          time_zone TEXT NOT NULL DEFAULT 'UTC',
          sync_cursor_sync_token TEXT,
          last_sync_at TEXT,
          event_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_accounts_connection ON calendar_accounts(connection_id);',
        'CREATE INDEX IF NOT EXISTS idx_calendar_accounts_email ON calendar_accounts(calendar_email);',
      ],
    },
    {
      id: 'calendar-002-events',
      statements: [
        `CREATE TABLE IF NOT EXISTS calendar_events (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES calendar_accounts(id),
          google_event_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          is_all_day INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'confirmed',
          organizer TEXT NOT NULL DEFAULT '',
          attendees TEXT NOT NULL DEFAULT '[]',
          recurrence_rule TEXT,
          html_link TEXT,
          created_at_google TEXT,
          updated_at_google TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_account_gid ON calendar_events(account_id, google_event_id);',
        'CREATE INDEX IF NOT EXISTS idx_calendar_events_account_start ON calendar_events(account_id, start_time);',
        'CREATE INDEX IF NOT EXISTS idx_calendar_events_account_status ON calendar_events(account_id, status);',
      ],
    },
    {
      id: 'calendar-003-digests',
      statements: [
        `CREATE TABLE IF NOT EXISTS calendar_digests (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES calendar_accounts(id),
          workspace_id TEXT NOT NULL,
          date TEXT NOT NULL,
          today_event_count INTEGER NOT NULL DEFAULT 0,
          upcoming_count INTEGER NOT NULL DEFAULT 0,
          summary_markdown TEXT NOT NULL DEFAULT '',
          generated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_digests_account_date ON calendar_digests(account_id, date);',
      ],
    },
    {
      id: 'calendar-004-fts',
      statements: [
        `CREATE VIRTUAL TABLE IF NOT EXISTS calendar_events_fts USING fts5(
          title,
          description,
          content=calendar_events,
          content_rowid=rowid
        );`,
        `CREATE TRIGGER IF NOT EXISTS calendar_events_ai AFTER INSERT ON calendar_events BEGIN
          INSERT INTO calendar_events_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS calendar_events_ad AFTER DELETE ON calendar_events BEGIN
          INSERT INTO calendar_events_fts(calendar_events_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS calendar_events_au AFTER UPDATE ON calendar_events BEGIN
          INSERT INTO calendar_events_fts(calendar_events_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
          INSERT INTO calendar_events_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
        END;`,
      ],
    },
  ];
}
