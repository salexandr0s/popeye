import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const root = process.cwd();
const ignores = new Set(['node_modules', '.git', 'dist', 'coverage', '.vitest-coverage']);
const patterns = [
  /sk-[A-Za-z0-9]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._-]{20,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-ant-[A-Za-z0-9-]{20,}/g,
  /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_/]+/g,
];

function isSkippedFile(path) {
  const name = basename(path);
  return name.endsWith('.test.ts')
    || name.endsWith('.spec.ts')
    || name.endsWith('.test.tsx')
    || name.endsWith('.spec.tsx')
    || name.endsWith('.md')
    || hasGeneratedSourceSibling(path);
}

function hasGeneratedSourceSibling(path) {
  const sourcePath = getGeneratedSourceSibling(path);
  return sourcePath !== null && existsSync(sourcePath);
}

function getGeneratedSourceSibling(path) {
  const dir = dirname(path);
  const name = basename(path);

  const candidates = [];
  if (name.endsWith('.js.map')) {
    const stem = name.slice(0, -'.js.map'.length);
    candidates.push(join(dir, `${stem}.ts`), join(dir, `${stem}.tsx`));
  } else if (name.endsWith('.d.ts.map')) {
    const stem = name.slice(0, -'.d.ts.map'.length);
    candidates.push(join(dir, `${stem}.ts`), join(dir, `${stem}.tsx`));
  } else if (name.endsWith('.d.ts')) {
    const stem = name.slice(0, -'.d.ts'.length);
    candidates.push(join(dir, `${stem}.ts`), join(dir, `${stem}.tsx`));
  } else if (name.endsWith('.js')) {
    const stem = name.slice(0, -'.js'.length);
    candidates.push(join(dir, `${stem}.ts`), join(dir, `${stem}.tsx`));
  } else {
    return null;
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function walk(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (ignores.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (isSkippedFile(full)) {
      continue;
    }
    const text = readFileSync(full, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        throw new Error(`Potential secret found in ${full}`);
      }
    }
  }
}

walk(root);
console.info('Secret scan passed');
