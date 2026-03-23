import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Page } from '@playwright/test';

type ExampleConfig = {
  authFile: string;
};

type AuthStoreFile = {
  current?: { token?: string };
  roles?: {
    operator?: {
      current?: { token?: string };
    };
  };
};

function readExampleConfig(): ExampleConfig {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'config/example.json'), 'utf8')) as ExampleConfig;
}

function readOperatorTokenFromStore(): string {
  const { authFile } = readExampleConfig();
  const store = JSON.parse(readFileSync(authFile, 'utf8')) as AuthStoreFile;
  const token = store.roles?.operator?.current?.token ?? store.current?.token;
  if (!token) {
    throw new Error(`Operator token missing from auth store at ${authFile}`);
  }
  return token;
}

export async function waitForOperatorToken(): Promise<string> {
  const { authFile } = readExampleConfig();
  await expect
    .poll(() => existsSync(authFile), {
      timeout: 5_000,
      message: `Expected auth store at ${authFile}`,
    })
    .toBe(true);

  return readOperatorTokenFromStore();
}

export async function unlockInspector(page: Page): Promise<string> {
  const token = await waitForOperatorToken();

  // Verify the daemon is responsive before loading the SPA
  const healthResponse = await page.request.get('/v1/health');
  if (!healthResponse.ok()) {
    throw new Error(`Daemon health check failed: ${healthResponse.status()} ${healthResponse.statusText()}`);
  }

  const response = await page.goto('/', { waitUntil: 'load' });
  if (!response || !response.ok()) {
    const status = response?.status() ?? 'no response';
    throw new Error(`page.goto('/') failed with status ${status}`);
  }

  // Wait for the React app to boot and show the unlock modal.
  // If the heading doesn't appear, capture page state for diagnostics.
  const heading = page.getByRole('heading', { name: 'Unlock Popeye Inspector' });
  try {
    await expect(heading).toBeVisible({ timeout: 15_000 });
  } catch {
    // Capture diagnostic info before re-throwing
    const bodyText = await page.locator('body').innerText().catch(() => '<failed to read body>');
    const title = await page.title().catch(() => '<failed to read title>');
    const url = page.url();
    throw new Error(
      `Unlock heading not found after 15s.\n` +
      `  URL: ${url}\n` +
      `  Title: ${title}\n` +
      `  Body text (first 500 chars): ${bodyText.slice(0, 500)}`,
    );
  }

  await page.getByLabel('Operator bearer token').fill(token);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByRole('heading', { name: 'Unlock Popeye Inspector' })).toBeHidden({
    timeout: 5_000,
  });
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
    timeout: 5_000,
  });

  return token;
}
