import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export interface LaunchdInstallOptions {
  label?: string;
  configPath: string;
  nodeExecutable?: string;
  daemonEntryPoint: string;
  workingDirectory: string;
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

export function getLaunchAgentPath(label = 'dev.popeye.popeyed'): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

export function getLaunchAgentTarget(label = 'dev.popeye.popeyed'): string {
  return `gui/${process.getuid()}/${label}`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function createLaunchdPlist(options: LaunchdInstallOptions): string {
  const label = xmlEscape(options.label ?? 'dev.popeye.popeyed');
  const nodeExecutable = xmlEscape(options.nodeExecutable ?? process.execPath);
  const entryPoint = xmlEscape(options.daemonEntryPoint);
  const workDir = xmlEscape(options.workingDirectory);
  const configPath = xmlEscape(options.configPath);
  const outLog = xmlEscape(join(options.workingDirectory, 'launchd.out.log'));
  const errLog = xmlEscape(join(options.workingDirectory, 'launchd.err.log'));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeExecutable}</string>
    <string>${entryPoint}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${workDir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>POPEYE_CONFIG_PATH</key>
    <string>${configPath}</string>
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
  const label = options.label ?? 'dev.popeye.popeyed';
  const plistPath = getLaunchAgentPath(label);
  mkdirSync(resolve(plistPath, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(plistPath, createLaunchdPlist(options));
  return { label, plistPath, installed: true };
}

export function daemonStatus(label = 'dev.popeye.popeyed'): { installed: boolean; loaded: boolean; output: string } {
  const plistPath = getLaunchAgentPath(label);
  if (!existsSync(plistPath)) {
    return { installed: false, loaded: false, output: 'not installed' };
  }
  const target = getLaunchAgentTarget(label);
  const result = spawnSync('launchctl', ['print', target], { encoding: 'utf8' });
  const loaded = result.status === 0;
  return { installed: true, loaded, output: result.stdout || result.stderr || '' };
}

export function loadLaunchAgent(label = 'dev.popeye.popeyed'): LaunchdCommandResult {
  const plistPath = getLaunchAgentPath(label);
  const result = spawnSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath], { encoding: 'utf8' });
  return { ok: result.status === 0, output: result.stdout || result.stderr || '' };
}

export function unloadLaunchAgent(label = 'dev.popeye.popeyed'): LaunchdCommandResult {
  const result = spawnSync('launchctl', ['bootout', getLaunchAgentTarget(label)], { encoding: 'utf8' });
  return { ok: result.status === 0, output: result.stdout || result.stderr || '' };
}

export function restartLaunchAgent(label = 'dev.popeye.popeyed'): LaunchdCommandResult {
  const unload = unloadLaunchAgent(label);
  const load = loadLaunchAgent(label);
  return {
    ok: load.ok,
    output: [unload.output, load.output].filter(Boolean).join('\n'),
  };
}

export function uninstallLaunchAgent(label = 'dev.popeye.popeyed'): LaunchdCommandResult & { removed: boolean; plistPath: string } {
  const plistPath = getLaunchAgentPath(label);
  if (existsSync(plistPath)) {
    unloadLaunchAgent(label);
    unlinkSync(plistPath);
    return { ok: true, output: 'removed', removed: true, plistPath };
  }
  return { ok: true, output: 'not installed', removed: false, plistPath };
}
