#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type PopeyeApiClient, ApiError } from '@popeye/api-client';
import type { AppConfig, DomainKind } from '@popeye/contracts';
import { z } from 'zod';
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
  PiEngineAdapter,
  restoreBackup,
  restartLaunchAgent,
  rotateAuthStore,
  runLocalSecurityAudit,
  runPiCompatibilityCheck,
  uninstallLaunchAgent,
  unloadLaunchAgent,
  verifyBackup,
} from '@popeye/runtime-core';
import { formatEngineCapabilities, formatProfile, formatSecurityPolicy, formatVault, getFlagValue, parseCsvLine, requireArg } from './formatters.js';
import { handleApprovals, handleStandingApprovals, handleAutomationGrants } from './commands/approvals.js';
import { handleRun, handleRuns, handleReceipt, handleInterventions, handleTask } from './commands/runs.js';

const VERSION = process.env['POPEYE_VERSION'] ?? '0.1.0-dev';
const GIT_SHA = process.env['POPEYE_GIT_SHA'] ?? '';
const BUILD_DATE = process.env['POPEYE_BUILD_DATE'] ?? '';

// Global flags
const jsonFlag = process.argv.includes('--json');
const versionFlag = process.argv.includes('--version') || process.argv.includes('-v');
const verboseFlag = process.argv.includes('--verbose');
const quietFlag = process.argv.includes('--quiet');
const positionalArgs = process.argv.filter(
  (a) => a !== '--json' && a !== '--help' && a !== '-h' && a !== '--version' && a !== '-v'
    && a !== '--verbose' && a !== '--quiet',
);
const helpFlag = process.argv.includes('--help') || process.argv.includes('-h');
const [, , command, subcommand, arg1, _arg2] = positionalArgs;

// --verbose: enable debug logging; --quiet: suppress non-essential output
if (verboseFlag) process.env['POPEYE_LOG_LEVEL'] = 'debug';
if (quietFlag) process.env['POPEYE_LOG_LEVEL'] = 'silent';

