import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

function getBuildMetadata() {
  const pkg = JSON.parse(readFileSync('../../package.json', 'utf-8'));
  let gitSha = '';
  try { gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim(); } catch { /* no git */ }
  return {
    version: pkg.version ?? '0.1.0-dev',
    gitSha,
    buildDate: new Date().toISOString().slice(0, 10),
  };
}

const meta = getBuildMetadata();

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  noExternal: [/@popeye\//],
  external: ['better-sqlite3', 'sqlite-vec', 'pino'],
  sourcemap: true,
  define: {
    'process.env.POPEYE_VERSION': JSON.stringify(meta.version),
    'process.env.POPEYE_GIT_SHA': JSON.stringify(meta.gitSha),
    'process.env.POPEYE_BUILD_DATE': JSON.stringify(meta.buildDate),
  },
});
