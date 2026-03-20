import type { CapabilityContext, CalendarAccountRecord, CalendarSyncResult } from '@popeye/contracts';
import { extractRedactionPatterns, redactText } from '@popeye/observability';

import type { CalendarProviderAdapter } from './providers/adapter-interface.js';
import type { CalendarService } from './calendar-service.js';

export class CalendarSyncService {
  private readonly redactionPatterns: string[];

  constructor(
    private readonly calendarService: CalendarService,
    private readonly ctx: CapabilityContext,
  ) {
    this.redactionPatterns = extractRedactionPatterns(ctx.config);
  }

  async syncAccount(account: CalendarAccountRecord, adapter: CalendarProviderAdapter): Promise<CalendarSyncResult> {
    const result: CalendarSyncResult = {
      accountId: account.id,
      eventsSynced: 0,
      eventsUpdated: 0,
      errors: [],
    };

    try {
      // Attempt incremental sync if we have a sync token
      if (account.syncCursorSyncToken) {
        try {
          const incrementalResult = await this.incrementalSync(account, adapter);
          result.eventsSynced = incrementalResult.eventsSynced;
          result.eventsUpdated = incrementalResult.eventsUpdated;
          result.errors = incrementalResult.errors;

          this.ctx.auditCallback({
            eventType: 'calendar_sync_completed',
            details: { accountId: account.id, mode: 'incremental', eventsSynced: result.eventsSynced, eventsUpdated: result.eventsUpdated },
            severity: 'info',
          });

          return result;
        } catch (err) {
          // Sync token may be expired — fall back to full sync
          this.ctx.log.warn('Incremental calendar sync failed, falling back to full sync', {
            accountId: account.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Full sync
      const fullResult = await this.fullSync(account, adapter);
      result.eventsSynced = fullResult.eventsSynced;
      result.eventsUpdated = fullResult.eventsUpdated;
      result.errors = fullResult.errors;

      this.ctx.auditCallback({
        eventType: 'calendar_sync_completed',
        details: { accountId: account.id, mode: 'full', eventsSynced: result.eventsSynced, eventsUpdated: result.eventsUpdated },
        severity: 'info',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(message);
      this.ctx.log.error('Calendar sync failed', { accountId: account.id, error: message });
      this.ctx.auditCallback({
        eventType: 'calendar_sync_failed',
        details: { accountId: account.id, error: message },
        severity: 'error',
      });
    }

    return result;
  }

  private async incrementalSync(account: CalendarAccountRecord, adapter: CalendarProviderAdapter): Promise<CalendarSyncResult> {
    const result: CalendarSyncResult = { accountId: account.id, eventsSynced: 0, eventsUpdated: 0, errors: [] };

    const { events, nextSyncToken } = await adapter.listEventsIncremental(account.syncCursorSyncToken!);

    for (const event of events) {
      try {
        const existing = this.calendarService.getEventByGoogleId(account.id, event.eventId);
        this.calendarService.upsertEvent(account.id, {
          googleEventId: event.eventId,
          title: this.redact(event.title),
          description: this.redact(event.description),
          location: event.location,
          startTime: event.startTime,
          endTime: event.endTime,
          isAllDay: event.isAllDay,
          status: event.status,
          organizer: event.organizer,
          attendees: event.attendees,
          recurrenceRule: event.recurrenceRule,
          htmlLink: event.htmlLink,
          createdAtGoogle: event.createdAt,
          updatedAtGoogle: event.updatedAt,
        });
        if (existing) {
          result.eventsUpdated++;
        } else {
          result.eventsSynced++;
        }
      } catch (err) {
        result.errors.push(`Event ${event.eventId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (nextSyncToken) {
      this.calendarService.updateSyncCursor(account.id, nextSyncToken);
    }
    this.calendarService.updateEventCount(account.id);

    return result;
  }

  private async fullSync(account: CalendarAccountRecord, adapter: CalendarProviderAdapter): Promise<CalendarSyncResult> {
    const result: CalendarSyncResult = { accountId: account.id, eventsSynced: 0, eventsUpdated: 0, errors: [] };

    // List events for past 30 days + next 90 days
    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();
    const timeMax = new Date(now.getTime() + 90 * 24 * 3600_000).toISOString();

    const { events, nextSyncToken } = await adapter.listEvents({ timeMin, timeMax });

    for (const event of events) {
      try {
        const existing = this.calendarService.getEventByGoogleId(account.id, event.eventId);
        this.calendarService.upsertEvent(account.id, {
          googleEventId: event.eventId,
          title: this.redact(event.title),
          description: this.redact(event.description),
          location: event.location,
          startTime: event.startTime,
          endTime: event.endTime,
          isAllDay: event.isAllDay,
          status: event.status,
          organizer: event.organizer,
          attendees: event.attendees,
          recurrenceRule: event.recurrenceRule,
          htmlLink: event.htmlLink,
          createdAtGoogle: event.createdAt,
          updatedAtGoogle: event.updatedAt,
        });
        if (existing) {
          result.eventsUpdated++;
        } else {
          result.eventsSynced++;
        }
      } catch (err) {
        result.errors.push(`Event ${event.eventId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Update sync cursor
    this.calendarService.updateSyncCursor(account.id, nextSyncToken);
    this.calendarService.updateEventCount(account.id);

    return result;
  }

  private redact(text: string): string {
    return redactText(text, this.redactionPatterns).text;
  }
}
