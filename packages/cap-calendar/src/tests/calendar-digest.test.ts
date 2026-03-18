import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { CalendarService } from '../calendar-service.js';
import { CalendarDigestService } from '../calendar-digest.js';
import { getCalendarMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capcalendar-digest-'));
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

function makeCtx(): CapabilityContext {
  return {
    appDb: {} as CapabilityContext['appDb'],
    memoryDb: {} as CapabilityContext['appDb'],
    paths: { capabilityStoresDir: '', runtimeDataDir: '', logsDir: '', cacheDir: '' } as CapabilityContext['paths'],
    config: { security: { redactionPatterns: [] } },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    auditCallback: vi.fn(),
    memoryInsert: vi.fn(() => ({ memoryId: 'mem-1', embedded: false })),
    approvalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
  };
}

describe('CalendarDigestService', () => {
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

  it('generates digest with today events section', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });

    // Add events for the target date
    svc.upsertEvent(acct.id, {
      googleEventId: 'e1', title: 'Morning standup', description: '',
      location: 'Room 101', startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T09:30:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });
    svc.upsertEvent(acct.id, {
      googleEventId: 'e2', title: 'Afternoon review', description: '',
      location: 'Conference Room', startTime: '2025-01-15T14:00:00', endTime: '2025-01-15T15:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    const ctx = makeCtx();
    const digestSvc = new CalendarDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-01-15');

    expect(digest.todayEventCount).toBe(2);
    expect(digest.summaryMarkdown).toContain('Calendar Digest');
    expect(digest.summaryMarkdown).toContain("Today's Events");
    expect(digest.summaryMarkdown).toContain('Morning standup');
    expect(digest.summaryMarkdown).toContain('Afternoon review');
    expect(digest.summaryMarkdown).toContain('Room 101');
  });

  it('includes upcoming this week section', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });

    // Add event for tomorrow
    svc.upsertEvent(acct.id, {
      googleEventId: 'e3', title: 'Tomorrow meeting', description: '',
      location: '', startTime: '2025-01-16T10:00:00', endTime: '2025-01-16T11:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    const ctx = makeCtx();
    const digestSvc = new CalendarDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-01-15');

    expect(digest.upcomingCount).toBeGreaterThanOrEqual(1);
    expect(digest.summaryMarkdown).toContain('Upcoming This Week');
    expect(digest.summaryMarkdown).toContain('Tomorrow meeting');
  });

  it('includes busy/free summary section', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });

    svc.upsertEvent(acct.id, {
      googleEventId: 'e1', title: 'Busy day', description: '',
      location: '', startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T10:00:00',
      isAllDay: false, status: 'confirmed', organizer: '', attendees: [],
      recurrenceRule: null, htmlLink: null, createdAtGoogle: null, updatedAtGoogle: null,
    });

    const ctx = makeCtx();
    const digestSvc = new CalendarDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-01-15');

    expect(digest.summaryMarkdown).toContain('Weekly Busy/Free Summary');
    expect(digest.summaryMarkdown).toContain('2025-01-15: 1 event');
    // Some days should be free
    expect(digest.summaryMarkdown).toContain('free');
  });

  it('stores digest in memory and emits audit event', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });
    const ctx = makeCtx();
    const digestSvc = new CalendarDigestService(svc, ctx);
    digestSvc.generateDigest(acct, '2025-01-15');

    expect(ctx.memoryInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'calendar',
        sourceRefType: 'calendar_digest',
        dedupKey: expect.stringContaining('calendar-digest:'),
      }),
    );

    expect(ctx.auditCallback).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'calendar_digest_generated', severity: 'info' }),
    );
  });

  it('generates empty digest when no data', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });
    const ctx = makeCtx();
    const digestSvc = new CalendarDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-01-15');

    expect(digest.todayEventCount).toBe(0);
    expect(digest.upcomingCount).toBe(0);
  });
});
