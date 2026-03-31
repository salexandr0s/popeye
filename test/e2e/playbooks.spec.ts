import { expect, test } from '@playwright/test';

import {
  createE2eId,
  readSeededPlaybook,
  seedGlobalPlaybook,
  seedPlaybookUsageSignals,
  unlockInspector,
  waitForAppDb,
} from './helpers';

test.describe('playbook inspector e2e', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppDb();
    await unlockInspector(page);
  });

  test('create draft proposal from the inspector', async ({ page }) => {
    const playbookId = createE2eId('draft-playbook');
    const title = `E2E Draft ${playbookId}`;

    await page.goto('/playbooks', { waitUntil: 'load' });
    await page.getByRole('link', { name: 'New playbook proposal' }).click();

    await expect(page).toHaveURL(/\/playbook-proposals\/new\?kind=draft/);
    await page.getByLabel('Playbook ID').fill(playbookId);
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Summary').fill('Create a new global operator procedure for E2E coverage.');
    await page.getByLabel('Body').fill('Step 1: inspect the queue.\nStep 2: file a receipt.\nStep 3: close the loop.');
    await page.getByRole('button', { name: 'Create proposal' }).click();

    await expect(page).toHaveURL(/\/playbook-proposals\/[^/]+$/);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('pending review')).toBeVisible();
    await expect(page.getByText('new draft')).toBeVisible();
  });

  test('create a patch proposal for a canonical playbook', async ({ page }) => {
    const seeded = seedGlobalPlaybook({
      id: createE2eId('patch-playbook'),
      title: `E2E Patch ${createE2eId('title')}`,
      body: 'Original procedure body.\nKeep it deterministic.',
    });

    await page.goto(`/playbooks/${encodeURIComponent(seeded.recordId)}`, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { name: seeded.title })).toBeVisible();

    await page.getByRole('link', { name: 'Propose patch' }).click();
    await expect(page).toHaveURL(/\/playbook-proposals\/new\?kind=patch/);

    await expect(page.getByText(seeded.recordId)).toBeVisible();
    await page.getByLabel('Summary').fill('Patch the canonical follow-up steps from the inspector.');
    await page.getByLabel('Body').fill(`${seeded.body}\nStep 3: capture an explicit audit note.`);
    await page.getByRole('button', { name: 'Create proposal' }).click();

    await expect(page).toHaveURL(/\/playbook-proposals\/[^/]+$/);
    await expect(page.getByText('pending review')).toBeVisible();
    await expect(page.locator('pre').filter({ hasText: 'Step 3: capture an explicit audit note.' }).first()).toBeVisible();
  });

  test('suggests a drafting patch from stale run evidence', async ({ page }) => {
    const seeded = seedGlobalPlaybook({
      id: createE2eId('stale-playbook'),
      title: `E2E Stale ${createE2eId('title')}`,
      body: 'Investigate stale procedures.\nEscalate when the evidence is repeated.',
    });

    await page.goto(`/playbooks/${encodeURIComponent(seeded.recordId)}`, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { name: seeded.title })).toBeVisible();

    const seededSignals = seedPlaybookUsageSignals({
      recordId: seeded.recordId,
      playbookId: seeded.id,
      title: seeded.title,
    });

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByText('Needs review')).toBeVisible();
    await page.getByRole('button', { name: 'Suggest patch from recent failures' }).click();

    await expect(page).toHaveURL(/\/playbook-proposals\/[^/]+$/);
    await expect(page.getByRole('heading', { name: seeded.title })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Edit drafting proposal' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible();
    await expect(page.getByRole('link', { name: seededSignals.runIds[0] })).toBeVisible();
    if (seededSignals.interventionIds.length > 0) {
      await expect(page.getByText(seededSignals.interventionIds[0])).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Submit for review' })).toBeVisible();
  });

  test('approves and applies a patch proposal back to the canonical file', async ({ page }) => {
    const seeded = seedGlobalPlaybook({
      id: createE2eId('apply-playbook'),
      title: `E2E Apply ${createE2eId('title')}`,
      body: 'Original apply body.\nDo not skip the receipt.',
    });

    await page.goto(`/playbooks/${encodeURIComponent(seeded.recordId)}`, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { name: seeded.title })).toBeVisible();

    await page.getByRole('link', { name: 'Propose patch' }).click();
    await page.getByLabel('Summary').fill('Add a final audit checkpoint before the run closes.');
    await page.getByLabel('Body').fill(`${seeded.body}\nFinal step: attach the audit checkpoint.`);
    await page.getByRole('button', { name: 'Create proposal' }).click();

    await expect(page.getByText('pending review')).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('approved')).toBeVisible();

    await page.getByRole('button', { name: 'Apply to canonical file' }).click();
    await expect
      .poll(() => readSeededPlaybook(seeded.filePath))
      .toContain('Final step: attach the audit checkpoint.');
  });

  test('filters canonical playbooks with the server-side q search', async ({ page }) => {
    const matching = seedGlobalPlaybook({
      id: createE2eId('query-match'),
      title: 'Searchable E2E Playbook',
      body: 'Look for the search needle in canonical playbook search.',
    });
    const nonMatching = seedGlobalPlaybook({
      id: createE2eId('query-other'),
      title: 'Background Control Playbook',
      body: 'This playbook should disappear once the query is applied.',
    });

    await page.goto('/playbooks', { waitUntil: 'load' });

    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === 'GET'
      && response.url().includes('/v1/playbooks?')
      && response.url().includes(`q=${encodeURIComponent(matching.id)}`),
    );

    await page.getByLabel('Search').fill(matching.id);
    await responsePromise;

    await expect(page.getByRole('link', { name: matching.title })).toBeVisible();
    await expect(page.getByRole('link', { name: nonMatching.title })).toBeHidden();
  });
});
