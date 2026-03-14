# Popeye

Popeye is my always-on personal agent.

It is a local-first, single-operator runtime I own, powered by Pi, with deliberate integrations like messaging, browser, email, and memory.

Popeye is not trying to be a clone of OpenClaw, a cloud SaaS, or a sprawling agent platform. It is a simpler, more opinionated system built for continuity, auditability, and control.

## North Star

Build an always-on personal agent that can reliably act on my behalf across trusted capabilities, while remaining fully owned, inspectable, and controlled by me.

**Shorthand:** own the runtime, keep it on, expand capabilities deliberately, avoid platform sprawl.

## Non-Goals

Popeye is intentionally **not**:

- a wholesale recreation of OpenClaw
- a multi-tenant SaaS or team collaboration platform
- a broad channel ecosystem
- a plugin marketplace
- a remote-first cloud control plane
- an autonomy-first system with hidden actions and weak auditability
- an interface-led architecture where UI drives runtime design

## Roadmap

### Core runtime

Get the foundation right: always-on, inspectable, safe.

- daemon (`popeyed`)
- scheduler and heartbeat
- control API
- session orchestration
- receipts, audit, and recovery
- memory foundation
- CLI and inspector surfaces

### Messaging ingress

Let Popeye receive work continuously.

- Telegram adapter
- manual and API message ingest
- allowlist, rate limiting, and prompt-injection checks
- task creation from inbound messages

### Operator memory

Let Popeye remember useful context safely.

- searchable memory
- daily notes
- promotion flow into curated memory
- provenance, confidence, decay, and consolidation

### Action capabilities

Give Popeye tightly bounded ways to do real work.

- browser capability
- email capability
- file and system capability
- selected external service integrations

### Personal workflow automation

Make Popeye genuinely useful day to day.

- recurring routines
- inbox triage
- research and follow-up workflows
- reminders, summaries, and proactive check-ins

### Mature personal agent

Make it dependable enough to live with long term.

- stronger policy controls
- intervention and approval flows
- richer observability
- stable client surfaces
- deliberate expansion of trusted capabilities
