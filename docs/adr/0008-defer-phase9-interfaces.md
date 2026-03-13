# ADR 0008: Defer Phase 9 Interfaces

- Status: Accepted
- Date: 2025-03-13

## Decision

Defer Phase 9 (web inspector + Swift macOS client). Phase 10 proceeds against CLI + control API boundary only.

## Rationale

- The `/v1/*` control API is the stable boundary both future interfaces target
- Hardening, security, migration docs, and test coverage are orthogonal to presentation layer
- Phase 9 has zero implementation — blocking Phase 10 on it adds no value
- CLI + control API provide complete operator coverage for v1

## Consequences

- Phase 10 verifies CLI/API only
- Phase 9 proceeds independently when ready
- No interface-layer assumptions leak into Phase 10 hardening work
- Web inspector and Swift client can target the same `/v1/*` API when implemented
