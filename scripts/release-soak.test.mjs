import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { captureSnapshot, runSoak } from './release-soak.mjs';

describe('release-soak', () => {
  it('captures a successful snapshot to a timestamped file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-release-soak-success-'));
    const execFileImpl = vi.fn().mockResolvedValue({
      stdout: '{"ok":true}\n',
      stderr: '',
    });

    const result = await captureSnapshot({
      host: 'savorgserver',
      remoteEnvFile: '$HOME/.popeye-rr-env.sh',
      outDir: dir,
      stamp: '20260401T210000Z',
      execFileImpl,
    });

    expect(result.ok).toBe(true);
    expect(execFileImpl).toHaveBeenCalledWith(
      'ssh',
      ['savorgserver', expect.stringContaining('pop daemon health --json')],
      expect.objectContaining({ maxBuffer: 10 * 1024 * 1024 }),
    );
    expect(readFileSync(join(dir, 'soak-20260401T210000Z.log'), 'utf8')).toContain('{"ok":true}');
  });

  it('continues after failed snapshots and writes a summary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-release-soak-summary-'));
    const execFileImpl = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'first ok\n', stderr: '' })
      .mockRejectedValueOnce({
        stdout: 'partial output\n',
        stderr: 'ssh failure\n',
        message: 'ssh exited with code 255',
        code: 255,
      });

    const summary = await runSoak({
      host: 'savorgserver',
      evidenceDir: dir,
      iterations: 2,
      intervalSeconds: 0,
      execFileImpl,
      sleepImpl: async () => undefined,
      pidFile: join(dir, 'runner.pid'),
    });

    expect(summary.iterationsCompleted).toBe(2);
    expect(summary.failures).toBe(1);
    expect(summary.snapshots).toEqual([
      expect.objectContaining({ iteration: 1, ok: true }),
      expect.objectContaining({ iteration: 2, ok: false, exitCode: 255 }),
    ]);
    expect(existsSync(join(dir, 'runner.pid'))).toBe(true);
    expect(readFileSync(join(dir, 'soak-summary.json'), 'utf8')).toContain('"failures": 1');
    expect(readFileSync(join(dir, 'soak-run.log'), 'utf8')).toContain('iteration 2/2');
    expect(readFileSync(join(dir, 'soak-end.log'), 'utf8')).toContain('"iterationsCompleted": 2');
  });
});
