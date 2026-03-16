import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../contracts/src/index.ts';
import type { EngineAdapter, EngineRunHandle } from '../../engine-pi/src/index.ts';
import { initAuthStore } from './auth.ts';
import { createRuntimeService } from './runtime-service.ts';

function makeConfig(dir: string): AppConfig {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [], promptScanQuarantinePatterns: [], promptScanSanitizePatterns: [] },
    telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: true, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  };
}

describe('recovery failure-injection', () => {
  it('mid-run crash reconciliation: stale run is abandoned with receipt on restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-recovery-crash-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);

    // Phase 1: Start runtime, create a task, wait for running state
    let resolveWait: (() => void) | null = null;
    const waitPromise = new Promise<void>((r) => { resolveWait = r; });
    const hangingEngine: EngineAdapter = {
      async startRun(_input, options) {
        const handle: EngineRunHandle = {
          pid: null,
          async cancel() { resolveWait?.(); },
          async wait() {
            await waitPromise;
            return {
              engineSessionRef: null,
              usage: { provider: 'fake', model: 'hanging', tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 },
              failureClassification: 'cancelled' as const,
            };
          },
          isAlive: () => true,
        };
        options?.onHandle?.(handle);
        options?.onEvent?.({ type: 'started', payload: { input: 'crash-test' } });
        return handle;
      },
      async run() { throw new Error('not implemented'); },
    };
    const runtime1 = createRuntimeService(config, hangingEngine);
    (runtime1 as unknown as { scheduler: { shutdownGraceMs: number } }).scheduler.shutdownGraceMs = 5;

    const created = runtime1.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'crash-reconcile-test',
      prompt: 'hello crash test',
      source: 'manual',
      autoEnqueue: true,
    });
    expect(created.job).toBeTruthy();

    // Wait for the run to reach running state
    const deadline = Date.now() + 5_000;
    let runId: string | null = null;
    while (Date.now() < deadline) {
      const runs = runtime1.listRuns();
      const running = runs.find((r) => r.state === 'running');
      if (running) {
        runId = running.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(runId).toBeTruthy();

    // Phase 2: Close runtime (simulates crash/restart)
    await runtime1.close();

    // Phase 3: Re-create runtime with same config — startup reconciliation runs
    const runtime2 = createRuntimeService(config);

    // During close(), the scheduler cancels active runs — the hanging engine
    // resolves with failureClassification: 'cancelled', so the run transitions
    // to 'cancelled' (not 'abandoned').  Startup reconciliation only marks runs
    // still in 'starting'/'running' as 'abandoned'.
    const reconciledRun = runtime2.getRun(runId!);
    expect(reconciledRun).toBeTruthy();
    expect(reconciledRun!.state).toBe('cancelled');

    // Verify a receipt was created for the cancelled run
    const receipts = runtime2.listReceipts();
    const cancelledReceipt = receipts.find((r) => r.runId === runId);
    expect(cancelledReceipt).toBeTruthy();
    expect(cancelledReceipt!.status).toBe('cancelled');

    await runtime2.close();
  });

  it('expired lease sweep: run is abandoned when lease expires', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-recovery-lease-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);

    // Start runtime and create a task
    const runtime = createRuntimeService(config);
    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'lease-expiry-test',
      prompt: 'hello lease test',
      source: 'manual',
      autoEnqueue: true,
    });
    expect(created.job).toBeTruthy();

    // Wait for the run to start and complete (fake engine completes instantly)
    const terminal = await runtime.waitForJobTerminalState(created.job!.id, 5_000);
    expect(terminal?.receipt?.status).toBe('succeeded');

    // Now set up a new task/job/run with an expired lease to simulate a stale lease scenario
    const pastTime = new Date(Date.now() - 120_000).toISOString();
    runtime.databases.app.prepare(
      'INSERT INTO tasks (id, workspace_id, project_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'task-lease-test',
      'default',
      null,
      'leaked lease task',
      'hello',
      'manual',
      'active',
      JSON.stringify({ maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 }),
      'read_only',
      pastTime,
    );

    runtime.databases.app.prepare(
      'INSERT INTO jobs (id, task_id, workspace_id, status, retry_count, available_at, last_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('job-lease-test', 'task-lease-test', 'default', 'leased', 0, pastTime, null, pastTime, pastTime);

    // Insert an expired lease
    runtime.databases.app.prepare(
      'INSERT INTO job_leases (job_id, lease_owner, lease_expires_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('job-lease-test', 'popeyed:test', pastTime, pastTime);

    // Trigger scheduler tick — should sweep the expired lease
    await runtime.runSchedulerCycle();

    // Verify the job was requeued after lease sweep
    const job = runtime.listJobs().find((j) => j.id === 'job-lease-test');
    expect(job).toBeTruthy();
    expect(job!.status).toBe('queued');

    // Verify the lease was cleaned up
    const lease = runtime.getJobLease('job-lease-test');
    expect(lease).toBeNull();

    await runtime.close();
  });
});
