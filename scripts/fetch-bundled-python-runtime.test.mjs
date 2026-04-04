import { mkdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { ensureBundledPythonRuntime, extractBundledPythonArchive, getBundledPythonSpec, sha256File } from './fetch-bundled-python-runtime.mjs';

const execFileAsync = promisify(execFile);

function initRoot() {
  const root = mkdtempSync(join(tmpdir(), 'popeye-bundled-python-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  return root;
}

function writeManifest(root, { sha256, url = 'https://example.com/python.tar.gz' }) {
  const archiveFile = 'cpython-3.12.8+20241206-aarch64-apple-darwin-install_only_stripped.tar.gz';
  const extractedDirectory = 'python';
  writeFileSync(
    join(root, 'scripts', 'bundled-python-runtime.json'),
    JSON.stringify(
      {
        version: '3.12.8',
        releaseTrain: '20241206',
        platforms: {
          'darwin-arm64': {
            archiveFile,
            sha256,
            url,
            extractedDirectory,
            binaryRelativePath: 'bin/python3',
          },
        },
      },
      null,
      2,
    ),
  );
  return { archiveFile, extractedDirectory };
}

describe('fetch-bundled-python-runtime', () => {
  it('loads the pinned darwin-arm64 spec', async () => {
    const spec = await getBundledPythonSpec();
    expect(spec.platform).toBe('darwin-arm64');
    expect(spec.version).toBe('3.12.8');
    expect(spec.url).toContain('cpython-3.12.8%2B20241206-aarch64-apple-darwin-install_only_stripped.tar.gz');
    expect(spec.sha256).toBe('d6e607f109db29f2e4a00137fde91f29f359709e1815887334305e4f560b19ac');
  });

  it('fails on checksum mismatch', async () => {
    const root = initRoot();
    writeManifest(root, { sha256: 'deadbeef' });
    const cacheRoot = join(root, 'cache');

    await expect(
      ensureBundledPythonRuntime({
        rootDir: root,
        cacheRoot,
        downloadFile: async ({ destinationPath }) => {
          mkdirSync(dirname(destinationPath), { recursive: true });
          writeFileSync(destinationPath, 'not-python');
        },
        extractArchive: vi.fn(),
      }),
    ).rejects.toThrow(/Bundled Python checksum mismatch/);
  });

  it('reuses cached runtime without re-downloading', async () => {
    const root = initRoot();
    writeManifest(root, { sha256: 'unused' });
    const cacheRoot = join(root, 'cache');
    const extractedRoot = join(cacheRoot, 'v3.12.8', 'darwin-arm64', 'python');
    mkdirSync(join(extractedRoot, 'bin'), { recursive: true });
    writeFileSync(join(extractedRoot, 'bin', 'python3'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

    const downloadFile = vi.fn();
    const extractArchive = vi.fn();
    const runtime = await ensureBundledPythonRuntime({ rootDir: root, cacheRoot, downloadFile, extractArchive });

    expect(runtime.cacheHit).toBe(true);
    expect(downloadFile).not.toHaveBeenCalled();
    expect(extractArchive).not.toHaveBeenCalled();
  });

  it('downloads, verifies, and extracts the runtime', async () => {
    const root = initRoot();
    const archivePayload = Buffer.from('archive-bytes');
    const sha256 = await sha256File(writeTempFile(root, archivePayload));
    writeManifest(root, { sha256 });
    const cacheRoot = join(root, 'cache');

    const runtime = await ensureBundledPythonRuntime({
      rootDir: root,
      cacheRoot,
      downloadFile: async ({ destinationPath }) => {
        mkdirSync(dirname(destinationPath), { recursive: true });
        writeFileSync(destinationPath, archivePayload);
      },
      extractArchive: async ({ destinationDir, extractedDirectory }) => {
        const extractedRoot = join(destinationDir, extractedDirectory);
        mkdirSync(join(extractedRoot, 'bin'), { recursive: true });
        writeFileSync(join(extractedRoot, 'bin', 'python3'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
      },
    });

    expect(runtime.cacheHit).toBe(false);
    expect(runtime.binaryPath).toBe(join(cacheRoot, 'v3.12.8', 'darwin-arm64', 'python', 'bin', 'python3'));
  });

  it('preserves relative symlinks when extracting the runtime archive', async () => {
    const root = initRoot();
    const archiveRoot = join(root, 'archive-root');
    const archivePath = join(root, 'python-runtime.tar.gz');
    const destinationDir = join(root, 'output');
    const pythonBinDir = join(archiveRoot, 'python', 'bin');

    mkdirSync(pythonBinDir, { recursive: true });
    writeFileSync(join(pythonBinDir, 'python3.12'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    await execFileAsync('ln', ['-sf', 'python3.12', join(pythonBinDir, 'python3')]);
    await execFileAsync('tar', ['-czf', archivePath, '-C', archiveRoot, 'python']);

    await extractBundledPythonArchive({
      archivePath,
      destinationDir,
      extractedDirectory: 'python',
    });

    expect(readlinkSync(join(destinationDir, 'python', 'bin', 'python3'))).toBe('python3.12');
  });
});

function writeTempFile(root, content) {
  const filePath = join(root, 'checksum-fixture.bin');
  writeFileSync(filePath, content);
  return filePath;
}
