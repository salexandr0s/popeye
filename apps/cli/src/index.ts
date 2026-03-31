#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { PopeyeApiClient } from '@popeye/api-client';
import type { AppConfig } from '@popeye/contracts';
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
import { formatEngineCapabilities, formatSecurityPolicy, requireArg } from './formatters.js';
import { handleApprovals, handleStandingApprovals, handleAutomationGrants } from './commands/approvals.js';
import { handleMemory, handleKnowledge } from './commands/memory.js';
import { handleRun, handleRuns, handleReceipt, handleInterventions, handleTask, handleRecovery, handleJobs, handleSessions, handleProfile } from './commands/runs.js';
import { handleVaults } from './commands/vaults.js';
import { handleConnection } from './commands/connection.js';
import { handleEmail } from './commands/email.js';
import { handleGithub } from './commands/github.js';
import { handleCalendar } from './commands/calendar.js';
import { handleTodo } from './commands/todo.js';
import { handlePeople } from './commands/people.js';
import { handleFinance } from './commands/finance.js';
import { handleMedical } from './commands/medical.js';
import { handleFiles } from './commands/files.js';
import { handlePlaybook } from './commands/playbooks.js';

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
    inspect: { desc: 'Inspect memory with full history', usage: 'pop memory inspect <id>' },
    history: { desc: 'Show memory version history', usage: 'pop memory history <id>' },
    pin: { desc: 'Pin a memory as important', usage: 'pop memory pin <id>' },
    forget: { desc: 'Forget a memory', usage: 'pop memory forget <id>' },
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
  playbook: {
    list: { desc: 'List canonical playbooks', usage: 'pop playbook list' },
    show: { desc: 'Show one playbook', usage: 'pop playbook show <recordId>' },
    revisions: { desc: 'List playbook revisions', usage: 'pop playbook revisions <recordId>' },
    usage: { desc: 'List recent playbook usage runs', usage: 'pop playbook usage <recordId>' },
    proposals: { desc: 'List playbook proposals', usage: 'pop playbook proposals' },
    proposal: { desc: 'Show one playbook proposal', usage: 'pop playbook proposal <proposalId>' },
    approve: { desc: 'Approve a playbook proposal', usage: 'pop playbook approve <proposalId> [note]' },
    reject: { desc: 'Reject a playbook proposal', usage: 'pop playbook reject <proposalId> [note]' },
    apply: { desc: 'Apply an approved playbook proposal', usage: 'pop playbook apply <proposalId>' },
    activate: { desc: 'Activate a playbook', usage: 'pop playbook activate <recordId>' },
    retire: { desc: 'Retire a playbook', usage: 'pop playbook retire <recordId>' },
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
  if (command === 'vaults') {
    const client = await requireDaemonClient(config);
    return handleVaults({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'recovery') {
    const client = await requireDaemonClient(config);
    return handleRecovery({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }

  if (command === 'memory') {
    const client = await requireDaemonClient(config);
    return handleMemory({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'knowledge') {
    const client = await requireDaemonClient(config);
    return handleKnowledge({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'jobs') {
    const client = await requireDaemonClient(config);
    return handleJobs({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'sessions') {
    const client = await requireDaemonClient(config);
    return handleSessions({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'profile') {
    const client = await requireDaemonClient(config);
    return handleProfile({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'playbook') {
    const client = await requireDaemonClient(config);
    return handlePlaybook({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'files') {
    const client = await requireDaemonClient(config);
    return handleFiles({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'email') {
    const client = await requireDaemonClient(config);
    return handleEmail({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'github') {
    const client = await requireDaemonClient(config);
    return handleGithub({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'calendar') {
    const client = await requireDaemonClient(config);
    return handleCalendar({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'todo') {
    const client = await requireDaemonClient(config);
    return handleTodo({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'connection') {
    const client = await requireDaemonClient(config);
    return handleConnection({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'people') {
    const client = await requireDaemonClient(config);
    return handlePeople({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'finance') {
    const client = await requireDaemonClient(config);
    return handleFinance({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
  }
  if (command === 'medical') {
    const client = await requireDaemonClient(config);
    return handleMedical({ client, subcommand: subcommand ?? '', arg1, arg2: _arg2, jsonFlag, positionalArgs });
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
