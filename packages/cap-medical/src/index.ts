import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import Database from 'better-sqlite3';

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

  function applyMedicalMigrations(db: Database.Database): void {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
    const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
    const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
    for (const migration of getMedicalMigrations()) {
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
      id: 'medical',
      name: 'Medical',
      version: '1.0.0',
      domain: 'medical',
      dependencies: [],
    },
    initialize(context: CapabilityContext): void {
      const storesDir = context.paths.capabilityStoresDir;
      mkdirSync(storesDir, { recursive: true });
      const dbPath = join(storesDir, 'medical.db');
      medicalDb = new Database(dbPath);
      medicalDb.pragma('journal_mode = WAL');
      medicalDb.pragma('foreign_keys = ON');
      applyMedicalMigrations(medicalDb);

      const dbHandle = medicalDb as unknown as CapabilityContext['appDb'];
      medicalService = new MedicalService(dbHandle);
      searchService = new MedicalSearchService(dbHandle);
      digestService = new MedicalDigestService(medicalService, context);
      context.log.info('cap-medical initialized', { dbPath });
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
