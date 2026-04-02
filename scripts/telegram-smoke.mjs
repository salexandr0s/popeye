#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';

import { z } from 'zod';

const DEFAULT_RUNTIME_DATA_DIR = join(homedir(), 'Library', 'Application Support', 'Popeye');
const DEFAULT_CONFIG_PATH = join(DEFAULT_RUNTIME_DATA_DIR, 'config.json');
const DEFAULT_AUTH_FILE = join(DEFAULT_RUNTIME_DATA_DIR, 'config', 'auth.json');
const DEFAULT_OUTPUT_ROOT = join('artifacts', 'telegram-smoke');
const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_TIMEOUT_SECONDS = 45;
const DEFAULT_POLL_MS = 1000;
const DEFAULT_LAUNCHD_LABEL = 'dev.popeye.popeyed';
const MAX_TEXT_SCAN_BYTES = 5 * 1024 * 1024;
const TELEGRAM_MUTATION_KINDS = new Set(['telegram_config_update', 'telegram_apply', 'daemon_restart']);

const AppConfigSchema = z.object({
  runtimeDataDir: z.string().min(1).default(DEFAULT_RUNTIME_DATA_DIR),
  authFile: z.string().min(1).default(DEFAULT_AUTH_FILE),
  security: z.object({
    bindHost: z.literal('127.0.0.1').default('127.0.0.1'),
    bindPort: z.number().int().min(1).max(65535).default(3210),
  }).default({ bindHost: '127.0.0.1', bindPort: 3210 }),
}).passthrough();

const AuthTokenSchema = z.object({
  current: z.object({
    token: z.string().min(1),
  }),
});

const AuthStoreSchema = z.union([
  AuthTokenSchema,
  z.object({
    roles: z.object({
      operator: AuthTokenSchema,
    }),
  }),
]);

const HealthSchema = z.object({
  ok: z.boolean(),
  startedAt: z.string(),
}).passthrough();

const StatusSchema = z.object({
  ok: z.boolean(),
  schedulerRunning: z.boolean(),
  startedAt: z.string(),
}).passthrough();

const SchedulerSchema = z.object({
  running: z.boolean(),
  activeLeases: z.number().int().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  nextHeartbeatDueAt: z.string().nullable(),
}).passthrough();

const TelegramConfigRecordSchema = z.object({
  enabled: z.boolean(),
  allowedUserId: z.string().nullable().default(null),
  secretRefId: z.string().nullable().default(null),
}).passthrough();

const TelegramConfigSnapshotSchema = z.object({
  persisted: TelegramConfigRecordSchema,
  applied: TelegramConfigRecordSchema,
  effectiveWorkspaceId: z.string(),
  secretAvailability: z.enum(['not_configured', 'available', 'missing']),
  staleComparedToApplied: z.boolean(),
  warnings: z.array(z.string()).default([]),
  managementMode: z.enum(['launchd', 'manual']),
  restartSupported: z.boolean(),
}).passthrough();

const TelegramRelayCheckpointSchema = z.object({
  relayKey: z.literal('telegram_long_poll'),
  workspaceId: z.string(),
  lastAcknowledgedUpdateId: z.number().int(),
  updatedAt: z.string(),
}).nullable();

const TelegramDeliveryRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  chatId: z.string(),
  telegramMessageId: z.number().int(),
  status: z.enum(['pending', 'sending', 'sent', 'uncertain', 'abandoned']),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

const MutationReceiptSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'telegram_config_update',
    'telegram_apply',
    'daemon_restart',
    'automation_update',
    'automation_run_now',
    'automation_pause',
    'automation_resume',
    'curated_document_save',
  ]),
  component: z.string(),
  status: z.enum(['succeeded', 'failed', 'scheduled']),
  summary: z.string(),
  details: z.string(),
  actorRole: z.string(),
  workspaceId: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
}).passthrough();

const SnapshotSchema = z.object({
  label: z.string(),
  capturedAt: z.string(),
  workspaceId: z.string(),
  health: HealthSchema,
  status: StatusSchema,
  scheduler: SchedulerSchema,
  telegramConfig: TelegramConfigSnapshotSchema,
  relayCheckpoint: TelegramRelayCheckpointSchema,
  uncertainDeliveries: z.array(TelegramDeliveryRecordSchema),
  mutationReceipts: z.array(MutationReceiptSchema),
  connections: z.unknown(),
}).passthrough();

