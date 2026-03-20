# ADR 0014: Fully polished product target

- Status: Accepted
- Date: 2026-03-20

## Context

Popeye already has a strong local runtime foundation, but older planning docs
mixed substrate readiness with product readiness. That made "done" ambiguous:
the daemon and control plane could be considered mature while key assistant
domains, operator workflows, and release engineering were still incomplete.

The project needs a locked definition of what "fully polished" means so future
work can be prioritized against one stable target.

## Decision Drivers

- prevent the runtime foundation from being confused with product completeness
- keep Pi as an engine boundary instead of letting packaging or UX decisions
  leak downward
- define a finish line that includes install, upgrade, recovery, and operator
  visibility
- keep the primary GUI choice explicit

## Considered Options

### Option 1: Treat runtime maturity as the polished bar

Pros:
- fastest path to claiming completeness
- minimizes new domain and UX work

Cons:
- leaves Popeye as a polished control plane rather than a polished assistant
- does not cover provider choices, domain UX, or release engineering
- would keep docs and operator expectations misleading

### Option 2: Define fully polished as the full assistant product

Pros:
- matches the real product goal
- keeps runtime, interfaces, and release engineering in scope
- makes remaining work legible and testable

Cons:
- materially higher bar
- forces explicit decisions on providers, autonomy, and restricted domains

### Option 3: Keep the target intentionally open-ended

Pros:
- preserves flexibility
- avoids locking near-term product decisions

Cons:
- guarantees more doc drift
- weakens prioritization and release discipline

## Decision

Adopt **Option 2**.

Popeye is only considered fully polished when it is a **distribution-grade,
macOS-first, local-only assistant product**, not merely a mature daemon/control
plane. The **web inspector** is the primary GUI for this bar. The native macOS
client remains deferred and does not block the polished state.

The canonical acceptance gate lives in
`docs/fully-polished-release-gate.md`.

## Consequences

Positive:
- "done" becomes testable
- product gaps can be separated from substrate gaps
- release engineering becomes a first-class requirement

Negative:
- more work remains before the polished claim is legitimate
- some existing "mostly complete" narratives become explicitly outdated

## Revisit Triggers

- a decision to make the native macOS app the primary required GUI
- a decision to support remote or multi-user operation
- a product pivot away from assistant-domain scope

## Follow-ups

- keep `docs/current-state-matrix.md` aligned with repo truth
- keep the release gate updated when product scope changes
