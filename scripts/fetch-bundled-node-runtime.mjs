import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, constants, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_PLATFORM = 'darwin-arm64';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CACHE_ROOT = join(REPO_ROOT, 'dist', 'cache', 'node-runtime');

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(targetPath) {
  try {
    await access(targetPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

export async function loadBundledNodeManifest(rootDir = REPO_ROOT) {
  const manifestPath = join(rootDir, 'scripts', 'bundled-node-runtime.json');
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

export async function getBundledNodeSpec({ rootDir = REPO_ROOT, platform = DEFAULT_PLATFORM } = {}) {
  const manifest = await loadBundledNodeManifest(rootDir);
  const platformSpec = manifest.platforms?.[platform];
  if (!platformSpec) {
    throw new Error(`No bundled Node runtime configured for platform: ${platform}`);
  }

  return {
    platform,
    version: manifest.version,
    releaseTrain: manifest.releaseTrain,
    ...platformSpec,
  };
}

export async function getBundledNodePaths({
  rootDir = REPO_ROOT,
  platform = DEFAULT_PLATFORM,
  cacheRoot = DEFAULT_CACHE_ROOT,
} = {}) {
  const spec = await getBundledNodeSpec({ rootDir, platform });
  const platformCacheDir = join(cacheRoot, `v${spec.version}`, platform);
  const archivePath = join(platformCacheDir, spec.archiveFile);
  const extractedRoot = join(platformCacheDir, spec.extractedDirectory);
  const binaryPath = join(extractedRoot, spec.binaryRelativePath);
  return {
    ...spec,
    rootDir,
    cacheRoot,
    platformCacheDir,
    archivePath,
    extractedRoot,
    binaryPath,
  };
}

export async function downloadBundledNodeArchive({ url, destinationPath }) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download bundled Node runtime from ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const tempPath = `${destinationPath}.tmp`;
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(tempPath, Buffer.from(arrayBuffer));
  await rename(tempPath, destinationPath);
}

export async function extractBundledNodeArchive({ archivePath, destinationDir }) {
  await mkdir(destinationDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', archivePath, '-C', destinationDir]);
}

export async function ensureBundledNodeRuntime({
  rootDir = REPO_ROOT,
  platform = DEFAULT_PLATFORM,
  cacheRoot = DEFAULT_CACHE_ROOT,
  downloadFile = downloadBundledNodeArchive,
  extractArchive = extractBundledNodeArchive,
} = {}) {
  const paths = await getBundledNodePaths({ rootDir, platform, cacheRoot });

  if (await isExecutable(paths.binaryPath)) {
    return {
      ...paths,
      cacheHit: true,
    };
  }

  await mkdir(paths.platformCacheDir, { recursive: true });

  if (await pathExists(paths.archivePath)) {
    const archiveChecksum = await sha256File(paths.archivePath);
    if (archiveChecksum !== paths.sha256) {
      await rm(paths.archivePath, { force: true });
    }
  }

  if (!(await pathExists(paths.archivePath))) {
    await downloadFile({ url: paths.url, destinationPath: paths.archivePath });
  }

  const archiveChecksum = await sha256File(paths.archivePath);
  if (archiveChecksum !== paths.sha256) {
    await rm(paths.archivePath, { force: true });
    throw new Error(
      `Bundled Node checksum mismatch for ${paths.archiveFile}: expected ${paths.sha256}, got ${archiveChecksum}`,
    );
  }

  await rm(paths.extractedRoot, { recursive: true, force: true });
  await extractArchive({ archivePath: paths.archivePath, destinationDir: paths.platformCacheDir });

  if (!(await isExecutable(paths.binaryPath))) {
    throw new Error(`Bundled Node runtime is missing executable ${paths.binaryRelativePath} after extraction`);
  }

  return {
    ...paths,
    cacheHit: false,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const runtime = await ensureBundledNodeRuntime();

  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(runtime, null, 2)}\n`);
    return;
  }

  if (args.has('--print-binary')) {
    process.stdout.write(`${runtime.binaryPath}\n`);
    return;
  }

  process.stdout.write(`${runtime.extractedRoot}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