const RunConfigSchema = z.object({
  runId: z.string(),
  mode: z.enum(['launchd', 'manual']),
  startedAt: z.string(),
  workspaceId: z.string(),
  hostName: z.string(),
  baseUrl: z.string(),
  configPath: z.string(),
  runtimeDataDir: z.string(),
  authFile: z.string(),
  outputDir: z.string(),
  launchdLabel: z.string(),
  allowDirtyBaseline: z.boolean().default(false),
  launchdLogPaths: z.array(z.string()).default([]),
  runtimeLogDir: z.string(),
}).passthrough();

const PreflightSchema = z.object({
  runId: z.string(),
  checkedAt: z.string(),
  clean: z.boolean(),
  managementModeMatches: z.boolean(),
  issues: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  snapshot: SnapshotSchema,
}).passthrough();

const SecretPatternSchema = z.object({
  name: z.string(),
  regex: z.instanceof(RegExp),
});

const SECRET_PATTERNS = z.array(SecretPatternSchema).parse([
  { name: 'openai-key', regex: /sk-[A-Za-z0-9]{10,}/g },
  { name: 'github-token', regex: /ghp_[A-Za-z0-9]{20,}/g },
  { name: 'private-key', regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----/g },
  { name: 'bearer-token', regex: /Bearer\s+[A-Za-z0-9._-]{20,}/g },
  { name: 'aws-access-key', regex: /AKIA[A-Z0-9]{16}/g },
  { name: 'github-pat', regex: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'anthropic-key', regex: /sk-ant-[A-Za-z0-9-]{20,}/g },
  { name: 'slack-webhook', regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_/]+/g },
  { name: 'telegram-bot-token', regex: /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g },
]);

function usage() {
  console.info(`Usage: node scripts/telegram-smoke.mjs <command> [options]

Commands:
  start     Initialize a clean-machine Telegram smoke run and capture baseline state.
  snapshot  Capture a labeled checkpoint after an in-app action.
  finish    Scan logs/artifacts, evaluate the run, and write result files.

start options:
  --mode <launchd|manual>        Required. Expected daemon management mode.
  --output-dir <dir>             Optional. Defaults to artifacts/telegram-smoke/<stamp>-<mode>.
  --workspace <id>               Optional. Defaults to default.
  --config <path>                Optional. Defaults to POPEYE_CONFIG_PATH or ~/Library/Application Support/Popeye/config.json.
  --base-url <url>               Optional. Defaults to http://127.0.0.1:<bindPort> from config.
  --launchd-label <label>        Optional. Defaults to dev.popeye.popeyed.
  --allow-dirty-baseline         Optional. Allows start on a non-clean Telegram baseline.

snapshot options:
  --run-dir <dir>                Required. Directory created by start.
  --label <name>                 Required. Example: after-save, after-apply, after-restart.
  --wait-for-healthy             Optional. Poll /v1/health before capturing.
  --timeout-seconds <n>          Optional. Defaults to 45.
  --poll-ms <n>                  Optional. Defaults to 1000.

finish options:
  --run-dir <dir>                Required. Directory created by start.
`);
}

function isoNow() {
  return new Date().toISOString();
}

function stampNow() {
  return isoNow().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseBooleanFlag(arg) {
  return arg === '--allow-dirty-baseline' || arg === '--wait-for-healthy';
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exit(0);
  }

  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (parseBooleanFlag(arg)) {
      options[arg.slice(2)] = true;
      continue;
    }
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[arg.slice(2)] = next;
    index += 1;
  }

  if (command === 'start') {
    const mode = options['mode'];
    if (mode !== 'launchd' && mode !== 'manual') {
      throw new Error('start requires --mode launchd|manual');
    }
    return {
      command,
      mode,
      outputDir: options['output-dir'],
      workspaceId: options['workspace'] ?? DEFAULT_WORKSPACE_ID,
      configPath: options['config'],
      baseUrl: options['base-url'],
      launchdLabel: options['launchd-label'] ?? DEFAULT_LAUNCHD_LABEL,
      allowDirtyBaseline: Boolean(options['allow-dirty-baseline']),
    };
  }

  if (command === 'snapshot') {
    const runDir = options['run-dir'];
    const label = options['label'];
    if (!runDir) throw new Error('snapshot requires --run-dir');
    if (!label) throw new Error('snapshot requires --label');
    const timeoutSeconds = Number(options['timeout-seconds'] ?? DEFAULT_TIMEOUT_SECONDS);
    const pollMs = Number(options['poll-ms'] ?? DEFAULT_POLL_MS);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      throw new Error('snapshot --timeout-seconds must be > 0');
    }
    if (!Number.isFinite(pollMs) || pollMs <= 0) {
      throw new Error('snapshot --poll-ms must be > 0');
    }
    return {
      command,
      runDir,
      label,
      waitForHealthy: Boolean(options['wait-for-healthy']),
      timeoutSeconds,
      pollMs,
    };
  }

  if (command === 'finish') {
    const runDir = options['run-dir'];
    if (!runDir) throw new Error('finish requires --run-dir');
    return {
      command,
      runDir,
    };
  }

  throw new Error(`Unknown command: ${command}`);
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function resolveConfigPath(configPath) {
  return resolve(configPath ?? process.env.POPEYE_CONFIG_PATH ?? DEFAULT_CONFIG_PATH);
}

