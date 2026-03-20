# ADR 0015: Blessed provider contract for the polished bar

- Status: Accepted
- Date: 2026-03-20

## Context

Popeye already has multiple adapters or possible provider paths in some
domains. That is useful during development, but a polished product cannot rely
on a vague "several paths might work" story. The operator experience, docs,
packaging, and tests need one blessed path per domain.

## Decision Drivers

- reduce operator confusion and support burden
- avoid installer dependencies on extra ad hoc CLIs
- keep testing and docs focused on the paths that actually count
- allow experimental adapters without promoting them to product contracts

## Considered Options

### Option 1: Support multiple equal providers per domain

Pros:
- maximum flexibility
- easy to keep experimental integrations visible

Cons:
- weakens polish and onboarding
- multiplies testing and upgrade burden
- encourages least-common-denominator abstractions too early

### Option 2: Lock one blessed provider per domain, allow others as experimental

Pros:
- clear operator contract
- strong release/testing focus
- allows extra adapters without letting them define the product

Cons:
- some existing adapters become explicitly secondary
- requires clear documentation about what counts toward the polished bar

### Option 3: Delay provider decisions until late

Pros:
- preserves optionality

Cons:
- creates ongoing ambiguity
- blocks honest readiness claims

## Decision

Adopt **Option 2**.

The polished bar uses one blessed provider path per domain:

- Files: local file roots
- Email: Gmail
- Calendar: Google Calendar
- Todos: Todoist
- GitHub: direct GitHub API
- People: local canonical people graph
- Finance: import-based local vaults
- Medical: import-based local vaults

Additional adapters may continue to exist, but they are **experimental** unless
promoted by a later ADR.

## Consequences

Positive:
- install, docs, and tests can converge on one path per domain
- CLI-backed or transitional adapters no longer silently define the product
- release engineering becomes simpler

Negative:
- some current integrations remain useful but do not count toward polish
- changing a blessed provider later becomes an architectural decision

## Revisit Triggers

- a provider becomes unreliable, unmaintained, or incompatible with local-first
  requirements
- a direct provider integration proves materially worse than a different local
  path
- legal or platform changes force a domain-level provider shift

## Follow-ups

- reflect blessed providers in operator docs and tests
- keep experimental providers clearly labeled in UI and CLI help
