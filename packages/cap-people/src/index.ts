import { join } from 'node:path';

import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import { openCapabilityDb } from '@popeye/cap-common';
import type Database from 'better-sqlite3';

import { getPeopleMigrations } from './migrations.js';
import { PeopleService } from './people-service.js';

export { getPeopleMigrations } from './migrations.js';
export { PeopleService, type PersonProjectionSeed } from './people-service.js';

export function createPeopleCapability(): CapabilityModule {
  let peopleDb: Database.Database | null = null;
  let peopleService: PeopleService | null = null;

  return {
    descriptor: {
      id: 'people',
      name: 'People',
      version: '1.0.0',
      domain: 'people',
      dependencies: [],
    },
    initialize(context: CapabilityContext): void {
      const storesDir = context.paths.capabilityStoresDir;
      peopleDb = openCapabilityDb(storesDir, 'people.db', getPeopleMigrations());
      peopleService = new PeopleService(peopleDb as unknown as CapabilityContext['appDb']);
      context.log.info('cap-people initialized', { dbPath: join(storesDir, 'people.db') });
    },
    shutdown(): void {
      peopleService = null;
      if (peopleDb) {
        peopleDb.close();
        peopleDb = null;
      }
    },
    healthCheck() {
      return { healthy: peopleService !== null && peopleDb !== null };
    },
    getMigrations() {
      return [];
    },
  };
}
