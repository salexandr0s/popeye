import { describe, expect, it } from 'vitest';

import type { ReceiptRecord } from '@popeye/contracts';

import { renderReceipt } from './render-receipt.js';

const baseReceipt: ReceiptRecord = {
  id: 'receipt-1',
  runId: 'run-1',
  jobId: 'job-1',
  taskId: 'task-1',
  workspaceId: 'ws-1',
  status: 'succeeded',
  summary: 'Test completed',
  details: 'All good',
  usage: {
    provider: 'fake',
    model: 'test-model',
    tokensIn: 100,
    tokensOut: 50,
    estimatedCostUsd: 0.05,
  },
  createdAt: '2025-01-01T00:00:00Z',
};

describe('renderReceipt', () => {
  it('renders receipt ID, run ID, status, and summary', () => {
    const output = renderReceipt(baseReceipt);
    expect(output).toContain('Receipt receipt-1');
    expect(output).toContain('Run: run-1');
    expect(output).toContain('Status: succeeded');
    expect(output).toContain('Summary: Test completed');
  });

  it('formats token counts as tokensIn/tokensOut', () => {
    const output = renderReceipt(baseReceipt);
    expect(output).toContain('Tokens: 100/50');
  });

  it('formats cost to 4 decimal places', () => {
    const output = renderReceipt(baseReceipt);
    expect(output).toContain('$0.0500');
  });

  it('handles zero-cost receipt', () => {
    const zeroCostReceipt: ReceiptRecord = {
      ...baseReceipt,
      usage: { ...baseReceipt.usage, estimatedCostUsd: 0 },
    };
    const output = renderReceipt(zeroCostReceipt);
    expect(output).toContain('$0.0000');
  });
});
