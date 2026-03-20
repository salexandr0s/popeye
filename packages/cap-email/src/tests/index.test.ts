import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { createEmailCapability } from '../index.js';

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
    actionApprovalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
  };
}

describe('createEmailCapability', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'popeye-capemail-cap-'));
  });

  afterEach(() => {
    // Cleanup handled by OS tmp
  });

  it('full lifecycle: init → tools → timers → shutdown', async () => {
    const cap = createEmailCapability();

    expect(cap.descriptor.id).toBe('email');
    expect(cap.descriptor.domain).toBe('email');
    expect(cap.descriptor.version).toBe('1.0.0');

    // Initialize (creates email.db)
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    // Health check
    const health = cap.healthCheck();
    expect(health.healthy).toBe(true);

    // Get tools
    const tools = cap.getRuntimeTools!({ workspaceId: 'default' });
    expect(tools.length).toBe(4);
    expect(tools.map((t) => t.name)).toContain('popeye_email_search');
    expect(tools.map((t) => t.name)).toContain('popeye_email_digest');
    expect(tools.map((t) => t.name)).toContain('popeye_email_thread');
    expect(tools.map((t) => t.name)).toContain('popeye_email_message');

    // Get timers
    const timers = cap.getTimers!();
    expect(timers.length).toBe(2);
    expect(timers.map((t) => t.id)).toContain('email-sync');
    expect(timers.map((t) => t.id)).toContain('email-digest');

    // Migrations (empty — email.db is self-managed)
    const migrations = cap.getMigrations!();
    expect(migrations.length).toBe(0);

    // Shutdown
    await cap.shutdown();
    const postShutdownHealth = cap.healthCheck();
    expect(postShutdownHealth.healthy).toBe(false);
  });

  it('creates email.db in capabilityStoresDir', async () => {
    const cap = createEmailCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    // Verify email.db exists by opening it
    const db = new Database(join(tempDir, 'email.db'), { readonly: true });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('email_accounts');
    expect(tableNames).toContain('email_threads');
    expect(tableNames).toContain('email_messages');
    expect(tableNames).toContain('email_digests');
    expect(tableNames).toContain('email_threads_fts');
    expect(tableNames).toContain('schema_migrations');

    db.close();
    await cap.shutdown();
  });

  it('tools return appropriate messages when no accounts', async () => {
    const cap = createEmailCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    const tools = cap.getRuntimeTools!({ workspaceId: 'default' });

    // Search with no data
    const searchTool = tools.find((t) => t.name === 'popeye_email_search')!;
    const searchResult = await searchTool.execute({ query: 'test' });
    expect(searchResult.content[0]!.text).toContain('No matching emails');

    // Digest with no accounts
    const digestTool = tools.find((t) => t.name === 'popeye_email_digest')!;
    const digestResult = await digestTool.execute({});
    expect(digestResult.content[0]!.text).toContain('No email accounts');

    // Thread not found
    const threadTool = tools.find((t) => t.name === 'popeye_email_thread')!;
    const threadResult = await threadTool.execute({ threadId: 'nonexistent' });
    expect(threadResult.content[0]!.text).toContain('Thread not found');

    // Message not found
    const messageTool = tools.find((t) => t.name === 'popeye_email_message')!;
    const messageResult = await messageTool.execute({ messageId: 'nonexistent' });
    expect(messageResult.content[0]!.text).toContain('Message not found');

    await cap.shutdown();
  });

  it('survives double shutdown', async () => {
    const cap = createEmailCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    await cap.shutdown();
    await cap.shutdown(); // Should not throw
    expect(cap.healthCheck().healthy).toBe(false);
  });
});
