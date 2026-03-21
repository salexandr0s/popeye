import { expect, test } from '@playwright/test';
import { unlockInspector } from './helpers';

test.describe('web inspector smoke', () => {
  test('dashboard shell loads', async ({ page }) => {
    await unlockInspector(page);
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 5_000 });
  });

  test('navigates to runs page', async ({ page }) => {
    await unlockInspector(page);
    await page.getByRole('link', { name: 'Runs' }).click();
    await expect(page).toHaveURL(/\/runs/);
    await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible();
  });

  test('navigates to receipts page', async ({ page }) => {
    await unlockInspector(page);
    await page.getByRole('link', { name: 'Receipts' }).click();
    await expect(page).toHaveURL(/\/receipts/);
  });

  test('navigates to memory search', async ({ page }) => {
    await unlockInspector(page);
    await page.getByRole('link', { name: 'Memory' }).click();
    await expect(page).toHaveURL(/\/memory/);
  });

  // Smoke tests: verify every major view renders without errors
  const viewRoutes = [
    { link: 'Command Center', url: /\/command-center/ },
    { link: 'Jobs', url: /\/jobs/ },
    { link: 'Instructions', url: /\/instructions/ },
    { link: 'Interventions', url: /\/interventions/ },
    { link: 'Approvals', url: /\/approvals/ },
    { link: 'Standing Approvals', url: /\/standing-approvals/ },
    { link: 'Automation Grants', url: /\/automation-grants/ },
    { link: 'Connections', url: /\/connections/ },
    { link: 'Email', url: /\/email/ },
    { link: 'Calendar', url: /\/calendar/ },
    { link: 'GitHub', url: /\/github/ },
    { link: 'People', url: /\/people/ },
    { link: 'Todos', url: /\/todos/ },
    { link: 'Finance', url: /\/finance/ },
    { link: 'Medical', url: /\/medical/ },
    { link: 'Files', url: /\/files/ },
    { link: 'Vaults', url: /\/vaults/ },
    { link: 'Security Policy', url: /\/security-policy/ },
    { link: 'Usage', url: /\/usage/ },
  ];

  for (const { link, url } of viewRoutes) {
    test(`navigates to ${link} view`, async ({ page }) => {
      await unlockInspector(page);
      await page.getByRole('link', { name: link, exact: true }).click();
      await expect(page).toHaveURL(url);
      // Verify the error boundary did not trigger
      await expect(page.getByText('Something went wrong')).toBeHidden({ timeout: 3_000 });
    });
  }

  test('browser bootstrap supports csrf-protected mutations', async ({ page }) => {
    await unlockInspector(page);

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
