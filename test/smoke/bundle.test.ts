/**
 * Bundle smoke test — verifies the CLI bundle starts and responds to --help / --version.
 *
 * Not included in the default vitest run. Execute manually:
 *   npx vitest run test/smoke/bundle.test.ts
 *
 * Requires: pnpm pack:cli to have been run first (or run pnpm pack:cli before).
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const CLI_BUNDLE = resolve('apps', 'cli', 'dist', 'index.cjs');

describe.skipIf(!existsSync(CLI_BUNDLE))('CLI bundle smoke test', () => {
  it('--help exits 0 and contains version string', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_BUNDLE, '--help'], {
      timeout: 10_000,
    });
    expect(stdout).toContain('pop v0.1.0');
    expect(stdout).toContain('Popeye CLI');
  });

  it('--version exits 0 and prints version', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_BUNDLE, '--version'], {
      timeout: 10_000,
    });
    expect(stdout.trim()).toBe('pop v0.1.0');
  });

  it('unknown command exits 1', async () => {
    try {
      await execFileAsync(process.execPath, [CLI_BUNDLE, 'bogus'], { timeout: 10_000 });
      expect.fail('should have exited with non-zero');
    } catch (err: unknown) {
      const e = err as { code?: number; stderr?: string };
      expect(e.code).toBe(1);
      expect(e.stderr).toContain('Unknown command');
    }
  });
});
