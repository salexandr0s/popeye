import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import type { AppConfig } from '@popeye/contracts';
import { initAuthStore, createRuntimeService } from '@popeye/runtime-core';
import { renderReceipt } from '@popeye/receipts';
import { createControlApi } from '../../../packages/control-api/src/index.js';

const execFileAsync = promisify(execFile);

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Spawn the CLI via tsx (no config needed for help/version/error paths). */
async function runPop(...args: string[]): Promise<CliResult> {
  return runPopWithEnv(args);
}

async function runPopWithEnv(args: string[], extraEnv: Record<string, string | undefined> = {}): Promise<CliResult> {
  const tsx = resolve('node_modules', '.bin', 'tsx');
  const entry = resolve('apps', 'cli', 'src', 'index.ts');
  try {
    const { stdout, stderr } = await execFileAsync(
      tsx,
      ['--tsconfig', 'tsconfig.base.json', entry, ...args],
      {
        env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extraEnv },
        timeout: 15_000,
      },
    );
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
  }
}

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

  it('run envelope: prints the persisted execution envelope for a completed run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-cli-run-envelope-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    runtime.startScheduler();

    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'run-envelope-task',
      prompt: 'test run envelope',
      source: 'manual',
      autoEnqueue: true,
    });

    const terminal = await runtime.waitForJobTerminalState(created.job!.id, 5_000);
    expect(terminal?.run?.id).toBeTruthy();

    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        ...config,
        security: {
          ...config.security,
          bindPort: address.port,
        },
      }),
      'utf8',
    );

    const result = await runPopWithEnv(
      ['run', 'envelope', terminal!.run!.id],
      { POPEYE_CONFIG_PATH: configPath },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Execution Envelope');
    expect(result.stdout).toContain(`Profile:              ${terminal!.run!.profileId}`);
    expect(result.stdout).toContain('Scratch root:');

    await app.close();
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

describe('CLI help and discoverability', () => {
  it('--help with no command prints help with version and exits 0', async () => {
    const r = await runPop('--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('pop v0.1.0');
    expect(r.stdout).toContain('Popeye CLI');
    expect(r.stdout).toContain('--version');
    expect(r.stdout).toContain('--json');
  });

  it('--version prints version and exits 0', async () => {
    const r = await runPop('--version');
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('pop v0.1.0');
  });

  it('pop auth --help prints auth subcommands', async () => {
    const r = await runPop('auth', '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('pop auth');
    expect(r.stdout).toContain('init');
    expect(r.stdout).toContain('rotate');
  });

  it('pop daemon --help prints daemon health subcommand', async () => {
    const r = await runPop('daemon', '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('health');
  });

  it('pop approvals --help prints approval subcommands', async () => {
    const r = await runPop('approvals', '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('list');
    expect(r.stdout).toContain('approve');
    expect(r.stdout).toContain('deny');
  });

  it('pop vaults --help prints vault subcommands', async () => {
    const r = await runPop('vaults', '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('create');
    expect(r.stdout).toContain('open');
    expect(r.stdout).toContain('seal');
  });

  it('pop profile --help prints profile subcommands', async () => {
    const r = await runPop('profile', '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('list');
    expect(r.stdout).toContain('show');
  });

  it('pop run --help prints run envelope subcommand', async () => {
    const r = await runPop('run', '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('show');
    expect(r.stdout).toContain('envelope');
  });

  it('pop task run --help prints task run usage', async () => {
    const r = await runPop('task', 'run', '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('pop task run');
    expect(r.stdout).toContain('--profile <id>');
  });

  it('unknown command exits 1 with error', async () => {
    const r = await runPop('bogus');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Unknown command: bogus');
  });

  it('unknown subcommand exits 1 with error and shows command help', async () => {
    const r = await runPop('daemon', 'bogus');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Unknown subcommand: daemon bogus');
    expect(r.stdout).toContain('pop daemon');
  });

  it('bare pop (no args) prints help and exits 0', async () => {
    const r = await runPop();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('pop v0.1.0');
  });
});
