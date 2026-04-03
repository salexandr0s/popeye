import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadGitIgnoredRelativePaths, scanForSecrets } from './scan-secrets.mjs';

function initRepo() {
  const root = mkdtempSync(join(tmpdir(), 'popeye-secret-scan-'));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Popeye Tests'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'popeye-tests@example.com'], { cwd: root, stdio: 'ignore' });
  return root;
}

describe('scan-secrets', () => {
  it('skips ignored SwiftPM build artifacts', () => {
    const root = initRepo();
    mkdirSync(join(root, 'apps', 'macos', 'PopeyeMac', '.build'), { recursive: true });
    writeFileSync(join(root, 'apps', 'macos', 'PopeyeMac', '.gitignore'), '.build/\n');
    writeFileSync(join(root, 'apps', 'macos', 'PopeyeMac', '.build', 'PopeyeMac'), 'token sk-abc123def456ghi789');

    expect(loadGitIgnoredRelativePaths(root).has('apps/macos/PopeyeMac/.build')).toBe(true);
    expect(() => scanForSecrets({ root })).not.toThrow();
  });

  it('still fails on tracked files containing secrets', () => {
    const root = initRepo();
    mkdirSync(join(root, 'tracked'), { recursive: true });
    writeFileSync(join(root, 'tracked', 'fixture.txt'), 'token sk-abc123def456ghi789');
    execFileSync('git', ['add', 'tracked/fixture.txt'], { cwd: root, stdio: 'ignore' });

    expect(() => scanForSecrets({ root })).toThrow(/Potential secret found in tracked\/fixture.txt:1/);
  });

  it('still honors inline allow markers', () => {
    const root = initRepo();
    writeFileSync(join(root, 'notes.txt'), 'token sk-abc123def456ghi789 // secret-scan: allow\n');

    expect(() => scanForSecrets({ root })).not.toThrow();
  });
});
