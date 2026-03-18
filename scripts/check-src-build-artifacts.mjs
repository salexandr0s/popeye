import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['apps', 'packages'];
const BAD_SUFFIXES = ['.js', '.js.map', '.d.ts', '.d.ts.map'];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!fullPath.includes('/src/')) {
      continue;
    }
    if (BAD_SUFFIXES.some((suffix) => fullPath.endsWith(suffix))) {
      files.push(fullPath);
    }
  }
  return files;
}

const offenders = [];
for (const root of ROOTS) {
  try {
    if (!statSync(root).isDirectory()) {
      continue;
    }
  } catch {
    continue;
  }
  walk(root, offenders);
}

if (offenders.length > 0) {
  console.error('Source-adjacent build artifacts are not allowed. Remove these files:');
  for (const file of offenders.sort()) {
    console.error(` - ${relative(process.cwd(), file)}`);
  }
  process.exit(1);
}

console.log('No source-adjacent build artifacts found');
