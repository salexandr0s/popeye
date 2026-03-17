#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const VERSION = '0.1.0';

// --json flag: when present, output raw JSON instead of human-readable text
const jsonFlag = process.argv.includes('--json');
const versionFlag = process.argv.includes('--version') || process.argv.includes('-v');
const positionalArgs = process.argv.filter(
  (a) => a !== '--json' && a !== '--help' && a !== '-h' && a !== '--version' && a !== '-v',
);
const helpFlag = process.argv.includes('--help') || process.argv.includes('-h');
const [, , command, subcommand, arg1, arg2] = positionalArgs;

const COMMANDS: Record<string, Record<string, { desc: string; usage: string; args?: string; examples?: string[] }>> = {
  auth: {
    init: { desc: 'Initialize auth store', usage: 'pop auth init' },
    rotate: { desc: 'Rotate auth token', usage: 'pop auth rotate' },
  },
  security: {
    audit: { desc: 'Run local security audit', usage: 'pop security audit' },
  },
  pi: {
    smoke: { desc: 'Run Pi engine compatibility check', usage: 'pop pi smoke' },
  },
  daemon: {
    install: { desc: 'Install LaunchAgent', usage: 'pop daemon install' },
    start: { desc: 'Start daemon in foreground', usage: 'pop daemon start' },
    status: { desc: 'Show daemon status', usage: 'pop daemon status' },
    load: { desc: 'Load LaunchAgent', usage: 'pop daemon load' },
    stop: { desc: 'Stop (unload) daemon', usage: 'pop daemon stop' },
    restart: { desc: 'Restart LaunchAgent', usage: 'pop daemon restart' },
    uninstall: { desc: 'Uninstall LaunchAgent', usage: 'pop daemon uninstall' },
    plist: { desc: 'Print LaunchAgent plist', usage: 'pop daemon plist' },
  },
  backup: {
    create: { desc: 'Create runtime backup (optionally include workspace dirs)', usage: 'pop backup create [path] [workspace...]' },
    verify: { desc: 'Verify backup integrity', usage: 'pop backup verify <path>' },
    restore: { desc: 'Restore from backup', usage: 'pop backup restore <path>' },
  },
  task: {
    run: { desc: 'Create and enqueue a task', usage: 'pop task run [title] [prompt]' },
  },
  run: {
    show: { desc: 'Show run details', usage: 'pop run show <runId>' },
  },
  runs: {
    tail: { desc: 'List recent runs', usage: 'pop runs tail' },
    failures: { desc: 'List failed runs', usage: 'pop runs failures' },
  },
  interventions: {
    list: { desc: 'List open interventions', usage: 'pop interventions list' },
  },
  recovery: {
    retry: { desc: 'Retry a failed run', usage: 'pop recovery retry <runId>' },
  },
  receipt: {
    show: { desc: 'Show receipt details', usage: 'pop receipt show <receiptId>' },
    search: { desc: 'Search episodic memories', usage: 'pop receipt search <query>' },
  },
  memory: {
    search: { desc: 'Search memories', usage: 'pop memory search <query> [--full]' },
    audit: { desc: 'Show memory audit stats', usage: 'pop memory audit' },
    list: { desc: 'List memories', usage: 'pop memory list [type]' },
    show: { desc: 'Show memory by ID', usage: 'pop memory show <id>' },
    maintenance: { desc: 'Trigger memory maintenance', usage: 'pop memory maintenance' },
  },
  knowledge: {
    search: { desc: 'Search knowledge memories', usage: 'pop knowledge search <query> [--full]' },
  },
  jobs: {
    list: { desc: 'List jobs', usage: 'pop jobs list' },
    pause: { desc: 'Pause a job', usage: 'pop jobs pause <jobId>' },
    resume: { desc: 'Resume a paused job', usage: 'pop jobs resume <jobId>' },
  },
  sessions: {
    list: { desc: 'List session roots', usage: 'pop sessions list' },
  },
  files: {
    roots: { desc: 'List file roots', usage: 'pop files roots [--json]' },
    add: { desc: 'Register a file root', usage: 'pop files add <path> [--label <name>] [--permission <read|index|index_and_derive>]' },
    remove: { desc: 'Disable a file root', usage: 'pop files remove <id>' },
    search: { desc: 'Search indexed files', usage: 'pop files search <query> [--root-id <id>] [--limit <n>]' },
    reindex: { desc: 'Trigger reindex', usage: 'pop files reindex <root-id>' },
    status: { desc: 'Show indexing stats', usage: 'pop files status' },
  },
  email: {
    accounts: { desc: 'List email accounts', usage: 'pop email accounts [--json]' },
    connect: { desc: 'Connect email provider', usage: 'pop email connect --gmail | --proton' },
    sync: { desc: 'Trigger email sync', usage: 'pop email sync [accountId]' },
    threads: { desc: 'List email threads', usage: 'pop email threads [--unread] [--limit <n>] [--json]' },
    search: { desc: 'Search email', usage: 'pop email search <query> [--limit <n>] [--json]' },
    digest: { desc: 'Show latest email digest', usage: 'pop email digest [--generate] [--json]' },
    providers: { desc: 'Show available email providers', usage: 'pop email providers [--json]' },
  },
  github: {
    accounts: { desc: 'List GitHub accounts', usage: 'pop github accounts [--json]' },
    repos: { desc: 'List synced repos', usage: 'pop github repos [--limit <n>] [--json]' },
    prs: { desc: 'List pull requests', usage: 'pop github prs [--state open|closed|all] [--limit <n>] [--json]' },
    issues: { desc: 'List issues', usage: 'pop github issues [--assigned] [--state open|closed|all] [--limit <n>] [--json]' },
    notifications: { desc: 'List unread notifications', usage: 'pop github notifications [--limit <n>] [--json]' },
    search: { desc: 'Search PRs and issues', usage: 'pop github search <query> [--limit <n>] [--json]' },
    digest: { desc: 'Show GitHub digest', usage: 'pop github digest [--json]' },
  },
  migrate: {
    qmd: { desc: 'Import QMD markdown files', usage: 'pop migrate qmd <directory>' },
    'openclaw-memory': { desc: 'Import OpenClaw memory files', usage: 'pop migrate openclaw-memory <directory>' },
  },
};

