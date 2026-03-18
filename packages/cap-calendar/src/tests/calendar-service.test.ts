import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { CapabilityContext } from '@popeye/contracts';

import { CalendarService } from '../calendar-service.js';
import { getCalendarMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capcalendar-'));
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

describe('CalendarService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: CalendarService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    svc = new CalendarService(db as unknown as CapabilityContext['appDb']);
  });

  afterEach(() => {
    cleanup();
  });

  // --- Accounts ---

  it('registers and retrieves an account', () => {
    const account = svc.registerAccount({
      connectionId: 'conn-1',
      calendarEmail: 'test@example.com',
      displayName: 'Test User',
      timeZone: 'America/New_York',
    });
    expect(account.calendarEmail).toBe('test@example.com');
    expect(account.displayName).toBe('Test User');
    expect(account.connectionId).toBe('conn-1');
    expect(account.timeZone).toBe('America/New_York');
    expect(account.eventCount).toBe(0);

    const fetched = svc.getAccount(account.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.calendarEmail).toBe('test@example.com');
  });

  it('lists accounts', () => {
    svc.registerAccount({ connectionId: 'c1', calendarEmail: 'alice@example.com', displayName: 'Alice', timeZone: 'UTC' });
    svc.registerAccount({ connectionId: 'c2', calendarEmail: 'bob@example.com', displayName: 'Bob', timeZone: 'UTC' });
    const all = svc.listAccounts();
    expect(all.length).toBe(2);
  });

  it('finds account by connection ID', () => {
    svc.registerAccount({ connectionId: 'conn-x', calendarEmail: 'x@example.com', displayName: 'X', timeZone: 'UTC' });
    const found = svc.getAccountByConnection('conn-x');
    expect(found).not.toBeNull();
    expect(found!.calendarEmail).toBe('x@example.com');
  });

  it('updates sync cursor', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });
    svc.updateSyncCursor(acct.id, 'sync-token-abc');
    const updated = svc.getAccount(acct.id)!;
    expect(updated.syncCursorSyncToken).toBe('sync-token-abc');
    expect(updated.lastSyncAt).not.toBeNull();
  });

  // --- Events ---

  it('upserts and lists events', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });
    const event = svc.upsertEvent(acct.id, {
      googleEventId: 'evt-1',
      title: 'Team standup',
      description: 'Daily standup meeting',
      location: 'Room 101',
      startTime: '2025-01-15T09:00:00',
      endTime: '2025-01-15T09:30:00',
      isAllDay: false,
      status: 'confirmed',
      organizer: 'alice@example.com',
      attendees: ['bob@example.com', 'carol@example.com'],
      recurrenceRule: null,
      htmlLink: 'https://calendar.google.com/event/1',
      createdAtGoogle: '2025-01-01T00:00:00Z',
      updatedAtGoogle: '2025-01-01T00:00:00Z',
    });
    expect(event.title).toBe('Team standup');
    expect(event.location).toBe('Room 101');
    expect(event.attendees).toEqual(['bob@example.com', 'carol@example.com']);

    // Upsert again (update)
    const updated = svc.upsertEvent(acct.id, {
      googleEventId: 'evt-1',
      title: 'Team standup (updated)',
      description: 'Daily standup meeting - updated',
      location: 'Room 202',
      startTime: '2025-01-15T09:00:00',
      endTime: '2025-01-15T09:30:00',
      isAllDay: false,
      status: 'confirmed',
      organizer: 'alice@example.com',
      attendees: ['bob@example.com'],
      recurrenceRule: null,
      htmlLink: null,
      createdAtGoogle: null,
      updatedAtGoogle: null,
    });
    expect(updated.title).toBe('Team standup (updated)');
    expect(updated.location).toBe('Room 202');

    const all = svc.listEvents(acct.id);
    expect(all.length).toBe(1);
  });

  it('gets event by Google ID', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });
    svc.upsertEvent(acct.id, {
      googleEventId: 'gid-42',
      title: 'Lunch',
      description: '',
      location: '',
      startTime: '2025-01-15T12:00:00',
      endTime: '2025-01-15T13:00:00',
      isAllDay: false,
      status: 'confirmed',
      organizer: '',
      attendees: [],
      recurrenceRule: null,
      htmlLink: null,
      createdAtGoogle: null,
      updatedAtGoogle: null,
    });

    const found = svc.getEventByGoogleId(acct.id, 'gid-42');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Lunch');
  });

  it('lists events with date range', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });

    svc.upsertEvent(acct.id, {
      googleEventId: 'e1', title: 'Early', description: '', location: '',
      startTime: '2025-01-10T09:00:00', endTime: '2025-01-10T10:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });
    svc.upsertEvent(acct.id, {
      googleEventId: 'e2', title: 'Mid', description: '', location: '',
      startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T10:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });
    svc.upsertEvent(acct.id, {
      googleEventId: 'e3', title: 'Late', description: '', location: '',
      startTime: '2025-01-20T09:00:00', endTime: '2025-01-20T10:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    const filtered = svc.listEvents(acct.id, { dateFrom: '2025-01-12T00:00:00', dateTo: '2025-01-18T00:00:00' });
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.title).toBe('Mid');
  });

  it('lists today events', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });
    const today = new Date().toISOString().slice(0, 10);

    svc.upsertEvent(acct.id, {
      googleEventId: 'today-1', title: 'Today event', description: '', location: '',
      startTime: `${today}T10:00:00`, endTime: `${today}T11:00:00`,
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });
    svc.upsertEvent(acct.id, {
      googleEventId: 'tomorrow-1', title: 'Tomorrow event', description: '', location: '',
      startTime: '2099-12-31T10:00:00', endTime: '2099-12-31T11:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    const todayEvents = svc.listToday(acct.id);
    expect(todayEvents.length).toBe(1);
    expect(todayEvents[0]!.title).toBe('Today event');
  });

  it('lists upcoming events', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });

    // Event in the near future
    const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);
    svc.upsertEvent(acct.id, {
      googleEventId: 'upcoming-1', title: 'Upcoming', description: '', location: '',
      startTime: `${tomorrow}T10:00:00`, endTime: `${tomorrow}T11:00:00`,
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    // Event far in the future
    svc.upsertEvent(acct.id, {
      googleEventId: 'far-1', title: 'Far future', description: '', location: '',
      startTime: '2099-12-31T10:00:00', endTime: '2099-12-31T11:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    const upcoming = svc.listUpcoming(acct.id, 3);
    expect(upcoming.length).toBe(1);
    expect(upcoming[0]!.title).toBe('Upcoming');
  });

  // --- Digests ---

  it('inserts and retrieves digests', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });

    const digest = svc.insertDigest({
      accountId: acct.id,
      workspaceId: 'default',
      date: '2025-01-15',
      todayEventCount: 3,
      upcomingCount: 10,
      summaryMarkdown: '# Digest',
    });
    expect(digest.todayEventCount).toBe(3);

    const latest = svc.getLatestDigest(acct.id);
    expect(latest).not.toBeNull();
    expect(latest!.date).toBe('2025-01-15');

    // Upsert same date
    const updated = svc.insertDigest({
      accountId: acct.id,
      workspaceId: 'default',
      date: '2025-01-15',
      todayEventCount: 5,
      upcomingCount: 12,
      summaryMarkdown: '# Updated Digest',
    });
    expect(updated.id).toBe(digest.id); // Same ID preserved
    expect(updated.todayEventCount).toBe(5);
  });

  // --- Availability ---

  it('returns all slots when calendar is empty', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });

    const slots = svc.computeAvailability(acct.id, '2025-01-15', 9, 17, 30);
    // 8 hours = 480 minutes / 30 = 16 slots
    expect(slots.length).toBe(16);
    expect(slots[0]!.startTime).toBe('2025-01-15T09:00:00');
    expect(slots[0]!.endTime).toBe('2025-01-15T09:30:00');
    expect(slots[0]!.durationMinutes).toBe(30);
  });

  it('events reduce available slots', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });

    // Add a 1-hour meeting from 10:00 to 11:00
    svc.upsertEvent(acct.id, {
      googleEventId: 'meeting-1', title: 'Meeting', description: '', location: '',
      startTime: '2025-01-15T10:00:00', endTime: '2025-01-15T11:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    const slots = svc.computeAvailability(acct.id, '2025-01-15', 9, 17, 30);
    // Should be 16 - 2 = 14 (the 10:00 and 10:30 slots are blocked)
    expect(slots.length).toBe(14);

    // Verify the blocked slots are not present
    const blockedSlots = slots.filter((s) =>
      s.startTime === '2025-01-15T10:00:00' || s.startTime === '2025-01-15T10:30:00',
    );
    expect(blockedSlots.length).toBe(0);
  });

  it('updates event count', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'u1@example.com', displayName: 'U1', timeZone: 'UTC' });
    svc.upsertEvent(acct.id, {
      googleEventId: 'e1', title: 'Event 1', description: '', location: '',
      startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T10:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });
    svc.upsertEvent(acct.id, {
      googleEventId: 'e2', title: 'Event 2', description: '', location: '',
      startTime: '2025-01-16T09:00:00', endTime: '2025-01-16T10:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    svc.updateEventCount(acct.id);
    const updated = svc.getAccount(acct.id)!;
    expect(updated.eventCount).toBe(2);
  });

  it('returns null for nonexistent entities', () => {
    expect(svc.getAccount('nope')).toBeNull();
    expect(svc.getEvent('nope')).toBeNull();
    expect(svc.getDigest('nope')).toBeNull();
    expect(svc.getLatestDigest('nope')).toBeNull();
    expect(svc.getAccountByConnection('nope')).toBeNull();
  });
});
