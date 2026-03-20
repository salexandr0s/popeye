export interface PeopleMigration {
  id: string;
  statements: string[];
}

export function getPeopleMigrations(): PeopleMigration[] {
  return [
    {
      id: 'people-001-core',
      statements: [
        `CREATE TABLE IF NOT EXISTS people (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          pronouns TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          notes TEXT NOT NULL DEFAULT '',
          canonical_email TEXT,
          github_login TEXT,
          activity_summary TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE INDEX IF NOT EXISTS idx_people_display_name ON people(display_name);',
        'CREATE INDEX IF NOT EXISTS idx_people_canonical_email ON people(canonical_email);',
        'CREATE INDEX IF NOT EXISTS idx_people_github_login ON people(github_login);',
        `CREATE TABLE IF NOT EXISTS person_identities (
          id TEXT PRIMARY KEY,
          person_id TEXT NOT NULL REFERENCES people(id),
          provider TEXT NOT NULL,
          external_id TEXT NOT NULL,
          display_name TEXT,
          handle TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_person_identities_provider_external ON person_identities(provider, external_id);',
        'CREATE INDEX IF NOT EXISTS idx_person_identities_person ON person_identities(person_id);',
        `CREATE TABLE IF NOT EXISTS person_contact_methods (
          id TEXT PRIMARY KEY,
          person_id TEXT NOT NULL REFERENCES people(id),
          type TEXT NOT NULL,
          value TEXT NOT NULL,
          label TEXT,
          source TEXT NOT NULL DEFAULT 'derived',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_person_contact_methods_person_value ON person_contact_methods(person_id, type, value);',
        'CREATE INDEX IF NOT EXISTS idx_person_contact_methods_value ON person_contact_methods(type, value);',
        `CREATE TABLE IF NOT EXISTS person_policy (
          person_id TEXT PRIMARY KEY REFERENCES people(id),
          relationship_label TEXT,
          reminder_routing TEXT,
          approval_notes TEXT,
          updated_at TEXT NOT NULL
        );`,
        `CREATE TABLE IF NOT EXISTS person_activity_rollups (
          person_id TEXT PRIMARY KEY REFERENCES people(id),
          summary TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );`,
        `CREATE TABLE IF NOT EXISTS person_merge_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          source_person_id TEXT,
          target_person_id TEXT,
          identity_id TEXT,
          requested_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        );`,
        'CREATE INDEX IF NOT EXISTS idx_person_merge_events_target ON person_merge_events(target_person_id);',
        'CREATE INDEX IF NOT EXISTS idx_person_merge_events_source ON person_merge_events(source_person_id);',
      ],
    },
    {
      id: 'people-002-extended-rollups',
      statements: [
        `ALTER TABLE person_activity_rollups ADD COLUMN domain TEXT NOT NULL DEFAULT '';`,
        `ALTER TABLE person_activity_rollups ADD COLUMN count INTEGER NOT NULL DEFAULT 0;`,
        `ALTER TABLE person_activity_rollups ADD COLUMN last_seen_at TEXT;`,
        `ALTER TABLE person_policy ADD COLUMN email_send_policy TEXT NOT NULL DEFAULT 'approval_required';`,
        `ALTER TABLE person_policy ADD COLUMN calendar_allowlist INTEGER NOT NULL DEFAULT 0;`,
      ],
    },
  ];
}