function showHelp(): void {
  console.info(`pop v${VERSION} — Popeye CLI\n`);
  console.info('Usage: pop <command> <subcommand> [args] [--json] [--help]\n');
  for (const [group, subs] of Object.entries(COMMANDS)) {
    const entries = Object.entries(subs);
    const subNames = entries.map(([name]) => name).join(', ');
    console.info(`  ${group} <${subNames}>`);
    for (const [name, meta] of entries) {
      console.info(`    ${group} ${name.padEnd(20)} ${meta.desc}`);
    }
  }
  console.info('\nFlags:');
  console.info('  --json             Output raw JSON instead of human-readable text');
  console.info('  --full             Include full content in search results');
  console.info('  --help, -h         Show help for a command');
  console.info('  --version, -v      Print version');
  console.info('\nExamples:');
  console.info('  pop daemon status              Check if the daemon is running');
  console.info('  pop task run "fix bug" "..."    Create and enqueue a task');
  console.info('  pop runs tail --json           List recent runs as JSON');
  console.info('  pop memory search "auth"       Search memories');
}

function showCommandHelp(cmd: string): void {
  const subs = COMMANDS[cmd];
  if (!subs) {
    console.error(`Unknown command: ${cmd}`);
    showHelp();
    process.exit(1);
  }
  console.info(`pop ${cmd}\n`);
  for (const [name, meta] of Object.entries(subs)) {
    console.info(`  ${meta.usage.padEnd(45)} ${meta.desc}`);
    void name;
  }
}

