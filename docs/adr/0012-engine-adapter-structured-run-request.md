# ADR 0012: EngineAdapter structured run request boundary

- Status: Accepted
- Date: 2026-03-14

## Context

Popeye already builds structured engine requests in the runtime before handing
work off to `@popeye/engine-pi`.

That request shape now carries two different classes of data:

- immediate execution controls that `@popeye/engine-pi` already honors today:
  `prompt`, `cwd`, `modelOverride`, and `runtimeTools`
- runtime metadata that Popeye accepts and persists, but does not yet forward
  into Pi RPC semantics: `workspaceId`, `projectId`, `sessionPolicy`,
  `instructionSnapshotId`, and `trigger`

Even with that structured contract in place, the `EngineAdapter` interface
still exposes dual overloads for both `run()` and `startRun()`:

- `string` prompt input
- `EngineRunRequest` object input

The runtime already uses the structured object path. The remaining string
overloads mostly serve legacy convenience, test code, and examples.

Keeping both input shapes obscures the owned Popeye boundary, encourages drift
between “simple prompt” runs and structured runs, and makes future adapter
evolution harder than it needs to be.

Pi itself does not yet expose a richer RPC contract for these metadata fields.
Under the adapter, Popeye still sends prompt-oriented Pi RPC commands. That
means this cleanup is about the Popeye-owned wrapper boundary, not a Pi fork
change.

## Decision

Standardize the public `EngineAdapter` interface on `EngineRunRequest` only.

The adapter keeps two lifecycle methods with distinct behavior:

- `startRun(input: EngineRunRequest, options?)`
- `run(input: EngineRunRequest, options?)`

But both methods now accept the same structured request shape.

Popeye explicitly documents the current behavioral split inside
`EngineRunRequest`:

- execution controls already mapped into current adapter behavior:
  `prompt`, `cwd`, `modelOverride`, `runtimeTools`
- runtime metadata accepted by Popeye but not yet forwarded into Pi RPC
  semantics:
  `workspaceId`, `projectId`, `sessionPolicy`, `instructionSnapshotId`,
  `trigger`

## Options considered

### Option A — Keep dual string/object overloads permanently

**Rejected.**

Pros:

- convenient for trivial call sites
- avoids breaking string-based helpers, tests, and examples immediately

Cons:

- keeps two public entry shapes for one owned boundary
- makes it less clear which run attributes are first-class in Popeye
- invites future drift where new fields only work on one code path

### Option B — Standardize on `EngineRunRequest` only

**Accepted.**

Pros:

- gives Popeye one explicit engine-request contract
- matches current runtime behavior
- makes future structured evolution cheaper and clearer
- preserves the distinction between supported execution controls and metadata
  that is not yet sent into Pi RPC semantics

Cons:

- intentionally breaks any remaining string-based adapter callers
- requires test and doc cleanup across the repo

### Option C — Delay cleanup until Pi RPC carries all metadata natively

**Rejected for now.**

Pros:

- would align the public request shape with a richer underlying Pi protocol

Cons:

- ties a Popeye-owned interface cleanup to unrelated Pi fork work
- leaves the adapter boundary ambiguous longer than necessary
- does not improve current clarity for runtime callers

## Migration and compatibility notes

- The Popeye runtime already uses `EngineRunRequest`, so runtime impact is low.
- Internal tests, helper code, and examples that still call `run("prompt")` or
  `startRun("prompt")` must move to `run({ prompt: "..." })` or
  `startRun({ prompt: "..." })`.
- This ADR does **not** change current Pi RPC behavior:
  - Popeye still sends `get_state`, `prompt`, and `abort`
  - only `cwd`, `modelOverride`, and `runtimeTools` currently alter adapter
    launch / RPC behavior beyond the prompt itself
  - runtime metadata fields remain accepted but not forwarded into Pi RPC
    semantics yet
- No Pi fork delta is required beyond documenting the clarified adapter
  contract.

## Consequences

- `@popeye/engine-pi` has a clearer, single structured request boundary.
- Test doubles and docs now match the runtime’s actual integration style.
- Future adapter changes can extend one owned request object instead of
  proliferating overloads.
- Any future work to forward more metadata into Pi RPC semantics remains a
  separate, deliberate change.
