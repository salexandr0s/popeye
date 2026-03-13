import { describe, expect, it } from 'vitest';

import { createLaunchdPlist } from './launchd.js';

describe('createLaunchdPlist', () => {
  it('renders a LaunchAgent plist', () => {
    const plist = createLaunchdPlist({
      configPath: '/tmp/config.json',
      daemonEntryPoint: '/repo/apps/daemon/src/index.ts',
      workingDirectory: '/repo',
    });
    expect(plist).toContain('POPEYE_CONFIG_PATH');
    expect(plist).toContain('dev.popeye.popeyed');
  });
});
