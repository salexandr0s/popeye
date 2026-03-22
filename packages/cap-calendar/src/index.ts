import { join } from 'node:path';

import { openCapabilityDb } from '@popeye/cap-common';
import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import type Database from 'better-sqlite3';

import { CalendarService } from './calendar-service.js';
import { CalendarSyncService } from './calendar-sync.js';
import { CalendarDigestService } from './calendar-digest.js';
import { CalendarSearchService } from './calendar-search.js';
import { createCalendarTools } from './tools.js';
import { getCalendarMigrations } from './migrations.js';
import type { CalendarProviderAdapter } from './providers/adapter-interface.js';

export { CalendarService } from './calendar-service.js';
export { CalendarSyncService } from './calendar-sync.js';
export { CalendarDigestService } from './calendar-digest.js';
export { CalendarSearchService } from './calendar-search.js';
export { getCalendarMigrations } from './migrations.js';
export type { CalendarProviderAdapter, NormalizedCalendarEvent } from './providers/adapter-interface.js';
export { GcalcliAdapter } from './providers/gcalcli-adapter.js';
export { GoogleCalendarAdapter, type GoogleCalendarAdapterConfig } from './providers/google-calendar-adapter.js';

const DEFAULT_SYNC_INTERVAL_MS = 15 * 60_000; // 15 minutes
const DIGEST_INTERVAL_MS = 24 * 3600_000; // 24 hours

export function createCalendarCapability(): CapabilityModule {
  let calendarService: CalendarService | null = null;
  let syncService: CalendarSyncService | null = null;
  let digestService: CalendarDigestService | null = null;
  let searchService: CalendarSearchService | null = null;
  let ctx: CapabilityContext | null = null;
  let calendarDb: Database.Database | null = null;

  return {
    descriptor: {
      id: 'calendar',
      name: 'Calendar',
      version: '1.0.0',
      domain: 'calendar',
      dependencies: [],
    },

    initialize(context: CapabilityContext): void {
      ctx = context;

      const storesDir = context.paths.capabilityStoresDir;
      calendarDb = openCapabilityDb(storesDir, 'calendar.db', getCalendarMigrations());

      const dbHandle = calendarDb as unknown as CapabilityContext['appDb'];
      calendarService = new CalendarService(dbHandle);
      syncService = new CalendarSyncService(calendarService, context);
      digestService = new CalendarDigestService(calendarService, context);
      searchService = new CalendarSearchService(dbHandle);

      context.log.info('cap-calendar initialized', { dbPath: join(storesDir, 'calendar.db') });
    },

    shutdown(): void {
      calendarService = null;
      syncService = null;
      digestService = null;
      searchService = null;
      ctx = null;
      if (calendarDb) {
        calendarDb.close();
        calendarDb = null;
      }
    },

    healthCheck() {
      return { healthy: calendarService !== null && calendarDb !== null };
    },

    getRuntimeTools(taskContext) {
      if (!calendarService || !searchService || !digestService || !ctx) return [];
      return createCalendarTools(calendarService, searchService, digestService, ctx, taskContext);
    },

    getTimers() {
      return [
        {
          id: 'calendar-sync',
          intervalMs: DEFAULT_SYNC_INTERVAL_MS,
          immediate: false,
          handler: async () => {
            if (!calendarService || !syncService || !ctx) return;

            const accounts = calendarService.listAccounts();
            for (const account of accounts) {
              try {
                if (!ctx.resolveCalendarAdapter) {
                  ctx.log.debug('Calendar sync timer tick — no adapter resolver configured');
                  return;
                }
                const resolved = await ctx.resolveCalendarAdapter(account.connectionId);
                if (!resolved) {
                  ctx.log.debug('Calendar sync timer — no adapter for account', { accountId: account.id });
                  continue;
                }
                const adapter = resolved.adapter as CalendarProviderAdapter;
                await syncService.syncAccount(account, adapter);
                ctx.log.info('Calendar sync timer completed', { accountId: account.id });
              } catch (err) {
                ctx.log.error(`Calendar sync timer failed for ${account.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          },
        },
        {
          id: 'calendar-digest',
          intervalMs: DIGEST_INTERVAL_MS,
          immediate: false,
          handler: () => {
            if (!calendarService || !digestService || !ctx) return;
            const accounts = calendarService.listAccounts();
            for (const account of accounts) {
              try {
                digestService.generateDigest(account);
              } catch (err) {
                ctx.log.error(`Calendar digest failed for ${account.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          },
        },
      ];
    },

    getMigrations() {
      // calendar.db is self-managed — no migrations on app.db or memory.db
      return [];
    },
  };
}
