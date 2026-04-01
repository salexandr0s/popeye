import { describe, expect, it } from 'vitest';

import {
  createLaunchdPlist,
  getLaunchAgentPath,
  getLaunchAgentDomain,
  getLaunchAgentTarget,
  installLaunchAgent,
  daemonStatus,
  loadLaunchAgent,
  unloadLaunchAgent,
  restartLaunchAgent,
  uninstallLaunchAgent,
} from './launchd.js';

describe('launchd pure functions', () => {
  it('createLaunchdPlist renders valid plist with defaults', () => {
    const plist = createLaunchdPlist({
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/app/daemon.js',
      workingDirectory: '/app',
    });
    expect(plist).toContain('dev.popeye.popeyed');
    expect(plist).toContain('POPEYE_CONFIG_PATH');
    expect(plist).toContain('/tmp/config.json');
    expect(plist).toContain('/app/daemon.js');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('POPEYE_LAUNCHD_LABEL');
    expect(plist).toContain('dev.popeye.popeyed');
  });

  it('createLaunchdPlist uses custom label', () => {
    const plist = createLaunchdPlist({
      label: 'com.custom.agent',
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/app/daemon.js',
      workingDirectory: '/app',
    });
    expect(plist).toContain('com.custom.agent');
    expect(plist).not.toContain('dev.popeye.popeyed');
  });

  it('createLaunchdPlist uses custom node executable', () => {
    const plist = createLaunchdPlist({
      configPath: '/tmp/config.json',
      nodeExecutable: '/usr/local/bin/node22',
      daemonEntryPoint: '/app/daemon.js',
      workingDirectory: '/app',
    });
    expect(plist).toContain('/usr/local/bin/node22');
  });

  it('createLaunchdPlist includes log paths', () => {
    const plist = createLaunchdPlist({
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/app/daemon.js',
      workingDirectory: '/var/log/popeye',
    });
    expect(plist).toContain('launchd.out.log');
    expect(plist).toContain('launchd.err.log');
  });

  it('getLaunchAgentPath returns default path', () => {
    const path = getLaunchAgentPath();
    expect(path).toContain('Library/LaunchAgents/dev.popeye.popeyed.plist');
  });

  it('getLaunchAgentPath uses custom label', () => {
    const path = getLaunchAgentPath('com.test.agent');
    expect(path).toContain('Library/LaunchAgents/com.test.agent.plist');
  });

  it('getLaunchAgentDomain returns gui/uid format', () => {
    const domain = getLaunchAgentDomain();
    expect(domain).toMatch(/^gui\/\d+$/);
  });

  it('getLaunchAgentTarget returns gui/uid/label format', () => {
    const target = getLaunchAgentTarget();
    expect(target).toMatch(/^gui\/\d+\/dev\.popeye\.popeyed$/);
  });

  it('getLaunchAgentTarget uses custom label', () => {
    const target = getLaunchAgentTarget('com.test.agent');
    expect(target).toMatch(/^gui\/\d+\/com\.test\.agent$/);
  });
});

describe('launchd integration (real file ops, fake label)', () => {
  const testLabel = `dev.popeye.test.${Date.now()}`;

  it('installLaunchAgent writes plist file', () => {
    const result = installLaunchAgent({
      label: testLabel,
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/app/daemon.js',
      workingDirectory: '/app',
    });
    expect(result.installed).toBe(true);
    expect(result.label).toBe(testLabel);
    expect(result.plistPath).toContain(testLabel);
    try { uninstallLaunchAgent(testLabel); } catch { /* ignore */ }
  });

  it('daemonStatus reports installed for written plist', () => {
    installLaunchAgent({
      label: testLabel,
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/app/daemon.js',
      workingDirectory: '/app',
    });
    const status = daemonStatus(testLabel);
    expect(status.installed).toBe(true);
    expect(status.loaded).toBe(false);
    try { uninstallLaunchAgent(testLabel); } catch { /* ignore */ }
  });

  it('daemonStatus reports not installed for missing label', () => {
    const status = daemonStatus('dev.popeye.nonexistent.test');
    expect(status.installed).toBe(false);
    expect(status.loaded).toBe(false);
  });

  it('loadLaunchAgent returns result for non-bootstrapped agent', () => {
    installLaunchAgent({
      label: testLabel,
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/app/daemon.js',
      workingDirectory: '/app',
    });
    const result = loadLaunchAgent(testLabel);
    expect(typeof result.ok).toBe('boolean');
    expect(typeof result.output).toBe('string');
    try { uninstallLaunchAgent(testLabel); } catch { /* ignore */ }
  });

  it('unloadLaunchAgent returns result for non-loaded agent', () => {
    const result = unloadLaunchAgent(`dev.popeye.nonexistent.${Date.now()}`);
    expect(result.ok).toBe(false);
    expect(typeof result.output).toBe('string');
  });

  it('restartLaunchAgent returns result reflecting load attempt', () => {
    installLaunchAgent({
      label: testLabel,
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/app/daemon.js',
      workingDirectory: '/app',
    });
    const result = restartLaunchAgent(testLabel);
    expect(typeof result.ok).toBe('boolean');
    expect(typeof result.output).toBe('string');
    try { uninstallLaunchAgent(testLabel); } catch { /* ignore */ }
  });

  it('uninstallLaunchAgent removes installed plist', () => {
    installLaunchAgent({
      label: testLabel,
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/app/daemon.js',
      workingDirectory: '/app',
    });
    const result = uninstallLaunchAgent(testLabel);
    expect(result.removed).toBe(true);
    const statusAfter = daemonStatus(testLabel);
    expect(statusAfter.installed).toBe(false);
  });

  it('uninstallLaunchAgent returns removed false for missing', () => {
    const result = uninstallLaunchAgent('dev.popeye.nonexistent.test');
    expect(result.removed).toBe(false);
  });
});
