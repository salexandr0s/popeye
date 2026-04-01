#!/usr/bin/env node

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

function usage() {
  console.info(`Usage: node scripts/release-soak.mjs --host <host> --evidence-dir <dir> [--iterations <n>] [--interval-seconds <n>] [--remote-env-file <path>] [--pid-file <path>]

Runs the release-readiness soak snapshot loop against a remote Popeye host and writes:
  - soak-start.log
  - soak-<timestamp>.log
  - soak-run.log
  - soak-summary.json
  - soak-end.log
`);
}

function parseArgs(argv) {
  const args = {
    host: process.env.HOST ?? '',
    evidenceDir: process.env.EVIDENCE_DIR ?? '',
    iterations: Number(process.env.SOAK_ITERATIONS ?? '12'),
    intervalSeconds: Number(process.env.SOAK_INTERVAL_SECONDS ?? '7200'),
    remoteEnvFile: process.env.SOAK_REMOTE_ENV_FILE ?? '$HOME/.popeye-rr-env.sh',
    pidFile: process.env.SOAK_PID_FILE ?? '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--host':
        args.host = next ?? '';
        i += 1;
        break;
      case '--evidence-dir':
        args.evidenceDir = next ?? '';
        i += 1;
        break;
      case '--iterations':
        args.iterations = Number(next ?? '12');
        i += 1;
        break;
      case '--interval-seconds':
        args.intervalSeconds = Number(next ?? '7200');
        i += 1;
        break;
      case '--remote-env-file':
        args.remoteEnvFile = next ?? '';
        i += 1;
        break;
      case '--pid-file':
        args.pidFile = next ?? '';
        i += 1;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        return args;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.host) throw new Error('Missing --host');
  if (!args.evidenceDir) throw new Error('Missing --evidence-dir');
  if (!Number.isFinite(args.iterations) || args.iterations <= 0) throw new Error('iterations must be > 0');
  if (!Number.isFinite(args.intervalSeconds) || args.intervalSeconds < 0) throw new Error('interval-seconds must be >= 0');
  return args;
}

function isoNow() {
  return new Date().toISOString();
}

function stampNow() {
  return isoNow().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function buildRemoteScript(stamp, remoteEnvFile) {
  return `set -euo pipefail
. "${remoteEnvFile}"
cd "$POPEYE_REPO_DIR"
printf "=== %s ===\\n" "${stamp}"
pop daemon health --json
printf "\\n---\\n"
pop daemon status --json
printf "\\n---\\n"
pop runs tail --json
printf "\\n---\\n"
pop runs failures --json
printf "\\n---\\n"
pop interventions list --json
printf "\\n---\\n"
pop security audit --json
`;
}

function appendLine(path, line) {
  appendFileSync(path, `${line}\n`, 'utf8');
}

export async function captureSnapshot({
  host,
  remoteEnvFile,
  outDir,
  stamp = stampNow(),
  execFileImpl = execFileAsync,
}) {
  const snapshotPath = join(outDir, `soak-${stamp}.log`);
  try {
    const { stdout, stderr } = await execFileImpl('ssh', [host, buildRemoteScript(stamp, remoteEnvFile)], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const combined = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`;
    writeFileSync(snapshotPath, combined, 'utf8');
    return { ok: true, stamp, snapshotPath, stdout, stderr };
  } catch (error) {
    const stdout = error?.stdout ?? '';
    const stderr = error?.stderr ?? '';
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = typeof error?.code === 'number' ? error.code : null;
    writeFileSync(
      snapshotPath,
      `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}\n[error]\n${message}\n[exitCode]\n${exitCode ?? 'unknown'}\n`,
      'utf8',
    );
    return { ok: false, stamp, snapshotPath, stdout, stderr, message, exitCode };
  }
}

export async function runSoak({
  host,
  evidenceDir,
  iterations = 12,
  intervalSeconds = 7200,
  remoteEnvFile = '$HOME/.popeye-rr-env.sh',
  pidFile,
  execFileImpl = execFileAsync,
  sleepImpl = sleep,
}) {
  const outDir = resolve(evidenceDir);
  mkdirSync(outDir, { recursive: true });
  const runLogPath = join(outDir, 'soak-run.log');
  const startLogPath = join(outDir, 'soak-start.log');
  const endLogPath = join(outDir, 'soak-end.log');
  const summaryPath = join(outDir, 'soak-summary.json');

  if (pidFile) {
    writeFileSync(pidFile, `${process.pid}\n`, 'utf8');
  }

  const summary = {
    host,
    startedAt: isoNow(),
    finishedAt: null,
    iterationsRequested: iterations,
    iterationsCompleted: 0,
    intervalSeconds,
    snapshots: [],
    failures: 0,
    interrupted: false,
  };

  let interrupted = false;
  const handleSignal = (signal) => {
    interrupted = true;
    appendLine(runLogPath, `[${isoNow()}] received ${signal}; finishing current iteration and stopping early`);
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  writeFileSync(
    startLogPath,
    JSON.stringify(
      {
        host,
        startedAt: summary.startedAt,
        iterations,
        intervalSeconds,
        remoteEnvFile,
        pid: process.pid,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  appendLine(runLogPath, `[${summary.startedAt}] soak start host=${host} iterations=${iterations} intervalSeconds=${intervalSeconds}`);

  for (let i = 0; i < iterations; i += 1) {
    const stamp = stampNow();
    appendLine(runLogPath, `[${isoNow()}] iteration ${i + 1}/${iterations} snapshot=${stamp} begin`);
    const result = await captureSnapshot({
      host,
      remoteEnvFile,
      outDir,
      stamp,
      execFileImpl,
    });
    summary.iterationsCompleted += 1;
    summary.snapshots.push({
      iteration: i + 1,
      stamp,
      ok: result.ok,
      snapshotPath: result.snapshotPath,
      ...(result.ok ? {} : { error: result.message ?? 'snapshot failed', exitCode: result.exitCode ?? null }),
    });
    if (!result.ok) {
      summary.failures += 1;
      appendLine(runLogPath, `[${isoNow()}] iteration ${i + 1}/${iterations} snapshot=${stamp} failed exitCode=${result.exitCode ?? 'unknown'}`);
    } else {
      appendLine(runLogPath, `[${isoNow()}] iteration ${i + 1}/${iterations} snapshot=${stamp} passed`);
    }
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
    if (interrupted || i === iterations - 1) {
      break;
    }
    await sleepImpl(intervalSeconds * 1000);
  }

  summary.finishedAt = isoNow();
  summary.interrupted = interrupted;
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  writeFileSync(
    endLogPath,
    JSON.stringify(
      {
        finishedAt: summary.finishedAt,
        iterationsCompleted: summary.iterationsCompleted,
        failures: summary.failures,
        interrupted: summary.interrupted,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  appendLine(runLogPath, `[${summary.finishedAt}] soak end iterationsCompleted=${summary.iterationsCompleted} failures=${summary.failures} interrupted=${summary.interrupted}`);
  process.removeListener('SIGINT', handleSignal);
  process.removeListener('SIGTERM', handleSignal);

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await runSoak(args);
  process.exitCode = summary.failures > 0 || summary.interrupted ? 1 : 0;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
