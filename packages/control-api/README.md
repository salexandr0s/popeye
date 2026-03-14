# @popeye/control-api

Fastify HTTP control API for the Popeye runtime. The single network surface
through which all clients (CLI, web inspector, Telegram adapter, macOS app)
interact with the runtime.

## Purpose

Mounts versioned REST endpoints on a Fastify server, enforcing bearer token
authentication on every request and CSRF protection (token + Sec-Fetch-Site
validation) on all state-changing mutations. Provides SSE streaming for
real-time event delivery. Contains no business logic -- all operations delegate
to `PopeyeRuntimeService`.

## Layer

Interface. HTTP surface over the runtime; no business logic of its own.

## Provenance

New platform implementation.

## Key exports

| Export                | Description                                        |
| --------------------- | -------------------------------------------------- |
| `createControlApi()`  | Build and configure the Fastify server instance    |
| `ControlApiDependencies` | Input type requiring a `PopeyeRuntimeService`   |

## Endpoints (~30 routes)

| Area           | Routes                                                       |
| -------------- | ------------------------------------------------------------ |
| Health         | `GET /v1/health`, `GET /v1/status`                           |
| Daemon         | `GET /v1/daemon/state`, `GET /v1/daemon/scheduler`           |
| Resources      | `GET /v1/workspaces`, `GET /v1/projects`, `GET /v1/agent-profiles` |
| Tasks          | `GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/tasks`      |
| Jobs           | `GET /v1/jobs`, `POST /v1/jobs/:id/pause|resume|enqueue`     |
| Runs           | `GET /v1/runs`, `GET /v1/runs/:id`, `POST /v1/runs/:id/retry|cancel` |
| Receipts       | `GET /v1/receipts`, `GET /v1/receipts/:id`                   |
| Instructions   | `GET /v1/instruction-previews/:scope`                        |
| Interventions  | `GET /v1/interventions`, `POST /v1/interventions/:id/resolve`|
| Memory         | `GET /v1/memory/search`, `GET /v1/memory`, `GET /v1/memory/:id`, `GET /v1/memory/audit`, `POST /v1/memory/maintenance`, `POST /v1/memory/:id/promote/propose`, `POST /v1/memory/:id/promote/execute` |
| Messages       | `POST /v1/messages/ingest`, `GET /v1/messages/:id`           |
| Security       | `GET /v1/security/audit`, `GET /v1/security/csrf-token`      |
| Usage          | `GET /v1/usage/summary`                                      |
| Events         | `GET /v1/events/stream` (SSE)                                |

## Dependencies

- `@popeye/contracts` -- Zod schemas for request/response validation
- `@popeye/runtime-core` -- `PopeyeRuntimeService` and auth utilities
- `fastify` -- HTTP framework
- `@fastify/sensible` -- error handling utilities

## Usage

```ts
import { createControlApi } from '@popeye/control-api';

const app = await createControlApi({ runtime });
await app.listen({ host: '127.0.0.1', port: 18789 });
```

See `src/index.test.ts`, `src/contract.test.ts`, `src/csrf.test.ts`,
`src/sec-fetch.test.ts`, and `src/sse.test.ts` for API contract and
security enforcement tests.

### Memory promotion

The memory API includes a two-step promotion flow:

1. `POST /v1/memory/:id/promote/propose` with `{ targetPath }`
2. Review the returned `{ memoryId, targetPath, diff, approved, promoted }`
3. `POST /v1/memory/:id/promote/execute` with the approved payload

Promotion routes are covered by contract and behavior tests in
`src/contract.test.ts` and `src/index.test.ts`.