function normalizeConfig(raw) {
  const config = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw }
    : raw;
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    if (typeof config.runtimeDataDir !== 'string' || config.runtimeDataDir.trim().length === 0) {
      config.runtimeDataDir = DEFAULT_RUNTIME_DATA_DIR;
    }
    if (typeof config.authFile !== 'string' || config.authFile.trim().length === 0) {
      config.authFile = join(config.runtimeDataDir, 'config', 'auth.json');
    }
    if (typeof config.security !== 'object' || config.security === null || Array.isArray(config.security)) {
      config.security = { bindHost: '127.0.0.1', bindPort: 3210 };
    }
  }
  return AppConfigSchema.parse(config);
}

export function loadHarnessConfig(configPathArg) {
  const configPath = resolveConfigPath(configPathArg);
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const config = normalizeConfig(readJsonFile(configPath));
  const runtimeDataDir = resolve(config.runtimeDataDir);
  const authFile = resolve(config.authFile);
  const baseUrl = `http://${config.security.bindHost}:${config.security.bindPort}`;
  return {
    configPath,
    config,
    runtimeDataDir,
    authFile,
    baseUrl,
  };
}

export function readOperatorToken(authFilePath) {
  const raw = AuthStoreSchema.parse(readJsonFile(authFilePath));
  return 'roles' in raw ? raw.roles.operator.current.token : raw.current.token;
}

