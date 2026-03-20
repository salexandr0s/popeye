# ADR 0017: Restricted-domain handling for finance and medical

- Status: Accepted
- Date: 2026-03-20

## Context

Finance and medical data are part of the target product scope, but they carry a
stricter trust boundary than general assistant domains. Treating them as
ordinary memories or general-purpose tool domains would weaken the local-first
 safety model and make operator review less trustworthy.

## Decision Drivers

- protect highly sensitive content by default
- keep auditability stronger than convenience
- avoid leaking raw restricted content into generic memory or model context
- preserve a path to useful product workflows without unrestricted mutation

## Considered Options

### Option 1: Treat finance and medical like any other domain

Pros:
- simplest implementation path
- reuses generic memory and capability flows

Cons:
- unacceptable context-release risk
- weakens audit boundaries
- invites accidental raw embedding and broad mutation

### Option 2: Use vault-backed restricted domains with summary-first context release

Pros:
- aligns with the security model
- allows useful search, review, and digest flows without broad exposure
- keeps audit and backup posture explicit

Cons:
- more storage, policy, and backup work
- slower path to feature parity

### Option 3: Omit finance and medical entirely

Pros:
- avoids the hardest safety problems

Cons:
- does not meet the intended product scope
- leaves an important operator need permanently unserved

## Decision

Adopt **Option 2**.

Finance and medical are first-class but **bounded** domains:

- content is stored in vault-backed restricted stores
- raw restricted content is not embedded by default
- context release defaults to summary or excerpt form
- higher-fidelity release requires explicit approval
- all access/import/export/release activity is auditable
- these domains remain non-mutating with respect to external systems

Generic memory may hold derived summaries or operator-approved reductions, but
it must not become the default durable store for raw restricted content.

## Consequences

Positive:
- sensitive domains fit the local-first model
- operator trust and forensic visibility remain intact
- future product work has a clear safety boundary

Negative:
- restricted-domain UX will ship later than general-domain UX
- backup, restore, and policy code paths become more complex

## Revisit Triggers

- a regulatory or platform requirement changes the acceptable storage posture
- evidence shows summary-first release is insufficient for core workflows
- a future need for tightly bounded, explicitly approved external mutation

## Follow-ups

- add restricted backup and restore drills
- keep finance and medical policy rules separate from general-domain defaults
- add tests for no raw embedding leakage and no unauthorized full context
  release
