import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateBaseline,
  evaluateRunArtifacts,
  finishRun,
  parseLaunchdLogPaths,
  scanTextForSecrets,
  startRun,
} from './telegram-smoke.mjs';

function makeSnapshot(overrides = {}) {
  return {
    label: 'before',
    capturedAt: '2026-04-02T10:00:00.000Z',
    workspaceId: 'default',
    health: { ok: true, startedAt: '2026-04-02T09:59:00.000Z' },
    status: { ok: true, schedulerRunning: true, startedAt: '2026-04-02T09:59:00.000Z' },
    scheduler: { running: true, activeLeases: 0, activeRuns: 0, nextHeartbeatDueAt: null },
    telegramConfig: {
      persisted: { enabled: false, allowedUserId: null, secretRefId: null },
      applied: { enabled: false, allowedUserId: null, secretRefId: null },
      effectiveWorkspaceId: 'default',
      secretAvailability: 'not_configured',
      staleComparedToApplied: false,
      warnings: [],
      managementMode: 'launchd',
      restartSupported: true,
    },
    relayCheckpoint: null,
    uncertainDeliveries: [],
    mutationReceipts: [],
    connections: [],
    ...overrides,
  };
}

function makeReceipt(overrides = {}) {
  return {
    id: 'receipt-1',
    kind: 'telegram_config_update',
    component: 'telegram',
    status: 'succeeded',
    summary: 'Saved Telegram config',
    details: 'enabled false -> true',
    actorRole: 'operator',
    workspaceId: null,
    metadata: {},
    createdAt: '2026-04-02T10:05:00.000Z',
    ...overrides,
  };
}

function makeRunConfig(overrides = {}) {
  return {
    runId: '20260402T100000Z-launchd',
    mode: 'launchd',
    startedAt: '2026-04-02T10:00:30.000Z',
    workspaceId: 'default',
    hostName: 'test-host',
    baseUrl: 'http://127.0.0.1:3210',
    configPath: '/tmp/config.json',
    runtimeDataDir: '/tmp/runtime',
    authFile: '/tmp/auth.json',
    outputDir: '/tmp/output',
    launchdLabel: 'dev.popeye.popeyed',
    allowDirtyBaseline: false,
    launchdLogPaths: [],
    runtimeLogDir: '/tmp/runtime/logs',
    ...overrides,
  };
}

function makePreflight(overrides = {}) {
  return {
    runId: '20260402T100000Z-launchd',
    checkedAt: '2026-04-02T10:00:10.000Z',
    clean: true,
    managementModeMatches: true,
    issues: [],
    warnings: [],
    snapshot: makeSnapshot(),
    ...overrides,
  };
}

