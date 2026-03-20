import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import Database from 'better-sqlite3';

import { getFinanceMigrations } from './migrations.js';
import { FinanceService } from './finance-service.js';
import { FinanceSearchService } from './search-service.js';
import { FinanceDigestService } from './digest-service.js';

export { getFinanceMigrations } from './migrations.js';
export { FinanceService } from './finance-service.js';
export { FinanceSearchService } from './search-service.js';
export { FinanceDigestService } from './digest-service.js';

export function createFinanceCapability(): CapabilityModule {
  let financeDb: Database.Database | null = null;
  let financeService: FinanceService | null = null;
  let searchService: FinanceSearchService | null = null;
  let digestService: FinanceDigestService | null = null;

  function applyFinanceMigrations(db: Database.Database): void {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
    const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
    const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
    for (const migration of getFinanceMigrations()) {
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
      id: 'finance',
      name: 'Finance',
      version: '1.0.0',
      domain: 'finance',
      dependencies: [],
    },
    initialize(context: CapabilityContext): void {
      const storesDir = context.paths.capabilityStoresDir;
      mkdirSync(storesDir, { recursive: true });
      const dbPath = join(storesDir, 'finance.db');
      financeDb = new Database(dbPath);
      financeDb.pragma('journal_mode = WAL');
      financeDb.pragma('foreign_keys = ON');
      applyFinanceMigrations(financeDb);
      const dbHandle = financeDb as unknown as CapabilityContext['appDb'];
      financeService = new FinanceService(dbHandle);
      searchService = new FinanceSearchService(dbHandle);
      digestService = new FinanceDigestService(financeService, context);
      context.log.info('cap-finance initialized', { dbPath });
    },
    shutdown(): void {
      financeService = null;
      searchService = null;
      digestService = null;
      if (financeDb) {
        financeDb.close();
        financeDb = null;
      }
    },
    healthCheck() {
      return { healthy: financeService !== null && searchService !== null && digestService !== null && financeDb !== null };
    },
    getMigrations() {
      return [];
    },
  };
}
