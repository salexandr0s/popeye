import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ensureBundledKnowledgePython } from './build-bundled-knowledge-python.mjs';

describe('build-bundled-knowledge-python', () => {
  it('creates a portable closure manifest and shim scripts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-knowledge-python-'));
    const cacheRoot = join(root, 'cache');
    const requirementsPath = join(root, 'requirements.txt');
    const runtimeRoot = join(root, 'runtime', 'python');
    const pythonBin = join(runtimeRoot, 'bin', 'python3');

    mkdirSync(join(runtimeRoot, 'bin'), { recursive: true });
    writeFileSync(pythonBin, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    writeFileSync(requirementsPath, 'markitdown==0.1.5\n', 'utf8');

    const runCommand = vi.fn(async (command, args) => {
      if (args[0] === '-m' && args[1] === 'pip' && args[2] === 'download') {
        const destination = args[args.indexOf('--dest') + 1];
        mkdirSync(destination, { recursive: true });
        if (args.includes('setuptools==75.8.0')) {
          writeFileSync(join(destination, 'setuptools-75.8.0-py3-none-any.whl'), 'wheel');
          writeFileSync(join(destination, 'wheel-0.45.1-py3-none-any.whl'), 'wheel');
        } else {
          writeFileSync(join(destination, 'markitdown-0.1.5-py3-none-any.whl'), 'wheel');
        }
        return { stdout: '', stderr: '' };
      }
      if (args[0] === '-m' && args[1] === 'pip' && args[2] === 'wheel') {
        return { stdout: '', stderr: '' };
      }
      if (args[0] === '-m' && args[1] === 'pip' && args[2] === 'install') {
        if (!args.includes('--target')) {
          return { stdout: '', stderr: '' };
        }
        const target = args[args.indexOf('--target') + 1];
        const report = args[args.indexOf('--report') + 1];
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, 'markitdown.py'), '# test\n');
        writeFileSync(report, JSON.stringify({ install: [{ metadata: { name: 'markitdown', version: '0.1.5' } }] }, null, 2));
        return { stdout: '', stderr: '' };
      }
      return { stdout: 'pip ok', stderr: '' };
    });

    try {
      const closure = await ensureBundledKnowledgePython({
        rootDir: root,
        cacheRoot,
        requirementsPath,
        ensurePythonRuntime: async () => ({
          version: '3.12.8',
          platform: 'darwin-arm64',
          url: 'https://example.com/python.tar.gz',
          sha256: 'sha',
          extractedRoot: runtimeRoot,
          binaryRelativePath: 'bin/python3',
        }),
        runCommand,
      });

      expect(closure.cacheHit).toBe(false);
      expect(existsSync(join(closure.closureRoot, 'knowledge-python-shims', 'python3'))).toBe(true);
      expect(existsSync(join(closure.closureRoot, 'knowledge-python-shims', 'markitdown'))).toBe(true);
      const manifest = JSON.parse(readFileSync(closure.manifestPath, 'utf8'));
      expect(manifest.pythonRuntime.version).toBe('3.12.8');
      expect(manifest.requirementsHash).toBeTruthy();
      expect(manifest.installReport.install[0].metadata.name).toBe('markitdown');
      expect(manifest.wheelhouse[0].file).toBe('markitdown-0.1.5-py3-none-any.whl');

      const cached = await ensureBundledKnowledgePython({
        rootDir: root,
        cacheRoot,
        requirementsPath,
        ensurePythonRuntime: async () => ({
          version: '3.12.8',
          platform: 'darwin-arm64',
          url: 'https://example.com/python.tar.gz',
          sha256: 'sha',
          extractedRoot: runtimeRoot,
          binaryRelativePath: 'bin/python3',
        }),
        runCommand,
      });
      expect(cached.cacheHit).toBe(true);

      writeFileSync(requirementsPath, 'markitdown==0.1.6\n', 'utf8');
      const rebuilt = await ensureBundledKnowledgePython({
        rootDir: root,
        cacheRoot,
        requirementsPath,
        ensurePythonRuntime: async () => ({
          version: '3.12.8',
          platform: 'darwin-arm64',
          url: 'https://example.com/python.tar.gz',
          sha256: 'sha',
          extractedRoot: runtimeRoot,
          binaryRelativePath: 'bin/python3',
        }),
        runCommand,
      });
      expect(rebuilt.cacheHit).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
