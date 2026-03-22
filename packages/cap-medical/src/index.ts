import { join } from 'node:path';

import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import { openCapabilityDb } from '@popeye/cap-common';
import type Database from 'better-sqlite3';

import { getMedicalMigrations } from './migrations.js';
import { MedicalService } from './medical-service.js';
import { MedicalSearchService } from './search-service.js';
import { MedicalDigestService } from './digest-service.js';

export { getMedicalMigrations } from './migrations.js';
export { MedicalService } from './medical-service.js';
export { MedicalSearchService } from './search-service.js';
export { MedicalDigestService } from './digest-service.js';

export function createMedicalCapability(): CapabilityModule {
  let medicalDb: Database.Database | null = null;
  let medicalService: MedicalService | null = null;
  let searchService: MedicalSearchService | null = null;
  let digestService: MedicalDigestService | null = null;

  return {
    descriptor: {
      id: 'medical',
      name: 'Medical',
      version: '1.0.0',
      domain: 'medical',
      dependencies: [],
    },
    initialize(context: CapabilityContext): void {
      const storesDir = context.paths.capabilityStoresDir;
      medicalDb = openCapabilityDb(storesDir, 'medical.db', getMedicalMigrations());
      const dbHandle = medicalDb as unknown as CapabilityContext['appDb'];
      medicalService = new MedicalService(dbHandle);
      searchService = new MedicalSearchService(dbHandle);
      digestService = new MedicalDigestService(medicalService, context);
      context.log.info('cap-medical initialized', { dbPath: join(storesDir, 'medical.db') });
    },
    shutdown(): void {
      medicalService = null;
      searchService = null;
      digestService = null;
      if (medicalDb) {
        medicalDb.close();
        medicalDb = null;
      }
    },
    healthCheck() {
      return {
        healthy: medicalService !== null
          && searchService !== null
          && digestService !== null
          && medicalDb !== null,
      };
    },
    getMigrations() {
      return [];
    },
  };
}