function showSubcommandHelp(cmd: string, sub: string): void {
  const subs = COMMANDS[cmd];
  if (!subs) {
    console.error(`Unknown command: ${cmd}`);
    showHelp();
    process.exit(1);
  }
  const meta = subs[sub];
  if (!meta) {
    console.error(`Unknown subcommand: ${cmd} ${sub}`);
    showCommandHelp(cmd);
    process.exit(1);
  }
  console.info(`${meta.usage}\n`);
  console.info(`  ${meta.desc}`);
  if (meta.args) {
    console.info(`\nArguments:\n  ${meta.args}`);
  }
  if (meta.examples && meta.examples.length > 0) {
    console.info('\nExamples:');
    for (const example of meta.examples) {
      console.info(`  ${example}`);
    }
  }
}

function requireArg(value: string | undefined, label: string): asserts value is string {
  if (!value) {
    console.error(`Missing required argument: <${label}>`);
    const subs = command ? COMMANDS[command] : undefined;
    const sub = subs && subcommand ? subs[subcommand] : undefined;
    if (sub) console.error(`Usage: ${sub.usage}`);
    process.exit(1);
  }
}

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

function isBundledMode(): boolean {
  const selfPath = typeof import.meta.filename === 'string'
    ? import.meta.filename
    : fileURLToPath(import.meta.url);
  return selfPath.includes(`${join('dist', 'index')}`);
}

// Early exits that don't require configuration
if (versionFlag) {
  console.info(`pop v${VERSION}`);
  process.exit(0);
}

if (!command) {
  showHelp();
  process.exit(0);
}

if (helpFlag) {
  if (subcommand) {
    showSubcommandHelp(command, subcommand);
  } else {
    showCommandHelp(command);
  }
  process.exit(0);
}

if (!COMMANDS[command]) {
  console.error(`Unknown command: ${command}. Run 'pop --help' for usage.`);
  process.exit(1);
}

if (subcommand && !COMMANDS[command][subcommand]) {
  console.error(`Unknown subcommand: ${command} ${subcommand}`);
  showCommandHelp(command);
  process.exit(1);
}

