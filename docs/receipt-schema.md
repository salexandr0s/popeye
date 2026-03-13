# Receipt schema

Every stored receipt includes:
- `id`
- `runId`
- `jobId`
- `taskId`
- `workspaceId`
- `status`
- `summary`
- `details`
- `usage.provider`
- `usage.model`
- `usage.tokensIn`
- `usage.tokensOut`
- `usage.estimatedCostUsd`
- `createdAt`

Receipts are persisted in:
- `app.db` (`receipts` table)
- `receipts/by-run/<receiptId>.json`
