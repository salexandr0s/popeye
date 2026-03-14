import { describe, expect, it } from 'vitest';

import type { ReceiptRecord } from '@popeye/contracts';
import { renderReceipt } from '@popeye/receipts';

function makeReceipt(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: 'receipt-001',
    runId: 'run-001',
    jobId: 'job-001',
    taskId: 'task-001',
    workspaceId: 'default',
    status: 'succeeded',
    summary: 'Run completed successfully',
    details: '',
    usage: {
      provider: 'fake',
      model: 'fake-engine',
      tokensIn: 1200,
      tokensOut: 800,
      estimatedCostUsd: 0.0042,
    },
    createdAt: '2026-03-13T12:00:00.000Z',
    ...overrides,
  };
}

describe('golden: receipt rendering', () => {
  it('succeeded receipt renders canonical format', () => {
    const receipt = makeReceipt();
    const rendered = renderReceipt(receipt);

    expect(rendered).toMatchInlineSnapshot(`
      "Receipt receipt-001
      Run: run-001
      Status: succeeded
      Summary: Run completed successfully
      Provider: fake
      Model: fake-engine
      Tokens: 1200/800
      Estimated cost: $0.0042"
    `);
  });

  it('failed receipt renders canonical format', () => {
    const receipt = makeReceipt({
      id: 'receipt-002',
      runId: 'run-002',
      status: 'failed',
      summary: 'Run failed: permanent engine error',
      usage: {
        provider: 'pi',
        model: 'external-pi',
        tokensIn: 500,
        tokensOut: 0,
        estimatedCostUsd: 0.0015,
      },
    });
    const rendered = renderReceipt(receipt);

    expect(rendered).toMatchInlineSnapshot(`
      "Receipt receipt-002
      Run: run-002
      Status: failed
      Summary: Run failed: permanent engine error
      Provider: pi
      Model: external-pi
      Tokens: 500/0
      Estimated cost: $0.0015"
    `);
  });

  it('cancelled receipt renders canonical format', () => {
    const receipt = makeReceipt({
      id: 'receipt-003',
      runId: 'run-003',
      status: 'cancelled',
      summary: 'Run cancelled',
      usage: {
        provider: 'fake',
        model: 'fake-engine',
        tokensIn: 300,
        tokensOut: 100,
        estimatedCostUsd: 0.001,
      },
    });
    const rendered = renderReceipt(receipt);

    expect(rendered).toMatchInlineSnapshot(`
      "Receipt receipt-003
      Run: run-003
      Status: cancelled
      Summary: Run cancelled
      Provider: fake
      Model: fake-engine
      Tokens: 300/100
      Estimated cost: $0.0010"
    `);
  });

  it('zero-usage receipt renders $0.0000', () => {
    const receipt = makeReceipt({
      id: 'receipt-004',
      runId: 'run-004',
      status: 'succeeded',
      summary: 'No-op run',
      usage: {
        provider: 'fake',
        model: 'fake-engine',
        tokensIn: 0,
        tokensOut: 0,
        estimatedCostUsd: 0,
      },
    });
    const rendered = renderReceipt(receipt);

    expect(rendered).toMatchInlineSnapshot(`
      "Receipt receipt-004
      Run: run-004
      Status: succeeded
      Summary: No-op run
      Provider: fake
      Model: fake-engine
      Tokens: 0/0
      Estimated cost: $0.0000"
    `);
  });
});
