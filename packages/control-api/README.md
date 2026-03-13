# @popeye/control-api

Fastify HTTP control API for the Popeye runtime. Binds to loopback only
(127.0.0.1), requires bearer token authentication on every endpoint, and
enforces CSRF protection on all state-changing mutations. Provides SSE
streaming for real-time event delivery.

## Key exports

- `createControlApi(runtime, options)` -- build and configure the Fastify server

## Endpoints (~33 routes)

Health, tasks, jobs, runs, receipts, instructions, interventions, messages
(including Telegram ingress), usage/cost, security audit, and SSE event streams.

## Dependencies

- `@popeye/contracts`
- `@popeye/runtime-core`
- `fastify`
- `@fastify/sensible`

## Layer

Interface. HTTP surface over the runtime; no business logic of its own.
