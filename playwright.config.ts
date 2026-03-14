import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3210',
    headless: true,
  },
  webServer: {
    command: 'pnpm --filter @popeye/web-inspector build && POPEYE_CONFIG_PATH=config/example.json pnpm exec tsx --tsconfig tsconfig.base.json apps/daemon/src/index.ts',
    url: 'http://127.0.0.1:3210/v1/health',
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