const COMMANDS: Record<string, Record<string, { desc: string; usage: string; args?: string; examples?: string[] }>> = {
  auth: {
    init: { desc: 'Initialize auth store', usage: 'pop auth init [--role <operator|service|readonly>]' },
    rotate: { desc: 'Rotate auth token', usage: 'pop auth rotate [--role <operator|service|readonly>]' },
  },
  security: {
    audit: { desc: 'Run local security audit', usage: 'pop security audit' },
    policy: { desc: 'Show domain policy and approval rules', usage: 'pop security policy' },
  },
  pi: {
    smoke: { desc: 'Run Pi engine compatibility check', usage: 'pop pi smoke' },
  },
  daemon: {
    install: { desc: 'Install LaunchAgent', usage: 'pop daemon install' },
    start: { desc: 'Start daemon in foreground', usage: 'pop daemon start' },
    health: { desc: 'Show daemon API + engine health', usage: 'pop daemon health' },
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
    run: { desc: 'Create and enqueue a task', usage: 'pop task run [title] [prompt] [--profile <id>]' },
  },
  run: {
    envelope: { desc: 'Show run execution envelope', usage: 'pop run envelope <runId>' },
    show: { desc: 'Show run details', usage: 'pop run show <runId>' },
  },
  runs: {
    tail: { desc: 'List recent runs', usage: 'pop runs tail' },
    failures: { desc: 'List failed runs', usage: 'pop runs failures' },
  },
  interventions: {
    list: { desc: 'List open interventions', usage: 'pop interventions list' },
  },
  approvals: {
    list: { desc: 'List approvals', usage: 'pop approvals list [--status <pending|approved|denied|expired>] [--domain <domain>] [--scope <scope>] [--action-kind <kind>] [--run-id <id>]' },
    show: { desc: 'Show one approval', usage: 'pop approvals show <approvalId>' },
    approve: { desc: 'Approve a pending approval', usage: 'pop approvals approve <approvalId> [reason]' },
    deny: { desc: 'Deny a pending approval', usage: 'pop approvals deny <approvalId> [reason]' },
  },
  'standing-approvals': {
    list: { desc: 'List standing approvals', usage: 'pop standing-approvals list [--status <active|revoked|expired>] [--domain <domain>] [--action-kind <kind>]' },
    create: { desc: 'Create a standing approval', usage: 'pop standing-approvals create --scope <scope> --domain <domain> --action-kind <kind> --resource-type <type> [--resource-id <id>] [--resource-scope <scope>] [--requested-by <actor>] [--workspace-id <id>] [--project-id <id>] [--expires-at <iso>] [--note <text>] [--created-by <actor>]' },
    revoke: { desc: 'Revoke a standing approval', usage: 'pop standing-approvals revoke <id> [--by <actor>]' },
  },
  'automation-grants': {
    list: { desc: 'List automation grants', usage: 'pop automation-grants list [--status <active|revoked|expired>] [--domain <domain>] [--action-kind <kind>]' },
    create: { desc: 'Create an automation grant', usage: 'pop automation-grants create --scope <scope> --domain <domain> --action-kind <kind> --resource-type <type> [--resource-id <id>] [--resource-scope <scope>] [--requested-by <actor>] [--workspace-id <id>] [--project-id <id>] [--task-sources <heartbeat,schedule>] [--expires-at <iso>] [--note <text>] [--created-by <actor>]' },
    revoke: { desc: 'Revoke an automation grant', usage: 'pop automation-grants revoke <id> [--by <actor>]' },
  },
  vaults: {
    list: { desc: 'List vaults', usage: 'pop vaults list [--domain <domain>] [--json]' },
    show: { desc: 'Show one vault', usage: 'pop vaults show <vaultId>' },
    create: { desc: 'Create a vault', usage: 'pop vaults create <domain> <name> [--restricted]' },
    open: { desc: 'Open a vault using an approved approval', usage: 'pop vaults open <vaultId> <approvalId>' },
    close: { desc: 'Close a vault', usage: 'pop vaults close <vaultId>' },
    seal: { desc: 'Seal a vault', usage: 'pop vaults seal <vaultId>' },
    'set-kek': { desc: 'Store vault KEK in Keychain', usage: 'pop vaults set-kek [--generate]' },
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
  profile: {
    list: { desc: 'List execution profiles', usage: 'pop profile list' },
    show: { desc: 'Show execution profile details', usage: 'pop profile show <id>' },
  },
  files: {
    roots: { desc: 'List file roots', usage: 'pop files roots [--json]' },
    add: { desc: 'Register a file root', usage: 'pop files add <path> [--label <name>] [--permission <read|index|index_and_derive>]' },
    remove: { desc: 'Disable a file root', usage: 'pop files remove <id>' },
    search: { desc: 'Search indexed files', usage: 'pop files search <query> [--root-id <id>] [--limit <n>]' },
    reindex: { desc: 'Trigger reindex', usage: 'pop files reindex <root-id>' },
    status: { desc: 'Show indexing stats', usage: 'pop files status' },
    review: { desc: 'List pending write intents', usage: 'pop files review [--json]' },
    apply: { desc: 'Apply a write intent', usage: 'pop files apply <intentId>' },
    reject: { desc: 'Reject a write intent', usage: 'pop files reject <intentId> [reason]' },
  },
  email: {
    accounts: { desc: 'List email accounts', usage: 'pop email accounts [--json]' },
    connect: { desc: 'Connect email provider', usage: 'pop email connect --gmail [--read-write] [--reconnect <connectionId>] | --proton | --gmail-experimental' },
    sync: { desc: 'Trigger email sync', usage: 'pop email sync [accountId]' },
    threads: { desc: 'List email threads', usage: 'pop email threads [--unread] [--limit <n>] [--json]' },
    search: { desc: 'Search email', usage: 'pop email search <query> [--limit <n>] [--json]' },
    digest: { desc: 'Show latest email digest', usage: 'pop email digest [--generate] [--json]' },
    providers: { desc: 'Show available email providers', usage: 'pop email providers [--json]' },
  },
  github: {
    connect: { desc: 'Connect GitHub via browser OAuth', usage: 'pop github connect [--read-write] [--reconnect <connectionId>]' },
    accounts: { desc: 'List GitHub accounts', usage: 'pop github accounts [--json]' },
    sync: { desc: 'Trigger GitHub sync', usage: 'pop github sync [accountId]' },
    repos: { desc: 'List synced repos', usage: 'pop github repos [--limit <n>] [--json]' },
    prs: { desc: 'List pull requests', usage: 'pop github prs [--state open|closed|all] [--limit <n>] [--json]' },
    issues: { desc: 'List issues', usage: 'pop github issues [--assigned] [--state open|closed|all] [--limit <n>] [--json]' },
    notifications: { desc: 'List unread notifications', usage: 'pop github notifications [--limit <n>] [--json]' },
    search: { desc: 'Search PRs and issues', usage: 'pop github search <query> [--limit <n>] [--json]' },
    digest: { desc: 'Show GitHub digest', usage: 'pop github digest [--json]' },
  },
  calendar: {
    connect: { desc: 'Connect Google Calendar via browser OAuth', usage: 'pop calendar connect [--read-write] [--reconnect <connectionId>]' },
    accounts: { desc: 'List calendar accounts', usage: 'pop calendar accounts [--json]' },
    sync: { desc: 'Trigger calendar sync', usage: 'pop calendar sync [accountId]' },
    events: { desc: 'List calendar events', usage: 'pop calendar events [--today] [--upcoming] [--limit <n>] [--json]' },
    search: { desc: 'Search calendar events', usage: 'pop calendar search <query> [--limit <n>] [--json]' },
    availability: { desc: 'Show free slots', usage: 'pop calendar availability [--date YYYY-MM-DD] [--json]' },
    digest: { desc: 'Show calendar digest', usage: 'pop calendar digest [--json]' },
  },
  todo: {
    connect: { desc: 'Connect Todoist with a manual API token', usage: 'pop todo connect [--label <name>] [--display-name <name>] [--read-only]' },
    accounts: { desc: 'List todo accounts', usage: 'pop todo accounts [--json]' },
    sync: { desc: 'Trigger todo sync', usage: 'pop todo sync [accountId] [--json]' },
    list: { desc: 'List todos', usage: 'pop todo list [--overdue] [--priority 1-4] [--project <name>] [--limit <n>] [--json]' },
    add: { desc: 'Add a todo', usage: 'pop todo add <title> [--priority 1-4] [--due YYYY-MM-DD] [--project <name>]' },
    complete: { desc: 'Complete a todo', usage: 'pop todo complete <id>' },
    reprioritize: { desc: 'Reprioritize a todo', usage: 'pop todo reprioritize <id> <priority>' },
    reschedule: { desc: 'Reschedule a todo', usage: 'pop todo reschedule <id> <dueDate>' },
    move: { desc: 'Move a todo to a project', usage: 'pop todo move <id> <projectName>' },
    reconcile: { desc: 'Reconcile todos with provider', usage: 'pop todo reconcile [accountId]' },
    projects: { desc: 'List todo projects', usage: 'pop todo projects [accountId]' },
    search: { desc: 'Search todos', usage: 'pop todo search <query> [--limit <n>] [--json]' },
    digest: { desc: 'Show todo digest', usage: 'pop todo digest [--json]' },
  },
  connection: {
    rules: { desc: 'List resource rules for a connection', usage: 'pop connection rules <id>' },
    'add-rule': { desc: 'Add a resource rule', usage: 'pop connection add-rule <id> --type <type> --id <resourceId> --name <name> [--write]' },
    'remove-rule': { desc: 'Remove a resource rule', usage: 'pop connection remove-rule <id> --type <type> --id <resourceId>' },
    diagnostics: { desc: 'Show connection diagnostics', usage: 'pop connection diagnostics <id>' },
    reconnect: { desc: 'Reconnect a connection', usage: 'pop connection reconnect <id> [--action <reauthorize|reconnect|scope_fix|secret_fix>]' },
  },
  people: {
    list: { desc: 'List people in the canonical identity graph', usage: 'pop people list [--json]' },
    search: { desc: 'Search people', usage: 'pop people search <query> [--limit <n>] [--json]' },
    show: { desc: 'Show one person', usage: 'pop people show <personId> [--json]' },
    edit: { desc: 'Edit a person profile', usage: 'pop people edit <personId> [--display-name <name>] [--pronouns <value>] [--tags <comma,separated>] [--notes <text>]' },
    merge: { desc: 'Merge one person into another', usage: 'pop people merge <sourcePersonId> <targetPersonId>' },
    split: { desc: 'Split identities into a new person', usage: 'pop people split <personId> <identityId> [identityId...]' },
    attach: { desc: 'Attach an identity to a person', usage: 'pop people attach <personId> --provider <email|calendar|github> --external-id <value> [--display-name <name>] [--handle <value>]' },
    detach: { desc: 'Detach an identity into a new person', usage: 'pop people detach <identityId>' },
    history: { desc: 'Show merge/split/attach/detach events', usage: 'pop people history <personId> [--json]' },
    suggestions: { desc: 'Show merge suggestions', usage: 'pop people suggestions [--json]' },
    activity: { desc: 'Show activity rollups', usage: 'pop people activity <personId> [--json]' },
  },
  finance: {
    imports: { desc: 'List finance imports', usage: 'pop finance imports [--json]' },
    import: { desc: 'Import a finance file', usage: 'pop finance import <file>' },
    transactions: { desc: 'List transactions', usage: 'pop finance transactions [--category <cat>] [--limit <n>] [--json]' },
    search: { desc: 'Search finance data', usage: 'pop finance search <query> [--json]' },
    digest: { desc: 'Show finance digest', usage: 'pop finance digest [--period <YYYY-MM>] [--json]' },
  },
  medical: {
    imports: { desc: 'List medical imports', usage: 'pop medical imports [--json]' },
    import: { desc: 'Import a medical file', usage: 'pop medical import <file>' },
    appointments: { desc: 'List appointments', usage: 'pop medical appointments [--limit <n>] [--json]' },
    medications: { desc: 'List medications', usage: 'pop medical medications [--json]' },
    search: { desc: 'Search medical data', usage: 'pop medical search <query> [--json]' },
    digest: { desc: 'Show medical digest', usage: 'pop medical digest [--json]' },
  },
  upgrade: {
    verify: { desc: 'Verify post-upgrade state', usage: 'pop upgrade verify [--json]' },
    rollback: { desc: 'Restore from pre-upgrade backup', usage: 'pop upgrade rollback <backupPath>' },
  },
  migrate: {
    qmd: { desc: 'Import QMD markdown files', usage: 'pop migrate qmd <directory>' },
    'openclaw-memory': { desc: 'Import OpenClaw memory files', usage: 'pop migrate openclaw-memory <directory>' },
    telegram: { desc: 'Generate Popeye telegram config from OpenClaw config', usage: 'pop migrate telegram [openclawConfigPath]' },
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

async function requireDaemonClient(config: AppConfig): Promise<PopeyeApiClient> {
  const client = await tryConnectDaemon(config);
  if (!client) {
    console.error('daemon not running');
    process.exit(1);
  }
  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openBrowserUrl(url: string): Promise<boolean> {
  const platform = process.platform;
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];

  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: platform !== 'win32',
    });
    child.once('error', () => resolve(false));
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

async function runOAuthConnectFlow(
  client: PopeyeApiClient,
  input: {
    providerKind: 'gmail' | 'google_calendar' | 'github';
    mode: 'read_only' | 'read_write';
    syncIntervalSeconds?: number;
    connectionId?: string;
  },
): Promise<void> {
  const session = await client.startOAuthConnection({
    providerKind: input.providerKind,
    mode: input.mode,
    syncIntervalSeconds: input.syncIntervalSeconds ?? 900,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
  });

  const opened = await openBrowserUrl(session.authorizationUrl);
  console.info(`Starting ${input.providerKind} connection...`);
  if (opened) {
    console.info('Opened browser for OAuth approval.');
  } else {
    console.info('Open this URL in your browser:');
    console.info(`  ${session.authorizationUrl}`);
  }

  for (let attempt = 0; attempt < 150; attempt += 1) {
    await sleep(2000);
    const latest = await client.getOAuthConnectionSession(session.id);
    if (latest.status === 'pending') {
      continue;
    }
    if (latest.status === 'completed') {
      console.info(input.connectionId ? `${input.providerKind} reconnected.` : `${input.providerKind} connected.`);
      if (latest.connectionId) console.info(`  Connection: ${latest.connectionId}`);
      if (latest.accountId) console.info(`  Account:    ${latest.accountId}`);
      return;
    }
    console.error(`${input.providerKind} connection failed: ${latest.error ?? latest.status}`);
    process.exit(1);
  }

  console.error('OAuth connection timed out while waiting for callback completion.');
  process.exit(1);
}

function isBundledMode(): boolean {
  const selfPath = typeof import.meta.filename === 'string'
    ? import.meta.filename
    : fileURLToPath(import.meta.url);
  return selfPath.includes(`${join('dist', 'index')}`);
}

// Early exits that don't require configuration
if (versionFlag) {
  const parts = [`pop v${VERSION}`];
  if (GIT_SHA) parts.push(`(${GIT_SHA})`);
  if (BUILD_DATE) parts.push(`built ${BUILD_DATE}`);
  console.info(parts.join(' '));
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

function readRoleFlag(): 'operator' | 'service' | 'readonly' {
  const roleIdx = process.argv.indexOf('--role');
  return z.enum(['operator', 'service', 'readonly']).parse(
    roleIdx !== -1 ? (process.argv[roleIdx + 1] ?? 'operator') : 'operator',
  );
}

async function main(): Promise<void> {
  if (command === 'auth' && subcommand === 'init') {
    console.info(JSON.stringify(initAuthStore(config.authFile, readRoleFlag()), null, 2));
    return;
  }
  if (command === 'auth' && subcommand === 'rotate') {
    console.info(JSON.stringify(rotateAuthStore(config.authFile, 24, readRoleFlag()), null, 2));
    return;
  }
  if (command === 'security' && subcommand === 'audit') {
    console.info(JSON.stringify(runLocalSecurityAudit(config), null, 2));
    return;
  }
  if (command === 'security' && subcommand === 'policy') {
    const client = await requireDaemonClient(config);
    const policy = await client.getSecurityPolicy();
    if (jsonFlag) {
      console.info(JSON.stringify(policy, null, 2));
    } else {
      console.info(formatSecurityPolicy(policy));
    }
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
  if (command === 'daemon' && subcommand === 'health') {
    const client = await requireDaemonClient(config);
    const [health, status, capabilities] = await Promise.all([
      client.health(),
      client.status(),
      client.engineCapabilities(),
    ]);
    if (jsonFlag) {
      console.info(JSON.stringify({ health, status, engine: capabilities }, null, 2));
    } else {
      console.info([
        `Daemon:              ${health.ok ? 'healthy' : 'unhealthy'}`,
        `  Started:           ${health.startedAt}`,
        `  Scheduler:         ${status.schedulerRunning ? 'running' : 'stopped'}`,
        `  Jobs:              ${status.runningJobs} running / ${status.queuedJobs} queued`,
        `  Interventions:     ${status.openInterventions}`,
        formatEngineCapabilities(capabilities),
      ].join('\n'));
    }
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
    const workspacePaths = positionalArgs.slice(5).map((p) => resolve(p));
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
  if (command === 'task') {
    const client = await requireDaemonClient(config);
    return handleTask({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'run') {
    const client = await requireDaemonClient(config);
    return handleRun({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'receipt') {
    const client = await requireDaemonClient(config);
    return handleReceipt({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'runs') {
    const client = await requireDaemonClient(config);
    return handleRuns({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'interventions') {
    const client = await requireDaemonClient(config);
    return handleInterventions({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'approvals') {
    const client = await requireDaemonClient(config);
    return handleApprovals({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'standing-approvals') {
    const client = await requireDaemonClient(config);
    return handleStandingApprovals({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'automation-grants') {
    const client = await requireDaemonClient(config);
    return handleAutomationGrants({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'vaults' && subcommand === 'list') {
    const client = await requireDaemonClient(config);
    const domainIndex = process.argv.indexOf('--domain');
    const vaults = await client.listVaults(domainIndex !== -1 ? process.argv[domainIndex + 1] as DomainKind : undefined);
    if (jsonFlag) {
      console.info(JSON.stringify(vaults, null, 2));
    } else if (vaults.length === 0) {
      console.info('No vaults');
    } else {
      console.info(vaults.map(formatVault).join('\n\n'));
    }
    return;
  }
  if (command === 'vaults' && (subcommand === 'show' || subcommand === 'close' || subcommand === 'seal')) {
    requireArg(arg1, 'vaultId');
  }
  if (command === 'vaults' && subcommand === 'show' && arg1) {
    const client = await requireDaemonClient(config);
    const vault = await client.getVault(arg1);
    console.info(jsonFlag ? JSON.stringify(vault, null, 2) : formatVault(vault));
    return;
  }
  if (command === 'vaults' && subcommand === 'create') {
    requireArg(arg1, 'domain');
    requireArg(_arg2, 'name');
  }
  if (command === 'vaults' && subcommand === 'create' && arg1 && _arg2) {
    const client = await requireDaemonClient(config);
    const vault = await client.createVault({
      domain: arg1 as DomainKind,
      name: _arg2,
      ...(process.argv.includes('--restricted') ? { kind: 'restricted' } : {}),
    });
    console.info(jsonFlag ? JSON.stringify(vault, null, 2) : formatVault(vault));
    return;
  }
  if (command === 'vaults' && subcommand === 'open') {
    requireArg(arg1, 'vaultId');
    requireArg(_arg2, 'approvalId');
  }
  if (command === 'vaults' && subcommand === 'open' && arg1 && _arg2) {
    const client = await requireDaemonClient(config);
    const vault = await client.openVault(arg1, { approvalId: _arg2 });
    console.info(jsonFlag ? JSON.stringify(vault, null, 2) : formatVault(vault));
    return;
  }
  if (command === 'vaults' && subcommand === 'close' && arg1) {
    const client = await requireDaemonClient(config);
    const vault = await client.closeVault(arg1);
    console.info(jsonFlag ? JSON.stringify(vault, null, 2) : formatVault(vault));
    return;
  }
  if (command === 'vaults' && subcommand === 'seal' && arg1) {
    const client = await requireDaemonClient(config);
    const vault = await client.sealVault(arg1);
    console.info(jsonFlag ? JSON.stringify(vault, null, 2) : formatVault(vault));
    return;
  }
  if (command === 'vaults' && subcommand === 'set-kek') {
    const { randomBytes: rb } = await import('node:crypto');
    const { keychainSet } = await import('@popeye/runtime-core');
    const generateFlag = process.argv.includes('--generate');
    let kekValue: string;
    if (generateFlag) {
      kekValue = rb(32).toString('hex');
    } else {
      const { createInterface } = await import('node:readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      kekValue = await new Promise<string>((resolveValue) => {
        rl.question('Enter KEK (64-char hex string): ', (answer) => {
          rl.close();
          resolveValue(answer.trim());
        });
      });
    }
    if (kekValue.length !== 64 || !/^[0-9a-f]+$/i.test(kekValue)) {
      console.error('KEK must be a 64-character hex string (256 bits).');
      process.exitCode = 1;
      return;
    }
    const result = keychainSet('vault-kek', kekValue);
    if (result.ok) {
      console.info('Vault KEK stored in macOS Keychain.');
    } else {
      console.error(`Failed to store KEK: ${result.error}`);
      process.exitCode = 1;
    }
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
  if (command === 'profile' && subcommand === 'list') {
    const client = await requireDaemonClient(config);
    const profiles = await client.listProfiles();
    if (jsonFlag) {
      console.info(JSON.stringify(profiles, null, 2));
    } else if (profiles.length === 0) {
      console.info('No execution profiles found.');
    } else {
      for (const profile of profiles) {
        console.info(`  ${profile.id.padEnd(18)} ${profile.mode.padEnd(12)} ${profile.name}`);
      }
    }
    return;
  }
  if (command === 'profile' && subcommand === 'show') {
    requireArg(arg1, 'id');
  }
  if (command === 'profile' && subcommand === 'show' && arg1) {
    try {
      const client = await requireDaemonClient(config);
      const profile = await client.getProfile(arg1);
      if (jsonFlag) {
        console.info(JSON.stringify(profile, null, 2));
      } else {
        console.info(formatProfile(profile));
      }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        console.info(`Profile not found: ${arg1}`);
        return;
      }
      throw error;
    }
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
    const isGmailExperimental = process.argv.includes('--gmail-experimental');
    const isProton = process.argv.includes('--proton');
    const mode = process.argv.includes('--read-write') ? 'read_write' : 'read_only';
    const reconnectId = getFlagValue('--reconnect');
    if (!isGmail && !isGmailExperimental && !isProton) {
      console.error('Usage: pop email connect --gmail [--read-write] | --proton | --gmail-experimental');
      process.exit(1);
    }
    const client = await requireDaemonClient(config);

    if (isGmail) {
      await runOAuthConnectFlow(client, {
        providerKind: 'gmail',
        mode,
        syncIntervalSeconds: 900,
        ...(reconnectId ? { connectionId: reconnectId } : {}),
      });
      console.info('Run "pop email sync" to fetch your inbox.');
    } else if (isGmailExperimental) {
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
      console.info('Connected Gmail via experimental gws CLI flow.');
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
      console.info(`  Gmail (gws CLI, experimental): ${providers.gws.available ? 'available' : 'not found'}`);
      console.info(`  Proton (Bridge):     ${providers.protonBridge.available ? 'running' : 'not detected'}`);
    }
    return;
  }

  // --- GitHub commands ---

  if (command === 'github' && subcommand === 'connect') {
    const client = await requireDaemonClient(config);
    const reconnectId = getFlagValue('--reconnect');
    await runOAuthConnectFlow(client, {
      providerKind: 'github',
      mode: process.argv.includes('--read-write') ? 'read_write' : 'read_only',
      syncIntervalSeconds: 900,
      ...(reconnectId ? { connectionId: reconnectId } : {}),
    });
    console.info('Run "pop github sync" to fetch repos, PRs, issues, and notifications.');
    return;
  }

  if (command === 'github' && subcommand === 'sync') {
    const client = await requireDaemonClient(config);
    const accounts = await client.listGithubAccounts();
    if (accounts.length === 0) {
      console.error('No GitHub accounts registered. Run "pop github connect" first.');
      process.exit(1);
    }
    const targetId = arg1 ?? accounts[0]!.id;
    console.info(`Syncing GitHub account ${targetId}...`);
    const result = await client.syncGithubAccount(targetId);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`  Repos: ${result.reposSynced}  PRs: ${result.prsSynced}  Issues: ${result.issuesSynced}  Notifications: ${result.notificationsSynced}`);
      if (result.errors.length > 0) {
        console.info(`  Errors: ${result.errors.length}`);
        for (const err of result.errors.slice(0, 5)) console.info(`    - ${err}`);
      }
    }
    return;
  }

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

  // --- Calendar commands ---

  if (command === 'calendar' && subcommand === 'connect') {
    const client = await requireDaemonClient(config);
    const reconnectId = getFlagValue('--reconnect');
    await runOAuthConnectFlow(client, {
      providerKind: 'google_calendar',
      mode: process.argv.includes('--read-write') ? 'read_write' : 'read_only',
      syncIntervalSeconds: 900,
      ...(reconnectId ? { connectionId: reconnectId } : {}),
    });
    console.info('Run "pop calendar sync" to fetch upcoming events.');
    return;
  }

  if (command === 'calendar' && subcommand === 'sync') {
    const client = await requireDaemonClient(config);
    const accounts = await client.listCalendarAccounts();
    if (accounts.length === 0) {
      console.error('No calendar accounts registered. Run "pop calendar connect" first.');
      process.exit(1);
    }
    const targetId = arg1 ?? accounts[0]!.id;
    console.info(`Syncing calendar account ${targetId}...`);
    const result = await client.syncCalendarAccount(targetId);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`  Events: ${result.eventsSynced} new, ${result.eventsUpdated} updated`);
      if (result.errors.length > 0) {
        console.info(`  Errors: ${result.errors.length}`);
        for (const err of result.errors.slice(0, 5)) console.info(`    - ${err}`);
      }
    }
    return;
  }

  if (command === 'calendar' && subcommand === 'accounts') {
    const client = await requireDaemonClient(config);
    const accounts = await client.listCalendarAccounts();
    if (jsonFlag) {
      console.info(JSON.stringify(accounts, null, 2));
    } else {
      if (accounts.length === 0) {
        console.info('No calendar accounts registered.');
      } else {
        for (const acct of accounts) {
          console.info(`  ${acct.id}  ${acct.calendarEmail.padEnd(30)} ${acct.displayName}  tz: ${acct.timeZone}  events: ${acct.eventCount}  last sync: ${acct.lastSyncAt ?? 'never'}`);
        }
      }
    }
    return;
  }

  if (command === 'calendar' && subcommand === 'events') {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '50', 10) : 50;
    const today = process.argv.includes('--today');
    const upcoming = process.argv.includes('--upcoming');
    const now = new Date();
    const dateFrom = today ? now.toISOString().slice(0, 10) : upcoming ? now.toISOString().slice(0, 10) : undefined;
    const dateTo = today ? now.toISOString().slice(0, 10) + 'T23:59:59' : upcoming ? new Date(now.getTime() + 7 * 24 * 3600_000).toISOString().slice(0, 10) : undefined;
    const events = await client.listCalendarEvents(undefined, { ...(dateFrom !== undefined ? { dateFrom } : {}), ...(dateTo !== undefined ? { dateTo } : {}), limit });
    if (jsonFlag) {
      console.info(JSON.stringify(events, null, 2));
    } else {
      if (events.length === 0) {
        console.info('No calendar events found.');
      } else {
        for (const ev of events) {
          const time = ev.isAllDay ? 'all-day' : `${ev.startTime.slice(11, 16)}-${ev.endTime.slice(11, 16)}`;
          const loc = ev.location ? ` @ ${ev.location}` : '';
          console.info(`  ${ev.startTime.slice(0, 10)} ${time.padEnd(12)} ${ev.title.slice(0, 50)}${loc}`);
        }
      }
    }
    return;
  }

  if (command === 'calendar' && subcommand === 'search' && arg1) {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '20', 10) : 20;
    const response = await client.searchCalendar(arg1, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else {
      if (response.results.length === 0) {
        console.info('No matching calendar events found.');
      } else {
        for (const r of response.results) {
          const loc = r.location ? ` @ ${r.location}` : '';
          console.info(`  ${r.startTime.slice(0, 10)} ${r.startTime.slice(11, 16)}-${r.endTime.slice(11, 16)}  ${r.title.slice(0, 50)}${loc}`);
        }
      }
    }
    return;
  }

  if (command === 'calendar' && subcommand === 'availability') {
    const client = await requireDaemonClient(config);
    const dateIdx = process.argv.indexOf('--date');
    const date = dateIdx !== -1 ? (process.argv[dateIdx + 1] ?? new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10);
    const slots = await client.getCalendarAvailability({ date });
    if (jsonFlag) {
      console.info(JSON.stringify(slots, null, 2));
    } else {
      if (slots.length === 0) {
        console.info('No free slots available.');
      } else {
        console.info(`Free slots for ${date}:`);
        for (const slot of slots) {
          console.info(`  ${slot.startTime.slice(11, 16)} - ${slot.endTime.slice(11, 16)}  (${slot.durationMinutes}min)`);
        }
      }
    }
    return;
  }

  if (command === 'calendar' && subcommand === 'digest') {
    const client = await requireDaemonClient(config);
    const digest = await client.getCalendarDigest();
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No calendar digest available. Sync first with the daemon running.');
    } else {
      console.info(digest.summaryMarkdown);
    }
    return;
  }

  // --- Todo commands ---

  if (command === 'todo' && subcommand === 'connect') {
    const client = await requireDaemonClient(config);
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (prompt: string): Promise<string> => new Promise((resolveQuestion) => rl.question(prompt, resolveQuestion));
    const displayName = getFlagValue('--display-name') ?? 'Todoist';
    const label = getFlagValue('--label') ?? 'Todoist';
    const mode = process.argv.includes('--read-only') ? 'read_only' : 'read_write';
    const apiToken = (await ask('Todoist API token: ')).trim();
    rl.close();
    if (!apiToken) {
      console.error('A Todoist API token is required.');
      process.exit(1);
    }
    const result = await client.connectTodoist({
      apiToken,
      displayName,
      label,
      mode,
      syncIntervalSeconds: 900,
    });
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info('Connected Todoist.');
      console.info(`  Connection: ${result.connectionId}`);
      console.info(`  Account:    ${result.account.id} (${result.account.displayName})`);
      console.info('Run "pop todo sync" to fetch projects and tasks.');
    }
    return;
  }

  if (command === 'todo' && subcommand === 'accounts') {
    const client = await requireDaemonClient(config);
    const accounts = await client.listTodoAccounts();
    if (jsonFlag) {
      console.info(JSON.stringify(accounts, null, 2));
    } else {
      if (accounts.length === 0) {
        console.info('No todo accounts registered.');
      } else {
        for (const acct of accounts) {
          console.info(`  ${acct.id}  ${acct.displayName.padEnd(25)} ${acct.providerKind.padEnd(10)} todos: ${acct.todoCount}  last sync: ${acct.lastSyncAt ?? 'never'}`);
        }
      }
    }
    return;
  }

  if (command === 'todo' && subcommand === 'sync') {
    const client = await requireDaemonClient(config);
    const accounts = await client.listTodoAccounts();
    if (accounts.length === 0) {
      console.error('No todo accounts registered. Run "pop todo connect" first.');
      process.exit(1);
    }
    const targetId = arg1 ?? accounts[0]!.id;
    const result = await client.syncTodoAccount(targetId);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`  Synced: ${result.todosSynced} new, ${result.todosUpdated} updated`);
      if (result.errors.length > 0) {
        console.info(`  Errors: ${result.errors.length}`);
        for (const error of result.errors.slice(0, 5)) console.info(`    - ${error}`);
      }
    }
    return;
  }

  if (command === 'todo' && subcommand === 'list') {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '50', 10) : 50;
    const priorityIdx = process.argv.indexOf('--priority');
    const priority = priorityIdx !== -1 ? parseInt(process.argv[priorityIdx + 1] ?? '0', 10) : undefined;
    const projectIdx = process.argv.indexOf('--project');
    const project = projectIdx !== -1 ? process.argv[projectIdx + 1] : undefined;
    const overdue = process.argv.includes('--overdue');
    const status = overdue ? 'pending' : undefined;
    const todos = await client.listTodos(undefined, { ...(status !== undefined ? { status } : {}), ...(priority !== undefined ? { priority } : {}), ...(project !== undefined ? { project } : {}), limit });
    let filteredTodos = todos;
    if (overdue) {
      const todayStr = new Date().toISOString().slice(0, 10);
      filteredTodos = todos.filter((t) => t.dueDate !== null && t.dueDate < todayStr);
    }
    if (jsonFlag) {
      console.info(JSON.stringify(filteredTodos, null, 2));
    } else {
      if (filteredTodos.length === 0) {
        console.info('No todos found.');
      } else {
        for (const t of filteredTodos) {
          const due = t.dueDate ? ` due:${t.dueDate}` : '';
          const proj = t.projectName ? ` [${t.projectName}]` : '';
          const pri = t.priority <= 2 ? ` !!!` : t.priority === 3 ? ' !!' : '';
          console.info(`  ${t.id.slice(0, 8)}  ${t.status.padEnd(10)} P${t.priority} ${t.title.slice(0, 50)}${due}${proj}${pri}`);
        }
      }
    }
    return;
  }

  if (command === 'todo' && subcommand === 'add' && arg1) {
    const client = await requireDaemonClient(config);
    const accounts = await client.listTodoAccounts();
    if (accounts.length === 0) {
      console.error('No todo accounts registered. Create one first.');
      process.exit(1);
    }
    const priorityIdx = process.argv.indexOf('--priority');
    const priority = priorityIdx !== -1 ? parseInt(process.argv[priorityIdx + 1] ?? '4', 10) : undefined;
    const dueIdx = process.argv.indexOf('--due');
    const dueDate = dueIdx !== -1 ? process.argv[dueIdx + 1] : undefined;
    const projectIdx = process.argv.indexOf('--project');
    const projectName = projectIdx !== -1 ? process.argv[projectIdx + 1] : undefined;
    const todo = await client.createTodo({
      accountId: accounts[0]!.id,
      title: arg1,
      priority,
      dueDate,
      projectName,
    });
    if (jsonFlag) {
      console.info(JSON.stringify(todo, null, 2));
    } else {
      console.info(`Created todo: ${todo.id.slice(0, 8)} — ${todo.title}`);
    }
    return;
  }

  if (command === 'todo' && subcommand === 'complete' && arg1) {
    const client = await requireDaemonClient(config);
    const todo = await client.completeTodo(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(todo, null, 2));
    } else {
      console.info(`Completed: ${todo.title}`);
    }
    return;
  }

  if (command === 'todo' && subcommand === 'search' && arg1) {
    const client = await requireDaemonClient(config);
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '20', 10) : 20;
    const response = await client.searchTodos(arg1, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else {
      if (response.results.length === 0) {
        console.info('No matching todos found.');
      } else {
        for (const r of response.results) {
          const due = r.dueDate ? ` due:${r.dueDate}` : '';
          const proj = r.projectName ? ` [${r.projectName}]` : '';
          console.info(`  P${r.priority} ${r.status.padEnd(10)} ${r.title.slice(0, 50)}${due}${proj}`);
        }
      }
    }
    return;
  }

  if (command === 'todo' && subcommand === 'digest') {
    const client = await requireDaemonClient(config);
    const digest = await client.getTodoDigest();
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No todo digest available. Sync first with the daemon running.');
    } else {
      console.info(digest.summaryMarkdown);
    }
    return;
  }

  // --- People commands ---

  if (command === 'people' && subcommand === 'list') {
    const client = await requireDaemonClient(config);
    const people = await client.listPeople();
    if (jsonFlag) {
      console.info(JSON.stringify(people, null, 2));
    } else if (people.length === 0) {
      console.info('No people projected yet. Sync email, calendar, or GitHub first.');
    } else {
      for (const person of people) {
        console.info(`  ${person.id}  ${person.displayName}  ${person.canonicalEmail ?? person.githubLogin ?? ''}`.trimEnd());
      }
    }
    return;
  }

  if (command === 'people' && subcommand === 'search' && arg1) {
    const client = await requireDaemonClient(config);
    const limit = Number.parseInt(getFlagValue('--limit') ?? '20', 10);
    const response = await client.searchPeople(arg1, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else if (response.results.length === 0) {
      console.info('No matching people found.');
    } else {
      for (const result of response.results) {
        console.info(`  ${result.personId}  ${result.displayName}  ${result.canonicalEmail ?? result.githubLogin ?? ''}`.trimEnd());
      }
    }
    return;
  }

  if (command === 'people' && subcommand === 'show' && arg1) {
    const client = await requireDaemonClient(config);
    const person = await client.getPerson(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(person, null, 2));
    } else {
      console.info(`Person ${person.id}`);
      console.info(`  Name:          ${person.displayName}`);
      console.info(`  Email:         ${person.canonicalEmail ?? '(none)'}`);
      console.info(`  GitHub:        ${person.githubLogin ?? '(none)'}`);
      console.info(`  Pronouns:      ${person.pronouns ?? '(none)'}`);
      console.info(`  Tags:          ${person.tags.length > 0 ? person.tags.join(', ') : '(none)'}`);
      console.info(`  Identities:    ${person.identityCount}`);
      console.info(`  Contacts:      ${person.contactMethodCount}`);
      console.info(`  Activity:      ${person.activitySummary || '(none)'}`);
    }
    return;
  }

  if (command === 'people' && subcommand === 'edit' && arg1) {
    const client = await requireDaemonClient(config);
    const displayName = getFlagValue('--display-name');
    const pronouns = getFlagValue('--pronouns');
    const tagsFlag = getFlagValue('--tags');
    const notes = getFlagValue('--notes');
    const updated = await client.updatePerson(arg1, {
      ...(displayName ? { displayName } : {}),
      ...(pronouns !== undefined ? { pronouns } : {}),
      ...(tagsFlag !== undefined ? { tags: tagsFlag.split(',').map((value) => value.trim()).filter(Boolean) } : {}),
      ...(notes !== undefined ? { notes } : {}),
    });
    if (jsonFlag) {
      console.info(JSON.stringify(updated, null, 2));
    } else {
      console.info(`Updated ${updated.id}: ${updated.displayName}`);
    }
    return;
  }

  if (command === 'people' && subcommand === 'merge' && arg1 && _arg2) {
    const client = await requireDaemonClient(config);
    const merged = await client.mergePeople({
      sourcePersonId: arg1,
      targetPersonId: _arg2,
      requestedBy: 'cli',
    });
    if (jsonFlag) {
      console.info(JSON.stringify(merged, null, 2));
    } else {
      console.info(`Merged into ${merged.id}: ${merged.displayName}`);
    }
    return;
  }

  if (command === 'people' && subcommand === 'attach' && arg1) {
    const provider = getFlagValue('--provider');
    const externalId = getFlagValue('--external-id');
    if (!provider || !externalId || !['email', 'calendar', 'github'].includes(provider)) {
      console.error('Usage: pop people attach <personId> --provider <email|calendar|github> --external-id <value> [--display-name <name>] [--handle <value>]');
      process.exit(1);
    }
    const client = await requireDaemonClient(config);
    const attached = await client.attachPersonIdentity({
      personId: arg1,
      provider: provider as 'email' | 'calendar' | 'github',
      externalId,
      displayName: getFlagValue('--display-name') ?? null,
      handle: getFlagValue('--handle') ?? null,
      requestedBy: 'cli',
    });
    if (jsonFlag) {
      console.info(JSON.stringify(attached, null, 2));
    } else {
      console.info(`Attached identity to ${attached.id}: ${attached.displayName}`);
    }
    return;
  }

  if (command === 'people' && subcommand === 'detach' && arg1) {
    const client = await requireDaemonClient(config);
    const detached = await client.detachPersonIdentity(arg1, { requestedBy: 'cli' });
    if (jsonFlag) {
      console.info(JSON.stringify(detached, null, 2));
    } else {
      console.info(`Detached into ${detached.id}: ${detached.displayName}`);
    }
    return;
  }

  if (command === 'people' && subcommand === 'split' && arg1) {
    const identityIds = positionalArgs.slice(5);
    if (identityIds.length === 0) {
      console.error('Usage: pop people split <personId> <identityId> [identityId...]');
      process.exit(1);
    }
    const client = await requireDaemonClient(config);
    const split = await client.splitPerson(arg1, {
      identityIds,
      requestedBy: 'cli',
    });
    if (jsonFlag) {
      console.info(JSON.stringify(split, null, 2));
    } else {
      console.info(`Split into ${split.id}: ${split.displayName}`);
    }
    return;
  }

  // --- People Tranche 2: history, suggestions, activity ---

  if (command === 'people' && subcommand === 'history' && arg1) {
    const client = await requireDaemonClient(config);
    const events = await client.listPersonMergeEvents(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(events, null, 2));
    } else if (events.length === 0) {
      console.info('No merge/split events found.');
    } else {
      for (const event of events) {
        console.info(`  ${event.eventType.padEnd(10)} ${event.sourcePersonId} → ${event.targetPersonId}  ${event.createdAt}`);
      }
    }
    return;
  }

  if (command === 'people' && subcommand === 'suggestions') {
    const client = await requireDaemonClient(config);
    const suggestions = await client.getPersonMergeSuggestions();
    if (jsonFlag) {
      console.info(JSON.stringify(suggestions, null, 2));
    } else if (suggestions.length === 0) {
      console.info('No merge suggestions found.');
    } else {
      for (const sug of suggestions) {
        console.info(`  ${sug.sourceDisplayName} → ${sug.targetDisplayName}  (${sug.reason}, confidence: ${sug.confidence})`);
      }
    }
    return;
  }

  if (command === 'people' && subcommand === 'activity' && arg1) {
    const client = await requireDaemonClient(config);
    const rollups = await client.getPersonActivityRollups(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(rollups, null, 2));
    } else if (rollups.length === 0) {
      console.info('No activity found.');
    } else {
      for (const rollup of rollups) {
        console.info(`  ${rollup.domain.padEnd(12)} ${rollup.summary.padEnd(30)} count: ${rollup.count}  last: ${rollup.lastSeenAt}`);
      }
    }
    return;
  }

  // --- Finance CLI ---

  if (command === 'finance' && subcommand === 'imports') {
    const client = await requireDaemonClient(config);
    const imports = await client.listFinanceImports();
    if (jsonFlag) {
      console.info(JSON.stringify(imports, null, 2));
    } else if (imports.length === 0) {
      console.info('No finance imports found.');
    } else {
      for (const imp of imports) {
        console.info(`  ${imp.id.slice(0, 8)}  ${imp.fileName.padEnd(30)} ${imp.status.padEnd(12)} ${imp.importType}  records: ${imp.recordCount}`);
      }
    }
    return;
  }

  if (command === 'finance' && subcommand === 'transactions') {
    const client = await requireDaemonClient(config);
    const category = getFlagValue('--category');
    const limit = getFlagValue('--limit');
    const opts: { category?: string; limit?: number } = {};
    if (category) opts.category = category;
    if (limit) opts.limit = Number(limit);
    const transactions = await client.listFinanceTransactions(opts);
    if (jsonFlag) {
      console.info(JSON.stringify(transactions, null, 2));
    } else if (transactions.length === 0) {
      console.info('No transactions found.');
    } else {
      for (const tx of transactions) {
        const sign = tx.amount >= 0 ? '+' : '';
        console.info(`  ${tx.date}  ${sign}${tx.currency} ${tx.amount.toFixed(2).padStart(10)}  ${tx.description.slice(0, 40)}${tx.category ? `  [${tx.category}]` : ''}`);
      }
    }
    return;
  }

  if (command === 'finance' && subcommand === 'search' && arg1) {
    const client = await requireDaemonClient(config);
    const result = await client.searchFinance(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else if (result.results.length === 0) {
      console.info('No results found.');
    } else {
      for (const item of result.results) {
        console.info(`  ${item.date}  $${item.amount.toFixed(2).padStart(10)}  ${item.description.slice(0, 40)}`);
      }
    }
    return;
  }

  if (command === 'finance' && subcommand === 'digest') {
    const client = await requireDaemonClient(config);
    const period = getFlagValue('--period');
    const digest = await client.getFinanceDigest(period ?? undefined);
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No finance digest available.');
    } else {
      console.info(`Period: ${digest.period}`);
      console.info(`Income:   $${digest.totalIncome.toFixed(2)}`);
      console.info(`Expenses: $${digest.totalExpenses.toFixed(2)}`);
      if (Object.keys(digest.categoryBreakdown).length > 0) {
        console.info('Categories:');
        for (const [cat, amount] of Object.entries(digest.categoryBreakdown)) {
          console.info(`  ${cat.padEnd(20)} $${amount.toFixed(2)}`);
        }
      }
    }
    return;
  }

  if (command === 'finance' && subcommand === 'import' && arg1) {
    const client = await requireDaemonClient(config);
    const filePath = resolve(arg1);
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exitCode = 1;
      return;
    }
    const fileName = filePath.split('/').pop() ?? arg1;
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const importType = (['csv', 'ofx', 'qfx'].includes(ext) ? ext : 'other') as 'csv' | 'ofx' | 'qfx' | 'other';

    const vaultId = getFlagValue('--vault');
    if (!vaultId) {
      const vaults = await client.listVaults('finance');
      if (vaults.length === 0) {
        console.error('No finance vaults found. Create one first: pop vaults create finance <name>');
        process.exitCode = 1;
        return;
      }
      const defaultVault = vaults[0]!;
      const imp = await client.createFinanceImport({ vaultId: defaultVault.id, importType, fileName });
      if (importType === 'csv') {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        const header = parseCsvLine(lines[0] ?? '');
        const dateIdx = header.findIndex((h) => /date/i.test(h));
        const descIdx = header.findIndex((h) => /desc|memo|name/i.test(h));
        const amountIdx = header.findIndex((h) => /amount/i.test(h));
        const catIdx = header.findIndex((h) => /category|cat/i.test(h));
        const transactions: Array<{
          date: string;
          description: string;
          amount: number;
          category?: string | null;
        }> = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCsvLine(lines[i]!);
          if (cols.length < 3) continue;
          transactions.push({
            date: cols[dateIdx >= 0 ? dateIdx : 0]?.trim() ?? '',
            description: cols[descIdx >= 0 ? descIdx : 1]?.trim() ?? '',
            amount: parseFloat(cols[amountIdx >= 0 ? amountIdx : 2]?.trim() ?? '0') || 0,
            category: catIdx >= 0 ? (cols[catIdx]?.trim() || null) : null,
          });
        }
        if (transactions.length > 0) {
          await client.insertFinanceTransactionBatch({ importId: imp.id, transactions });
        }
        await client.updateFinanceImportStatus(imp.id, 'completed', transactions.length);
        console.info(`Imported ${transactions.length} transactions from ${fileName}`);
      } else {
        console.info(`Import created: ${imp.id.slice(0, 8)} (${importType}). Parse and add transactions via API or web inspector.`);
      }
      return;
    }
    const imp = await client.createFinanceImport({ vaultId, importType, fileName });
    console.info(`Import created: ${imp.id.slice(0, 8)} (${importType})`);
    return;
  }

  // --- Medical CLI ---

  if (command === 'medical' && subcommand === 'imports') {
    const client = await requireDaemonClient(config);
    const imports = await client.listMedicalImports();
    if (jsonFlag) {
      console.info(JSON.stringify(imports, null, 2));
    } else if (imports.length === 0) {
      console.info('No medical imports found.');
    } else {
      for (const imp of imports) {
        console.info(`  ${imp.id.slice(0, 8)}  ${imp.fileName.padEnd(30)} ${imp.status.padEnd(12)} ${imp.importType}`);
      }
    }
    return;
  }

  if (command === 'medical' && subcommand === 'appointments') {
    const client = await requireDaemonClient(config);
    const limit = getFlagValue('--limit');
    const apptOpts: { limit?: number } = {};
    if (limit) apptOpts.limit = Number(limit);
    const appointments = await client.listMedicalAppointments(apptOpts);
    if (jsonFlag) {
      console.info(JSON.stringify(appointments, null, 2));
    } else if (appointments.length === 0) {
      console.info('No appointments found.');
    } else {
      for (const appt of appointments) {
        console.info(`  ${appt.date}  ${appt.provider.padEnd(20)}${appt.specialty ? ` [${appt.specialty}]` : ''}${appt.location ? ` @ ${appt.location}` : ''}`);
      }
    }
    return;
  }

  if (command === 'medical' && subcommand === 'medications') {
    const client = await requireDaemonClient(config);
    const medications = await client.listMedicalMedications();
    if (jsonFlag) {
      console.info(JSON.stringify(medications, null, 2));
    } else if (medications.length === 0) {
      console.info('No medications found.');
    } else {
      for (const med of medications) {
        console.info(`  ${med.name.padEnd(25)} ${med.dosage ?? ''}${med.frequency ? ` · ${med.frequency}` : ''}${med.prescriber ? ` (${med.prescriber})` : ''}`);
      }
    }
    return;
  }

  if (command === 'medical' && subcommand === 'search' && arg1) {
    const client = await requireDaemonClient(config);
    const result = await client.searchMedical(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else if (result.results.length === 0) {
      console.info('No results found.');
    } else {
      for (const item of result.results) {
        console.info(`  [${item.recordType}] ${item.redactedSummary.slice(0, 50)}${item.date ? ` (${item.date})` : ''}`);
      }
    }
    return;
  }

  if (command === 'medical' && subcommand === 'digest') {
    const client = await requireDaemonClient(config);
    const digest = await client.getMedicalDigest();
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No medical digest available.');
    } else {
      console.info(`Period: ${digest.period}`);
      console.info(`Appointments: ${digest.appointmentCount}`);
      console.info(`Active medications: ${digest.activeMedications}`);
      if (digest.summary) {
        console.info(`Summary: ${digest.summary}`);
      }
    }
    return;
  }

  if (command === 'medical' && subcommand === 'import' && arg1) {
    const client = await requireDaemonClient(config);
    const filePath = resolve(arg1);
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exitCode = 1;
      return;
    }
    const fileName = filePath.split('/').pop() ?? arg1;
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const importType = (ext === 'pdf' ? 'pdf' : ext === 'document' ? 'document' : 'other') as 'pdf' | 'document' | 'other';

    const vaultId = getFlagValue('--vault');
    let resolvedVaultId = vaultId;
    if (!resolvedVaultId) {
      const vaults = await client.listVaults('medical');
      if (vaults.length === 0) {
        console.error('No medical vaults found. Create one first: pop vaults create medical <name>');
        process.exitCode = 1;
        return;
      }
      resolvedVaultId = vaults[0]!.id;
    }
    const imp = await client.createMedicalImport({ vaultId: resolvedVaultId, importType, fileName });
    console.info(`Import created: ${imp.id.slice(0, 8)} (${importType})`);
    console.info('Add appointments/medications via API or web inspector.');
    return;
  }

  // --- File write-intent CLI ---

  if (command === 'files' && subcommand === 'review') {
    const client = await requireDaemonClient(config);
    const intents = await client.listFileWriteIntents({ status: 'pending' });
    if (jsonFlag) {
      console.info(JSON.stringify(intents, null, 2));
    } else if (intents.length === 0) {
      console.info('No pending write intents.');
    } else {
      for (const intent of intents) {
        console.info(`  ${intent.id.slice(0, 8)}  ${intent.intentType.padEnd(8)} ${intent.filePath}`);
        if (intent.diffPreview) {
          for (const line of intent.diffPreview.split('\n').slice(0, 5)) {
            console.info(`    ${line}`);
          }
        }
      }
    }
    return;
  }

  if (command === 'files' && subcommand === 'apply' && arg1) {
    const client = await requireDaemonClient(config);
    const result = await client.reviewFileWriteIntent(arg1, { action: 'apply' });
    console.info(`Applied write intent ${result.id}: ${result.filePath}`);
    return;
  }

  if (command === 'files' && subcommand === 'reject' && arg1) {
    const client = await requireDaemonClient(config);
    const reviewInput: { action: 'reject'; reason?: string } = { action: 'reject' };
    if (_arg2) reviewInput.reason = _arg2;
    const result = await client.reviewFileWriteIntent(arg1, reviewInput);
    console.info(`Rejected write intent ${result.id}: ${result.filePath}`);
    return;
  }

  // --- Upgrade CLI ---

  if (command === 'upgrade' && subcommand === 'verify') {
    const client = await requireDaemonClient(config);
    try {
      const daemonStatus = await client.status();
      const result = {
        ok: daemonStatus.ok,
        schedulerRunning: daemonStatus.schedulerRunning,
        engineKind: daemonStatus.engineKind,
        runningJobs: daemonStatus.runningJobs,
        startedAt: daemonStatus.startedAt,
      };
      if (jsonFlag) {
        console.info(JSON.stringify(result, null, 2));
      } else {
        console.info(`Daemon: ${result.ok ? 'healthy' : 'unhealthy'}`);
        console.info(`Scheduler: ${result.schedulerRunning ? 'running' : 'stopped'}`);
        console.info(`Engine: ${result.engineKind}`);
        console.info(`Running jobs: ${result.runningJobs}`);
        console.info(`Started: ${result.startedAt}`);
      }
    } catch (error) {
      console.error(`Upgrade verification failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'upgrade' && subcommand === 'rollback') {
    requireArg(arg1, 'backupPath');
    const targetPath = resolve(arg1);
    if (!existsSync(targetPath)) {
      console.error(`Backup not found: ${targetPath}`);
      process.exit(1);
    }
    const upgradePaths = deriveRuntimePaths(config.runtimeDataDir);
    try {
      const { MigrationManager } = await import('@popeye/runtime-core');
      const Database = (await import('better-sqlite3')).default;
      const appDbPath = upgradePaths.appDbPath;
      const tempDb = new Database(':memory:');
      const mgr = new MigrationManager(tempDb);
      mgr.rollbackMigration(targetPath, appDbPath);
      tempDb.close();
      console.info(`Restored app database from backup: ${targetPath}`);
      console.info('Restart the daemon to apply the restored state.');
    } catch (error) {
      console.error(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
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

  if (command === 'migrate' && subcommand === 'telegram') {
    if (arg1) {
      // Read OpenClaw config and extract telegram settings
      const configFilePath = resolve(arg1);
      if (!existsSync(configFilePath)) {
        console.error(`Config file not found: ${configFilePath}`);
        process.exit(1);
      }
      try {
        const rawContent = readFileSync(configFilePath, 'utf-8');
        const parsed: unknown = JSON.parse(rawContent);
        if (typeof parsed !== 'object' || parsed === null) {
          console.error('Invalid config: expected a JSON object');
          process.exit(1);
        }
        const obj = parsed as Record<string, unknown>;
        const telegramSection = obj['telegram'] as Record<string, unknown> | undefined;

        const botToken = telegramSection?.['botToken'] ?? telegramSection?.['bot_token'] ?? null;
        const allowedUsers = telegramSection?.['allowedUsers'] ?? telegramSection?.['allowed_users'] ?? [];

        const popeyeConfig = {
          telegram: {
            botToken: botToken ? '<REDACTED — set via POPEYE_TELEGRAM_BOT_TOKEN env var>' : null,
            allowedUsers: Array.isArray(allowedUsers) ? allowedUsers : [],
            rateLimitPerMinute: 30,
          },
        };

        console.info('Extracted Popeye telegram config from OpenClaw config:');
        console.info('');
        console.info(JSON.stringify(popeyeConfig, null, 2));
        console.info('');
        if (botToken) {
          console.info('NOTE: Bot token was found but redacted. Set it via environment variable:');
          console.info('  export POPEYE_TELEGRAM_BOT_TOKEN="<your-token>"');
        } else {
          console.info('NOTE: No bot token found in the source config.');
          console.info('Set it via environment variable: export POPEYE_TELEGRAM_BOT_TOKEN="<your-token>"');
        }
        console.info('');
        console.info('Paste the JSON above into your Popeye config.json under the "telegram" key.');
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.error(`Failed to parse config file as JSON: ${error.message}`);
        } else {
          console.error(`Error reading config: ${error instanceof Error ? error.message : String(error)}`);
        }
        process.exit(1);
      }
    } else {
      // No source config — output a template
      const template = {
        telegram: {
          botToken: '<set via POPEYE_TELEGRAM_BOT_TOKEN env var>',
          allowedUsers: ['<telegram-user-id-1>', '<telegram-user-id-2>'],
          rateLimitPerMinute: 30,
        },
      };
      console.info('Popeye telegram config template:');
      console.info('');
      console.info(JSON.stringify(template, null, 2));
      console.info('');
      console.info('Instructions:');
      console.info('  1. Create a Telegram bot via @BotFather and note the token');
      console.info('  2. Set the token as an environment variable:');
      console.info('     export POPEYE_TELEGRAM_BOT_TOKEN="<your-token>"');
      console.info('  3. Replace allowedUsers with numeric Telegram user IDs');
      console.info('  4. Paste the config into your Popeye config.json');
      console.info('');
      console.info('To import from an existing OpenClaw config:');
      console.info('  pop migrate telegram /path/to/openclaw/config.json');
    }
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
