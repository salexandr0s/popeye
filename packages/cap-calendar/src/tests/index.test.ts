import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { createCalendarCapability } from '../index.js';

function makeCtx(tempDir: string): CapabilityContext {
  return {
    appDb: {} as CapabilityContext['appDb'],
    memoryDb: {} as CapabilityContext['appDb'],
    paths: {
      capabilityStoresDir: tempDir,
      runtimeDataDir: tempDir,
      logsDir: tempDir,
      cacheDir: tempDir,
    } as CapabilityContext['paths'],
    config: { security: { redactionPatterns: [] } },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    auditCallback: () => {},
    memoryInsert: () => ({ memoryId: 'mem-1', embedded: false }),
    approvalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
  };
}

describe('createCalendarCapability', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'popeye-capcalendar-cap-'));
  });

  afterEach(() => {
    // Cleanup handled by OS tmp
  });

  it('full lifecycle: init → tools → timers → shutdown', async () => {
    const cap = createCalendarCapability();

    expect(cap.descriptor.id).toBe('calendar');
    expect(cap.descriptor.domain).toBe('calendar');
    expect(cap.descriptor.version).toBe('1.0.0');

    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    const health = cap.healthCheck();
    expect(health.healthy).toBe(true);

    const tools = cap.getRuntimeTools!({ workspaceId: 'default' });
    expect(tools.length).toBe(4);
    expect(tools.map((t) => t.name)).toContain('popeye_calendar_today');
    expect(tools.map((t) => t.name)).toContain('popeye_calendar_search');
    expect(tools.map((t) => t.name)).toContain('popeye_calendar_availability');
    expect(tools.map((t) => t.name)).toContain('popeye_calendar_digest');

    const timers = cap.getTimers!();
    expect(timers.length).toBe(2);
    expect(timers.map((t) => t.id)).toContain('calendar-sync');
    expect(timers.map((t) => t.id)).toContain('calendar-digest');

    const migrations = cap.getMigrations!();
    expect(migrations.length).toBe(0);

    await cap.shutdown();
    const postShutdownHealth = cap.healthCheck();
    expect(postShutdownHealth.healthy).toBe(false);
  });

  it('creates calendar.db in capabilityStoresDir', async () => {
    const cap = createCalendarCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    const db = new Database(join(tempDir, 'calendar.db'), { readonly: true });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('calendar_accounts');
    expect(tableNames).toContain('calendar_events');
    expect(tableNames).toContain('calendar_digests');
    expect(tableNames).toContain('calendar_events_fts');
    expect(tableNames).toContain('schema_migrations');

    db.close();
    await cap.shutdown();
  });

  it('tools return appropriate messages when no accounts', async () => {
    const cap = createCalendarCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    const tools = cap.getRuntimeTools!({ workspaceId: 'default' });

    const todayTool = tools.find((t) => t.name === 'popeye_calendar_today')!;
    const todayResult = await todayTool.execute({});
    expect(todayResult.content[0]!.text).toContain('No calendar accounts');

    const searchTool = tools.find((t) => t.name === 'popeye_calendar_search')!;
    const searchResult = await searchTool.execute({ query: 'test' });
    expect(searchResult.content[0]!.text).toContain('No matching calendar');

    const availTool = tools.find((t) => t.name === 'popeye_calendar_availability')!;
    const availResult = await availTool.execute({ date: '2025-01-15' });
    expect(availResult.content[0]!.text).toContain('No calendar accounts');

    const digestTool = tools.find((t) => t.name === 'popeye_calendar_digest')!;
    const digestResult = await digestTool.execute({});
    expect(digestResult.content[0]!.text).toContain('No calendar accounts');

    await cap.shutdown();
  });

  it('survives double shutdown', async () => {
    const cap = createCalendarCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    await cap.shutdown();
    await cap.shutdown();
    expect(cap.healthCheck().healthy).toBe(false);
  });
});
