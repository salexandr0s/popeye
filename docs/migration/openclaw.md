# Migrating from OpenClaw to Popeye

## Overview

Popeye is not a drop-in OpenClaw replacement. It is a purpose-built agent platform on a controlled Pi fork with different architecture, scope, and boundaries.

## What maps

| OpenClaw concept | Popeye equivalent | Notes |
|---|---|---|
| Scheduled tasks | Popeye scheduler (`pop task run`) | Similar semantics, different API |
| QMD collections | `memory.db` (FTS5 + sqlite-vec) | See `docs/migration/qmd-replacement.md` |
| Telegram channel | `@popeye/telegram` adapter | Thin bridge, DM-only, allowlist-only |
| Session management | Pi engine sessions | Managed through runtime, not directly |
| Agent configuration | Workspace config + instructions | JSON config validated with Zod |

## What does not map

These OpenClaw concepts are intentionally omitted (see CLAUDE.md sections 8 and 17):

- Multi-channel ecosystem
- Node/device pairing
- Media pipelines
- Plugin marketplace
- Gateway-wide routing abstractions
- Custom command frameworks
- Multi-user/group chat

## Migration steps

1. **Export QMD knowledge** — `qmd query "*"` or `qmd search "*"` to extract existing knowledge documents
2. **Create Popeye workspace config** — copy `config/example.json`, set `runtimeDataDir` and workspace entries
3. **Import knowledge** — use the control API `/v1/memory` endpoints to ingest extracted knowledge by type
4. **Re-create scheduled tasks** — use `pop task run` to set up task definitions
5. **Configure Telegram** (if needed) — set `telegram.enabled: true`, `telegram.allowedUserId` in config

## Key differences

- **Auth model**: File-based auth tokens with rotation, not OpenClaw's pairing system
- **Storage**: SQLite (WAL mode) instead of distributed storage
- **Security**: Loopback-only binding, CSRF on mutations, redact-on-write
- **Memory**: Structured records with provenance/confidence vs raw markdown files
