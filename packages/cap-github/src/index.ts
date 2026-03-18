import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import Database from 'better-sqlite3';

import { GithubService } from './github-service.js';
import { GithubSyncService } from './github-sync.js';
import { GithubDigestService } from './github-digest.js';
import { GithubSearchService } from './github-search.js';
import { createGithubTools } from './tools.js';
import { getGithubMigrations } from './migrations.js';

export { GithubService } from './github-service.js';
export { GithubSyncService } from './github-sync.js';
export { GithubDigestService } from './github-digest.js';
export { GithubSearchService } from './github-search.js';
export { getGithubMigrations } from './migrations.js';
export type { GithubProviderAdapter, NormalizedGithubRepo, NormalizedGithubPR, NormalizedGithubIssue, NormalizedGithubNotification, NormalizedGithubProfile } from './providers/adapter-interface.js';
export { GhCliAdapter } from './providers/gh-cli-adapter.js';

const DEFAULT_SYNC_INTERVAL_MS = 15 * 60_000; // 15 minutes
const DIGEST_INTERVAL_MS = 24 * 3600_000; // 24 hours

export function createGithubCapability(): CapabilityModule {
  let githubService: GithubService | null = null;
  let syncService: GithubSyncService | null = null;
  let digestService: GithubDigestService | null = null;
  let searchService: GithubSearchService | null = null;
  let ctx: CapabilityContext | null = null;
  let githubDb: Database.Database | null = null;

  function applyGithubMigrations(db: Database.Database): void {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
    const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
    const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

    for (const migration of getGithubMigrations()) {
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
      id: 'github',
      name: 'GitHub',
      version: '1.0.0',
      domain: 'github',
      dependencies: [],
    },

    initialize(context: CapabilityContext): void {
      ctx = context;

      const storesDir = context.paths.capabilityStoresDir;
      mkdirSync(storesDir, { recursive: true });
      const dbPath = join(storesDir, 'github.db');
      githubDb = new Database(dbPath);
      githubDb.pragma('journal_mode = WAL');
      githubDb.pragma('foreign_keys = ON');

      applyGithubMigrations(githubDb);

      const dbHandle = githubDb as unknown as CapabilityContext['appDb'];
      githubService = new GithubService(dbHandle);
      syncService = new GithubSyncService(githubService, context);
      digestService = new GithubDigestService(githubService, context);
      searchService = new GithubSearchService(dbHandle);

      context.log.info('cap-github initialized', { dbPath });
    },

    shutdown(): void {
      githubService = null;
      syncService = null;
      digestService = null;
      searchService = null;
      ctx = null;
      if (githubDb) {
        githubDb.close();
        githubDb = null;
      }
    },

    healthCheck() {
      return { healthy: githubService !== null && githubDb !== null };
    },

    getRuntimeTools(taskContext) {
      if (!githubService || !searchService || !digestService || !ctx) return [];
      return createGithubTools(githubService, searchService, digestService, ctx, taskContext);
    },

    getTimers() {
      return [
        {
          id: 'github-sync',
          intervalMs: DEFAULT_SYNC_INTERVAL_MS,
          immediate: false,
          handler: async () => {
            if (!githubService || !syncService || !ctx) return;

            const accounts = githubService.listAccounts();
            for (const account of accounts) {
              try {
                const { GhCliAdapter } = await import('./providers/gh-cli-adapter.js');
                const adapter = new GhCliAdapter();
                await syncService.syncAccount(account, adapter);
                ctx.log.info('GitHub sync timer completed', { accountId: account.id });
              } catch (err) {
                ctx.log.error(`GitHub sync timer failed for ${account.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          },
        },
        {
          id: 'github-digest',
          intervalMs: DIGEST_INTERVAL_MS,
          immediate: false,
          handler: () => {
            if (!githubService || !digestService || !ctx) return;
            const accounts = githubService.listAccounts();
            for (const account of accounts) {
              try {
                digestService.generateDigest(account);
              } catch (err) {
                ctx.log.error(`GitHub digest failed for ${account.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          },
        },
      ];
    },

    getMigrations() {
      // github.db is self-managed — no migrations on app.db or memory.db
      return [];
    },
  };
}
