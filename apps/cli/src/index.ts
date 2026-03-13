#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

import { PiEngineAdapter, runPiCompatibilityCheck } from '@popeye/engine-pi';
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

const [, , command, subcommand, arg1, arg2] = process.argv;
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
    console.info(JSON.stringify({ ...created, terminal }, null, 2));
    await runtime.close();
    return;
  }
  if (command === 'run' && subcommand === 'show' && arg1) {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.getRun(arg1), null, 2));
    await runtime.close();
    return;
  }
  if (command === 'receipt' && subcommand === 'show' && arg1) {
    const runtime = createRuntimeService(config);
    console.info(JSON.stringify(runtime.getReceipt(arg1), null, 2));
    await runtime.close();
    return;
  }

  console.info('Usage: pop auth <init|rotate> | pop security audit | pop pi smoke | pop daemon <install|start|load|stop|restart|status|uninstall|plist> | pop backup <create|verify|restore> | pop task run [title] [prompt] | pop run show <runId> | pop receipt show <receiptId>');
}

await main();
