import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppConfig } from '@popeye/contracts';
import { initAuthStore, createRuntimeService } from '@popeye/runtime-core';
import { renderReceipt } from '@popeye/receipts';

function makeConfig(dir: string): AppConfig {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: true, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  };
}

describe('CLI command workflows (service-level)', () => {
  // 1. `task run` workflow
  it('task run: createTask with autoEnqueue, startScheduler, waitForJobTerminalState produces succeeded result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-cli-taskrun-'));
    chmodSync(dir, 0o700);
    const runtime = createRuntimeService(makeConfig(dir));
    runtime.startScheduler();

    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'cli-task',
      prompt: 'hello from pop',
      source: 'manual',
      autoEnqueue: true,
    });

    expect(created.task).toBeTruthy();
    expect(created.task.id).toBeTruthy();
    expect(created.job).toBeTruthy();
    expect(created.job?.id).toBeTruthy();

    const terminal = await runtime.waitForJobTerminalState(created.job!.id, 5_000);
    expect(terminal).not.toBeNull();
    expect(terminal?.job.status).toBe('succeeded');
    expect(terminal?.run).not.toBeNull();
    expect(terminal?.run?.state).toBe('succeeded');
    expect(terminal?.receipt).not.toBeNull();
    expect(terminal?.receipt?.status).toBe('succeeded');

    await runtime.close();
  });

  // 2. `run show` workflow
  it('run show: getRun returns valid run with terminal state after task run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-cli-runshow-'));
    chmodSync(dir, 0o700);
    const runtime = createRuntimeService(makeConfig(dir));
    runtime.startScheduler();

    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'run-show-task',
      prompt: 'test run show',
      source: 'manual',
      autoEnqueue: true,
    });

    const terminal = await runtime.waitForJobTerminalState(created.job!.id, 5_000);
    expect(terminal?.run).not.toBeNull();

    const runId = terminal!.run!.id;
    const run = runtime.getRun(runId);

    expect(run).not.toBeNull();
    expect(run!.id).toBe(runId);
    expect(run!.jobId).toBe(created.job!.id);
    expect(run!.taskId).toBe(created.task.id);
    expect(run!.workspaceId).toBe('default');
    expect(run!.state).toBe('succeeded');
    expect(run!.startedAt).toBeTruthy();
    expect(run!.finishedAt).toBeTruthy();
    expect(run!.sessionRootId).toBeTruthy();

    await runtime.close();
  });

  // 3. `receipt show` workflow
  it('receipt show: getReceipt returns receipt with complete usage metrics', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-cli-rcptshow-'));
    chmodSync(dir, 0o700);
    const runtime = createRuntimeService(makeConfig(dir));
    runtime.startScheduler();

    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'receipt-show-task',
      prompt: 'test receipt show',
      source: 'manual',
      autoEnqueue: true,
    });

    const terminal = await runtime.waitForJobTerminalState(created.job!.id, 5_000);
    expect(terminal?.receipt).not.toBeNull();

    const receiptId = terminal!.receipt!.id;
    const receipt = runtime.getReceipt(receiptId);

    expect(receipt).not.toBeNull();
    expect(receipt!.id).toBe(receiptId);
    expect(receipt!.runId).toBeTruthy();
    expect(receipt!.jobId).toBe(created.job!.id);
    expect(receipt!.taskId).toBe(created.task.id);
    expect(receipt!.workspaceId).toBe('default');
    expect(receipt!.status).toBe('succeeded');
    expect(receipt!.createdAt).toBeTruthy();

    // Verify all usage metrics are present
    expect(receipt!.usage).toBeTruthy();
    expect(typeof receipt!.usage.provider).toBe('string');
    expect(receipt!.usage.provider.length).toBeGreaterThan(0);
    expect(typeof receipt!.usage.model).toBe('string');
    expect(receipt!.usage.model.length).toBeGreaterThan(0);
    expect(typeof receipt!.usage.tokensIn).toBe('number');
    expect(receipt!.usage.tokensIn).toBeGreaterThanOrEqual(0);
    expect(typeof receipt!.usage.tokensOut).toBe('number');
    expect(receipt!.usage.tokensOut).toBeGreaterThanOrEqual(0);
    expect(typeof receipt!.usage.estimatedCostUsd).toBe('number');
    expect(receipt!.usage.estimatedCostUsd).toBeGreaterThanOrEqual(0);

    await runtime.close();
  });

  // 4. Receipt rendering
  it('renderReceipt produces human-readable string containing receipt ID, status, model, and cost', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-cli-render-'));
    chmodSync(dir, 0o700);
    const runtime = createRuntimeService(makeConfig(dir));
    runtime.startScheduler();

    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'render-task',
      prompt: 'test render receipt',
      source: 'manual',
      autoEnqueue: true,
    });

    const terminal = await runtime.waitForJobTerminalState(created.job!.id, 5_000);
    expect(terminal?.receipt).not.toBeNull();

    const receipt = runtime.getReceipt(terminal!.receipt!.id);
    expect(receipt).not.toBeNull();

    const rendered = renderReceipt(receipt!);

    expect(typeof rendered).toBe('string');
    expect(rendered.length).toBeGreaterThan(0);

    // Verify key fields appear in the rendered output
    expect(rendered).toContain(receipt!.id);
    expect(rendered).toContain(receipt!.status);
    expect(rendered).toContain(receipt!.usage.model);
    expect(rendered).toContain('$');
    expect(rendered).toContain('Receipt');
    expect(rendered).toContain('Status');
    expect(rendered).toContain('Provider');
    expect(rendered).toContain('Model');
    expect(rendered).toContain('Estimated cost');

    await runtime.close();
  });
});
