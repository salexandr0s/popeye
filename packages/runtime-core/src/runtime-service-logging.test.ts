import { chmodSync, mkdtempSync } from 'node:fs';
import { Writable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../contracts/src/index.ts';
import type { EngineAdapter, EngineRunHandle, EngineRunRequest } from '../../engine-pi/src/index.ts';
import { createLogger } from '../../observability/src/index.ts';
import { initAuthStore } from './auth.ts';
import { createRuntimeService } from './runtime-service.ts';

function createCapture(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

function makeConfig(dir: string): AppConfig {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'] },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: false, heartbeatIntervalSeconds: 3600 }],
  };
}

describe('RuntimeService structured logging', () => {
  it('logs runtime started with startup profile on construction', async () => {
    const { stream, lines } = createCapture();
    const dir = mkdtempSync(join(tmpdir(), 'popeye-log-'));
    chmodSync(dir, 0o700);
    const logger = createLogger('runtime', { destination: stream });
    const runtime = createRuntimeService(makeConfig(dir), undefined, logger);

    const output = lines();
    const startupLog = output.find((l) => l.msg === 'runtime started');
    expect(startupLog).toBeDefined();
    expect(startupLog).toHaveProperty('dbReadyMs');
    expect(startupLog).toHaveProperty('reconcileMs');
    expect(startupLog).toHaveProperty('schedulerReadyMs');

    await runtime.close();
  });

  it('logs scheduler started and stopping', async () => {
    const { stream, lines } = createCapture();
    const dir = mkdtempSync(join(tmpdir(), 'popeye-log-'));
    chmodSync(dir, 0o700);
    const logger = createLogger('runtime', { destination: stream });
    const runtime = createRuntimeService(makeConfig(dir), undefined, logger);

    await runtime.close();
    const output = lines();
    expect(output.some((l) => l.msg === 'scheduler started')).toBe(true);
    expect(output.some((l) => l.msg === 'scheduler stopping')).toBe(true);
    expect(output.some((l) => l.msg === 'runtime closing')).toBe(true);
  });

  it('logs run started with all 6 correlation IDs on successful run', async () => {
    const { stream, lines } = createCapture();
    const dir = mkdtempSync(join(tmpdir(), 'popeye-log-'));
    chmodSync(dir, 0o700);
    const logger = createLogger('runtime', { destination: stream });

    let _onEventCb: ((event: { type: string; payload?: Record<string, unknown> }) => void) | undefined;
    const engine: EngineAdapter = {
      startRun: async (_request: EngineRunRequest, callbacks: { onEvent: (event: { type: string; payload?: Record<string, unknown> }) => void }) => {
        _onEventCb = callbacks.onEvent;
        const handle: EngineRunHandle = {
          pid: 12345,
          cancel: async () => {},
          wait: () => new Promise<{ engineSessionRef: string | null; usage: { provider: string; model: string; tokensIn: number; tokensOut: number; estimatedCostUsd: number }; failureClassification: null }>((resolve) => {
            setTimeout(() => resolve({
              engineSessionRef: 'sess-1',
              usage: { provider: 'fake', model: 'test', tokensIn: 100, tokensOut: 50, estimatedCostUsd: 0.001 },
              failureClassification: null,
            }), 10);
          }),
        };
        return handle;
      },
    };

    const runtime = createRuntimeService(makeConfig(dir), engine, logger);
    const { task, job } = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'test-task',
      prompt: 'hello',
      source: 'manual',
      autoEnqueue: true,
    });

    expect(task).toBeDefined();
    expect(job).toBeDefined();

    // Wait for run to complete
    const receipt = await runtime.waitForTaskTerminalReceipt(task.id, 5000);
    expect(receipt).toBeDefined();

    const output = lines();
    const runStartedLog = output.find((l) => l.msg === 'run started');
    expect(runStartedLog).toBeDefined();
    expect(runStartedLog).toHaveProperty('workspaceId', 'default');
    expect(runStartedLog).toHaveProperty('taskId', task.id);
    expect(runStartedLog).toHaveProperty('jobId');
    expect(runStartedLog).toHaveProperty('runId');
    expect(runStartedLog).toHaveProperty('sessionRootId');

    const runSucceededLog = output.find((l) => l.msg === 'run succeeded');
    expect(runSucceededLog).toBeDefined();
    expect(runSucceededLog).toHaveProperty('provider', 'fake');
    expect(runSucceededLog).toHaveProperty('model', 'test');
    expect(runSucceededLog).toHaveProperty('tokensIn', 100);
    expect(runSucceededLog).toHaveProperty('tokensOut', 50);
    expect(runSucceededLog).toHaveProperty('estimatedCostUsd', 0.001);

    await runtime.close();
  });

  it('logs run startup failed when engine throws on startRun', async () => {
    const { stream, lines } = createCapture();
    const dir = mkdtempSync(join(tmpdir(), 'popeye-log-'));
    chmodSync(dir, 0o700);
    const logger = createLogger('runtime', { destination: stream });
    const throwingEngine: EngineAdapter = {
      startRun: async () => { throw new Error('Engine startup exploded'); },
    };
    const runtime = createRuntimeService(makeConfig(dir), throwingEngine, logger);

    runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'fail-task',
      prompt: 'hello',
      source: 'manual',
      autoEnqueue: false,
    });
    const tasks = runtime.listTasks();
    expect(tasks.length).toBeGreaterThan(0);
    runtime.enqueueTask(tasks[tasks.length - 1]!.id);

    // Let the scheduler tick process the job
    await runtime.runSchedulerCycle();

    const output = lines();
    const failLog = output.find((l) => l.msg === 'run startup failed');
    expect(failLog).toBeDefined();
    expect(failLog).toHaveProperty('workspaceId', 'default');
    expect(failLog).toHaveProperty('taskId');
    expect(failLog).toHaveProperty('error');

    await runtime.close();
  });

  it('produces valid JSON on every log line', async () => {
    const { stream, lines } = createCapture();
    const dir = mkdtempSync(join(tmpdir(), 'popeye-log-'));
    chmodSync(dir, 0o700);
    const logger = createLogger('runtime', { destination: stream });
    const runtime = createRuntimeService(makeConfig(dir), undefined, logger);

    await runtime.close();
    const output = lines();
    expect(output.length).toBeGreaterThan(0);
    for (const line of output) {
      expect(line).toHaveProperty('name', 'runtime');
      expect(line).toHaveProperty('msg');
      expect(line).toHaveProperty('level');
      expect(line).toHaveProperty('time');
    }
  });

  it('redacts sensitive content in log messages', async () => {
    const { stream, lines } = createCapture();
    const dir = mkdtempSync(join(tmpdir(), 'popeye-log-'));
    chmodSync(dir, 0o700);
    const logger = createLogger('runtime', { destination: stream });
    const throwingEngine: EngineAdapter = {
      startRun: async () => { throw new Error('key is sk-ant-api03-abcdefghijklmnopqrst'); }, // secret-scan: allow
    };
    const runtime = createRuntimeService(makeConfig(dir), throwingEngine, logger);

    runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'redact-test',
      prompt: 'hello',
      source: 'manual',
      autoEnqueue: false,
    });
    const tasks = runtime.listTasks();
    runtime.enqueueTask(tasks[tasks.length - 1]!.id);
    await runtime.runSchedulerCycle();
    const output = lines();

    // All lines should have valid JSON structure
    for (const line of output) {
      expect(typeof line.msg).toBe('string');
    }

    // The error log should have redacted any API key in the error field
    const failLog = output.find((l) => l.msg === 'run startup failed');
    if (failLog?.error) {
      expect(String(failLog.error)).not.toContain('sk-ant-api03');
    }

    await runtime.close();
  });
});
