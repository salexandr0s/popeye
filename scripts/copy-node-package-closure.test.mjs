import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./copy-node-package-closure.mjs', import.meta.url));

describe('copy-node-package-closure', () => {
  it('copies only the runtime subset for packaged bootstrap dependencies', () => {
    const destinationRoot = mkdtempSync(join(tmpdir(), 'popeye-node-closure-'));
    try {
      execFileSync(process.execPath, [
        scriptPath,
        destinationRoot,
        'better-sqlite3',
        'pino',
        'sqlite-vec',
      ]);

      expect(existsSync(join(destinationRoot, 'better-sqlite3', 'package.json'))).toBe(true);
      expect(existsSync(join(destinationRoot, 'better-sqlite3', 'lib', 'index.js'))).toBe(true);
      expect(existsSync(join(destinationRoot, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'))).toBe(true);
      expect(existsSync(join(destinationRoot, 'pino', 'package.json'))).toBe(true);
      expect(existsSync(join(destinationRoot, 'pino', 'pino.js'))).toBe(true);
      expect(existsSync(join(destinationRoot, 'pino', 'lib', 'transport.js'))).toBe(true);
      expect(existsSync(join(destinationRoot, 'sqlite-vec', 'package.json'))).toBe(true);
      expect(existsSync(join(destinationRoot, 'sqlite-vec', 'index.cjs'))).toBe(true);

      expect(existsSync(join(destinationRoot, 'better-sqlite3', 'deps', 'sqlite3', 'sqlite3.c'))).toBe(false);
      expect(existsSync(join(destinationRoot, 'better-sqlite3', 'src', 'better_sqlite3.cpp'))).toBe(false);
      expect(existsSync(join(destinationRoot, 'pino', 'docs', 'api.md'))).toBe(false);
      expect(existsSync(join(destinationRoot, 'pino', 'test', 'basic.test.js'))).toBe(false);
      expect(existsSync(join(destinationRoot, 'pino', 'benchmarks', 'basic.bench.js'))).toBe(false);
      expect(existsSync(join(destinationRoot, 'pino', 'pino.d.ts'))).toBe(false);
      expect(existsSync(join(destinationRoot, 'sqlite-vec', 'README.md'))).toBe(false);
      expect(existsSync(join(destinationRoot, 'sqlite-vec', 'index.d.ts'))).toBe(false);
    } finally {
      rmSync(destinationRoot, { recursive: true, force: true });
    }
  });
});
