import { defineConfig } from 'tsup';

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
});
