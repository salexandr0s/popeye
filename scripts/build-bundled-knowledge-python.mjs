import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ensureBundledPythonRuntime } from './fetch-bundled-python-runtime.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_PLATFORM = 'darwin-arm64';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CACHE_ROOT = join(REPO_ROOT, 'dist', 'cache', 'knowledge-python');
const REQUIREMENTS_PATH = join(REPO_ROOT, 'scripts', 'knowledge-python-requirements.txt');
const SOURCE_DISTRIBUTION_ALLOWLIST = ['pylatexenc'];
const BUILD_TOOL_REQUIREMENTS = ['setuptools==75.8.0', 'wheel==0.45.1'];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

function defaultRunCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
}

async function ensurePip(pythonBin, runCommand) {
  try {
    await runCommand(pythonBin, ['-m', 'pip', '--version']);
  } catch {
    await runCommand(pythonBin, ['-m', 'ensurepip', '--upgrade']);
  }
}

async function hashWheelhouse(directory) {
  const entries = (await readdir(directory))
    .filter((entry) => entry.endsWith('.whl') || entry.endsWith('.tar.gz') || entry.endsWith('.zip'))
    .sort();
  const wheels = [];
  for (const entry of entries) {
    const filePath = join(directory, entry);
    const fileStat = await stat(filePath);
    wheels.push({
      file: entry,
      sizeBytes: fileStat.size,
      sha256: await sha256File(filePath),
    });
  }
  return wheels;
}

function matchesAllowedSourceDistribution(fileName) {
  const lower = fileName.toLowerCase();
  return SOURCE_DISTRIBUTION_ALLOWLIST.some((packageName) => lower.startsWith(`${packageName.toLowerCase()}-`));
}

async function buildAllowedSourceDistributions({ pythonBin, wheelhouseRoot, runCommand }) {
  const entries = (await readdir(wheelhouseRoot))
    .filter((entry) => !entry.endsWith('.whl'))
    .sort();

  for (const entry of entries) {
    if (!matchesAllowedSourceDistribution(entry)) {
      throw new Error(`Unsupported non-wheel dependency in bundled Knowledge closure: ${entry}`);
    }

    await runCommand(pythonBin, [
      '-m',
      'pip',
      'wheel',
      '--disable-pip-version-check',
      '--no-deps',
      '--no-build-isolation',
      '--wheel-dir',
      wheelhouseRoot,
      join(wheelhouseRoot, entry),
    ]);
  }
}

async function installBuildTooling({ pythonBin, wheelhouseRoot, runCommand }) {
  if (BUILD_TOOL_REQUIREMENTS.length === 0) {
    return;
  }

  await runCommand(pythonBin, [
    '-m',
    'pip',
    'download',
    '--disable-pip-version-check',
    '--only-binary=:all:',
    '--dest',
    wheelhouseRoot,
    ...BUILD_TOOL_REQUIREMENTS,
  ]);

  await runCommand(pythonBin, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-index',
    '--find-links',
    wheelhouseRoot,
    '--upgrade',
    ...BUILD_TOOL_REQUIREMENTS.map((entry) => entry.split('==')[0]),
  ]);
}

async function writeShims(closureRoot) {
  const shimsDir = join(closureRoot, 'knowledge-python-shims');
  await mkdir(shimsDir, { recursive: true });
  const pythonShimPath = join(shimsDir, 'python3');
  const pythonShim = `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_BIN="$ROOT_DIR/python/bin/python3"
SITE_PACKAGES="$ROOT_DIR/python-site-packages"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Bundled Popeye Knowledge Python runtime missing at $PYTHON_BIN" >&2
  exit 1
fi

export PYTHONNOUSERSITE=1
if [[ -n "\${PYTHONPATH:-}" ]]; then
  export PYTHONPATH="$SITE_PACKAGES:$PYTHONPATH"
else
  export PYTHONPATH="$SITE_PACKAGES"
fi

exec "$PYTHON_BIN" "$@"
`;
  await writeFile(pythonShimPath, pythonShim, { encoding: 'utf8', mode: 0o755 });
  await chmod(pythonShimPath, 0o755);

  const markitdownShimPath = join(shimsDir, 'markitdown');
  const markitdownShim = `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/python3" -m markitdown "$@"
`;
  await writeFile(markitdownShimPath, markitdownShim, { encoding: 'utf8', mode: 0o755 });
  await chmod(markitdownShimPath, 0o755);

  return { shimsDir, pythonShimPath, markitdownShimPath };
}