function apiUrl(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

async function fetchJson(baseUrl, token, path, fetchImpl = fetch) {
  const response = await fetchImpl(apiUrl(baseUrl, path), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  const payload = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${text}`);
  }
  return payload;
}

async function sleep(ms) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export async function waitForHealthy({ baseUrl, token, timeoutMs = DEFAULT_TIMEOUT_SECONDS * 1000, pollMs = DEFAULT_POLL_MS, fetchImpl = fetch }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const health = HealthSchema.parse(await fetchJson(baseUrl, token, '/v1/health', fetchImpl));
      if (health.ok) {
        return health;
      }
      lastError = new Error('Health endpoint returned ok=false');
    } catch (error) {
      lastError = error;
    }
    await sleep(pollMs);
  }
  throw lastError ?? new Error('Timed out waiting for /v1/health');
}

export async function captureStateSnapshot({ baseUrl, token, workspaceId, label, fetchImpl = fetch }) {
  const [health, status, scheduler, telegramConfig, relayCheckpoint, uncertainDeliveries, mutationReceipts, connections] = await Promise.all([
    fetchJson(baseUrl, token, '/v1/health', fetchImpl),
    fetchJson(baseUrl, token, '/v1/status', fetchImpl),
    fetchJson(baseUrl, token, '/v1/daemon/scheduler', fetchImpl),
    fetchJson(baseUrl, token, '/v1/config/telegram', fetchImpl),
    fetchJson(baseUrl, token, `/v1/telegram/relay/checkpoint?workspaceId=${encodeURIComponent(workspaceId)}`, fetchImpl),
    fetchJson(baseUrl, token, `/v1/telegram/deliveries/uncertain?workspaceId=${encodeURIComponent(workspaceId)}`, fetchImpl),
    fetchJson(baseUrl, token, '/v1/governance/mutation-receipts?limit=100', fetchImpl),
    fetchJson(baseUrl, token, '/v1/connections', fetchImpl),
  ]);

  return SnapshotSchema.parse({
    label,
    capturedAt: isoNow(),
    workspaceId,
    health,
    status,
    scheduler,
    telegramConfig,
    relayCheckpoint,
    uncertainDeliveries,
    mutationReceipts,
    connections,
  });
}

export function evaluateBaseline(snapshot, expectedMode) {
  const issues = [];
  const warnings = [];

  if (!snapshot.health.ok) {
    issues.push('Health endpoint did not report ok=true.');
  }
  if (snapshot.telegramConfig.managementMode !== expectedMode) {
    issues.push(`Expected management mode ${expectedMode} but control API reported ${snapshot.telegramConfig.managementMode}.`);
  }
  if (snapshot.telegramConfig.persisted.enabled) {
    issues.push('Persisted Telegram config is already enabled.');
  }
  if (snapshot.telegramConfig.applied.enabled) {
    issues.push('Applied Telegram bridge is already enabled.');
  }
  if (snapshot.telegramConfig.persisted.allowedUserId) {
    issues.push('Persisted Telegram config already contains allowedUserId.');
  }
  if (snapshot.telegramConfig.persisted.secretRefId) {
    issues.push('Persisted Telegram config already contains secretRefId.');
  }
  if (snapshot.telegramConfig.secretAvailability !== 'not_configured') {
    issues.push(`Secret availability is ${snapshot.telegramConfig.secretAvailability}, not not_configured.`);
  }
  if (snapshot.relayCheckpoint) {
    issues.push('Telegram relay checkpoint already exists.');
  }
  if (snapshot.uncertainDeliveries.length > 0) {
    issues.push(`Found ${snapshot.uncertainDeliveries.length} uncertain Telegram deliveries before the test started.`);
  }
  if (!snapshot.status.schedulerRunning) {
    warnings.push('Scheduler is not running; Telegram apply/restart verification may be incomplete.');
  }

  return {
    clean: issues.length === 0,
    issues,
    warnings,
    managementModeMatches: snapshot.telegramConfig.managementMode === expectedMode,
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function buildGuide(runConfig) {
  const runDir = runConfig.outputDir;
  const commands = {
    afterSave: `node scripts/telegram-smoke.mjs snapshot --run-dir ${shellQuote(runDir)} --label after-save`,
    afterApply: `node scripts/telegram-smoke.mjs snapshot --run-dir ${shellQuote(runDir)} --label after-apply`,
    afterRestart: `node scripts/telegram-smoke.mjs snapshot --run-dir ${shellQuote(runDir)} --label after-restart --wait-for-healthy`,
    afterRestartRequest: `node scripts/telegram-smoke.mjs snapshot --run-dir ${shellQuote(runDir)} --label after-restart-request`,
    afterManualRestart: `node scripts/telegram-smoke.mjs snapshot --run-dir ${shellQuote(runDir)} --label after-manual-restart --wait-for-healthy`,
    finish: `node scripts/telegram-smoke.mjs finish --run-dir ${shellQuote(runDir)}`,
  };

  const lines = [
    '# Telegram smoke QA guide',
    '',
    `- Run ID: \`${runConfig.runId}\``,
    `- Mode: \`${runConfig.mode}\``,
    `- Workspace: \`${runConfig.workspaceId}\``,
    `- Base URL: \`${runConfig.baseUrl}\``,
    '',
    '## Operator steps',
    '',
    '1. Open the Popeye Mac app and navigate to **Setup → Telegram**.',
    '2. Enter the bot token and store it.',
    '3. Save the Telegram runtime config from the detail pane.',
    '4. Immediately capture the post-save checkpoint:',
    '',
    `   \`${commands.afterSave}\``,
    '',
    '5. Click **Apply Now** in the Telegram detail pane.',
    '6. Capture the post-apply checkpoint:',
    '',
    `   \`${commands.afterApply}\``,
    '',
  ];

  if (runConfig.mode === 'launchd') {
    lines.push(
      '7. If Telegram is still inactive, click **Restart Daemon**.',
      '8. Wait for the app to reconnect, then capture the restart checkpoint:',
      '',
      `   \`${commands.afterRestart}\``,
      '',
    );
  } else {
    lines.push(
      '7. Click **Restart Daemon** and confirm the app reports **manual restart required**.',
      '8. Capture the post-restart-request checkpoint:',
      '',
      `   \`${commands.afterRestartRequest}\``,
      '',
      '9. Restart the daemon manually outside the app.',
      '10. After reconnecting the app, capture the post-manual-restart checkpoint:',
      '',
      `   \`${commands.afterManualRestart}\``,
      '',
    );
  }

  lines.push(
    '## Finish',
    '',
    'When the checkpoints are captured, finish the run and generate the report:',
    '',
    `- \`${commands.finish}\``,
    '',
    '## Manual attestation still required',
    '',
    '- Confirm no Telegram bot token appears in any screenshot taken during the run.',
    '- Confirm the Setup copy matched the expected launchd/manual restart wording.',
    '- Add operator notes to `result.md` if anything looked off.',
    '',
  );

  return `${lines.join('\n')}\n`;
}

function getLaunchAgentPath(label) {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

function decodeXmlEntities(input) {
  return input
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

export function parseLaunchdLogPaths(plistText) {
  const readValue = (key) => {
    const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(plistText);
    return match?.[1] ? decodeXmlEntities(match[1]) : null;
  };
  const outLogPath = readValue('StandardOutPath');
  const errLogPath = readValue('StandardErrorPath');
  if (!outLogPath && !errLogPath) {
    return [];
  }
  return [outLogPath, errLogPath].filter((value) => typeof value === 'string' && value.length > 0);
}

function listFilesRecursively(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }
  const results = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      results.push(fullPath);
    }
  };
  walk(rootDir);
  return results;
}

