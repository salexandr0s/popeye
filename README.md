<p align="center">
  <img
    src="https://github.com/user-attachments/assets/77bbf39b-d279-4b5a-a427-aab4eb640ecf"
    alt="Popeye logo"
    width="260"
  />
</p>

<h1 align="center">Popeye</h1>

<p align="center">
  A local-first, always-on personal agent runtime.
</p>

<p align="center">
  Built on Pi. Operated by one person. Designed for continuity, auditability, and control.
</p>

---

## Overview

Popeye is a long-lived personal agent platform for a single operator.

**Pi is the engine. Popeye is the product.** Popeye adds the runtime,
orchestration, memory, receipts, policy, and control surfaces needed to run a
personal agent continuously and safely on infrastructure you own.

It is intentionally opinionated:

- **local-first** rather than cloud-first
- **single-operator** rather than multi-tenant
- **auditable** rather than opaque
- **deliberate** rather than platform-sprawl-driven

Popeye is not trying to recreate OpenClaw wholesale, become a general-purpose
SaaS, or hide autonomous behavior behind weak operational controls.

## What Popeye includes

Today the repository contains the core pieces of the platform:

- **daemon runtime** for scheduling, heartbeats, runs, receipts, recovery, and
  supervision
- **loopback-only control API** with token auth, CSRF protection on mutations,
  and explicit route authorization
- **CLI (`pop`)** for operator workflows
- **web inspector** for runtime visibility
- **blessed browser-OAuth connect flows** for Gmail, Google Calendar, and
  GitHub
- **blessed Todoist manual-token connect flow** for todos
- **derived-first People graph** with Gmail / Calendar / GitHub identity
  projection plus operator merge/split/edit workflows
- **structured memory system** with SQLite, FTS5, sqlite-vec, provenance, and
  promotion-managed curated memory
- **capability packages** for files, email, calendar, GitHub, todos, and people
- **Telegram bridge** implemented as a thin control-plane adapter

## Design principles

- **Ownership first** — runtime state, policy, and operational records stay
  under operator control
- **Hard boundaries** — Pi stays behind `@popeye/engine-pi`; UI stays behind
  the control API
- **Security by default** — loopback-only API, auth token required, CSRF on
  mutations, redaction before durable writes
- **Receipts and visibility** — every run leaves durable evidence, including
  failures and cancellations
- **Memory with provenance** — durable recall is explainable, location-aware,
  and operator-governed
- **Boring upgrades** — deliberate, testable change over incidental complexity

## Architecture at a glance

Popeye is organized into three layers:

1. **Pi layer** — engine capabilities: model/provider abstraction, agent loop,
   sessions, tool calling, event streaming
2. **Popeye runtime** — product semantics: daemon lifecycle, scheduling,
   instruction resolution, memory, receipts, audit, security, control API
3. **Interfaces** — replaceable operator surfaces: CLI, Telegram bridge, web
   inspector, generated clients

## Repository layout

```text
apps/
  cli/              pop operator CLI
  daemon/           runtime daemon entrypoint
  web-inspector/    React-based control-plane UI

packages/
  engine-pi/        the only Pi integration boundary
  runtime-core/     daemon/runtime orchestration and policy
  control-api/      Fastify control plane
  memory/           durable memory system and retrieval
  instructions/     instruction resolution
  receipts/         receipt creation and rendering
  contracts/        shared Zod/API contracts
  api-client/       typed client for the control API
  telegram/         thin Telegram adapter
  cap-*/            bounded capability packages
```

## Security model

Popeye is designed as a local control plane, not a remote service:

- API binds to **`127.0.0.1` only**
- **auth token required** on every route
- **browser sessions are operator-only**
- **CSRF protection** is enforced on state-changing routes
- **secrets are redacted before durable writes**
- runtime data is stored outside the workspace

## Memory model

Popeye uses a layered memory system:

- **legacy compatibility layer** in `memories`
- **structured durable memory** via artifacts, facts, and syntheses
- **curated markdown memory** for explicit operator-managed long-term context

Durable recall is:

- provenance-aware
- confidence-scored
- location-aware (`workspaceId` / `projectId`)
- explainable with evidence links

See:

- [`docs/memory-model.md`](docs/memory-model.md)
- [`docs/domain-model.md`](docs/domain-model.md)

## Getting started

### Prerequisites

- Node.js **22 LTS**
- `pnpm`
- macOS is the primary supported operator environment today

### Install

```bash
pnpm install
```

### Core verification

```bash
pnpm typecheck
pnpm test
pnpm verify:pi-boundary
pnpm verify:src-build-artifacts
pnpm dev-verify
```

### Bootstrap

For full setup, configuration, auth initialization, and Pi integration, use:

- [`docs/runbooks/bootstrap.md`](docs/runbooks/bootstrap.md)

Notes:

- `config/example.json` defaults to a fake engine for local development
- real Pi-backed runs expect a sibling `../pi` checkout unless configured
  otherwise

## Documentation

- [`docs/control-api.md`](docs/control-api.md) — control-plane routes and auth
- [`docs/api-contracts.md`](docs/api-contracts.md) — contract behavior notes
- [`docs/current-state-matrix.md`](docs/current-state-matrix.md) — canonical repo-truth snapshot
- [`docs/fully-polished-release-gate.md`](docs/fully-polished-release-gate.md) — acceptance bar for the polished product state
- [`docs/memory-model.md`](docs/memory-model.md) — memory architecture
- [`docs/domain-model.md`](docs/domain-model.md) — runtime entities and
  relationships
- [`docs/runbooks/bootstrap.md`](docs/runbooks/bootstrap.md) — installation and
  bootstrap

## Status

Popeye is under active development, but the architecture direction is stable:

- Pi remains the engine boundary
- the runtime remains local-first and operator-owned
- the API remains loopback-only and authenticated
- Gmail, Google Calendar, GitHub, and Todoist now have blessed operator connect
  paths; People is now a first-class derived identity graph
- the web inspector remains the primary required GUI; the native macOS client
  is deferred for the current polished bar

The goal is not maximum surface area. The goal is a dependable personal agent
that can stay on, stay inspectable, and become more useful over time without
losing operational discipline.
