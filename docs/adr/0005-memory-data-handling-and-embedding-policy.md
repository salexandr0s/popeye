# ADR 0005: Memory data handling and embedding policy

- Status: Accepted
- Date: 2026-03-13

## Decision

Use a two-layer memory model with redaction-before-write and default-deny external embedding.

## Rules

- `app.db` stores operational state; `memory.db` stores memory state.
- Redact before persisting memory and before sending content to embedding providers.
- Only explicitly approved curated memory is embeddable in phases 1-6.
- Raw receipts, raw Telegram content, and daily summaries are not embeddable by default.
- Provenance is required for every stored memory.

## Consequences

- Privacy and retention controls are enforced before semantic retrieval expands.
- External embedding traffic is limited to `embeddable` classified content only.
