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

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Unlock Popeye Inspector' })).toBeVisible({
    timeout: 5_000,
  });

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
