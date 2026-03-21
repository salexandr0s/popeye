import BetterSqlite3 from 'better-sqlite3';
import { existsSync } from 'node:fs';
import type { CapabilityContext } from '@popeye/contracts';
import type { CapabilityRegistry } from './capability-registry.js';

type CapabilityDbHandle = CapabilityContext['appDb'];

export class CapabilityFacade<TService, TSearch = never> {
  private readDb: BetterSqlite3.Database | null = null;
  private serviceCache: TService | null = null;
  private searchCache: TSearch | null = null;

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly storesDir: string,
    private readonly capabilityName: string,
    private readonly dbFileName: string,
    private readonly createService: (db: CapabilityDbHandle) => TService,
    private readonly createSearch?: ((db: CapabilityDbHandle) => TSearch) | undefined,
  ) {}

  getReadDb(): BetterSqlite3.Database | null {
    if (this.readDb) return this.readDb;
    const cap = this.registry.getCapability(this.capabilityName);
    if (!cap) return null;
    const dbPath = `${this.storesDir}/${this.dbFileName}`;
    if (!existsSync(dbPath)) return null;
    this.readDb = new BetterSqlite3(dbPath, { readonly: true });
    return this.readDb;
  }

  getService(): TService | null {
    if (this.serviceCache) return this.serviceCache;
    const db = this.getReadDb();
    if (!db) return null;
    this.serviceCache = this.createService(db as unknown as CapabilityDbHandle);
    return this.serviceCache;
  }

  getSearch(): TSearch | null {
    if (this.searchCache) return this.searchCache;
    if (!this.createSearch) return null;
    const db = this.getReadDb();
    if (!db) return null;
    this.searchCache = this.createSearch(db as unknown as CapabilityDbHandle);
    return this.searchCache;
  }

  invalidate(): void {
    if (this.readDb) {
      this.readDb.close();
      this.readDb = null;
    }
    this.serviceCache = null;
    this.searchCache = null;
  }
}
