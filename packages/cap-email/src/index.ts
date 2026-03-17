import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import Database from 'better-sqlite3';

import { EmailService } from './email-service.js';
import { EmailSyncService } from './email-sync.js';
import { EmailDigestService } from './email-digest.js';
import { EmailSearchService } from './email-search.js';
import { createEmailTools } from './tools.js';
import { getEmailMigrations } from './migrations.js';

export { EmailService } from './email-service.js';
export { EmailSyncService } from './email-sync.js';
export { EmailDigestService } from './email-digest.js';
export { EmailSearchService } from './email-search.js';
export { getEmailMigrations } from './migrations.js';
export type { EmailProviderAdapter, NormalizedThread, NormalizedMessage, ThreadListPage, HistoryChange } from './providers/adapter-interface.js';
export { createAdapter, type AdapterCredentials } from './providers/create-adapter.js';
export { GwsCliAdapter, type GwsCliAdapterConfig } from './providers/gws-adapter.js';
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

  function applyEmailMigrations(db: Database.Database): void {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
    const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
    const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

    for (const migration of getEmailMigrations()) {
      if (getMigration.get(migration.id)) continue;
      const tx = db.transaction(() => {
        for (const statement of migration.statements) db.exec(statement);
        addMigration.run(migration.id, new Date().toISOString());
      });
      tx();
    }
  }

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
      mkdirSync(storesDir, { recursive: true });
      const dbPath = join(storesDir, 'email.db');
      emailDb = new Database(dbPath);
      emailDb.pragma('journal_mode = WAL');
      emailDb.pragma('foreign_keys = ON');

      // Apply email-specific migrations
      applyEmailMigrations(emailDb);

      // Create services using the email DB (cast to CapabilityDbHandle)
      const dbHandle = emailDb as unknown as CapabilityContext['appDb'];
      emailService = new EmailService(dbHandle);
      syncService = new EmailSyncService(emailService, context);
      digestService = new EmailDigestService(emailService, context);
      searchService = new EmailSearchService(dbHandle);

      context.log.info('cap-email initialized', { dbPath });
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

    getRuntimeTools(_taskContext) {
      if (!emailService || !searchService || !digestService || !ctx) return [];
      return createEmailTools(emailService, searchService, digestService, ctx);
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
                const adapter = resolved.adapter as import('./providers/adapter-interface.js').EmailProviderAdapter;
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