describe('telegram-smoke harness', () => {
  it('extracts launchd out/err log paths from the plist', () => {
    const paths = parseLaunchdLogPaths(`<?xml version="1.0"?>
<plist>
<dict>
  <key>StandardOutPath</key>
  <string>/tmp/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/launchd.err.log</string>
</dict>
</plist>`);

    expect(paths).toEqual(['/tmp/launchd.out.log', '/tmp/launchd.err.log']);
  });

  it('flags a dirty baseline when Telegram is already configured', () => {
    const result = evaluateBaseline(makeSnapshot({
      telegramConfig: {
        persisted: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
        applied: { enabled: false, allowedUserId: null, secretRefId: null },
        effectiveWorkspaceId: 'default',
        secretAvailability: 'available',
        staleComparedToApplied: true,
        warnings: [],
        managementMode: 'manual',
        restartSupported: false,
      },
    }), 'launchd');

    expect(result.clean).toBe(false);
    expect(result.managementModeMatches).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('already enabled'),
      expect.stringContaining('allowedUserId'),
      expect.stringContaining('secretRefId'),
      expect.stringContaining('Expected management mode launchd'),
    ]));
  });

  it('detects Telegram bot tokens during secret scans', () => {
    const findings = scanTextForSecrets('stored leaked token 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd');
    expect(findings).toEqual([
      expect.objectContaining({ pattern: 'telegram-bot-token', lineNumber: 1 }),
    ]);
  });

  it('passes a launchd flow when restart activates the bridge', () => {
    const preflight = makePreflight();
    const runConfig = makeRunConfig();
    const snapshots = [
      makeSnapshot({ label: 'before' }),
      makeSnapshot({
        label: 'after-save',
        telegramConfig: {
          persisted: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          applied: { enabled: false, allowedUserId: null, secretRefId: null },
          effectiveWorkspaceId: 'default',
          secretAvailability: 'available',
          staleComparedToApplied: true,
          warnings: [],
          managementMode: 'launchd',
          restartSupported: true,
        },
        mutationReceipts: [makeReceipt()],
      }),
      makeSnapshot({
        label: 'after-apply',
        telegramConfig: {
          persisted: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          applied: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          effectiveWorkspaceId: 'default',
          secretAvailability: 'available',
          staleComparedToApplied: false,
          warnings: [],
          managementMode: 'launchd',
          restartSupported: true,
        },
        mutationReceipts: [
          makeReceipt(),
          makeReceipt({ id: 'receipt-apply', kind: 'telegram_apply', summary: 'Applied Telegram config', createdAt: '2026-04-02T10:06:00.000Z' }),
        ],
      }),
      makeSnapshot({
        label: 'after-restart',
        telegramConfig: {
          persisted: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          applied: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          effectiveWorkspaceId: 'default',
          secretAvailability: 'available',
          staleComparedToApplied: false,
          warnings: [],
          managementMode: 'launchd',
          restartSupported: true,
        },
        relayCheckpoint: {
          relayKey: 'telegram_long_poll',
          workspaceId: 'default',
          lastAcknowledgedUpdateId: 101,
          updatedAt: '2026-04-02T10:07:00.000Z',
        },
        mutationReceipts: [
          makeReceipt(),
          makeReceipt({ id: 'receipt-apply', kind: 'telegram_apply', summary: 'Applied Telegram config', createdAt: '2026-04-02T10:06:00.000Z' }),
          makeReceipt({ id: 'receipt-restart', kind: 'daemon_restart', component: 'daemon', status: 'scheduled', summary: 'Daemon restart scheduled through launchd.', createdAt: '2026-04-02T10:06:30.000Z' }),
        ],
      }),
    ];

    const evaluation = evaluateRunArtifacts({
      runConfig,
      preflight,
      snapshots,
      logScan: { findings: [], scannedFiles: ['result.json'], missingFiles: [] },
    });

    expect(evaluation.automatedPass).toBe(true);
    expect(evaluation.checkpoints.every((item) => item.passed)).toBe(true);
  });

  it('passes a manual flow when manual restart is required and then completed', () => {
    const preflight = makePreflight({
      snapshot: makeSnapshot({
        telegramConfig: {
          persisted: { enabled: false, allowedUserId: null, secretRefId: null },
          applied: { enabled: false, allowedUserId: null, secretRefId: null },
          effectiveWorkspaceId: 'default',
          secretAvailability: 'not_configured',
          staleComparedToApplied: false,
          warnings: [],
          managementMode: 'manual',
          restartSupported: false,
        },
      }),
    });
    const runConfig = makeRunConfig({ mode: 'manual' });
    const snapshots = [
      makeSnapshot({ label: 'before', telegramConfig: { ...preflight.snapshot.telegramConfig } }),
      makeSnapshot({
        label: 'after-save',
        telegramConfig: {
          persisted: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          applied: { enabled: false, allowedUserId: null, secretRefId: null },
          effectiveWorkspaceId: 'default',
          secretAvailability: 'available',
          staleComparedToApplied: true,
          warnings: [],
          managementMode: 'manual',
          restartSupported: false,
        },
        mutationReceipts: [makeReceipt()],
      }),
      makeSnapshot({
        label: 'after-apply',
        telegramConfig: {
          persisted: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          applied: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          effectiveWorkspaceId: 'default',
          secretAvailability: 'available',
          staleComparedToApplied: false,
          warnings: [],
          managementMode: 'manual',
          restartSupported: false,
        },
        mutationReceipts: [
          makeReceipt(),
          makeReceipt({ id: 'receipt-apply', kind: 'telegram_apply', summary: 'Applied Telegram config', createdAt: '2026-04-02T10:06:00.000Z' }),
        ],
      }),
      makeSnapshot({
        label: 'after-restart-request',
        telegramConfig: {
          persisted: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          applied: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          effectiveWorkspaceId: 'default',
          secretAvailability: 'available',
          staleComparedToApplied: false,
          warnings: [],
          managementMode: 'manual',
          restartSupported: false,
        },
        mutationReceipts: [
          makeReceipt(),
          makeReceipt({ id: 'receipt-apply', kind: 'telegram_apply', summary: 'Applied Telegram config', createdAt: '2026-04-02T10:06:00.000Z' }),
          makeReceipt({ id: 'receipt-restart', kind: 'daemon_restart', component: 'daemon', status: 'failed', summary: 'This daemon is not launchd-managed. Restart it manually after applying config.', metadata: { restartSupported: 'false' }, createdAt: '2026-04-02T10:06:30.000Z' }),
        ],
      }),
      makeSnapshot({
        label: 'after-manual-restart',
        telegramConfig: {
          persisted: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          applied: { enabled: true, allowedUserId: '1234', secretRefId: 'secret_1' },
          effectiveWorkspaceId: 'default',
          secretAvailability: 'available',
          staleComparedToApplied: false,
          warnings: [],
          managementMode: 'manual',
          restartSupported: false,
        },
        relayCheckpoint: {
          relayKey: 'telegram_long_poll',
          workspaceId: 'default',
          lastAcknowledgedUpdateId: 202,
          updatedAt: '2026-04-02T10:08:00.000Z',
        },
        mutationReceipts: [
          makeReceipt(),
          makeReceipt({ id: 'receipt-apply', kind: 'telegram_apply', summary: 'Applied Telegram config', createdAt: '2026-04-02T10:06:00.000Z' }),
          makeReceipt({ id: 'receipt-restart', kind: 'daemon_restart', component: 'daemon', status: 'failed', summary: 'This daemon is not launchd-managed. Restart it manually after applying config.', metadata: { restartSupported: 'false' }, createdAt: '2026-04-02T10:06:30.000Z' }),
        ],
      }),
    ];

    const evaluation = evaluateRunArtifacts({
      runConfig,
      preflight,
      snapshots,
      logScan: { findings: [], scannedFiles: ['result.json'], missingFiles: [] },
    });

    expect(evaluation.automatedPass).toBe(true);
    expect(evaluation.checkpoints.every((item) => item.passed)).toBe(true);
  });

  it('writes result artifacts and fails when a token leak is detected', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'popeye-telegram-smoke-'));
    const runtimeLogsDir = join(runDir, 'runtime-logs');
    mkdirSync(runtimeLogsDir, { recursive: true });
    writeFileSync(join(runtimeLogsDir, 'daemon.log'), 'leaked token 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd\n', 'utf8');

    const runConfig = makeRunConfig({
      outputDir: runDir,
      runtimeDataDir: runDir,
      runtimeLogDir: runtimeLogsDir,
      launchdLabel: 'dev.popeye.popeyed',
    });
    const preflight = makePreflight();

    writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(runConfig, null, 2)}\n`, 'utf8');
    writeFileSync(join(runDir, 'preflight.json'), `${JSON.stringify(preflight, null, 2)}\n`, 'utf8');
    writeFileSync(join(runDir, 'before.json'), `${JSON.stringify(makeSnapshot({ label: 'before' }), null, 2)}\n`, 'utf8');
    writeFileSync(join(runDir, 'after-save.json'), `${JSON.stringify(makeSnapshot({ label: 'after-save', mutationReceipts: [makeReceipt()] }), null, 2)}\n`, 'utf8');
    writeFileSync(join(runDir, 'after-apply.json'), `${JSON.stringify(makeSnapshot({
      label: 'after-apply',
      mutationReceipts: [
        makeReceipt(),
        makeReceipt({ id: 'receipt-apply', kind: 'telegram_apply', summary: 'Applied Telegram config', createdAt: '2026-04-02T10:06:00.000Z' }),
      ],
    }), null, 2)}\n`, 'utf8');
    writeFileSync(join(runDir, 'after-restart.json'), `${JSON.stringify(makeSnapshot({
      label: 'after-restart',
      relayCheckpoint: {
        relayKey: 'telegram_long_poll',
        workspaceId: 'default',
        lastAcknowledgedUpdateId: 101,
        updatedAt: '2026-04-02T10:07:00.000Z',
      },
      mutationReceipts: [
        makeReceipt(),
        makeReceipt({ id: 'receipt-apply', kind: 'telegram_apply', summary: 'Applied Telegram config', createdAt: '2026-04-02T10:06:00.000Z' }),
        makeReceipt({ id: 'receipt-restart', kind: 'daemon_restart', component: 'daemon', status: 'scheduled', summary: 'Daemon restart scheduled through launchd.', createdAt: '2026-04-02T10:06:30.000Z' }),
      ],
    }), null, 2)}\n`, 'utf8');

    const { result } = await finishRun({ runDir });

    expect(result.automatedPass).toBe(false);
    expect(existsSync(join(runDir, 'result.md'))).toBe(true);
    expect(existsSync(join(runDir, 'log-scan.json'))).toBe(true);
    expect(readFileSync(join(runDir, 'result.md'), 'utf8')).toContain('Automated result: **FAIL**');
  });

  it('writes a usable operator guide during start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-telegram-smoke-start-'));
    const configPath = join(dir, 'config.json');
    const authPath = join(dir, 'auth.json');

    writeFileSync(configPath, JSON.stringify({
      runtimeDataDir: dir,
      authFile: authPath,
      security: { bindHost: '127.0.0.1', bindPort: 3210 },
    }), 'utf8');
    writeFileSync(authPath, JSON.stringify({ current: { token: 'operator-token' } }), 'utf8');

    const fetchImpl = async (url) => {
      const path = new URL(url).pathname + new URL(url).search;
      if (path === '/v1/health') return new Response(JSON.stringify({ ok: true, startedAt: '2026-04-02T09:59:00.000Z' }));
      if (path === '/v1/status') return new Response(JSON.stringify({ ok: true, schedulerRunning: true, startedAt: '2026-04-02T09:59:00.000Z' }));
      if (path === '/v1/daemon/scheduler') return new Response(JSON.stringify({ running: true, activeLeases: 0, activeRuns: 0, nextHeartbeatDueAt: null }));
      if (path === '/v1/config/telegram') return new Response(JSON.stringify({
        persisted: { enabled: false, allowedUserId: null, secretRefId: null },
        applied: { enabled: false, allowedUserId: null, secretRefId: null },
        effectiveWorkspaceId: 'default',
        secretAvailability: 'not_configured',
        staleComparedToApplied: false,
        warnings: [],
        managementMode: 'launchd',
        restartSupported: true,
      }));
      if (path.startsWith('/v1/telegram/relay/checkpoint')) return new Response('null');
      if (path.startsWith('/v1/telegram/deliveries/uncertain')) return new Response('[]');
      if (path.startsWith('/v1/governance/mutation-receipts')) return new Response('[]');
      if (path === '/v1/connections') return new Response('[]');
      throw new Error(`Unexpected path ${path}`);
    };

    const { runConfig } = await startRun({
      mode: 'launchd',
      outputDir: join(dir, 'artifacts'),
      workspaceId: 'default',
      configPath,
      fetchImpl,
    });

    const guide = readFileSync(join(runConfig.outputDir, 'guide.md'), 'utf8');
    expect(guide).toContain('Setup → Telegram');
    expect(guide).toContain('after-save');
    expect(guide).toContain('finish');
  });
});