export function discoverLogFiles({ runtimeDataDir, launchdLabel }) {
  const runtimeLogDir = join(runtimeDataDir, 'logs');
  const files = new Set(listFilesRecursively(runtimeLogDir));
  const plistPath = getLaunchAgentPath(launchdLabel);
  if (existsSync(plistPath)) {
    const plistText = readFileSync(plistPath, 'utf8');
    for (const path of parseLaunchdLogPaths(plistText)) {
      if (existsSync(path)) {
        files.add(path);
      }
    }
  }
  return Array.from(files).sort();
}

function buildFinding(filePath, patternName, lineNumber) {
  return {
    filePath,
    pattern: patternName,
    lineNumber,
  };
}

export function scanTextForSecrets(text, patterns = SECRET_PATTERNS) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        findings.push(buildFinding('', pattern.name, index + 1));
      }
    }
  });
  return findings;
}

export function scanFilesForSecrets(paths, { rootDir = process.cwd(), patterns = SECRET_PATTERNS } = {}) {
  const findings = [];
  const scannedFiles = [];
  const missingFiles = [];

  for (const filePath of paths) {
    if (!existsSync(filePath)) {
      missingFiles.push(filePath);
      continue;
    }
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      continue;
    }
    if (stat.size > MAX_TEXT_SCAN_BYTES) {
      continue;
    }
    const text = readFileSync(filePath, 'utf8');
    scannedFiles.push(filePath);
    const matches = scanTextForSecrets(text, patterns).map((finding) => ({
      ...finding,
      filePath: relative(rootDir, filePath),
    }));
    findings.push(...matches);
  }

  return {
    scannedFiles: scannedFiles.map((filePath) => relative(rootDir, filePath)),
    missingFiles: missingFiles.map((filePath) => relative(rootDir, filePath)),
    findings,
  };
}

