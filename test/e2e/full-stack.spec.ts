import { expect, test } from '@playwright/test';
import { unlockInspector } from './helpers';

test.describe('full-stack daemon e2e (fake engine)', () => {
  let csrfToken: string;

  test.beforeEach(async ({ page }) => {
    await unlockInspector(page);

    const bootstrap = await page.evaluate(async () => {
      const csrfResponse = await fetch('/v1/security/csrf-token', {
        credentials: 'same-origin',
      });
      const csrfBody = await csrfResponse.json() as { token: string };
      return {
        csrfStatus: csrfResponse.status,
        csrfToken: csrfBody.token,
      };
    });

    expect(bootstrap.csrfStatus).toBe(200);
    expect(bootstrap.csrfToken).toBeTruthy();
    csrfToken = bootstrap.csrfToken;
  });

  test('full task lifecycle: create -> poll jobs -> receipt -> run events', async ({ page }) => {
    // Step 1: POST /v1/tasks with autoEnqueue: true
    const createResult = await page.evaluate(async (csrf: string) => {
      const response = await fetch('/v1/tasks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-popeye-csrf': csrf,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({
          workspaceId: 'default',
          projectId: null,
          title: 'e2e-full-stack-test',
          prompt: 'hello from full-stack e2e',
          source: 'manual',
          autoEnqueue: true,
        }),
      });
      return {
        status: response.status,
        body: await response.json() as {
          task: { id: string };
          job: { id: string } | null;
        },
      };
    }, csrfToken);

    expect(createResult.status).toBe(200);
    expect(createResult.body.task.id).toBeTruthy();
    expect(createResult.body.job).toBeTruthy();
    const jobId = createResult.body.job!.id;
    const taskId = createResult.body.task.id;

    // Step 2: Poll GET /v1/jobs until terminal state
    const terminalJob = await page.evaluate(async (jid: string) => {
      const terminalStates = new Set(['succeeded', 'failed_final', 'cancelled']);
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const response = await fetch(`/v1/jobs/${jid}`, {
          credentials: 'same-origin',
        });
        if (response.status !== 200) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        const job = await response.json() as { id: string; status: string; lastRunId: string | null };
        if (terminalStates.has(job.status)) {
          return job;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    }, jobId);

    expect(terminalJob).not.toBeNull();
    expect(terminalJob!.status).toBe('succeeded');
    expect(terminalJob!.lastRunId).toBeTruthy();
    const runId = terminalJob!.lastRunId!;

    // Step 3: Verify receipt exists via GET /v1/receipts
    const receiptsResult = await page.evaluate(async () => {
      const response = await fetch('/v1/receipts', { credentials: 'same-origin' });
      return {
        status: response.status,
        body: await response.json() as Array<{
          id: string;
          runId: string;
          taskId: string;
          status: string;
        }>,
      };
    });

    expect(receiptsResult.status).toBe(200);
    const matchingReceipt = receiptsResult.body.find((r) => r.runId === runId);
    expect(matchingReceipt).toBeTruthy();
    expect(matchingReceipt!.status).toBe('succeeded');
    expect(matchingReceipt!.taskId).toBe(taskId);

    // Step 4: Verify run events via GET /v1/runs/{id}/events
    const eventsResult = await page.evaluate(async (rid: string) => {
      const response = await fetch(`/v1/runs/${rid}/events`, {
        credentials: 'same-origin',
      });
      return {
        status: response.status,
        body: await response.json() as Array<{
          id: string;
          runId: string;
          type: string;
        }>,
      };
    }, runId);

    expect(eventsResult.status).toBe(200);
    expect(eventsResult.body.length).toBeGreaterThanOrEqual(1);
    expect(eventsResult.body.every((e) => e.runId === runId)).toBe(true);
    // The fake engine emits at least a 'started' event
    expect(eventsResult.body.some((e) => e.type === 'started')).toBe(true);
  });
});
