#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

import { ApiError, type PopeyeApiClient } from '@popeye/api-client';
import type { AppConfig, RunRecord } from '@popeye/contracts';
import { z } from 'zod';
import { PiEngineAdapter, runPiCompatibilityCheck } from '@popeye/engine-pi';
import { renderReceipt } from '@popeye/receipts';
import { tryConnectDaemon } from './api-client.js';
import {
  createBackup,
  createLaunchdPlist,
  daemonStatus,
  deriveRuntimePaths,
  initAuthStore,
  installLaunchAgent,
  loadLaunchAgent,
  loadAppConfig,
  restoreBackup,
  restartLaunchAgent,
  rotateAuthStore,
  runLocalSecurityAudit,
  uninstallLaunchAgent,
  unloadLaunchAgent,
  verifyBackup,
} from '@popeye/runtime-core';

// --json flag: when present, output raw JSON instead of human-readable text
const jsonFlag = process.argv.includes('--json');
const positionalArgs = process.argv.filter((a) => a !== '--json');
const [, , command, subcommand, arg1, arg2] = positionalArgs;

function formatRun(run: RunRecord): string {
  const lines = [
    `Run ${run.id}`,
    `  State:      ${run.state}`,
    `  Job:        ${run.jobId}`,
    `  Task:       ${run.taskId}`,
    `  Workspace:  ${run.workspaceId}`,
    `  Session:    ${run.sessionRootId}`,
    `  Started:    ${run.startedAt}`,
  ];
  if (run.finishedAt) lines.push(`  Finished:   ${run.finishedAt}`);
  if (run.error) lines.push(`  Error:      ${run.error}`);
  return lines.join('\n');
}

async function requireDaemonClient(config: AppConfig): Promise<PopeyeApiClient> {
  const client = await tryConnectDaemon(config);
  if (!client) {
    console.error('daemon not running');
    process.exit(1);
  }
  return client;
}

const configPath = process.env.POPEYE_CONFIG_PATH;

if (!configPath) {
  throw new Error('POPEYE_CONFIG_PATH is required');
}

const config = loadAppConfig(configPath);
mkdirSync(dirname(config.authFile), { recursive: true, mode: 0o700 });
const paths = deriveRuntimePaths(config.runtimeDataDir);

