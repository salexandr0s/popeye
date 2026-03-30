# @popeye/api-client

Type-safe HTTP client for the Popeye control API. Used by the CLI and any other
client that communicates with the running daemon over HTTP.

## Purpose

Provides `PopeyeApiClient`, a typed wrapper around the control API's REST
endpoints. Handles bearer token authentication, automatic CSRF token acquisition
for mutations, Sec-Fetch-Site headers, and Zod-validated response parsing. Also
supports SSE event stream subscription for real-time updates.

## Layer

Interface. Client-side HTTP layer; no business logic.

## Provenance

New platform implementation.

## Key exports

| Export                    | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `PopeyeApiClient`         | Main client class with typed methods for all endpoints |
| `PopeyeApiClientOptions`  | Configuration: `{ baseUrl, token }`                   |
| `ApiError`                | Error class with HTTP status code                     |

### Client methods

- `health()`, `status()`, `daemonState()`, `schedulerStatus()`
- `listTasks()`, `getTask()`, `createTask()`
- `listJobs()`, `getJobLease()`, `pauseJob()`, `resumeJob()`, `enqueueJob()`
- `listRuns()`, `getRun()`, `listRunEvents()`, `retryRun()`, `cancelRun()`
- `listReceipts()`, `getReceipt()`
- `searchRecall()`, `getRecallDetail()`
- `getInstructionPreview()`, `listInterventions()`, `resolveIntervention()`
- `searchMemory()`, `usageSummary()`, `securityAudit()`
- `subscribeEvents()` -- SSE stream subscription returning an unsubscribe function

## Dependencies

- `@popeye/contracts` -- Zod schemas for response validation

## Usage

```ts
import { PopeyeApiClient } from '@popeye/api-client';

const client = new PopeyeApiClient({ baseUrl: 'http://127.0.0.1:18789', token: '...' });
const health = await client.health();
const tasks = await client.listTasks();
const receipt = await client.getReceipt('receipt-id');
```

See `src/client.test.ts` for integration tests against a live control API.
