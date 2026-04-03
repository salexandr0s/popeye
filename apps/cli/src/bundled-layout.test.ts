import { describe, expect, it } from 'vitest';

import { resolveBundledRuntimeLayout } from './bundled-layout.js';

describe('resolveBundledRuntimeLayout', () => {
  it('detects repo dist layout', () => {
    const layout = resolveBundledRuntimeLayout('/repo/apps/cli/dist/index.cjs', '/Users/test/Library/Application Support/Popeye/config.json');

    expect(layout).toEqual({
      kind: 'repo-dist',
      daemonEntryPoint: '/repo/apps/daemon/dist/index.cjs',
      workingDirectory: '/repo',
    });
  });

  it('detects legacy installed layout and uses config directory for launchd logs', () => {
    const layout = resolveBundledRuntimeLayout('/usr/local/lib/popeye/cli/pop.cjs', '/Users/test/Library/Application Support/Popeye/config.json');

    expect(layout).toEqual({
      kind: 'legacy-install',
      daemonEntryPoint: '/usr/local/lib/popeye/daemon/popeyed.cjs',
      workingDirectory: '/Users/test/Library/Application Support/Popeye',
    });
  });

  it('detects packaged mac app layout', () => {
    const layout = resolveBundledRuntimeLayout(
      '/Applications/PopeyeMac.app/Contents/Resources/Bootstrap/pop',
      '/Users/test/Library/Application Support/Popeye/config.json',
    );

    expect(layout).toEqual({
      kind: 'mac-app-bootstrap',
      daemonEntryPoint: '/Applications/PopeyeMac.app/Contents/Resources/Bootstrap/popeyed.cjs',
      workingDirectory: '/Users/test/Library/Application Support/Popeye',
    });
  });

  it('returns null for source-checkout tsx execution', () => {
    expect(resolveBundledRuntimeLayout('/repo/apps/cli/src/index.ts')).toBeNull();
  });
});
