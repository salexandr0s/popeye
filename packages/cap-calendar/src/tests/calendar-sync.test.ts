import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { CalendarService } from '../calendar-service.js';
import { CalendarSyncService } from '../calendar-sync.js';
import { getCalendarMigrations } from '../migrations.js';
import type { CalendarProviderAdapter } from '../providers/adapter-interface.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capcalendar-sync-'));
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
    actionApprovalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
  };
}

function createFakeAdapter(): CalendarProviderAdapter {
  return {
    getProfile: async () => ({ email: 'test@example.com', timeZone: 'America/New_York' }),
    listEvents: async () => ({
      events: [
        {
          eventId: 'evt-1', title: 'Team standup', description: 'Daily standup',
          location: 'Room 101', startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T09:30:00',
          isAllDay: false, status: 'confirmed', organizer: 'alice@example.com',
          attendees: ['bob@example.com'], recurrenceRule: null, htmlLink: null,
          createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
        },
        {
          eventId: 'evt-2', title: 'Lunch', description: 'Team lunch',
          location: 'Cafeteria', startTime: '2025-01-15T12:00:00', endTime: '2025-01-15T13:00:00',
          isAllDay: false, status: 'confirmed', organizer: '',
          attendees: [], recurrenceRule: null, htmlLink: null,
          createdAt: null, updatedAt: null,
        },
      ],
      nextSyncToken: 'full-sync-token',
    }),
    listEventsIncremental: async () => ({
      events: [
        {
          eventId: 'evt-3', title: 'New event', description: 'Incremental',
          location: '', startTime: '2025-01-16T10:00:00', endTime: '2025-01-16T11:00:00',
          isAllDay: false, status: 'confirmed', organizer: '',
          attendees: [], recurrenceRule: null, htmlLink: null,
          createdAt: null, updatedAt: null,
        },
      ],
      nextSyncToken: 'new-token',
    }),
  };
}

describe('CalendarSyncService', () => {
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

  it('syncs events from fake adapter via full sync', async () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });
    const ctx = makeCtx();
    const syncSvc = new CalendarSyncService(svc, ctx);
    const adapter = createFakeAdapter();

    const result = await syncSvc.syncAccount(acct, adapter);

    expect(result.eventsSynced).toBe(2);
    expect(result.eventsUpdated).toBe(0);
    expect(result.errors.length).toBe(0);

    // Verify data stored
    const events = svc.listEvents(acct.id);
    expect(events.length).toBe(2);
    expect(events[0]!.title).toBe('Team standup');
  });

  it('uses incremental sync when sync token exists', async () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });
    // Set a sync token
    svc.updateSyncCursor(acct.id, 'old-token');
    const updatedAcct = svc.getAccount(acct.id)!;

    const ctx = makeCtx();
    const syncSvc = new CalendarSyncService(svc, ctx);
    const adapter = createFakeAdapter();

    const result = await syncSvc.syncAccount(updatedAcct, adapter);

    expect(result.eventsSynced).toBe(1);
    expect(result.errors.length).toBe(0);

    // Verify sync token was updated
    const afterSync = svc.getAccount(acct.id)!;
    expect(afterSync.syncCursorSyncToken).toBe('new-token');
  });

  it('falls back to full sync when incremental fails', async () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });
    svc.updateSyncCursor(acct.id, 'expired-token');
    const updatedAcct = svc.getAccount(acct.id)!;

    const ctx = makeCtx();
    const syncSvc = new CalendarSyncService(svc, ctx);

    const adapter: CalendarProviderAdapter = {
      ...createFakeAdapter(),
      listEventsIncremental: async () => { throw new Error('Sync token expired'); },
    };

    const result = await syncSvc.syncAccount(updatedAcct, adapter);

    // Should fall back to full sync
    expect(result.eventsSynced).toBe(2);
    expect(result.errors.length).toBe(0);
  });

  it('redacts event descriptions before storage', async () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });
    const ctx = makeCtx();
    // Add a redaction pattern
    ctx.config = { security: { redactionPatterns: ['secret-token-\\w+'] } };
    const syncSvc = new CalendarSyncService(svc, ctx);

    const adapter: CalendarProviderAdapter = {
      ...createFakeAdapter(),
      listEvents: async () => ({
        events: [
          {
            eventId: 'evt-redact', title: 'Meeting about secret-token-abc123',
            description: 'Discuss secret-token-def456 handling',
            location: '', startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T10:00:00',
            isAllDay: false, status: 'confirmed', organizer: '',
            attendees: [], recurrenceRule: null, htmlLink: null,
            createdAt: null, updatedAt: null,
          },
        ],
        nextSyncToken: 'redacted-sync-token',
      }),
    };

    await syncSvc.syncAccount(acct, adapter);

    const events = svc.listEvents(acct.id);
    expect(events.length).toBe(1);
    // The redaction should have replaced the secret patterns
    expect(events[0]!.title).not.toContain('secret-token-abc123');
    expect(events[0]!.description).not.toContain('secret-token-def456');
  });

  it('emits audit event on success', async () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });
    const ctx = makeCtx();
    const syncSvc = new CalendarSyncService(svc, ctx);
    const adapter = createFakeAdapter();

    await syncSvc.syncAccount(acct, adapter);

    expect(ctx.auditCallback).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'calendar_sync_completed', severity: 'info' }),
    );
  });

  it('emits audit event on adapter failure', async () => {
    const acct = svc.registerAccount({ connectionId: 'c1', calendarEmail: 'test@example.com', displayName: 'Test', timeZone: 'UTC' });
    const ctx = makeCtx();
    const syncSvc = new CalendarSyncService(svc, ctx);

    const failingAdapter: CalendarProviderAdapter = {
      getProfile: async () => { throw new Error('gcalcli not found'); },
      listEvents: async () => { throw new Error('gcalcli not found'); },
      listEventsIncremental: async () => { throw new Error('gcalcli not found'); },
    };

    const result = await syncSvc.syncAccount(acct, failingAdapter);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(ctx.auditCallback).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'calendar_sync_failed', severity: 'error' }),
    );
  });
});
