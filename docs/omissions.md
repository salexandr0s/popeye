# Deliberate Omissions

Features and patterns that were explicitly excluded from Popeye. Each omission has a rationale. Revisiting any of these requires an ADR.

## From OpenClaw

### Channel ecosystems

OpenClaw supports multiple messaging channels (Slack, Discord, etc.) through a broad channel abstraction. Popeye deliberately omits this. The Telegram adapter is a thin bridge to the control API, not a channel framework. Adding a new interface means writing a new thin bridge, not extending a channel system.

### Media pipelines

OpenClaw includes media processing (image, audio, video pipelines). Popeye has no media pipeline. If media handling is needed, it should be scoped narrowly and added as a runtime tool, not a subsystem.

### Node/device/pairing systems

OpenClaw supports multi-device registration and pairing flows. Popeye is a single-operator, single-machine platform. There is no device registration, no pairing, and no multi-tenant identity.

### Plugin marketplaces

OpenClaw supports a plugin ecosystem with discovery and installation. Popeye uses a fixed set of runtime tools. Extensions are added by modifying the codebase, not by installing plugins.

### Gateway-wide routing abstractions

OpenClaw routes messages through a gateway with routing rules. Popeye routes everything through the control API with workspace scoping. There is no gateway abstraction.

### Donor UI stack

OpenClaw's UI components and patterns are not ported. Popeye interfaces (CLI, web inspector, Swift client) are built independently against the control API.

### Donor config schemas

OpenClaw config shapes are not used as Popeye's canonical config. Popeye uses its own `AppConfigSchema` validated with Zod at startup.

## From broader scope

### Remote API access

The control API binds to `127.0.0.1` only. No remote access, no TLS termination, no reverse proxy configuration. This is a local-first platform.

### Multi-tenant auth

There is no multi-user identity system, no OAuth, and no tenant management.
Popeye may use local role-scoped tokens (`operator`, `service`, `readonly`) for
least-privilege access on the same machine, but that is not a multi-tenant auth
system.

### Open registration

Telegram access is allowlist-only (single user ID). There is no self-service registration for any interface.

### Distributed execution

One daemon, one machine. No distributed scheduler, no worker pool, no message queue. Workspace locks enforce single-execution-per-workspace locally.

### External search services

Memory retrieval uses FTS5 + sqlite-vec locally. No Elasticsearch, no external vector databases, no cloud search APIs.