export async function ensureBundledKnowledgePython({
  rootDir = REPO_ROOT,
  platform = DEFAULT_PLATFORM,
  cacheRoot = DEFAULT_CACHE_ROOT,
  requirementsPath = REQUIREMENTS_PATH,
  ensurePythonRuntime = ensureBundledPythonRuntime,
  runCommand = defaultRunCommand,
} = {}) {
  const pythonRuntimeCacheRoot = join(dirname(cacheRoot), 'python-runtime');
  const runtime = await ensurePythonRuntime({ rootDir, platform, cacheRoot: pythonRuntimeCacheRoot });
  const closureRoot = join(cacheRoot, `python-${runtime.version}`, platform);
  const manifestPath = join(closureRoot, 'manifest.json');
  const pythonRoot = join(closureRoot, 'python');
  const sitePackagesRoot = join(closureRoot, 'python-site-packages');
  const wheelhouseRoot = join(closureRoot, 'wheelhouse');
  const requirementsHash = createHash('sha256').update(await readFile(requirementsPath, 'utf8')).digest('hex');

  if (await pathExists(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (
      manifest.requirementsHash === requirementsHash
      && await pathExists(join(closureRoot, 'knowledge-python-shims', 'python3'))
      && await pathExists(join(closureRoot, 'knowledge-python-shims', 'markitdown'))
    ) {
      return {
        closureRoot,
        manifestPath,
        pythonRoot,
        sitePackagesRoot,
        wheelhouseRoot,
        cacheHit: true,
        manifest,
      };
    }
  }

  await rm(closureRoot, { recursive: true, force: true });
  await mkdir(closureRoot, { recursive: true });
  await cp(runtime.extractedRoot, pythonRoot, { recursive: true });
  await mkdir(sitePackagesRoot, { recursive: true });
  await mkdir(wheelhouseRoot, { recursive: true });

  const pythonBin = join(pythonRoot, runtime.binaryRelativePath);
  await ensurePip(pythonBin, runCommand);
  await installBuildTooling({ pythonBin, wheelhouseRoot, runCommand });

  await runCommand(pythonBin, [
    '-m',
    'pip',
    'download',
    '--disable-pip-version-check',
    '--only-binary=:all:',
    `--no-binary=${SOURCE_DISTRIBUTION_ALLOWLIST.join(',')}`,
    '--requirement',
    requirementsPath,
    '--dest',
    wheelhouseRoot,
  ]);
  await buildAllowedSourceDistributions({ pythonBin, wheelhouseRoot, runCommand });

  const installReportPath = join(closureRoot, 'pip-install-report.json');
  await runCommand(pythonBin, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-compile',
    '--no-index',
    '--find-links',
    wheelhouseRoot,
    '--target',
    sitePackagesRoot,
    '--requirement',
    requirementsPath,
    '--report',
    installReportPath,
  ]);

  const { pythonShimPath, markitdownShimPath } = await writeShims(closureRoot);
  const installedReport = JSON.parse(await readFile(installReportPath, 'utf8'));
  const wheels = await hashWheelhouse(wheelhouseRoot);
  const manifest = {
    pythonRuntime: {
      version: runtime.version,
      platform: runtime.platform,
      sourceUrl: runtime.url,
      sha256: runtime.sha256,
    },
    requirementsPath,
    requirementsHash,
    buildToolRequirements: BUILD_TOOL_REQUIREMENTS,
    sourceDistributionAllowlist: SOURCE_DISTRIBUTION_ALLOWLIST,
    createdAt: new Date().toISOString(),
    wheelhouse: wheels,
    installReport: installedReport,
    shims: {
      python: pythonShimPath,
      markitdown: markitdownShimPath,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    closureRoot,
    manifestPath,
    pythonRoot,
    sitePackagesRoot,
    wheelhouseRoot,
    cacheHit: false,
    manifest,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const closure = await ensureBundledKnowledgePython();

  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(closure, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${closure.closureRoot}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
