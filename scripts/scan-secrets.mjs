import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const root = process.cwd();
const ignores = new Set(['node_modules', '.git', 'dist', 'coverage', '.vitest-coverage', '.turbo']);
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
const inlineAllowMarker = 'secret-scan: allow';

function isSkippedFile(path) {
  const name = basename(path);
  return name.endsWith('.png')
    || name.endsWith('.jpg')
    || name.endsWith('.jpeg')
    || name.endsWith('.gif')
    || name.endsWith('.ico')
    || name.endsWith('.pdf')
    || name.endsWith('.zip')
    || name.endsWith('.sqlite')
    || name.endsWith('.db')
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
      const match = pattern.exec(text);
      if (!match) {
        continue;
      }
      const beforeMatch = text.slice(0, match.index);
      const lineIndex = beforeMatch.split('\n').length - 1;
      const lines = text.split('\n');
      const line = lines[lineIndex] ?? '';
      if (line.includes(inlineAllowMarker)) {
        continue;
      }
      throw new Error(`Potential secret found in ${relative(root, full)}:${lineIndex + 1}`);
    }
  }
}

walk(root);
console.info('Secret scan passed');
