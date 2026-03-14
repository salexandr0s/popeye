import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOTS = [
  { root: 'packages', ignoreNames: new Set(['engine-pi']) },
  { root: 'apps', ignoreNames: new Set() },
  {
    root: 'scripts',
    ignoreNames: new Set([
      'check-pi-boundary.mjs',
      'check-pi-boundary.test.mjs',
      'check-pi-checkout.mjs',
      'check-pi-checkout.test.mjs',
    ]),
  },
];
const ENGINE_PI_PACKAGE = 'engine-pi';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yaml', '.yml']);
const IGNORED_DIRS = new Set(['dist', 'node_modules', 'coverage', '.turbo']);

const FORBIDDEN_PATTERNS = [
  { regex: /\.\.\/pi\b/g, reason: 'Pi checkout path leaked outside @popeye/engine-pi' },
  { regex: /(?:\.\/|\.\.\/|\/)external-pi(?:\/|\\|["'`])/g, reason: 'Pi checkout alias leaked outside @popeye/engine-pi' },
  { regex: /\b(?:join|resolve)\([^)\n]*['"`]external-pi['"`]/g, reason: 'Pi checkout alias leaked outside @popeye/engine-pi' },
  { regex: /packages\/coding-agent\b/g, reason: 'Pi internal package path leaked outside @popeye/engine-pi' },
  { regex: /packages\/ai\b/g, reason: 'Pi internal package path leaked outside @popeye/engine-pi' },
  { regex: /bin\/pi\.js\b/g, reason: 'Pi CLI path leaked outside @popeye/engine-pi' },
  { regex: /--mode rpc\b/g, reason: 'Pi RPC launch detail leaked outside @popeye/engine-pi' },
  { regex: /extension_ui_request\b/g, reason: 'Pi host-tool bridge detail leaked outside @popeye/engine-pi' },
  { regex: /extension_ui_response\b/g, reason: 'Pi host-tool bridge detail leaked outside @popeye/engine-pi' },
  { regex: /popeye\.runtime_tool\b/g, reason: 'Pi host-tool carrier leaked outside @popeye/engine-pi' },
];

function shouldScanFile(path) {
  const name = basename(path);
  for (const extension of SOURCE_EXTENSIONS) {
    if (name.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

function collectFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectFiles(fullPath, files);
      continue;
    }
    if (shouldScanFile(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

export function findPiBoundaryViolations(rootDir = process.cwd()) {
  const violations = [];

  for (const sourceRoot of SOURCE_ROOTS) {
    const directory = join(rootDir, sourceRoot.root);
    if (!existsSync(directory)) {
      continue;
    }

    if (sourceRoot.root === 'scripts') {
      for (const filePath of collectFiles(directory)) {
        if (sourceRoot.ignoreNames.has(basename(filePath))) {
          continue;
        }
        const content = readFileSync(filePath, 'utf8');
        for (const { regex, reason } of FORBIDDEN_PATTERNS) {
          regex.lastIndex = 0;
          let match;
          while ((match = regex.exec(content)) !== null) {
            violations.push({
              file: relative(rootDir, filePath),
              line: getLineNumber(content, match.index),
              reason,
              snippet: match[0],
            });
          }
        }
      }
      continue;
    }

    const packageNames = readdirSync(directory).filter((entry) => statSync(join(directory, entry)).isDirectory());
    for (const packageName of packageNames) {
      if (sourceRoot.ignoreNames.has(packageName) || (sourceRoot.root === 'packages' && packageName === ENGINE_PI_PACKAGE)) {
        continue;
      }

      const packageDir = join(directory, packageName);
      for (const filePath of collectFiles(packageDir)) {
        const content = readFileSync(filePath, 'utf8');
        for (const { regex, reason } of FORBIDDEN_PATTERNS) {
          regex.lastIndex = 0;
          let match;
          while ((match = regex.exec(content)) !== null) {
            violations.push({
              file: relative(rootDir, filePath),
              line: getLineNumber(content, match.index),
              reason,
              snippet: match[0],
            });
          }
        }
      }
    }
  }

  return violations;
}

function formatViolation(violation) {
  return `${violation.file}:${violation.line} — ${violation.reason} (${violation.snippet})`;
}

function main() {
  const violations = findPiBoundaryViolations(process.cwd());
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(formatViolation(violation));
    }
    throw new Error(`Pi boundary check failed with ${violations.length} violation(s)`);
  }
  console.info('Pi boundary check passed');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
