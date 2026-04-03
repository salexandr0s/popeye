#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, parse, resolve, sep } from 'node:path';

const [, , destinationRootArg, ...seedPackages] = process.argv;

if (!destinationRootArg || seedPackages.length === 0) {
  console.error('Usage: node scripts/copy-node-package-closure.mjs <destination-root> <package> [package...]');
  process.exit(1);
}

const destinationRoot = resolve(destinationRootArg);
const rootRequire = createRequire(resolve('package.json'));
const rootSearchPaths = [
  resolve('apps/cli/node_modules'),
  resolve('apps/daemon/node_modules'),
  resolve('node_modules'),
  resolve('node_modules/.pnpm/node_modules'),
];
const visited = new Set();
const RUNTIME_FILE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.json', '.node', '.wasm', '.dylib', '.so', '.dll']);
const PRUNED_DIRECTORY_NAMES = new Set([
  '.github',
  '__tests__',
  'benchmark',
  'benchmarks',
  'coverage',
  'doc',
  'docs',
  'documentation',
  'example',
  'examples',
  'fixture',
  'fixtures',
  'test',
  'tests',
]);
const PACKAGE_SPECIFIC_PRUNED_PREFIXES = new Map([
  ['better-sqlite3', ['deps', 'src']],
  ['pino', ['benchmarks', 'docs', 'examples', 'test']],
]);
const LEGAL_FILE_PATTERN = /^(license|licence|notice)(\.|$)/i;

mkdirSync(destinationRoot, { recursive: true });

for (const pkg of seedPackages) {
  copyPackageClosure(pkg, null, false);
}

function copyPackageClosure(packageName, packageRequire, optional) {
  const packageJsonPath = resolvePackageJson(packageName, packageRequire);
  if (!packageJsonPath) {
    if (optional) {
      return;
    }
    throw new Error(`Unable to resolve package '${packageName}' from the local workspace install`);
  }

  const packageDirectory = dirname(packageJsonPath);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const destinationDirectory = join(destinationRoot, ...packageName.split('/'));

  if (!visited.has(packageName)) {
    visited.add(packageName);
    rmSync(destinationDirectory, { recursive: true, force: true });
    copyRuntimePackageDirectory(packageDirectory, destinationDirectory, packageName);
  }

  const dependencyNames = Object.keys(packageJson.dependencies ?? {});
  const optionalDependencyNames = Object.keys(packageJson.optionalDependencies ?? {});
  const resolver = createRequire(packageJsonPath);

  for (const dependencyName of dependencyNames) {
    copyPackageClosure(dependencyName, resolver, false);
  }
  for (const dependencyName of optionalDependencyNames) {
    copyPackageClosure(dependencyName, resolver, true);
  }
}

function resolvePackageJson(packageName, packageRequire) {
  const resolvedPackageJson = findPackageJsonForRequest(`${packageName}/package.json`, packageName, packageRequire);
  if (resolvedPackageJson) {
    return resolvedPackageJson;
  }
  return findPackageJsonForRequest(packageName, packageName, packageRequire);
}

function findPackageJsonForRequest(request, packageName, packageRequire) {
  const resolvedPath = resolveRequest(request, packageRequire);
  if (!resolvedPath) {
    return null;
  }

  if (resolvedPath.endsWith(`${sep}package.json`)) {
    return resolvedPath;
  }

  let currentDirectory = dirname(resolvedPath);
  while (true) {
    const candidate = join(currentDirectory, 'package.json');
    if (existsSync(candidate)) {
      const candidateJson = JSON.parse(readFileSync(candidate, 'utf8'));
      if (candidateJson.name === packageName) {
        return candidate;
      }
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory || parentDirectory === parse(currentDirectory).root) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  return null;
}

function resolveRequest(request, packageRequire) {
  if (packageRequire) {
    try {
      return packageRequire.resolve(request);
    } catch {
      // fall through
    }
  }

  try {
    return rootRequire.resolve(request, { paths: rootSearchPaths });
  } catch {
    return null;
  }
}

function copyRuntimePackageDirectory(sourceDirectory, destinationDirectory, packageName) {
  mkdirSync(destinationDirectory, { recursive: true });
  copyDirectoryEntries(sourceDirectory, destinationDirectory, packageName, '');
}

function copyDirectoryEntries(sourceDirectory, destinationDirectory, packageName, relativeDirectory) {
  const entries = readdirSync(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDirectory, entry.name);
    const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;

    if (entry.isDirectory()) {
      if (shouldPruneDirectory(packageName, relativePath)) {
        continue;
      }

      copyDirectoryEntries(
        sourcePath,
        join(destinationDirectory, entry.name),
        packageName,
        relativePath,
      );
      continue;
    }

    if (entry.isFile() === false && entry.isSymbolicLink() === false) {
      continue;
    }

    if (shouldKeepFile(packageName, relativePath) === false) {
      continue;
    }

    mkdirSync(destinationDirectory, { recursive: true });
    cpSync(sourcePath, join(destinationDirectory, entry.name), { dereference: true });
  }
}

function shouldPruneDirectory(packageName, relativePath) {
  const segments = relativePath.split(sep).map((segment) => segment.toLowerCase());
  if (segments.includes('node_modules')) {
    return true;
  }
  if (segments.some((segment) => PRUNED_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  const packagePrefixes = PACKAGE_SPECIFIC_PRUNED_PREFIXES.get(packageName) ?? [];
  return packagePrefixes.some((prefix) => {
    return relativePath === prefix || relativePath.startsWith(`${prefix}${sep}`);
  });
}

function shouldKeepFile(_packageName, relativePath) {
  const fileName = basename(relativePath);
  if (fileName === 'package.json') {
    return true;
  }
  if (LEGAL_FILE_PATTERN.test(fileName)) {
    return true;
  }

  return RUNTIME_FILE_EXTENSIONS.has(extname(fileName).toLowerCase());
}
