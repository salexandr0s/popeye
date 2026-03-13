import { expect, test } from '@playwright/test';

test.describe('web inspector smoke', () => {
  test('dashboard loads with health status', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Healthy')).toBeVisible({ timeout: 5_000 });
  });

  test('navigates to runs page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Runs');
    await expect(page).toHaveURL(/\/runs/);
    await expect(page.locator('text=Runs')).toBeVisible();
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
});
