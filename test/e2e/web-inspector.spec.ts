import { expect, test } from '@playwright/test';

test.describe('web inspector smoke', () => {
  test('dashboard shell loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Popeye' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 5_000 });
  });

  test('navigates to runs page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Runs');
    await expect(page).toHaveURL(/\/runs/);
    await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible();
  });

  test('navigates to receipts page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Receipts');
    await expect(page).toHaveURL(/\/receipts/);
  });

  test('navigates to memory search', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Memory');
    await expect(page).toHaveURL(/\/memory/);
  });

  test('browser bootstrap supports csrf-protected mutations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 5_000 });

    const result = await page.evaluate(async () => {
      const csrfResponse = await fetch('/v1/security/csrf-token', {
        credentials: 'same-origin',
      });
      const csrfBody = await csrfResponse.json() as { token: string };

      const forbidden = await fetch('/v1/tasks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({
          workspaceId: 'default',
          projectId: null,
          title: 'missing-csrf-task',
          prompt: 'hello',
          source: 'manual',
          autoEnqueue: false,
        }),
      });

      const accepted = await fetch('/v1/tasks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-popeye-csrf': csrfBody.token,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({
          workspaceId: 'default',
          projectId: null,
          title: 'browser-session-task',
          prompt: 'hello from e2e',
          source: 'manual',
          autoEnqueue: false,
        }),
      });

      return {
        csrfStatus: csrfResponse.status,
        forbiddenStatus: forbidden.status,
        acceptedStatus: accepted.status,
      };
    });

    expect(result.csrfStatus).toBe(200);
    expect(result.forbiddenStatus).toBe(403);
    expect(result.acceptedStatus).toBe(200);
  });
});