function dedupeById(items) {
  const byId = new Map();
  for (const item of items) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function relevantMutationReceipts(snapshots, startedAt) {
  const startedAtMs = Date.parse(startedAt);
  return dedupeById(
    snapshots
      .flatMap((snapshot) => snapshot.mutationReceipts)
      .filter((receipt) => TELEGRAM_MUTATION_KINDS.has(receipt.kind))
      .filter((receipt) => Number.isNaN(startedAtMs) || Date.parse(receipt.createdAt) >= startedAtMs),
  ).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function snapshotHasBridgeEvidence(snapshot) {
  return snapshot.relayCheckpoint !== null || snapshot.uncertainDeliveries.length > 0;
}

function getSnapshot(snapshotsByLabel, label) {
  return snapshotsByLabel.get(label) ?? null;
}

function hasReceipt(receipts, predicate) {
  return receipts.some(predicate);
}

function checkpoint(name, passed, details) {
  return { name, passed, details };
}

export function evaluateRunArtifacts({ runConfig, preflight, snapshots, logScan }) {
  const snapshotsByLabel = new Map(snapshots.map((snapshot) => [snapshot.label, snapshot]));
  const receipts = relevantMutationReceipts(snapshots, runConfig.startedAt);
  const afterSave = getSnapshot(snapshotsByLabel, 'after-save');
  const afterApply = getSnapshot(snapshotsByLabel, 'after-apply');
  const afterRestart = getSnapshot(snapshotsByLabel, 'after-restart');
  const afterRestartRequest = getSnapshot(snapshotsByLabel, 'after-restart-request');
  const afterManualRestart = getSnapshot(snapshotsByLabel, 'after-manual-restart');
  const checkpoints = [];

  checkpoints.push(checkpoint(
    'preflight_clean_baseline',
    preflight.clean || runConfig.allowDirtyBaseline,
    preflight.clean
      ? 'Baseline was clean.'
      : `Baseline was dirty: ${preflight.issues.join(' | ')}`,
  ));

  checkpoints.push(checkpoint(
    'management_mode_matches',
    preflight.managementModeMatches,
    `Expected ${runConfig.mode}; control API reported ${preflight.snapshot.telegramConfig.managementMode}.`,
  ));

  checkpoints.push(checkpoint(
    'after_save_captured',
    afterSave !== null,
    afterSave ? `Captured at ${afterSave.capturedAt}.` : 'Missing after-save snapshot.',
  ));

  checkpoints.push(checkpoint(
    'telegram_config_update_receipt',
    hasReceipt(receipts, (receipt) => receipt.kind === 'telegram_config_update' && receipt.status === 'succeeded'),
    'Expected a succeeded telegram_config_update receipt after the run started.',
  ));

  checkpoints.push(checkpoint(
    'after_apply_captured',
    afterApply !== null,
    afterApply ? `Captured at ${afterApply.capturedAt}.` : 'Missing after-apply snapshot.',
  ));

  checkpoints.push(checkpoint(
    'telegram_apply_receipt',
    hasReceipt(receipts, (receipt) => receipt.kind === 'telegram_apply' && receipt.status === 'succeeded'),
    'Expected a succeeded telegram_apply receipt after the run started.',
  ));

  const bridgeActiveAfterApply = afterApply ? snapshotHasBridgeEvidence(afterApply) : false;

  if (runConfig.mode === 'launchd') {
    const restartReceiptPresent = hasReceipt(
      receipts,
      (receipt) => receipt.kind === 'daemon_restart' && receipt.status === 'scheduled',
    );
    const restartCaptured = afterRestart !== null;
    const finalBridgeEvidence = bridgeActiveAfterApply || (afterRestart ? snapshotHasBridgeEvidence(afterRestart) : false);
    checkpoints.push(checkpoint(
      'launchd_restart_if_needed',
      bridgeActiveAfterApply || (restartReceiptPresent && restartCaptured),
      bridgeActiveAfterApply
        ? 'Bridge evidence appeared after apply; restart was not required.'
        : restartCaptured
          ? 'Restart snapshot captured and scheduled daemon_restart receipt found.'
          : 'Expected after-restart snapshot and scheduled daemon_restart receipt when apply alone did not activate Telegram.',
    ));
    checkpoints.push(checkpoint(
      'launchd_final_bridge_evidence',
      finalBridgeEvidence,
      finalBridgeEvidence
        ? 'Relay checkpoint or uncertain delivery evidence confirmed bridge activity.'
        : 'No relay checkpoint or uncertain delivery evidence found after apply/restart.',
    ));
  } else {
    const manualRestartReceipt = receipts.find((receipt) =>
      receipt.kind === 'daemon_restart'
      && receipt.status === 'failed'
      && (receipt.summary.toLowerCase().includes('manual') || receipt.metadata.restartSupported === 'false'),
    );
    checkpoints.push(checkpoint(
      'manual_restart_request_captured',
      afterRestartRequest !== null,
      afterRestartRequest ? `Captured at ${afterRestartRequest.capturedAt}.` : 'Missing after-restart-request snapshot.',
    ));
    checkpoints.push(checkpoint(
      'manual_restart_required_receipt',
      Boolean(manualRestartReceipt),
      manualRestartReceipt
        ? 'daemon_restart receipt confirmed manual_required behavior.'
        : 'Expected a daemon_restart receipt showing manual restart was required.',
    ));
    checkpoints.push(checkpoint(
      'manual_restart_followthrough',
      afterManualRestart !== null,
      afterManualRestart ? `Captured at ${afterManualRestart.capturedAt}.` : 'Missing after-manual-restart snapshot.',
    ));
    checkpoints.push(checkpoint(
      'manual_final_bridge_evidence',
      Boolean(afterManualRestart) && snapshotHasBridgeEvidence(afterManualRestart),
      afterManualRestart && snapshotHasBridgeEvidence(afterManualRestart)
        ? 'Relay checkpoint or uncertain delivery evidence confirmed bridge activity after manual restart.'
        : 'No relay checkpoint or uncertain delivery evidence found after manual restart.',
    ));
  }

  checkpoints.push(checkpoint(
    'secret_leak_scan',
    logScan.findings.length === 0,
    logScan.findings.length === 0
      ? 'No secret-like material found in scanned artifacts or logs.'
      : `Found ${logScan.findings.length} potential secret exposures.`,
  ));

  const automatedPass = checkpoints.every((item) => item.passed);
  return {
    automatedPass,
    checkpoints,
    receipts,
    manualAttestations: [
      'Confirm no Telegram bot token appears in any screenshot captured during the run.',
      'Confirm the Setup UI wording matched the expected launchd/manual restart behavior.',
    ],
  };
}

function resultMarkdown({ runConfig, preflight, evaluation, logScan }) {
  const lines = [
    '# Telegram smoke QA result',
    '',
    `- Automated result: **${evaluation.automatedPass ? 'PASS' : 'FAIL'}**`,
    `- Run ID: \`${runConfig.runId}\``,
    `- Mode: \`${runConfig.mode}\``,
    `- Host: \`${runConfig.hostName}\``,
    `- Base URL: \`${runConfig.baseUrl}\``,
    `- Started: \`${runConfig.startedAt}\``,
    '',
    '## Checkpoints',
    '',
  ];

  for (const item of evaluation.checkpoints) {
    lines.push(`- [${item.passed ? 'x' : ' '}] **${item.name}** — ${item.details}`);
  }

  lines.push(
    '',
    '## Preflight',
    '',
    `- Clean baseline: **${preflight.clean ? 'yes' : 'no'}**`,
    `- Management mode matches: **${preflight.managementModeMatches ? 'yes' : 'no'}**`,
  );

  if (preflight.issues.length > 0) {
    lines.push('', '### Preflight issues', '');
    for (const issue of preflight.issues) {
      lines.push(`- ${issue}`);
    }
  }

  if (preflight.warnings.length > 0) {
    lines.push('', '### Preflight warnings', '');
    for (const warning of preflight.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push('', '## Mutation receipts', '');
  if (evaluation.receipts.length === 0) {
    lines.push('- None captured after the run start time.');
  } else {
    for (const receipt of evaluation.receipts) {
      lines.push(`- \`${receipt.createdAt}\` — \`${receipt.kind}\` / \`${receipt.status}\` — ${receipt.summary}`);
    }
  }

  lines.push('', '## Secret-leak scan', '');
  lines.push(`- Scanned files: ${logScan.scannedFiles.length}`);
  lines.push(`- Missing optional files: ${logScan.missingFiles.length}`);
  if (logScan.findings.length === 0) {
    lines.push('- No secret-like material found.');
  } else {
    for (const finding of logScan.findings) {
      lines.push(`- Potential leak: \`${finding.pattern}\` in \`${finding.filePath}:${finding.lineNumber}\``);
    }
  }

  lines.push('', '## Manual attestation still required', '');
  for (const item of evaluation.manualAttestations) {
    lines.push(`- [ ] ${item}`);
  }

  lines.push('', '## Operator notes', '', '- _Add notes here before attaching this artifact to a release or PR._', '');

  return `${lines.join('\n')}\n`;
}

function loadRunConfig(runDir) {
  const runConfig = RunConfigSchema.parse(readJsonFile(join(runDir, 'run.json')));
  const preflight = PreflightSchema.parse(readJsonFile(join(runDir, 'preflight.json')));
  return { runConfig, preflight };
}

function loadCapturedSnapshots(runDir) {
  const labels = readdirSync(runDir)
    .filter((entry) => entry.endsWith('.json'))
    .filter((entry) => !['run.json', 'preflight.json', 'result.json', 'log-scan.json'].includes(entry))
    .map((entry) => join(runDir, entry));
  return labels.map((path) => SnapshotSchema.parse(readJsonFile(path)));
}

export async function startRun({ mode, outputDir, workspaceId = DEFAULT_WORKSPACE_ID, configPath, baseUrl, launchdLabel = DEFAULT_LAUNCHD_LABEL, allowDirtyBaseline = false, fetchImpl = fetch }) {
  const harnessConfig = loadHarnessConfig(configPath);
  const token = readOperatorToken(harnessConfig.authFile);
  const resolvedOutputDir = resolve(outputDir ?? join(DEFAULT_OUTPUT_ROOT, `${stampNow()}-${mode}`));
  ensureDir(resolvedOutputDir);
  const runId = `${stampNow()}-${mode}`;
  const resolvedBaseUrl = baseUrl ?? harnessConfig.baseUrl;
  const baselineSnapshot = await captureStateSnapshot({
    baseUrl: resolvedBaseUrl,
    token,
    workspaceId,
    label: 'before',
    fetchImpl,
  });
  const baseline = evaluateBaseline(baselineSnapshot, mode);
  const launchdLogPaths = discoverLogFiles({
    runtimeDataDir: harnessConfig.runtimeDataDir,
    launchdLabel,
  }).filter((path) => basename(path).startsWith('launchd.'));
  const runConfig = RunConfigSchema.parse({
    runId,
    mode,
    startedAt: isoNow(),
    workspaceId,
    hostName: hostname(),
    baseUrl: resolvedBaseUrl,
    configPath: harnessConfig.configPath,
    runtimeDataDir: harnessConfig.runtimeDataDir,
    authFile: harnessConfig.authFile,
    outputDir: resolvedOutputDir,
    launchdLabel,
    allowDirtyBaseline,
    launchdLogPaths,
    runtimeLogDir: join(harnessConfig.runtimeDataDir, 'logs'),
  });
  const preflight = PreflightSchema.parse({
    runId,
    checkedAt: isoNow(),
    clean: baseline.clean,
    managementModeMatches: baseline.managementModeMatches,
    issues: baseline.issues,
    warnings: baseline.warnings,
    snapshot: baselineSnapshot,
  });

  writeJsonFile(join(resolvedOutputDir, 'run.json'), runConfig);
  writeJsonFile(join(resolvedOutputDir, 'preflight.json'), preflight);
  writeJsonFile(join(resolvedOutputDir, 'before.json'), baselineSnapshot);
  writeFileSync(join(resolvedOutputDir, 'guide.md'), buildGuide(runConfig), 'utf8');

  if (!baseline.clean && !allowDirtyBaseline) {
    const joinedIssues = baseline.issues.map((issue) => `- ${issue}`).join('\n');
    throw new Error(`Telegram baseline is not clean. Resolve the following or rerun with --allow-dirty-baseline:\n${joinedIssues}`);
  }

  return {
    runConfig,
    preflight,
  };
}

export async function snapshotRun({ runDir, label, waitForHealthy: shouldWaitForHealthy = false, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, pollMs = DEFAULT_POLL_MS, fetchImpl = fetch }) {
  const { runConfig } = loadRunConfig(runDir);
  const token = readOperatorToken(runConfig.authFile);
  if (shouldWaitForHealthy) {
    await waitForHealthy({
      baseUrl: runConfig.baseUrl,
      token,
      timeoutMs: timeoutSeconds * 1000,
      pollMs,
      fetchImpl,
    });
  }

  const snapshot = await captureStateSnapshot({
    baseUrl: runConfig.baseUrl,
    token,
    workspaceId: runConfig.workspaceId,
    label,
    fetchImpl,
  });
  writeJsonFile(join(runDir, `${label}.json`), snapshot);
  return snapshot;
}

export async function finishRun({ runDir }) {
  const { runConfig, preflight } = loadRunConfig(runDir);
  const snapshots = loadCapturedSnapshots(runDir);
  const logFiles = Array.from(new Set([
    ...listFilesRecursively(runDir),
    ...discoverLogFiles({ runtimeDataDir: runConfig.runtimeDataDir, launchdLabel: runConfig.launchdLabel }),
  ]));
  const logScan = scanFilesForSecrets(logFiles, { rootDir: dirname(runDir) });
  const evaluation = evaluateRunArtifacts({ runConfig, preflight, snapshots, logScan });
  const result = {
    runId: runConfig.runId,
    mode: runConfig.mode,
    automatedPass: evaluation.automatedPass,
    checkpoints: evaluation.checkpoints,
    manualAttestations: evaluation.manualAttestations,
    receipts: evaluation.receipts,
    generatedAt: isoNow(),
  };

  writeJsonFile(join(runDir, 'log-scan.json'), logScan);
  writeJsonFile(join(runDir, 'result.json'), result);
  writeFileSync(join(runDir, 'result.md'), resultMarkdown({ runConfig, preflight, evaluation, logScan }), 'utf8');

  return { result, logScan };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'start') {
    const outcome = await startRun(args);
    console.info(`Telegram smoke run initialized at ${outcome.runConfig.outputDir}`);
    return;
  }
  if (args.command === 'snapshot') {
    const snapshot = await snapshotRun(args);
    console.info(`Captured ${snapshot.label} at ${snapshot.capturedAt}`);
    return;
  }
  if (args.command === 'finish') {
    const { result } = await finishRun(args);
    console.info(`Telegram smoke ${result.automatedPass ? 'passed' : 'failed'} — see ${join(args.runDir, 'result.md')}`);
  }
}

if (import.meta.url === new URL(process.argv[1], 'file://').toString()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
