import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import { CapabilityRegistry, type CapabilityRegistryDeps } from './capability-registry.ts';

function makeDeps(): CapabilityRegistryDeps & { cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capreg-'));
  const appDb = new Database(join(dir, 'app.db'));
  const memoryDb = new Database(join(dir, 'memory.db'));
  appDb.pragma('journal_mode = WAL');
  appDb.pragma('foreign_keys = ON');
  memoryDb.pragma('journal_mode = WAL');
  memoryDb.pragma('foreign_keys = ON');
  return {
    appDb,
    memoryDb,
    buildContext: () => ({
      appDb,
      memoryDb,
      paths: {} as CapabilityContext['paths'],
      config: {},
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      auditCallback: () => {},
      memoryInsert: () => ({ memoryId: 'test', embedded: false }),
      approvalRequest: () => ({ id: 'test', status: 'pending' }),
      actionApprovalRequest: () => ({ id: 'test', status: 'pending' }),
      contextReleaseRecord: () => ({ id: 'test' }),
      events: { emit: () => {} },
    }),
    cleanup: () => {
      appDb.close();
      memoryDb.close();
    },
  };
}

function makeCapability(overrides?: Partial<CapabilityModule> & { id?: string; deps?: string[] }): CapabilityModule {
  const id = overrides?.id ?? 'test-cap';
  return {
    descriptor: {
      id,
      name: overrides?.id ?? 'Test Capability',
      version: '1.0.0',
      domain: 'general',
      dependencies: overrides?.deps ?? [],
    },
    initialize: overrides?.initialize ?? (() => {}),
    shutdown: overrides?.shutdown ?? (() => {}),
    healthCheck: overrides?.healthCheck ?? (() => ({ healthy: true })),
    getRuntimeTools: overrides?.getRuntimeTools,
    getTimers: overrides?.getTimers,
    getMigrations: overrides?.getMigrations,
  };
}

describe('CapabilityRegistry', () => {
  let deps: ReturnType<typeof makeDeps>;
  let registry: CapabilityRegistry;

  beforeEach(() => {
    deps = makeDeps();
    registry = new CapabilityRegistry(deps);
  });

  afterEach(() => {
    deps.cleanup();
  });

  it('registers and lists capabilities', () => {
    const cap = makeCapability({ id: 'alpha' });
    registry.register(cap);
    const listed = registry.listCapabilities();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe('alpha');
  });

  it('rejects duplicate registration', () => {
    registry.register(makeCapability({ id: 'dup' }));
    expect(() => registry.register(makeCapability({ id: 'dup' }))).toThrow('already registered');
  });

  it('initializes capabilities in dependency order', async () => {
    const order: string[] = [];
    registry.register(makeCapability({
      id: 'b',
      deps: ['a'],
      initialize: () => { order.push('b'); },
    }));
    registry.register(makeCapability({
      id: 'a',
      initialize: () => { order.push('a'); },
    }));
    await registry.initializeAll();
    expect(order).toEqual(['a', 'b']);
  });

  it('throws when dependency is missing', async () => {
    registry.register(makeCapability({ id: 'x', deps: ['missing'] }));
    await expect(registry.initializeAll()).rejects.toThrow('depends on "missing"');
  });

  it('runs migrations before initialization', async () => {
    let migrationRan = false;
    let initRan = false;
    registry.register(makeCapability({
      id: 'migrating',
      getMigrations: () => [{
        id: '001-test',
        db: 'app' as const,
        statements: ['CREATE TABLE IF NOT EXISTS cap_test (id TEXT PRIMARY KEY);'],
      }],
      initialize: () => {
        // Verify table exists at init time
        const row = deps.appDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cap_test'").get();
        if (row) migrationRan = true;
        initRan = true;
      },
    }));
    await registry.initializeAll();
    expect(migrationRan).toBe(true);
    expect(initRan).toBe(true);
  });

  it('aggregates tools from capabilities', async () => {
    registry.register(makeCapability({
      id: 'tooled',
      getRuntimeTools: () => [{
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      }],
    }));
    await registry.initializeAll();
    const tools = registry.getRuntimeTools({ workspaceId: 'default' });
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      capabilityId: 'tooled',
      tool: expect.objectContaining({ name: 'test_tool' }),
    });
  });

  it('does not return tools from uninitialized capabilities', () => {
    registry.register(makeCapability({
      id: 'lazy',
      getRuntimeTools: () => [{
        name: 'lazy_tool',
        label: 'Lazy',
        description: 'lazy',
        inputSchema: {},
        execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      }],
    }));
    // Not initialized
    const tools = registry.getRuntimeTools({ workspaceId: 'default' });
    expect(tools).toHaveLength(0);
  });

  it('shutdowns in reverse dependency order', async () => {
    const order: string[] = [];
    registry.register(makeCapability({
      id: 'first',
      shutdown: () => { order.push('first'); },
    }));
    registry.register(makeCapability({
      id: 'second',
      deps: ['first'],
      shutdown: () => { order.push('second'); },
    }));
    await registry.initializeAll();
    await registry.shutdownAll();
    expect(order).toEqual(['second', 'first']);
  });

  it('reports health for each capability', async () => {
    registry.register(makeCapability({
      id: 'healthy',
      healthCheck: () => ({ healthy: true }),
    }));
    registry.register(makeCapability({
      id: 'sick',
      healthCheck: () => ({ healthy: false, details: { reason: 'test' } }),
    }));
    await registry.initializeAll();
    const health = registry.healthCheck();
    expect(health['healthy']).toEqual({ healthy: true });
    expect(health['sick']).toEqual({ healthy: false, details: { reason: 'test' } });
  });

  it('reports not_initialized for uninitialized capabilities', () => {
    registry.register(makeCapability({ id: 'pending' }));
    const health = registry.healthCheck();
    expect(health['pending']!.healthy).toBe(false);
    expect(health['pending']!.details).toEqual({ reason: 'not_initialized' });
  });

  it('retrieves capability by id', () => {
    const cap = makeCapability({ id: 'findme' });
    registry.register(cap);
    expect(registry.getCapability('findme')).toBe(cap);
    expect(registry.getCapability('nope')).toBeUndefined();
  });

  it('starts and clears timers during lifecycle', async () => {
    let timerFired = false;
    registry.register(makeCapability({
      id: 'timed',
      getTimers: () => [{
        id: 'heartbeat',
        intervalMs: 50,
        immediate: true,
        handler: () => { timerFired = true; },
      }],
    }));
    await registry.initializeAll();
    // Give immediate timer a chance to fire
    await new Promise((r) => setTimeout(r, 100));
    expect(timerFired).toBe(true);
    await registry.shutdownAll();
  });

  it('detects dependency cycles', async () => {
    registry.register(makeCapability({ id: 'cycle-a', deps: ['cycle-b'] }));
    registry.register(makeCapability({ id: 'cycle-b', deps: ['cycle-a'] }));
    await expect(registry.initializeAll()).rejects.toThrow('cycle');
  });

  it('initializeAll is idempotent', async () => {
    let count = 0;
    registry.register(makeCapability({
      id: 'once',
      initialize: () => { count++; },
    }));
    await registry.initializeAll();
    await registry.initializeAll();
    expect(count).toBe(1);
  });
});
