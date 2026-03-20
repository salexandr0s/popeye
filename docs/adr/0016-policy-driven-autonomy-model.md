# ADR 0016: Policy-driven autonomy model

- Status: Accepted
- Date: 2026-03-20

## Context

Popeye currently has approval and policy substrate, but the coarse execution
model is still too binary for the long-term assistant product. The polished bar
needs unattended behavior to be controlled by runtime policy, not by prompt
convention or ad hoc "read-only versus side-effect" labels.

## Decision Drivers

- unattended behavior must be inspectable and deterministic
- policy must be reusable across CLI, web, daemon, and future automation flows
- dangerous actions need scope-aware controls and receipts
- autonomy should be narrow by default, not unconstrained

## Considered Options

### Option 1: Keep a coarse read-only versus external-side-effect model

Pros:
- simple to explain
- minimal implementation complexity

Cons:
- too weak for domain-aware approvals
- cannot represent standing grants or resource scope cleanly
- makes receipts and policy review less precise

### Option 2: Use structured action metadata plus standing approvals and automation grants

Pros:
- precise runtime enforcement
- supports unattended flows without hiding risk
- maps naturally to receipts, policy, and operator UX

Cons:
- requires more schemas, storage, and tests
- raises the bar for new domain actions

### Option 3: Allow broad prompt-driven autonomy with manual review only when needed

Pros:
- fastest path to more automation

Cons:
- weak operational guarantees
- brittle and hard to audit
- incompatible with restricted-domain posture

## Decision

Adopt **Option 2**.

Popeye autonomy is **policy-driven**. Runtime actions must be described with
structured metadata including:

- domain
- action kind
- risk class
- resource scope
- idempotency key
- approval posture

The product will support **standing approvals** and **automation grants** so
unattended behavior is governed by explicit policy records rather than prompt
text.

Default runtime posture:

- sync/import/digest/classification/triage may auto-run when allowed by policy
- email sends, calendar writes, GitHub writes, and non-agent-owned file writes
  require standing grants or explicit approval
- finance and medical never perform external mutations

## Consequences

Positive:
- autonomy becomes consistent across interfaces
- operator review becomes more useful because actions are typed and scoped
- replay and recovery can use idempotency keys instead of inference

Negative:
- more implementation work is required before the polished bar is met
- every new side-effectful action needs policy metadata and tests

## Revisit Triggers

- evidence that structured policy is too coarse for real operator workflows
- a need for additional action dimensions beyond the current metadata set
- future automation requirements that cannot be expressed with standing grants

## Follow-ups

- add schemas for action kinds, standing approvals, and automation grants
- extend receipts with canonical policy timeline entries
- add auto/ask/deny, expiry, replay, and crash-recovery tests
