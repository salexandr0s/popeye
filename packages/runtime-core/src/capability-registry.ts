import type Database from 'better-sqlite3';
import type {
  CapabilityContext,
  CapabilityDescriptor,
  CapabilityMigration,
  CapabilityModule,
  CapabilityToolDescriptor,
} from '@popeye/contracts';

import { applyMigrations, type Migration } from './database.js';

export interface CapabilityRegistryDeps {
  appDb: Database.Database;
  memoryDb: Database.Database;
  buildContext: () => CapabilityContext;
  log?: { error: (msg: string, meta?: Record<string, unknown>) => void };
}

interface RegisteredCapability {
  module: CapabilityModule;
  initialized: boolean;
  timers: Array<ReturnType<typeof setInterval>>;
}

export interface ResolvedCapabilityTool {
  capabilityId: string;
  tool: CapabilityToolDescriptor;
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, RegisteredCapability>();
  private readonly deps: CapabilityRegistryDeps;
  private initializationComplete = false;

  constructor(deps: CapabilityRegistryDeps) {
    this.deps = deps;
  }

  register(cap: CapabilityModule): void {
    const id = cap.descriptor.id;
    if (this.capabilities.has(id)) {
      throw new Error(`Capability already registered: ${id}`);
    }
    // Validate descriptor
    if (!id || !cap.descriptor.name || !cap.descriptor.version || !cap.descriptor.domain) {
      throw new Error(`Invalid capability descriptor: missing required fields`);
    }
    this.capabilities.set(id, { module: cap, initialized: false, timers: [] });
  }

  async initializeAll(): Promise<void> {
    if (this.initializationComplete) return;

    // Topological sort by dependencies
    const sorted = this.topologicalSort();

    // Run migrations first (all caps, in order)
    for (const entry of sorted) {
      const migrations = entry.module.getMigrations?.() ?? [];
      if (migrations.length > 0) {
        this.runCapabilityMigrations(entry.module.descriptor.id, migrations);
      }
    }

    // Initialize in dependency order
    const ctx = this.deps.buildContext();
    for (const entry of sorted) {
      await entry.module.initialize(ctx);
      entry.initialized = true;

      // Start timers
      const timers = entry.module.getTimers?.() ?? [];
      for (const timer of timers) {
        const logTimerError = (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.deps.log?.error(`Capability timer "${timer.id}" error: ${msg}`, { capabilityId: entry.module.descriptor.id, timerId: timer.id });
        };
        if (timer.immediate) {
          Promise.resolve(timer.handler()).catch(logTimerError);
        }
        const handle = setInterval(() => {
          Promise.resolve(timer.handler()).catch(logTimerError);
        }, timer.intervalMs);
        entry.timers.push(handle);
      }
    }

    this.initializationComplete = true;
  }

  async shutdownAll(): Promise<void> {
    // Reverse order (reverse of initialization)
    const sorted = this.topologicalSort();
    sorted.reverse();

    for (const entry of sorted) {
      // Clear timers first
      for (const timer of entry.timers) {
        clearInterval(timer);
      }
      entry.timers = [];

      if (entry.initialized) {
        await entry.module.shutdown();
        entry.initialized = false;
      }
    }
  }

  getRuntimeTools(taskContext: { workspaceId: string; runId?: string }): ResolvedCapabilityTool[] {
    const tools: ResolvedCapabilityTool[] = [];
    for (const [capabilityId, entry] of this.capabilities) {
      if (!entry.initialized) continue;
      const capTools = entry.module.getRuntimeTools?.(taskContext) ?? [];
      tools.push(...capTools.map((tool) => ({ capabilityId, tool })));
    }
    return tools;
  }

  healthCheck(): Record<string, { healthy: boolean; details?: Record<string, unknown> }> {
    const result: Record<string, { healthy: boolean; details?: Record<string, unknown> }> = {};
    for (const [id, entry] of this.capabilities) {
      if (!entry.initialized) {
        result[id] = { healthy: false, details: { reason: 'not_initialized' } };
        continue;
      }
      result[id] = entry.module.healthCheck();
    }
    return result;
  }

  getCapability(id: string): CapabilityModule | undefined {
    return this.capabilities.get(id)?.module;
  }

  listCapabilities(): CapabilityDescriptor[] {
    return Array.from(this.capabilities.values()).map((e) => e.module.descriptor);
  }

  private runCapabilityMigrations(capId: string, migrations: CapabilityMigration[]): void {
    const appMigrations: Migration[] = [];
    const memoryMigrations: Migration[] = [];

    for (const m of migrations) {
      const migration: Migration = { id: `${capId}-${m.id}`, statements: m.statements };
      if (m.db === 'app') appMigrations.push(migration);
      else memoryMigrations.push(migration);
    }

    if (appMigrations.length > 0) {
      applyMigrations(this.deps.appDb, appMigrations);
    }
    if (memoryMigrations.length > 0) {
      applyMigrations(this.deps.memoryDb, memoryMigrations);
    }
  }

  private topologicalSort(): RegisteredCapability[] {
    const entries = Array.from(this.capabilities.entries());
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const sorted: RegisteredCapability[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Dependency cycle detected involving capability "${id}"`);
      }
      visiting.add(id);

      const entry = this.capabilities.get(id);
      if (!entry) return;

      for (const dep of entry.module.descriptor.dependencies) {
        if (!this.capabilities.has(dep)) {
          throw new Error(`Capability "${id}" depends on "${dep}" which is not registered`);
        }
        visit(dep);
      }

      visiting.delete(id);
      visited.add(id);
      sorted.push(entry);
    };

    for (const [id] of entries) {
      visit(id);
    }

    return sorted;
  }
}
