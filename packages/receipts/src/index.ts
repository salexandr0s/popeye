import type { ReceiptRecord } from '@popeye/contracts';

export { readReceiptArtifact, writeReceiptArtifact } from './receipt-artifacts.js';

export function renderReceipt(receipt: ReceiptRecord): string {
  return [
    `Receipt ${receipt.id}`,
    `Run: ${receipt.runId}`,
    `Status: ${receipt.status}`,
    `Summary: ${receipt.summary}`,
    `Provider: ${receipt.usage.provider}`,
    `Model: ${receipt.usage.model}`,
    `Tokens: ${receipt.usage.tokensIn}/${receipt.usage.tokensOut}`,
    `Estimated cost: $${receipt.usage.estimatedCostUsd.toFixed(4)}`,
  ].join('\n');
}