async function main(): Promise<void> {
  if (command === 'auth' && subcommand === 'init') {
    console.info(JSON.stringify(initAuthStore(config.authFile), null, 2));
    return;
  }
  if (command === 'auth' && subcommand === 'rotate') {
    console.info(JSON.stringify(rotateAuthStore(config.authFile), null, 2));
    return;
  }
  if (command === 'security' && subcommand === 'audit') {
    console.info(JSON.stringify(runLocalSecurityAudit(config), null, 2));
    return;
  }
  if (command === 'pi' && subcommand === 'smoke') {
    let smokeArgs = config.engine.args;
    if (process.env.POPEYE_PI_SMOKE_ARGS) {
      try {
        smokeArgs = z.array(z.string()).parse(JSON.parse(process.env.POPEYE_PI_SMOKE_ARGS));
      } catch {
        console.error('POPEYE_PI_SMOKE_ARGS must be a JSON array of strings');
        process.exit(1);
      }
    }
    const adapter = new PiEngineAdapter({
      piPath: process.env.POPEYE_PI_SMOKE_PATH ?? config.engine.piPath,
      command: process.env.POPEYE_PI_SMOKE_COMMAND ?? config.engine.command,
      args: smokeArgs,
    });
    console.info(JSON.stringify(await runPiCompatibilityCheck(adapter), null, 2));
    return;
  }
  if (command === 'daemon' && subcommand === 'install') {
    const daemonEntryPoint = resolve(process.cwd(), 'apps/daemon/src/index.ts');
    console.info(
      JSON.stringify(
        installLaunchAgent({
          configPath,
          daemonEntryPoint,
          workingDirectory: process.cwd(),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'daemon' && subcommand === 'start') {
    const tsxBinary = resolve(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
    const daemonEntryPoint = resolve(process.cwd(), 'apps/daemon/src/index.ts');
    await new Promise<void>((resolveStart, rejectStart) => {
      const child = spawn(tsxBinary, [daemonEntryPoint], {
        stdio: 'inherit',
        env: { ...process.env, POPEYE_CONFIG_PATH: configPath },
      });
      child.on('error', rejectStart);
      child.on('exit', (code) => {
        if (code === 0) {
          resolveStart();
          return;
        }
        rejectStart(new Error(`Daemon exited with status ${code ?? 'unknown'}`));
      });
    });
    return;
  }
  if (command === 'daemon' && subcommand === 'status') {
    console.info(JSON.stringify(daemonStatus(), null, 2));
    return;
  }
  if (command === 'daemon' && subcommand === 'load') {
    console.info(JSON.stringify(loadLaunchAgent(), null, 2));
    return;
  }
  if (command === 'daemon' && subcommand === 'stop') {
    console.info(JSON.stringify(unloadLaunchAgent(), null, 2));
    return;
  }
  if (command === 'daemon' && subcommand === 'restart') {
    console.info(JSON.stringify(restartLaunchAgent(), null, 2));
    return;
  }
  if (command === 'daemon' && subcommand === 'uninstall') {
    console.info(JSON.stringify(uninstallLaunchAgent(), null, 2));
    return;
  }
  if (command === 'daemon' && subcommand === 'plist') {
    console.info(
      createLaunchdPlist({
        configPath,
        daemonEntryPoint: resolve(process.cwd(), 'apps/daemon/src/index.ts'),
        workingDirectory: process.cwd(),
      }),
    );
    return;
  }
  if (command === 'backup' && subcommand === 'create') {
    const destination = arg1 ? resolve(arg1) : join(paths.backupsDir, new Date().toISOString().replaceAll(':', '-'));
    console.info(createBackup({ destinationDir: destination, runtimePaths: paths }));
    return;
  }
  if (command === 'backup' && subcommand === 'verify' && arg1) {
    console.info(JSON.stringify(verifyBackup(resolve(arg1)), null, 2));
    return;
  }
  if (command === 'backup' && subcommand === 'restore' && arg1) {
    restoreBackup(resolve(arg1), paths);
    console.info(JSON.stringify({ restored: true, path: resolve(arg1) }, null, 2));
    return;
  }
  if (command === 'task' && subcommand === 'run') {
    const client = await requireDaemonClient(config);
    const result = await client.createTask({
      workspaceId: 'default',
      projectId: null,
      title: arg1 ?? 'cli-task',
      prompt: arg2 ?? arg1 ?? 'hello from pop',
      source: 'manual',
      autoEnqueue: true,
    });
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      const lines = [
        `Task: ${result.task.title} (${result.task.id})`,
        `  Status: ${result.task.status}`,
      ];
      if (result.job) lines.push(`  Job:    ${result.job.status} (${result.job.id})`);
      if (result.run) lines.push(`  Run:    ${result.run.state} (${result.run.id})`);
      console.info(lines.join('\n'));
    }
    return;
  }
  if (command === 'run' && subcommand === 'show' && arg1) {
    try {
      const client = await requireDaemonClient(config);
      const run = await client.getRun(arg1);
      if (jsonFlag) {
        console.info(JSON.stringify(run, null, 2));
      } else {
        console.info(formatRun(run));
      }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        console.info(`Run not found: ${arg1}`);
        return;
      }
      throw error;
    }
    return;
  }
  if (command === 'receipt' && subcommand === 'show' && arg1) {
    try {
      const client = await requireDaemonClient(config);
      const receipt = await client.getReceipt(arg1);
      if (jsonFlag) {
        console.info(JSON.stringify(receipt, null, 2));
      } else {
        console.info(renderReceipt(receipt));
      }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        console.info(`Receipt not found: ${arg1}`);
        return;
      }
      throw error;
    }
    return;
  }

  if (command === 'runs' && subcommand === 'tail') {
    const client = await requireDaemonClient(config);
    console.info(JSON.stringify((await client.listRuns()).slice(0, 20), null, 2));
    return;
  }
  if (command === 'runs' && subcommand === 'failures') {
    const client = await requireDaemonClient(config);
    console.info(
      JSON.stringify(
        await client.listRuns({ state: ['failed_retryable', 'failed_final', 'abandoned'] }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'interventions' && subcommand === 'list') {
    const client = await requireDaemonClient(config);
    console.info(JSON.stringify(await client.listInterventions(), null, 2));
    return;
  }
  if (command === 'recovery' && subcommand === 'retry' && arg1) {
    const client = await requireDaemonClient(config);
    console.info(JSON.stringify(await client.retryRun(arg1), null, 2));
    return;
  }

  if (command === 'memory' && subcommand === 'search' && arg1) {
    const includeContent = process.argv.includes('--full');
    const client = await requireDaemonClient(config);
    const result = await client.searchMemory({ query: arg1, limit: 20, includeContent });
    console.info(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'memory' && subcommand === 'audit') {
    const client = await requireDaemonClient(config);
    console.info(JSON.stringify(await client.memoryAudit(), null, 2));
    return;
  }
  if (command === 'memory' && subcommand === 'list') {
    const client = await requireDaemonClient(config);
    console.info(
      JSON.stringify(await client.listMemories({ ...(arg1 ? { type: arg1 } : {}), limit: 50 }), null, 2),
    );
    return;
  }
  if (command === 'memory' && subcommand === 'show' && arg1) {
    const client = await requireDaemonClient(config);
    console.info(JSON.stringify(await client.getMemory(arg1), null, 2));
    return;
  }
  if (command === 'memory' && subcommand === 'maintenance') {
    const client = await requireDaemonClient(config);
    console.info(JSON.stringify(await client.triggerMemoryMaintenance(), null, 2));
    return;
  }
  if (command === 'knowledge' && subcommand === 'search' && arg1) {
    const client = await requireDaemonClient(config);
    const result = await client.searchMemory({
      query: arg1,
      memoryTypes: ['semantic', 'procedural'],
      limit: 20,
      includeContent: process.argv.includes('--full'),
    });
    console.info(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'receipt' && subcommand === 'search' && arg1) {
    const client = await requireDaemonClient(config);
    const result = await client.searchMemory({
      query: arg1,
      memoryTypes: ['episodic'],
      limit: 20,
      includeContent: process.argv.includes('--full'),
    });
    console.info(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'jobs' && subcommand === 'list') {
    const client = await requireDaemonClient(config);
    console.info(JSON.stringify(await client.listJobs(), null, 2));
    return;
  }
  if (command === 'jobs' && subcommand === 'pause' && arg1) {
    const client = await requireDaemonClient(config);
    const result = await client.pauseJob(arg1);
    console.info(result ? JSON.stringify(result, null, 2) : 'No-op: job not in pauseable state');
    return;
  }
  if (command === 'jobs' && subcommand === 'resume' && arg1) {
    const client = await requireDaemonClient(config);
    const result = await client.resumeJob(arg1);
    console.info(result ? JSON.stringify(result, null, 2) : 'No-op: job not paused');
    return;
  }
  if (command === 'sessions' && subcommand === 'list') {
    const client = await requireDaemonClient(config);
    console.info(JSON.stringify(await client.listSessionRoots(), null, 2));
    return;
  }

  console.info('Usage: pop auth <init|rotate> | pop security audit | pop pi smoke | pop daemon <install|start|load|stop|restart|status|uninstall|plist> | pop backup <create|verify|restore> | pop task run [title] [prompt] | pop run show <runId> | pop runs <tail|failures> | pop interventions list | pop recovery retry <runId> | pop receipt show <receiptId> | pop memory <search|audit|list|show|maintenance> | pop knowledge search <query> | pop receipt search <query> | pop jobs <list|pause|resume> | pop sessions list');
}

await main();
