# ADR 0004: Telegram trust and identity

- Status: Accepted
- Date: 2026-03-13

## Decision

Treat Telegram as a thin, untrusted ingress surface with exactly one allowlisted operator user ID in v1.

## Rules

- Route all Telegram traffic through `/v1/messages/ingest`.
- Never call Pi directly from the adapter.
- Enforce allowlist before run creation.
- Enforce per-user rate limiting.
- Run prompt-injection scanning before execution.
- Quarantined messages create audit events and interventions instead of runs.

## Consequences

- The v1 trust model remains single-operator.
- Broader allowlists, pairing, and multi-user identity are deferred.
