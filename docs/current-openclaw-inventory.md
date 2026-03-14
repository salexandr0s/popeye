# Current OpenClaw Inventory

Current state of donor-derived code in the Popeye codebase. This inventory tracks what was adapted from OpenClaw and how it was transformed.

## Summary

Popeye does not contain any directly copied OpenClaw code. All implementations are original, built to Popeye's own contracts. Several design concepts were influenced by OpenClaw patterns but were restated in Popeye's domain language and implemented from scratch.

## Donor-influenced packages

### @popeye/runtime-core -- message ingress

The message ingress pipeline (`ingestMessage()`) was influenced by OpenClaw's channel message routing concept. The implementation is entirely new:

- Single `ingestMessage()` entry point instead of a channel abstraction
- Source-specific validation (Telegram checks, rate limiting) inline rather than via a plugin system
- Idempotency via composite keys in the `message_ingress` table
- Classification: **New platform implementation** (donor concept as design influence)

### @popeye/memory -- two-layer memory

The two-layer memory architecture (markdown + SQLite) was influenced by OpenClaw's knowledge persistence patterns. The implementation is original:

- FTS5 + sqlite-vec for retrieval instead of external search services
- Confidence decay with configurable half-life
- Embedding eligibility based on data classification
- Classification: **New platform implementation** (donor concept as design influence)

### @popeye/telegram -- thin bridge

The Telegram adapter concept is influenced by OpenClaw's channel adapters but deliberately reduced to a thin bridge:

- No channel abstraction layer
- No message formatting pipeline
- No bot command framework
- Routes everything through `/v1/messages/ingest`
- Classification: **New platform implementation** (donor concept, heavily reduced scope)

## Code with no donor influence

These packages have no OpenClaw lineage:

| Package | Classification |
|---------|---------------|
| `@popeye/contracts` | New platform implementation |
| `@popeye/engine-pi` | Pi wrapper |
| `@popeye/instructions` | New platform implementation |
| `@popeye/sessions` | New platform implementation |
| `@popeye/scheduler` | New platform implementation |
| `@popeye/receipts` | New platform implementation |
| `@popeye/observability` | New platform implementation |
| `@popeye/workspace` | New platform implementation |
| `@popeye/control-api` | New platform implementation |

## Verification

No OpenClaw source files, config schemas, or naming patterns exist in the Popeye repository. All imports reference `@popeye/` scoped packages. The CLAUDE.md operating contract includes contamination warning signs to prevent future drift.