const configPath = ((): string => {
  const p = process.env.POPEYE_CONFIG_PATH;
  if (!p) throw new Error('POPEYE_CONFIG_PATH is required');
  return p;
})();

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
    const piPath = process.env.POPEYE_PI_SMOKE_PATH ?? config.engine.piPath;
    const adapter = new PiEngineAdapter({
      ...(piPath !== undefined && { piPath }),
      command: process.env.POPEYE_PI_SMOKE_COMMAND ?? config.engine.command,
      args: smokeArgs,
    });
    console.info(JSON.stringify(await runPiCompatibilityCheck(adapter), null, 2));
    return;
  }
  if (command === 'daemon' && subcommand === 'install') {
    let daemonEntryPoint: string;
    let workingDirectory: string;
    if (isBundledMode()) {
      const selfPath = typeof import.meta.filename === 'string'
        ? import.meta.filename
        : fileURLToPath(import.meta.url);
      const selfDir = dirname(selfPath);
      daemonEntryPoint = resolve(selfDir, '..', '..', 'daemon', 'dist', 'index.js');
      workingDirectory = resolve(selfDir, '..', '..', '..');
    } else {
      daemonEntryPoint = resolve(process.cwd(), 'apps/daemon/src/index.ts');
      workingDirectory = process.cwd();
    }
    console.info(
      JSON.stringify(
        installLaunchAgent({
          configPath,
          daemonEntryPoint,
          workingDirectory,
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'daemon' && subcommand === 'start') {
    let execArgs: [string, string[]];
    if (isBundledMode()) {
      const selfPath = typeof import.meta.filename === 'string'
        ? import.meta.filename
        : fileURLToPath(import.meta.url);
      const bundledDaemon = resolve(dirname(selfPath), '..', '..', 'daemon', 'dist', 'index.js');
      if (!existsSync(bundledDaemon)) {
        console.error(`Bundled daemon not found at ${bundledDaemon}. Run 'pnpm pack:daemon' first.`);
        process.exit(1);
      }
      execArgs = [process.execPath, [bundledDaemon]];
    } else {
      const tsxBinary = resolve(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
      const daemonEntryPoint = resolve(process.cwd(), 'apps/daemon/src/index.ts');
      execArgs = [tsxBinary, [daemonEntryPoint]];
    }
    await new Promise<void>((resolveStart, rejectStart) => {
      const child = spawn(execArgs[0], execArgs[1], {
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
    let daemonEntryPoint: string;
    let workingDirectory: string;
    if (isBundledMode()) {
      const selfPath = typeof import.meta.filename === 'string'
        ? import.meta.filename
        : fileURLToPath(import.meta.url);
      const selfDir = dirname(selfPath);
      daemonEntryPoint = resolve(selfDir, '..', '..', 'daemon', 'dist', 'index.js');
      workingDirectory = resolve(selfDir, '..', '..', '..');
    } else {
      daemonEntryPoint = resolve(process.cwd(), 'apps/daemon/src/index.ts');
      workingDirectory = process.cwd();
    }
    console.info(
      createLaunchdPlist({
        configPath,
        daemonEntryPoint,
        workingDirectory,
      }),
    );
    return;
  }
  if (command === 'backup' && subcommand === 'create') {
    const destination = arg1 ? resolve(arg1) : join(paths.backupsDir, new Date().toISOString().replaceAll(':', '-'));
    const workspacePaths = positionalArgs.slice(6).map((p) => resolve(p));
    console.info(createBackup({
      destinationDir: destination,
      runtimePaths: paths,
      ...(workspacePaths.length > 0 && { workspacePaths }),
    }));
    return;
  }
  if (command === 'backup' && subcommand === 'verify') {
    requireArg(arg1, 'path');
  }
  if (command === 'backup' && subcommand === 'verify' && arg1) {
    console.info(JSON.stringify(verifyBackup(resolve(arg1)), null, 2));
    return;
  }
  if (command === 'backup' && subcommand === 'restore') {
    requireArg(arg1, 'path');
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
  if (command === 'run' && subcommand === 'show') {
    requireArg(arg1, 'runId');
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
  if (command === 'receipt' && subcommand === 'show') {
    requireArg(arg1, 'receiptId');
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
  if (command === 'recovery' && subcommand === 'retry') {
    requireArg(arg1, 'runId');
  }
  if (command === 'recovery' && subcommand === 'retry' && arg1) {
    const client = await requireDaemonClient(config);
    console.info(JSON.stringify(await client.retryRun(arg1), null, 2));
    return;
  }

  if (command === 'memory' && subcommand === 'search') {
    requireArg(arg1, 'query');
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
  if (command === 'memory' && subcommand === 'show') {
    requireArg(arg1, 'id');
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
  if (command === 'knowledge' && subcommand === 'search') {
    requireArg(arg1, 'query');
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
  if (command === 'receipt' && subcommand === 'search') {
    requireArg(arg1, 'query');
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
  if (command === 'jobs' && subcommand === 'pause') {
    requireArg(arg1, 'jobId');
  }
  if (command === 'jobs' && subcommand === 'pause' && arg1) {
    const client = await requireDaemonClient(config);
    const result = await client.pauseJob(arg1);
    console.info(result ? JSON.stringify(result, null, 2) : 'No-op: job not in pauseable state');
    return;
  }
  if (command === 'jobs' && subcommand === 'resume') {
    requireArg(arg1, 'jobId');
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

  // --- File roots commands ---

  if (command === 'files' && subcommand === 'roots') {
    const client = await requireDaemonClient(config);
    const roots = await client.listFileRoots();
    if (jsonFlag) {
      console.info(JSON.stringify(roots, null, 2));
    } else {
      if (roots.length === 0) {
        console.info('No file roots registered.');
      } else {
        for (const root of roots) {
          const status = root.enabled ? 'enabled' : 'disabled';
          console.info(`  ${root.id}  ${root.label.padEnd(24)} ${root.rootPath}  [${root.permission}] [${status}]  indexed: ${root.lastIndexedCount}`);
        }
      }
    }
    return;
  }

  if (command === 'files' && subcommand === 'add' && arg1) {
    const client = await requireDaemonClient(config);
    const labelIdx = process.argv.indexOf('--label');
    const permIdx = process.argv.indexOf('--permission');
    const label = labelIdx !== -1 ? process.argv[labelIdx + 1] ?? arg1 : arg1;
    const permission = permIdx !== -1 ? process.argv[permIdx + 1] ?? 'index' : 'index';
    const root = await client.createFileRoot({
      workspaceId: 'default',
      label,
      rootPath: resolve(arg1),
      permission: permission as 'read' | 'index' | 'index_and_derive',
      filePatterns: ['**/*.md', '**/*.txt'],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });
    console.info(`Registered file root: ${root.id} — ${root.label} (${root.rootPath})`);
    return;
  }

  if (command === 'files' && subcommand === 'add') {
    console.error('Usage: pop files add <path> [--label <name>] [--permission <perm>]');
    process.exit(1);
  }

  if (command === 'files' && subcommand === 'remove' && arg1) {
    const client = await requireDaemonClient(config);
    await client.deleteFileRoot(arg1);
    console.info(`Disabled file root: ${arg1}`);
    return;
  }

  if (command === 'files' && subcommand === 'search' && arg1) {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const rootIdIdx = process.argv.indexOf('--root-id');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '10', 10) : 10;
    const rootId = rootIdIdx !== -1 ? process.argv[rootIdIdx + 1] : undefined;
    const response = await client.searchFiles(arg1, { rootId, limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else {
      if (response.results.length === 0) {
        console.info('No files found.');
      } else {
        for (const r of response.results) {
          console.info(`  ${r.relativePath}  [root:${r.fileRootId}]${r.memoryId ? ` [memory:${r.memoryId}]` : ''}`);
        }
      }
    }
    return;
  }

  if (command === 'files' && subcommand === 'reindex' && arg1) {
    const client = await requireDaemonClient(config);
    const result = await client.reindexFileRoot(arg1);
    console.info(`Reindexed: ${result.indexed} new, ${result.updated} updated, ${result.skipped} skipped, ${result.stale} stale`);
    if (result.errors.length > 0) {
      console.info(`Errors: ${result.errors.join(', ')}`);
    }
    return;
  }

  if (command === 'files' && subcommand === 'status') {
    const client = await requireDaemonClient(config);
    const roots = await client.listFileRoots();
    const totalDocs = roots.reduce((sum, r) => sum + r.lastIndexedCount, 0);
    console.info(`File roots: ${roots.length}  Total indexed files: ${totalDocs}`);
    for (const root of roots) {
      const status = root.enabled ? 'enabled' : 'disabled';
      console.info(`  ${root.label.padEnd(20)} ${root.rootPath}  [${root.permission}] [${status}]  files: ${root.lastIndexedCount}  last: ${root.lastIndexedAt ?? 'never'}`);
    }
    return;
  }

  // --- Email commands ---

  if (command === 'email' && subcommand === 'accounts') {
    const client = await requireDaemonClient(config);
    const accounts = await client.listEmailAccounts();
    if (jsonFlag) {
      console.info(JSON.stringify(accounts, null, 2));
    } else {
      if (accounts.length === 0) {
        console.info('No email accounts registered.');
      } else {
        for (const acct of accounts) {
          console.info(`  ${acct.id}  ${acct.emailAddress.padEnd(30)} ${acct.displayName}  messages: ${acct.messageCount}  last sync: ${acct.lastSyncAt ?? 'never'}`);
        }
      }
    }
    return;
  }

  if (command === 'email' && subcommand === 'threads') {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '20', 10) : 20;
    const unreadOnly = process.argv.includes('--unread');
    const accounts = await client.listEmailAccounts();
    if (accounts.length === 0) {
      console.info('No email accounts registered.');
      return;
    }
    const threads = await client.listEmailThreads(accounts[0]!.id, { limit, unreadOnly });
    if (jsonFlag) {
      console.info(JSON.stringify(threads, null, 2));
    } else {
      if (threads.length === 0) {
        console.info('No email threads found.');
      } else {
        for (const t of threads) {
          const flags = [t.isUnread ? 'unread' : '', t.isStarred ? 'starred' : ''].filter(Boolean).join(' ');
          console.info(`  ${t.lastMessageAt.slice(0, 10)}  ${t.subject.slice(0, 60).padEnd(62)} ${flags}`);
        }
      }
    }
    return;
  }

  if (command === 'email' && subcommand === 'search' && arg1) {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '20', 10) : 20;
    const response = await client.searchEmail(arg1, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else {
      if (response.results.length === 0) {
        console.info('No matching emails found.');
      } else {
        for (const r of response.results) {
          console.info(`  ${r.lastMessageAt.slice(0, 10)}  ${r.subject.slice(0, 60).padEnd(62)} from: ${r.from}`);
        }
      }
    }
    return;
  }

  if (command === 'email' && subcommand === 'digest') {
    const generateFlag = process.argv.includes('--generate');
    const client = await requireDaemonClient(config);
    if (generateFlag) {
      const digest = await client.generateEmailDigest();
      if (jsonFlag) {
        console.info(JSON.stringify(digest, null, 2));
      } else if (!digest) {
        console.info('No accounts registered. Connect an email provider first.');
      } else {
        console.info('Digest generated:');
        console.info(digest.summaryMarkdown);
      }
    } else {
      const digest = await client.getEmailDigest();
      if (jsonFlag) {
        console.info(JSON.stringify(digest, null, 2));
      } else if (!digest) {
        console.info('No email digest available. Run sync first, or use --generate.');
      } else {
        console.info(digest.summaryMarkdown);
      }
    }
    return;
  }

  if (command === 'email' && subcommand === 'connect') {
    const isGmail = process.argv.includes('--gmail');
    const isProton = process.argv.includes('--proton');
    if (!isGmail && !isProton) {
      console.error('Usage: pop email connect --gmail | --proton');
      process.exit(1);
    }
    const client = await requireDaemonClient(config);

    if (isGmail) {
      // Check gws is available
      const providers = await client.detectEmailProviders();
      if (!providers.gws.available) {
        console.error('gws CLI not found. Install with: npm install -g @googleworkspace/cli');
        process.exit(1);
      }

      // Resolve real email address from gws profile
      let emailAddress: string;
      try {
        const profileJson = await new Promise<string>((resolveExec, rejectExec) => {
          execFile('gws', ['gmail', 'users', 'getProfile'], { timeout: 30_000 }, (error, stdout) => {
            if (error) {
              rejectExec(error);
              return;
            }
            resolveExec(stdout);
          });
        });
        const profile = JSON.parse(profileJson) as { emailAddress?: string };
        if (!profile.emailAddress) {
          console.error('gws getProfile did not return an email address. Is gws authenticated?');
          process.exit(1);
        }
        emailAddress = profile.emailAddress;
      } catch (err) {
        console.error(`Failed to resolve Gmail profile via gws: ${err instanceof Error ? err.message : String(err)}`);
        console.error('Ensure gws is authenticated: gws auth login');
        process.exit(1);
      }

      // Create connection
      const connection = await client.createConnection({
        domain: 'email',
        providerKind: 'gmail',
        label: `Gmail (${emailAddress})`,
        mode: 'read_only',
        secretRefId: null,
        syncIntervalSeconds: 900,
        allowedScopes: ['gmail.readonly'],
        allowedResources: [],
      });
      // Register account with the resolved email
      const account = await client.registerEmailAccount({
        connectionId: connection.id,
        emailAddress,
        displayName: emailAddress.split('@')[0] ?? emailAddress,
      });
      console.info(`Connected Gmail via gws CLI.`);
      console.info(`  Connection: ${connection.id}`);
      console.info(`  Account:    ${account.id} (${emailAddress})`);
      console.info('Run "pop email sync" to fetch your inbox.');
    } else {
      // Proton — prompt for bridge password
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));
      const email = await ask('Proton email address: ');
      const password = await ask('Bridge-generated password: ');
      rl.close();

      if (!email || !password) {
        console.error('Both email and bridge password are required.');
        process.exit(1);
      }

      // Store the bridge password in the daemon's secret store
      const secretRef = await client.storeSecret({
        key: `proton-bridge-password`,
        value: password,
        description: `Proton Bridge IMAP password for ${email}`,
      });

      // Create connection with the secret reference
      const connection = await client.createConnection({
        domain: 'email',
        providerKind: 'proton',
        label: `Proton (${email})`,
        mode: 'read_only',
        secretRefId: secretRef.id,
        syncIntervalSeconds: 900,
        allowedScopes: [],
        allowedResources: [],
      });

      // Update the secret to link it to the connection
      await client.updateConnection(connection.id, { secretRefId: secretRef.id });

      // Register account
      const account = await client.registerEmailAccount({
        connectionId: connection.id,
        emailAddress: email,
        displayName: email.split('@')[0] ?? email,
      });
      console.info(`Connected Proton Mail via Bridge.`);
      console.info(`  Connection: ${connection.id}`);
      console.info(`  Account:    ${account.id}`);
      console.info('  Password stored securely in daemon secret store.');
      console.info('Run "pop email sync" to fetch your inbox.');
    }
    return;
  }

  if (command === 'email' && subcommand === 'sync') {
    const client = await requireDaemonClient(config);
    const accounts = await client.listEmailAccounts();
    if (accounts.length === 0) {
      console.error('No email accounts registered. Run "pop email connect" first.');
      process.exit(1);
    }
    const targetId = arg1 ?? accounts[0]!.id;
    console.info(`Syncing account ${targetId}...`);
    const result = await client.syncEmailAccount(targetId);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`  Synced: ${result.synced} new, ${result.updated} updated`);
      if (result.errors.length > 0) {
        console.info(`  Errors: ${result.errors.length}`);
        for (const err of result.errors.slice(0, 5)) console.info(`    - ${err}`);
      }
    }
    return;
  }

  if (command === 'email' && subcommand === 'providers') {
    const client = await requireDaemonClient(config);
    const providers = await client.detectEmailProviders();
    if (jsonFlag) {
      console.info(JSON.stringify(providers, null, 2));
    } else {
      console.info('Email providers:');
      console.info(`  Gmail (gws CLI):     ${providers.gws.available ? 'available' : 'not found'}`);
      console.info(`  Proton (Bridge):     ${providers.protonBridge.available ? 'running' : 'not detected'}`);
    }
    return;
  }

  // --- GitHub commands ---

  if (command === 'github' && subcommand === 'accounts') {
    const client = await requireDaemonClient(config);
    const accounts = await client.listGithubAccounts();
    if (jsonFlag) {
      console.info(JSON.stringify(accounts, null, 2));
    } else {
      if (accounts.length === 0) {
        console.info('No GitHub accounts registered.');
      } else {
        for (const acct of accounts) {
          console.info(`  ${acct.id}  ${acct.githubUsername.padEnd(25)} ${acct.displayName}  repos: ${acct.repoCount}  last sync: ${acct.lastSyncAt ?? 'never'}`);
        }
      }
    }
    return;
  }

  if (command === 'github' && subcommand === 'repos') {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '100', 10) : 100;
    const repos = await client.listGithubRepos(undefined, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(repos, null, 2));
    } else {
      if (repos.length === 0) {
        console.info('No repos synced. Run "pop github sync" first.');
      } else {
        for (const r of repos) {
          const lang = r.language ? ` [${r.language}]` : '';
          const visibility = r.isPrivate ? 'private' : 'public';
          console.info(`  ${r.fullName.padEnd(40)} ${visibility.padEnd(8)} ${lang}`);
        }
      }
    }
    return;
  }

  if (command === 'github' && subcommand === 'prs') {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '50', 10) : 50;
    const stateIdx = process.argv.indexOf('--state');
    const state = stateIdx !== -1 ? process.argv[stateIdx + 1] : undefined;
    const prs = await client.listGithubPullRequests(undefined, { state, limit });
    if (jsonFlag) {
      console.info(JSON.stringify(prs, null, 2));
    } else {
      if (prs.length === 0) {
        console.info('No pull requests found.');
      } else {
        for (const pr of prs) {
          const draft = pr.isDraft ? ' [draft]' : '';
          const ci = pr.ciStatus ? ` ci:${pr.ciStatus}` : '';
          console.info(`  #${String(pr.githubPrNumber).padEnd(5)} ${pr.state.padEnd(7)} ${pr.title.slice(0, 50).padEnd(52)} by ${pr.author}${draft}${ci}`);
        }
      }
    }
    return;
  }

  if (command === 'github' && subcommand === 'issues') {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '50', 10) : 50;
    const stateIdx = process.argv.indexOf('--state');
    const state = stateIdx !== -1 ? process.argv[stateIdx + 1] : undefined;
    const assigned = process.argv.includes('--assigned');
    const issues = await client.listGithubIssues(undefined, { state, assigned, limit });
    if (jsonFlag) {
      console.info(JSON.stringify(issues, null, 2));
    } else {
      if (issues.length === 0) {
        console.info('No issues found.');
      } else {
        for (const issue of issues) {
          const labels = issue.labels.length > 0 ? ` [${issue.labels.join(', ')}]` : '';
          console.info(`  #${String(issue.githubIssueNumber).padEnd(5)} ${issue.state.padEnd(7)} ${issue.title.slice(0, 50).padEnd(52)} by ${issue.author}${labels}`);
        }
      }
    }
    return;
  }

  if (command === 'github' && subcommand === 'notifications') {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '50', 10) : 50;
    const notifications = await client.listGithubNotifications(undefined, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(notifications, null, 2));
    } else {
      if (notifications.length === 0) {
        console.info('No unread notifications.');
      } else {
        for (const n of notifications) {
          console.info(`  [${n.subjectType.padEnd(12)}] ${n.subjectTitle.slice(0, 50).padEnd(52)} ${n.repoFullName}  (${n.reason})`);
        }
      }
    }
    return;
  }

  if (command === 'github' && subcommand === 'search' && arg1) {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '20', 10) : 20;
    const response = await client.searchGithub(arg1, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else {
      if (response.results.length === 0) {
        console.info('No matching PRs or issues found.');
      } else {
        for (const r of response.results) {
          console.info(`  [${r.entityType.toUpperCase().padEnd(5)}] #${String(r.number).padEnd(5)} ${r.title.slice(0, 50).padEnd(52)} ${r.repoFullName}  by ${r.author}`);
        }
      }
    }
    return;
  }

  if (command === 'github' && subcommand === 'digest') {
    const client = await requireDaemonClient(config);
    const digest = await client.getGithubDigest();
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No GitHub digest available. Sync first with the daemon running.');
    } else {
      console.info(digest.summaryMarkdown);
    }
    return;
  }

  if (command === 'migrate' && (subcommand === 'qmd' || subcommand === 'openclaw-memory')) {
    requireArg(arg1, 'directory');
  }
  if (command === 'migrate' && subcommand === 'qmd' && arg1) {
    const dir = resolve(arg1);
    if (!existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      process.exit(1);
    }
    const client = await requireDaemonClient(config);
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    let imported = 0;
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      await client.importMemory({
        description: `QMD import: ${file}`,
        content,
        sourceType: 'workspace_doc',
        classification: 'embeddable',
      });
      imported++;
      if (imported % 10 === 0) console.info(`  ${imported}/${files.length} imported`);
    }
    console.info(`Imported ${imported} files from ${dir}`);
    return;
  }

  if (command === 'migrate' && subcommand === 'openclaw-memory' && arg1) {
    const dir = resolve(arg1);
    if (!existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      process.exit(1);
    }
    const client = await requireDaemonClient(config);
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    let imported = 0;
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      await client.importMemory({
        description: `OpenClaw memory: ${file}`,
        content,
        sourceType: 'curated_memory',
        classification: 'embeddable',
      });
      imported++;
      if (imported % 10 === 0) console.info(`  ${imported}/${files.length} imported`);
    }
    console.info(`Imported ${imported} files from ${dir}`);
    return;
  }

  // Valid command/subcommand but no handler matched — missing subcommand
  if (command && COMMANDS[command]) {
    showCommandHelp(command);
    process.exit(1);
  }
  console.error(`Unknown command: ${command ?? ''}. Run 'pop --help' for usage.`);
  process.exit(1);
}

await main();
