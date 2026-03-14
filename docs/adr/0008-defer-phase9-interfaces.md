# ADR 0008: Defer Phase 9 Interfaces

- Status: Amended
- Date: 2025-03-13
- Amended: 2026-03-14

## Original decision

Defer Phase 9 (web inspector + Swift macOS client). Phase 10 could proceed against CLI + control API first.

## Current status

That decision is now only **partially** true:

- the **web inspector is implemented** and serves as the primary Phase 9 proof of the control API boundary
- the **Swift macOS client remains deferred**

Phase 9 therefore no longer has zero implementation.

## Consequences

- Interface-layer work is no longer hypothetical; `apps/web-inspector` is an active surface that must stay aligned with `/v1/*`
- Phase 10 hardening/docs must account for the shipped web inspector, especially browser auth bootstrap and CSRF
- Swift/macOS work can still proceed independently when ready
