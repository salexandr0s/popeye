import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { CalendarService } from '../calendar-service.js';
import { CalendarSearchService } from '../calendar-search.js';
import { getCalendarMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capcalendar-search-'));
  const db = new Database(join(dir, 'calendar.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
  const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
  const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of getCalendarMigrations()) {
    if (getMigration.get(migration.id)) continue;
    const tx = db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      addMigration.run(migration.id, new Date().toISOString());
    });
    tx();
  }

  return { db, dir, cleanup: () => db.close() };
}

describe('CalendarSearchService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: CalendarService;
  let searchSvc: CalendarSearchService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    const dbHandle = db as unknown as import('@popeye/contracts').CapabilityContext['appDb'];
    svc = new CalendarService(dbHandle);
    searchSvc = new CalendarSearchService(dbHandle);

    // Seed data
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });

    svc.upsertEvent(acct.id, {
      googleEventId: 'e1', title: 'Team standup meeting', description: 'Daily standup with the engineering team',
      location: 'Room 101', startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T09:30:00',
      isAllDay: false, status: 'confirmed', organizer: 'alice@example.com', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    svc.upsertEvent(acct.id, {
      googleEventId: 'e2', title: 'Product review', description: 'Quarterly product roadmap review',
      location: 'Conference Hall', startTime: '2025-01-16T14:00:00', endTime: '2025-01-16T15:00:00',
      isAllDay: false, status: 'confirmed', organizer: 'bob@example.com', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    svc.upsertEvent(acct.id, {
      googleEventId: 'e3', title: 'Lunch with investors', description: 'Discuss funding round',
      location: 'Downtown Restaurant', startTime: '2025-01-17T12:00:00', endTime: '2025-01-17T13:30:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('searches events by title', () => {
    const result = searchSvc.search({ query: 'standup', limit: 10 });
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.title).toBe('Team standup meeting');
  });

  it('searches events by description', () => {
    const result = searchSvc.search({ query: 'roadmap', limit: 10 });
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.title).toBe('Product review');
  });

  it('searches across title and description', () => {
    const result = searchSvc.search({ query: 'engineering', limit: 10 });
    expect(result.results.length).toBe(1);
  });

  it('filters by accountId', () => {
    // Create a second account with an event
    const acct2 = svc.registerAccount({ connectionId: 'c2', calendarEmail: 'u2@example.com', displayName: 'U2', timeZone: 'UTC' });
    svc.upsertEvent(acct2.id, {
      googleEventId: 'e4', title: 'Another standup', description: '',
      location: '', startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T09:30:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    const allResults = searchSvc.search({ query: 'standup', limit: 10 });
    expect(allResults.results.length).toBe(2);

    const filteredResults = searchSvc.search({ query: 'standup', accountId: acct2.id, limit: 10 });
    expect(filteredResults.results.length).toBe(1);
    expect(filteredResults.results[0]!.title).toBe('Another standup');
  });

  it('returns empty on no match', () => {
    const result = searchSvc.search({ query: 'nonexistentxyz', limit: 10 });
    expect(result.results.length).toBe(0);
  });

  it('handles malformed FTS queries gracefully', () => {
    const result = searchSvc.search({ query: 'AND OR NOT', limit: 10 });
    // Should not throw — falls back to phrase quoting
    expect(result.results).toBeDefined();
  });
});
