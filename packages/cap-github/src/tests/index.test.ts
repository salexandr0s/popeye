import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { createGithubCapability } from '../index.js';

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

describe('createGithubCapability', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'popeye-capgithub-cap-'));
  });

  afterEach(() => {
    // Cleanup handled by OS tmp
  });

  it('full lifecycle: init → tools → timers → shutdown', async () => {
    const cap = createGithubCapability();

    expect(cap.descriptor.id).toBe('github');
    expect(cap.descriptor.domain).toBe('github');
    expect(cap.descriptor.version).toBe('1.0.0');

    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    const health = cap.healthCheck();
    expect(health.healthy).toBe(true);

    const tools = cap.getRuntimeTools!({ workspaceId: 'default' });
    expect(tools.length).toBe(5);
    expect(tools.map((t) => t.name)).toContain('popeye_github_search');
    expect(tools.map((t) => t.name)).toContain('popeye_github_digest');
    expect(tools.map((t) => t.name)).toContain('popeye_github_pr');
    expect(tools.map((t) => t.name)).toContain('popeye_github_issue');
    expect(tools.map((t) => t.name)).toContain('popeye_github_notifications');

    const timers = cap.getTimers!();
    expect(timers.length).toBe(2);
    expect(timers.map((t) => t.id)).toContain('github-sync');
    expect(timers.map((t) => t.id)).toContain('github-digest');

    const migrations = cap.getMigrations!();
    expect(migrations.length).toBe(0);

    await cap.shutdown();
    const postShutdownHealth = cap.healthCheck();
    expect(postShutdownHealth.healthy).toBe(false);
  });

  it('creates github.db in capabilityStoresDir', async () => {
    const cap = createGithubCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    const db = new Database(join(tempDir, 'github.db'), { readonly: true });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('github_accounts');
    expect(tableNames).toContain('github_repos');
    expect(tableNames).toContain('github_pull_requests');
    expect(tableNames).toContain('github_issues');
    expect(tableNames).toContain('github_notifications');
    expect(tableNames).toContain('github_digests');
    expect(tableNames).toContain('github_pull_requests_fts');
    expect(tableNames).toContain('github_issues_fts');
    expect(tableNames).toContain('schema_migrations');

    db.close();
    await cap.shutdown();
  });

  it('tools return appropriate messages when no accounts', async () => {
    const cap = createGithubCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    const tools = cap.getRuntimeTools!({ workspaceId: 'default' });

    const searchTool = tools.find((t) => t.name === 'popeye_github_search')!;
    const searchResult = await searchTool.execute({ query: 'test' });
    expect(searchResult.content[0]!.text).toContain('No matching GitHub');

    const digestTool = tools.find((t) => t.name === 'popeye_github_digest')!;
    const digestResult = await digestTool.execute({});
    expect(digestResult.content[0]!.text).toContain('No GitHub accounts');

    const prTool = tools.find((t) => t.name === 'popeye_github_pr')!;
    const prResult = await prTool.execute({ prId: 'nonexistent' });
    expect(prResult.content[0]!.text).toContain('Pull request not found');

    const issueTool = tools.find((t) => t.name === 'popeye_github_issue')!;
    const issueResult = await issueTool.execute({ issueId: 'nonexistent' });
    expect(issueResult.content[0]!.text).toContain('Issue not found');

    const notifTool = tools.find((t) => t.name === 'popeye_github_notifications')!;
    const notifResult = await notifTool.execute({});
    expect(notifResult.content[0]!.text).toContain('No GitHub accounts');

    await cap.shutdown();
  });

  it('survives double shutdown', async () => {
    const cap = createGithubCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    await cap.shutdown();
    await cap.shutdown();
    expect(cap.healthCheck().healthy).toBe(false);
  });
});
