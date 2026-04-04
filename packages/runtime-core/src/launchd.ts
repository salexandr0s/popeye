import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_LABEL = 'dev.popeye.popeyed';
const RETRYABLE_BOOTSTRAP_OUTPUT = 'Bootstrap failed: 5: Input/output error';
const LAUNCHD_RETRY_DELAYS_MS = [150, 300, 600] as const;

function getUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('process.getuid is not available on this platform (launchd requires macOS/POSIX)');
  return uid;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runLaunchctl(args: string[]): { ok: boolean; output: string } {
  const result = spawnSync('launchctl', args, { encoding: 'utf8' });
  return { ok: result.status === 0, output: result.stdout || result.stderr || '' };
}

function isRetryableBootstrapOutput(output: string): boolean {
  return output.includes(RETRYABLE_BOOTSTRAP_OUTPUT);
}

function waitForLaunchAgentState(label: string, loaded: boolean, timeoutMs = 2_000): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = daemonStatus(label);
    if (current.loaded === loaded) {
      return;
    }
    sleepSync(100);
  }
}

export interface LaunchdInstallOptions {
  label?: string;
  configPath: string;
  nodeExecutable?: string;
  daemonEntryPoint: string;
  programArguments?: string[];
  workingDirectory: string;
  environmentVariables?: Record<string, string>;
}

export interface LaunchdInstallResult {
  label: string;
  plistPath: string;
  installed: boolean;
}

export interface LaunchdCommandResult {
  ok: boolean;
  output: string;
}

export function getLaunchAgentPath(label = DEFAULT_LABEL): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

export function getLaunchAgentDomain(): string {
  return `gui/${getUid()}`;
}

export function getLaunchAgentTarget(label = DEFAULT_LABEL): string {
  return `${getLaunchAgentDomain()}/${label}`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function createLaunchdPlist(options: LaunchdInstallOptions): string {
  const label = xmlEscape(options.label ?? DEFAULT_LABEL);
  const programArguments = (options.programArguments ?? [
    options.nodeExecutable ?? process.execPath,
    options.daemonEntryPoint,
  ]).map((value) => xmlEscape(value));
  const workDir = xmlEscape(options.workingDirectory);
  const outLog = xmlEscape(join(options.workingDirectory, 'launchd.out.log'));
  const errLog = xmlEscape(join(options.workingDirectory, 'launchd.err.log'));
  const environmentVariables = {
    POPEYE_CONFIG_PATH: options.configPath,
    POPEYE_LAUNCHD_LABEL: options.label ?? DEFAULT_LABEL,
    ...(options.environmentVariables ?? {}),
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments.map((value) => `    <string>${value}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${workDir}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(environmentVariables)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
  .join('\n')}
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${outLog}</string>
  <key>StandardErrorPath</key>
  <string>${errLog}</string>
</dict>
</plist>`;
}

export function installLaunchAgent(options: LaunchdInstallOptions): LaunchdInstallResult {
  const label = options.label ?? DEFAULT_LABEL;
  const plistPath = getLaunchAgentPath(label);
  mkdirSync(resolve(plistPath, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(plistPath, createLaunchdPlist(options));
  return { label, plistPath, installed: true };
}

export function daemonStatus(label = DEFAULT_LABEL): { installed: boolean; loaded: boolean; output: string } {
  const plistPath = getLaunchAgentPath(label);
  if (!existsSync(plistPath)) {
    return { installed: false, loaded: false, output: 'not installed' };
  }
  const target = getLaunchAgentTarget(label);
  const result = runLaunchctl(['print', target]);
  return { installed: true, loaded: result.ok, output: result.output };
}

export function loadLaunchAgent(label = DEFAULT_LABEL): LaunchdCommandResult {
  const plistPath = getLaunchAgentPath(label);
  const outputs: string[] = [];

  for (let attempt = 0; attempt <= LAUNCHD_RETRY_DELAYS_MS.length; attempt += 1) {
    const result = runLaunchctl(['bootstrap', getLaunchAgentDomain(), plistPath]);
    if (result.output) {
      outputs.push(result.output.trimEnd());
    }
    if (result.ok) {
      return { ok: true, output: outputs.join('\n') };
    }

    if (!isRetryableBootstrapOutput(result.output)) {
      return { ok: false, output: outputs.join('\n') };
    }

    const status = daemonStatus(label);
    if (status.loaded) {
      if (status.output) {
        outputs.push(status.output.trimEnd());
      }
      return { ok: true, output: outputs.join('\n') };
    }

    const retryDelay = LAUNCHD_RETRY_DELAYS_MS[attempt];
    if (retryDelay !== undefined) {
      sleepSync(retryDelay);
    }
  }

  return { ok: false, output: outputs.join('\n') };
}

export function unloadLaunchAgent(label = DEFAULT_LABEL): LaunchdCommandResult {
  const result = runLaunchctl(['bootout', getLaunchAgentDomain(), getLaunchAgentPath(label)]);
  if (result.ok) {
    waitForLaunchAgentState(label, false);
  }
  return result;
}

function kickstartLaunchAgent(label = DEFAULT_LABEL): LaunchdCommandResult {
  return runLaunchctl(['kickstart', '-k', getLaunchAgentTarget(label)]);
}

export function restartLaunchAgent(label = DEFAULT_LABEL): LaunchdCommandResult {
  const status = daemonStatus(label);
  const outputs: string[] = [];

  if (status.loaded) {
    const restart = kickstartLaunchAgent(label);
    if (status.output) {
      outputs.push(status.output.trimEnd());
    }
    if (restart.output) {
      outputs.push(restart.output.trimEnd());
    }
    if (restart.ok) {
      return { ok: true, output: outputs.join('\n') };
    }
  }

  const unload = unloadLaunchAgent(label);
  const load = loadLaunchAgent(label);
  if (unload.output) {
    outputs.push(unload.output.trimEnd());
  }
  if (load.output) {
    outputs.push(load.output.trimEnd());
  }
  return {
    ok: load.ok,
    output: outputs.filter(Boolean).join('\n'),
  };
}

export function uninstallLaunchAgent(label = DEFAULT_LABEL): LaunchdCommandResult & { removed: boolean; plistPath: string } {
  const plistPath = getLaunchAgentPath(label);
  if (existsSync(plistPath)) {
    unloadLaunchAgent(label);
    unlinkSync(plistPath);
    return { ok: true, output: 'removed', removed: true, plistPath };
  }
  return { ok: true, output: 'not installed', removed: false, plistPath };
}
