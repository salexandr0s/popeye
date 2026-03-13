import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const root = process.cwd();
const ignores = new Set(['node_modules', '.git', 'dist', 'coverage']);
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
  return name.endsWith('.test.ts') || name.endsWith('.spec.ts') || name.endsWith('.md');
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
