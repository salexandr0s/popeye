import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import Database from 'better-sqlite3';

import { getPeopleMigrations } from './migrations.js';
import { PeopleService } from './people-service.js';

export { getPeopleMigrations } from './migrations.js';
export { PeopleService, type PersonProjectionSeed } from './people-service.js';

export function createPeopleCapability(): CapabilityModule {
  let peopleDb: Database.Database | null = null;
  let peopleService: PeopleService | null = null;

  function applyPeopleMigrations(db: Database.Database): void {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
    const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
    const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
    for (const migration of getPeopleMigrations()) {
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
      id: 'people',
      name: 'People',
      version: '1.0.0',
      domain: 'people',
      dependencies: [],
    },
    initialize(context: CapabilityContext): void {
      const storesDir = context.paths.capabilityStoresDir;
      mkdirSync(storesDir, { recursive: true });
      const dbPath = join(storesDir, 'people.db');
      peopleDb = new Database(dbPath);
      peopleDb.pragma('journal_mode = WAL');
      peopleDb.pragma('foreign_keys = ON');
      applyPeopleMigrations(peopleDb);
      peopleService = new PeopleService(peopleDb as unknown as CapabilityContext['appDb']);
      context.log.info('cap-people initialized', { dbPath });
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
