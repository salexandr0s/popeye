#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

import type { RunRecord } from '@popeye/contracts';
import { PiEngineAdapter, runPiCompatibilityCheck } from '@popeye/engine-pi';
import { renderReceipt } from '@popeye/receipts';
import { tryConnectDaemon } from './api-client.js';
import {
  createBackup,
  createLaunchdPlist,
  createRuntimeService,
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
    const smokeArgs = process.env.POPEYE_PI_SMOKE_ARGS ? JSON.parse(process.env.POPEYE_PI_SMOKE_ARGS) as string[] : config.engine.args;
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
    const client = await tryConnectDaemon(config);
    if (client) {
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
    } else {
      const runtime = createRuntimeService(config);
      runtime.startScheduler();
      const created = runtime.createTask({
        workspaceId: 'default',
        projectId: null,
        title: arg1 ?? 'cli-task',
        prompt: arg2 ?? arg1 ?? 'hello from pop',
        source: 'manual',
        autoEnqueue: true,
      });
      const terminal = created.job ? await runtime.waitForJobTerminalState(created.job.id, 10_000) : null;
      if (jsonFlag) {
        console.info(JSON.stringify({ ...created, terminal }, null, 2));
      } else {
        const lines = [
          `Task: ${created.task.title} (${created.task.id})`,
          `  Status: ${created.task.status}`,
        ];
        if (created.job) lines.push(`  Job:    ${created.job.status} (${created.job.id})`);
        if (created.run) lines.push(`  Run:    ${created.run.state} (${created.run.id})`);
        if (terminal?.job) lines.push(`  Final:  ${terminal.job.status}`);
        if (terminal?.run) lines.push(`  Run:    ${terminal.run.state}`);
        if (terminal?.receipt) lines.push('', renderReceipt(terminal.receipt));
        console.info(lines.join('\n'));
      }
      await runtime.close();
    }
    return;
  }
  if (command === 'run' && subcommand === 'show' && arg1) {
    const client = await tryConnectDaemon(config);
    if (client) {
      const run = await client.getRun(arg1);
      if (jsonFlag) {
        console.info(JSON.stringify(run, null, 2));
      } else {
        console.info(formatRun(run));
      }
    } else {
      const runtime = createRuntimeService(config);
      const run = runtime.getRun(arg1);
      if (jsonFlag) {
        console.info(JSON.stringify(run, null, 2));
      } else if (run) {
        console.info(formatRun(run));
      } else {
        console.info(`Run not found: ${arg1}`);
      }
      await runtime.close();
    }
    return;
  }
  if (command === 'receipt' && subcommand === 'show' && arg1) {
    const client = await tryConnectDaemon(config);
    if (client) {
      const receipt = await client.getReceipt(arg1);
      if (jsonFlag) {
        console.info(JSON.stringify(receipt, null, 2));
      } else {
        console.info(renderReceipt(receipt));
      }
    } else {
      const runtime = createRuntimeService(config);
      const receipt = runtime.getReceipt(arg1);
      if (jsonFlag) {
        console.info(JSON.stringify(receipt, null, 2));
      } else if (receipt) {
        console.info(renderReceipt(receipt));
      } else {
        console.info(`Receipt not found: ${arg1}`);
      }
      await runtime.close();
    }
    return;
  }

  if (command === 'runs' && subcommand === 'tail') {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.listRuns().slice(0, 20), null, 2));
    await runtime.close();
    return;
  }
  if (command === 'runs' && subcommand === 'failures') {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.listFailedRuns(), null, 2));
    await runtime.close();
    return;
  }
  if (command === 'interventions' && subcommand === 'list') {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.listInterventions(), null, 2));
    await runtime.close();
    return;
  }
  if (command === 'recovery' && subcommand === 'retry' && arg1) {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.retryRun(arg1), null, 2));
    await runtime.close();
    return;
  }

  if (command === 'memory' && subcommand === 'search' && arg1) {
    const runtime = createRuntimeService(config);
    const includeContent = process.argv.includes('--full');
    const result = await runtime.searchMemory({ query: arg1, limit: 20, includeContent });
    console.info(JSON.stringify(result, null, 2));
    await runtime.close();
    return;
  }
  if (command === 'memory' && subcommand === 'audit') {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.getMemoryAudit(), null, 2));
    await runtime.close();
    return;
  }
  if (command === 'memory' && subcommand === 'list') {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.listMemories({ type: arg1, limit: 50 }), null, 2));
    await runtime.close();
    return;
  }
  if (command === 'memory' && subcommand === 'show' && arg1) {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.getMemory(arg1), null, 2));
    await runtime.close();
    return;
  }
  if (command === 'memory' && subcommand === 'maintenance') {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.triggerMemoryMaintenance(), null, 2));
    await runtime.close();
    return;
  }
  if (command === 'knowledge' && subcommand === 'search' && arg1) {
    const runtime = createRuntimeService(config);
    const result = await runtime.searchMemory({ query: arg1, memoryTypes: ['semantic', 'procedural'], limit: 20, includeContent: process.argv.includes('--full') });
    console.info(JSON.stringify(result, null, 2));
    await runtime.close();
    return;
  }
  if (command === 'receipt' && subcommand === 'search' && arg1) {
    const runtime = createRuntimeService(config);
    const result = await runtime.searchMemory({ query: arg1, memoryTypes: ['episodic'], limit: 20, includeContent: process.argv.includes('--full') });
    console.info(JSON.stringify(result, null, 2));
    await runtime.close();
    return;
  }

  if (command === 'jobs' && subcommand === 'list') {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.listJobs(), null, 2));
    await runtime.close();
    return;
  }
  if (command === 'jobs' && subcommand === 'pause' && arg1) {
    const runtime = createRuntimeService(config);
    const result = runtime.pauseJob(arg1);
    console.info(result ? JSON.stringify(result, null, 2) : 'No-op: job not in pauseable state');
    await runtime.close();
    return;
  }
  if (command === 'jobs' && subcommand === 'resume' && arg1) {
    const runtime = createRuntimeService(config);
    const result = runtime.resumeJob(arg1);
    console.info(result ? JSON.stringify(result, null, 2) : 'No-op: job not paused');
    await runtime.close();
    return;
  }
  if (command === 'sessions' && subcommand === 'list') {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.listSessionRoots(), null, 2));
    await runtime.close();
    return;
  }

  console.info('Usage: pop auth <init|rotate> | pop security audit | pop pi smoke | pop daemon <install|start|load|stop|restart|status|uninstall|plist> | pop backup <create|verify|restore> | pop task run [title] [prompt] | pop run show <runId> | pop runs <tail|failures> | pop interventions list | pop recovery retry <runId> | pop receipt show <receiptId> | pop memory <search|audit|list|show|maintenance> | pop knowledge search <query> | pop receipt search <query> | pop jobs <list|pause|resume> | pop sessions list');
}

await main();
