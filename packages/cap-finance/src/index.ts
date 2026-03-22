import { join } from 'node:path';

import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import { openCapabilityDb } from '@popeye/cap-common';
import type Database from 'better-sqlite3';

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
      financeDb = openCapabilityDb(storesDir, 'finance.db', getFinanceMigrations());
      const dbHandle = financeDb as unknown as CapabilityContext['appDb'];
      financeService = new FinanceService(dbHandle);
      searchService = new FinanceSearchService(dbHandle);
      digestService = new FinanceDigestService(financeService, context);
      context.log.info('cap-finance initialized', { dbPath: join(storesDir, 'finance.db') });
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
