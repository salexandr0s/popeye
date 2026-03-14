import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  noExternal: [/@popeye\//],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
});
