import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ensureBundledNodeRuntime, getBundledNodeSpec, sha256File } from './fetch-bundled-node-runtime.mjs';

function initRoot() {
  const root = mkdtempSync(join(tmpdir(), 'popeye-bundled-node-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  return root;
}

function writeManifest(root, { sha256, url = 'https://example.com/node.tar.gz' }) {
  const archiveFile = 'node-v22.22.2-darwin-arm64.tar.gz';
  const extractedDirectory = 'node-v22.22.2-darwin-arm64';
  writeFileSync(
    join(root, 'scripts', 'bundled-node-runtime.json'),
    JSON.stringify(
      {
        version: '22.22.2',
        releaseTrain: 'v22.x',
        platforms: {
          'darwin-arm64': {
            archiveFile,
            sha256,
            url,
            extractedDirectory,
            binaryRelativePath: 'bin/node',
          },
        },
      },
      null,
      2,
    ),
  );
  return { archiveFile, extractedDirectory };
}

describe('fetch-bundled-node-runtime', () => {
  it('loads the pinned darwin-arm64 spec', async () => {
    const spec = await getBundledNodeSpec();
    expect(spec.platform).toBe('darwin-arm64');
    expect(spec.version).toBe('22.22.2');
    expect(spec.url).toBe('https://nodejs.org/download/release/v22.22.2/node-v22.22.2-darwin-arm64.tar.gz');
    expect(spec.sha256).toBe('db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000');
  });

  it('fails on checksum mismatch', async () => {
    const root = initRoot();
    writeManifest(root, { sha256: 'deadbeef' });
    const cacheRoot = join(root, 'cache');

    await expect(
      ensureBundledNodeRuntime({
        rootDir: root,
        cacheRoot,
        downloadFile: async ({ destinationPath }) => {
          mkdirSync(dirname(destinationPath), { recursive: true });
          writeFileSync(destinationPath, 'not-node');
        },
        extractArchive: vi.fn(),
      }),
    ).rejects.toThrow(/Bundled Node checksum mismatch/);
  });

  it('reuses cached runtime without re-downloading', async () => {
    const root = initRoot();
    writeManifest(root, { sha256: 'unused' });
    const cacheRoot = join(root, 'cache');
    const extractedRoot = join(cacheRoot, 'v22.22.2', 'darwin-arm64', 'node-v22.22.2-darwin-arm64');
    mkdirSync(join(extractedRoot, 'bin'), { recursive: true });
    writeFileSync(join(extractedRoot, 'bin', 'node'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

    const downloadFile = vi.fn();
    const extractArchive = vi.fn();
    const runtime = await ensureBundledNodeRuntime({ rootDir: root, cacheRoot, downloadFile, extractArchive });

    expect(runtime.cacheHit).toBe(true);
    expect(downloadFile).not.toHaveBeenCalled();
    expect(extractArchive).not.toHaveBeenCalled();
  });

  it('downloads, verifies, and extracts the runtime', async () => {
    const root = initRoot();
    const archivePayload = Buffer.from('archive-bytes');
    const sha256 = await sha256File(writeTempFile(root, archivePayload));
    const { extractedDirectory } = writeManifest(root, { sha256 });
    const cacheRoot = join(root, 'cache');

    const runtime = await ensureBundledNodeRuntime({
      rootDir: root,
      cacheRoot,
      downloadFile: async ({ destinationPath }) => {
        mkdirSync(dirname(destinationPath), { recursive: true });
        writeFileSync(destinationPath, archivePayload);
      },
      extractArchive: async ({ destinationDir }) => {
        const extractedRoot = join(destinationDir, extractedDirectory);
        mkdirSync(join(extractedRoot, 'bin'), { recursive: true });
        writeFileSync(join(extractedRoot, 'bin', 'node'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
      },
    });

    expect(runtime.cacheHit).toBe(false);
    expect(runtime.binaryPath).toBe(join(cacheRoot, 'v22.22.2', 'darwin-arm64', extractedDirectory, 'bin', 'node'));
  });
});

function writeTempFile(root, content) {
  const filePath = join(root, 'checksum-fixture.bin');
  writeFileSync(filePath, content);
  return filePath;
}
