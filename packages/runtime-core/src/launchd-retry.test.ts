import { rmSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

describe('launchd retry behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    spawnSyncMock.mockReset();
  });

  it('retries bootstrap after transient launchctl io error', async () => {
    const uid = process.getuid?.();
    expect(uid).toBeTypeOf('number');

    spawnSyncMock
      .mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'Bootstrap failed: 5: Input/output error\nTry re-running the command as root for richer errors.\n',
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'Bad request.\nCould not find service "dev.popeye.retry.test" in domain for user gui: 501\n',
      })
      .mockReturnValueOnce({ status: 0, stdout: 'loaded\n', stderr: '' });

    const { getLaunchAgentPath, installLaunchAgent, loadLaunchAgent } = await import('./launchd.js');
    installLaunchAgent({
      label: 'dev.popeye.retry.test',
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/tmp/daemon.js',
      workingDirectory: '/tmp',
    });

    try {
      const result = loadLaunchAgent('dev.popeye.retry.test');

      expect(result.ok).toBe(true);
      expect(spawnSyncMock).toHaveBeenNthCalledWith(
        1,
        'launchctl',
        ['bootstrap', `gui/${uid}`, getLaunchAgentPath('dev.popeye.retry.test')],
        { encoding: 'utf8' },
      );
      expect(spawnSyncMock).toHaveBeenNthCalledWith(
        2,
        'launchctl',
        ['print', `gui/${uid}/dev.popeye.retry.test`],
        { encoding: 'utf8' },
      );
      expect(spawnSyncMock).toHaveBeenNthCalledWith(
        3,
        'launchctl',
        ['bootstrap', `gui/${uid}`, getLaunchAgentPath('dev.popeye.retry.test')],
        { encoding: 'utf8' },
      );
    } finally {
      rmSync(getLaunchAgentPath('dev.popeye.retry.test'), { force: true });
    }
  });

  it('uses kickstart for restart when the agent is already loaded', async () => {
    const uid = process.getuid?.();
    expect(uid).toBeTypeOf('number');

    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: 'loaded\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    const { getLaunchAgentPath, installLaunchAgent, restartLaunchAgent } = await import('./launchd.js');
    installLaunchAgent({
      label: 'dev.popeye.restart.test',
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/tmp/daemon.js',
      workingDirectory: '/tmp',
    });

    try {
      const result = restartLaunchAgent('dev.popeye.restart.test');

      expect(result.ok).toBe(true);
      expect(spawnSyncMock).toHaveBeenNthCalledWith(
        1,
        'launchctl',
        ['print', `gui/${uid}/dev.popeye.restart.test`],
        { encoding: 'utf8' },
      );
      expect(spawnSyncMock).toHaveBeenNthCalledWith(
        2,
        'launchctl',
        ['kickstart', '-k', `gui/${uid}/dev.popeye.restart.test`],
        { encoding: 'utf8' },
      );
    } finally {
      rmSync(getLaunchAgentPath('dev.popeye.restart.test'), { force: true });
    }
  });
});
