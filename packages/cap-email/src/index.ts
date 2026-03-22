import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import { openCapabilityDb } from '@popeye/cap-common';
import type Database from 'better-sqlite3';

import { EmailService } from './email-service.js';
import { EmailSyncService } from './email-sync.js';
import { EmailDigestService } from './email-digest.js';
import { EmailSearchService } from './email-search.js';
import { createEmailTools } from './tools.js';
import { getEmailMigrations } from './migrations.js';
import type { EmailProviderAdapter } from './providers/adapter-interface.js';

export { EmailService } from './email-service.js';
export { EmailSyncService } from './email-sync.js';
export { EmailDigestService } from './email-digest.js';
export { EmailSearchService } from './email-search.js';
export { getEmailMigrations } from './migrations.js';
export type { EmailProviderAdapter, NormalizedThread, NormalizedMessage, ThreadListPage, HistoryChange } from './providers/adapter-interface.js';
export { createAdapter, type AdapterCredentials } from './providers/create-adapter.js';
export { GwsCliAdapter, type GwsCliAdapterConfig } from './providers/gws-adapter.js';
export { GmailAdapter, type GmailAdapterConfig } from './providers/gmail-adapter.js';
export { ProtonBridgeAdapter, type ProtonBridgeAdapterConfig } from './providers/proton-adapter.js';
export { detectAvailableProviders, detectGws, detectProtonBridge, type ProviderDetectionResult } from './providers/detect.js';

const DEFAULT_SYNC_INTERVAL_MS = 15 * 60_000; // 15 minutes
const DIGEST_INTERVAL_MS = 24 * 3600_000; // 24 hours

export function createEmailCapability(): CapabilityModule {
  let emailService: EmailService | null = null;
  let syncService: EmailSyncService | null = null;
  let digestService: EmailDigestService | null = null;
  let searchService: EmailSearchService | null = null;
  let ctx: CapabilityContext | null = null;
  let emailDb: Database.Database | null = null;

  return {
    descriptor: {
      id: 'email',
      name: 'Email',
      version: '1.0.0',
      domain: 'email',
      dependencies: [],
    },

    initialize(context: CapabilityContext): void {
      ctx = context;

      // Open capability-owned email.db
      const storesDir = context.paths.capabilityStoresDir;
      emailDb = openCapabilityDb(storesDir, 'email.db', getEmailMigrations());

      // Create services using the email DB (cast to CapabilityDbHandle)
      const dbHandle = emailDb as unknown as CapabilityContext['appDb'];
      emailService = new EmailService(dbHandle);
      syncService = new EmailSyncService(emailService, context);
      digestService = new EmailDigestService(emailService, context);
      searchService = new EmailSearchService(dbHandle);

      context.log.info('cap-email initialized', { storesDir });
    },

    shutdown(): void {
      emailService = null;
      syncService = null;
      digestService = null;
      searchService = null;
      ctx = null;
      if (emailDb) {
        emailDb.close();
        emailDb = null;
      }
    },

    healthCheck() {
      return { healthy: emailService !== null && emailDb !== null };
    },

    getRuntimeTools(taskContext) {
      if (!emailService || !searchService || !digestService || !ctx) return [];
      return createEmailTools(emailService, searchService, digestService, ctx, taskContext);
    },

    getTimers() {
      return [
        {
          id: 'email-sync',
          intervalMs: DEFAULT_SYNC_INTERVAL_MS,
          immediate: false,
          handler: async () => {
            if (!emailService || !syncService || !ctx) return;
            if (!ctx.resolveEmailAdapter) {
              ctx.log.debug('Email sync timer tick — no adapter resolver configured');
              return;
            }

            const accounts = emailService.listAccounts();
            for (const account of accounts) {
              try {
                const resolved = await ctx.resolveEmailAdapter(account.connectionId);
                if (!resolved) {
                  ctx.log.debug('Email sync timer — no adapter for account', { accountId: account.id });
                  continue;
                }
                const adapter = resolved.adapter as EmailProviderAdapter;
                await syncService.syncAccount(account, adapter);
                ctx.log.info('Email sync timer completed', { accountId: account.id });
              } catch (err) {
                ctx.log.error(`Email sync timer failed for ${account.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          },
        },
        {
          id: 'email-digest',
          intervalMs: DIGEST_INTERVAL_MS,
          immediate: false,
          handler: () => {
            if (!emailService || !digestService || !ctx) return;
            const accounts = emailService.listAccounts();
            for (const account of accounts) {
              try {
                digestService.generateDigest(account);
              } catch (err) {
                ctx.log.error(`Email digest failed for ${account.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          },
        },
      ];
    },

    getMigrations() {
      // email.db is self-managed — no migrations on app.db or memory.db
      return [];
    },
  };
}
