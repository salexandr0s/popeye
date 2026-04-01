# Popeye macOS App — Product Direction

**Status:** approved product direction for the next macOS app phase
**Audience:** implementation agents, design agents, human product/operator reviewers
**Builds on:** `docs/internal/dashboard/design.md`, `docs/internal/dashboard/architecture.md`, `docs/internal/dashboard/buildplan.md`

---

## 1. Why this document exists

The current native macOS app is no longer just a hypothetical shell.

Repo truth now is:
- `apps/macos/PopeyeMac/` is a real Swift package app
- the app already ships a working operator-console foundation
- the current native scope is strongest in operations, governance, observability, memory inspection, and Telegram operations

That foundation is good, but it is still too narrow for the product we actually want.

This document defines the next product direction:

> the Popeye macOS app should become the primary place where a person sets up, supervises, and collaborates with their assistant system.

This expands the app from an **operator console** into a **personal AI control center**.

---

## 2. Product statement

Popeye for macOS should become a calm, trustworthy, native control center where the user can:

1. **set up** the assistant and its providers
2. **manage the assistant brain** (identity, soul, instructions, memory, playbooks, schedules)
3. **supervise automations** and health
4. **inspect and steer life domains** (people, files, email, calendar, todos, finance, medical)
5. **see how the assistant is doing at managing the user’s life**

The app should feel like:
- a native Mac app first
- a personal command center second
- an operator console third

It must **not** feel like:
- a browser admin panel in Swift clothing
- a debugging-only shell
- a runtime bypass
- a direct database viewer

---

## 3. Current truth vs target truth

### 3.1 Current truth

The existing macOS app already provides:
- connect/auth screen
- dashboard
- command center
- runs / jobs / receipts investigation
- interventions / approvals
- connections overview
- usage & security
- memory views
- instruction preview
- agent profiles
- telegram operations
- scheduler status

### 3.2 Target truth

The macOS app should become the **primary daily-use surface** for Popeye on macOS.

That means it must add strong first-class experiences for:
- setup / onboarding / provider connections
- assistant/identity/brain management
- schedule and automation control
- memory browsing and daily-review UX
- daemon/gateway health and repair
- people/files/domain management
- finance and medical presentation

---

## 4. Goals

### 4.1 Primary goals

1. **Make setup easy**
   - connect GitHub
   - connect Google services
   - connect Telegram
   - configure assistant identity and defaults

2. **Make the assistant understandable**
   - show soul, identity, instructions, memory, playbooks, schedules, provider health, and recent behavior

3. **Make automations governable**
   - see what is enabled
   - turn things on/off
   - inspect failures
   - adjust cadences safely

4. **Make memory legible**
   - search it
   - browse it
   - inspect provenance
   - view daily memory on a timeline/calendar

5. **Make life domains usable**
   - people, files, email, calendar, todos, finance, medical should become real app surfaces, not hidden APIs

6. **Make system health obvious**
   - daemon, scheduler, connections, sync lag, interventions, security audit, failures, remediation paths

### 4.2 Secondary goals

- make the app comfortable for long-running daily use
- make the system’s intelligence visible without overwhelming the user
- keep a clean line between safe read-heavy workflows and explicit high-trust mutations

---

## 5. Non-goals

These are not part of this direction unless separately approved:

- direct SQLite/runtime file access from the app
- replacing the control API boundary
- multi-user/team workspace features
- donor/OpenClaw station/team/channel ecosystems
- turning the mac app into a plugin marketplace
- silently mutating critical instruction files without operator intent
- broad feature parity just because the web inspector has a screen

---

## 6. Product principles

1. **Control API only**
2. **Local-first, operator-owned, audit-visible**
3. **Native calm over dashboard chaos**
4. **Daily-use product, not just ops/debug tooling**
5. **High-trust flows must stay explicit**
6. **Read-heavy first, but not read-only forever**
7. **Life management and assistant management belong in one coherent app**
8. **The user should always be able to tell what the assistant knows, what it is doing, and where it is failing**

---

## 7. Core personas

### 7.1 Primary persona — Alexandros / single operator

A single user who wants Popeye to help run day-to-day life and projects.

Needs:
- simple setup
- strong visibility
- confidence in memory and automation behavior
- clear intervention paths
- elegant native UX

### 7.2 Secondary persona — operator/debugger

The same person, but in “why is this broken?” mode.

Needs:
- daemon health
- run/job/receipt evidence
- provider degradation signals
- recovery and restart tools

---

## 8. Primary user journeys

### Journey A — first-time setup

The user opens the app and can:
- connect to local daemon
- authenticate once
- connect GitHub
- connect Google Gmail/Calendar/(later Tasks)
- connect Telegram
- see which providers are healthy
- understand what remains unfinished

### Journey B — brain management

The user opens the app and can:
- inspect the assistant workspace
- view active identity
- view soul/instruction composition
- browse playbooks and memory
- see recent learning / daily summaries
- understand how the assistant is configured

### Journey C — automation supervision

The user can:
- see all recurring/heartbeat/scheduled work
- turn automations on/off
- adjust cadence/frequency
- see health, failures, and last success times
- inspect recent runs and interventions

### Journey D — daily review

The user can:
- open a home screen or memory calendar
- review what happened today/this week
- see upcoming tasks, calendar items, and issues needing attention
- inspect important receipts and summaries

### Journey E — repair mode

The user can:
- see daemon/gateway health
- run health checks
- restart/reset/load if supported
- identify which subsystem is failing
- see connection degradation and remediation guidance

### Journey F — life domains

The user can:
- inspect people, files, email, calendar, todos, finance, medical
- search and review those domains
- understand sync freshness and encryption state
- use the assistant system as a real life-management product

---

## 9. Information architecture

The mac app should evolve toward this top-level structure.

### 9.1 Home

Purpose: a daily landing page.

Contents:
- today’s summary
- assistant status
- open attention items
- upcoming calendar/todos
- notable recent runs/interventions
- daily memory summary
- domain freshness / provider health summary

### 9.2 Setup

Purpose: one clear place for onboarding and provider connection.

Contents:
- daemon connect/auth
- GitHub connect
- Google connect (Gmail, Calendar, later Tasks)
- Telegram connect/status
- provider permissions and health
- setup progress checklist

### 9.3 Brain

Purpose: understand and manage the assistant mind.

Contents:
- soul / identity / instruction preview
- memory browser
- memory daily timeline/calendar
- playbooks
- agent profiles
- assistant/workspace configuration

### 9.4 Automations

Purpose: supervise and control background behavior.

Contents:
- scheduler status
- heartbeat jobs
- recurring jobs / cron-like rules
- enable/disable controls
- cadence editor
- recent automation failures

### 9.5 Life

Purpose: day-to-day human domains.

Contents:
- people
- files
- email
- calendar
- todos
- finance
- medical

### 9.6 System

Purpose: infrastructure, governance, and repair.

Contents:
- daemon health
- runs / jobs / receipts
- interventions / approvals
- usage / security
- connection diagnostics
- recovery actions

---

## 10. Functional requirements

Requirements use RFC 2119 style.

### 10.1 Setup and connections

- The app **MUST** provide a native setup hub for connecting supported providers.
- The app **MUST** clearly distinguish connected, degraded, missing, and reauth-required states.
- The app **MUST** keep OAuth/bootstrap flows behind the control API boundary.
- The app **SHOULD** provide a setup progress checklist for first-time users.
- The app **SHOULD** consolidate provider health into one simple screen.
- The app **COULD** provide friendly walkthrough copy and setup tips.

### 10.2 Brain / assistant configuration

- The app **MUST** let the user inspect active identity, soul, and instruction composition.
- The app **MUST** let the user inspect memory in both searchable and chronological forms.
- The app **MUST** preserve operator ownership over critical instruction sources.
- The app **SHOULD** present playbooks as reusable procedures.
- The app **SHOULD** support multiple assistants/identities when the runtime supports them.
- The app **COULD** provide guided editing flows for `SOUL.md`, `WORKSPACE.md`, and identity layers if change safety is explicit.

### 10.3 Automations

- The app **MUST** show automation/scheduler status and recent health.
- The app **MUST** show whether jobs are enabled, disabled, running, blocked, or degraded.
- The app **SHOULD** let the user enable/disable automations.
- The app **SHOULD** let the user change cadence/frequency when a supported API exists.
- The app **COULD** simulate the impact of schedule changes before saving them.

### 10.4 Memory UX

- The app **MUST** provide memory search.
- The app **MUST** provide memory detail with provenance.
- The app **MUST** provide a daily memory browsing mode.
- The app **SHOULD** provide a calendar/timeline view over daily memory.
- The app **SHOULD** surface promotion and consolidation state clearly.
- The app **COULD** highlight important or decayed memories.

### 10.5 Daemon / system health

- The app **MUST** show daemon health, scheduler health, and connection freshness.
- The app **MUST** show where failures are occurring.
- The app **SHOULD** provide supported repair actions (restart, reset, reload, reauth, reconnect) where the API allows them.
- The app **SHOULD** clearly separate safe reads from operator-risk mutations.
- The app **COULD** surface guided remediation checklists.

### 10.6 Domain surfaces

- The app **MUST** eventually provide first-class surfaces for people, files, email, calendar, todos, finance, and medical.
- The app **SHOULD** make each domain feel native and purpose-built, not like a generic JSON table.
- The app **SHOULD** show sync freshness and source/provider provenance.
- The app **MUST** make restricted-domain encryption state visible for finance and medical.

---

## 11. Non-functional requirements

### Security
- The app **MUST** remain behind the loopback control API.
- The app **MUST NOT** read SQLite or runtime files directly.
- The app **MUST** use bearer auth + CSRF exactly as intended by the control API.
- The app **MUST NOT** expose secrets in logs, previews, or screenshots by default.
- The app **MUST** make restricted/encrypted vault state visible where relevant.

### Performance
- Main navigation between already-loaded feature areas **SHOULD** feel instantaneous.
- Dashboard/home refreshes **SHOULD** use incremental refresh/SSE invalidation where available.
- Memory search and domain searches **SHOULD** feel responsive enough for daily use.

### Reliability
- The app **MUST** degrade clearly when the daemon is unavailable.
- The app **MUST** distinguish auth errors from transport failures from provider degradation.
- The app **SHOULD** preserve last-good snapshots where that improves usability.

### Accessibility / UX
- The app **MUST** remain keyboard-friendly.
- The app **MUST** support comfortable split-view workflows.
- The app **SHOULD** feel native on macOS 15+ rather than mimicking a web app.

### Observability
- The app **MUST** expose enough status and evidence for the operator to understand what changed and why.
- The app **SHOULD** surface “last updated”, sync freshness, and mutation outcomes prominently.

---

## 12. Data / trust requirements

- Memory is a first-class product surface, but the app does not become the source of truth.
- Receipts, memory, runs, and approvals remain runtime-owned records.
- Restricted finance/medical data **MUST** honor existing vault and keychain/KEK rules.
- The app **MUST** make provenance visible when showing assistant-derived knowledge.
- The app **MUST** preserve the distinction between:
  - instructions
  - memory
  - automations
  - receipts
  - provider-connected external data

---

## 13. Current feature gaps that matter most

Relative to the desired product, the biggest current gaps are:

1. setup / onboarding / provider connect UX
2. assistant/brain management UX
3. automation management UX
4. memory timeline/calendar UX
5. life-domain surfaces (email/calendar/todos/people/files/finance/medical)
6. daemon repair/system-management UX beyond inspection

---

## 14. Recommended build order

1. **Setup Hub**
2. **Brain / Memory / Identity**
3. **Automations / Scheduler control**
4. **Life-domain read surfaces**
5. **Finance / Medical polished surfaces**
6. **Home / Daily review as a true personal control center**

This ordering is intentional:
- setup makes the rest usable
- brain makes the assistant understandable
- automations make the system governable
- domain surfaces make it useful day to day
- home becomes meaningfully valuable only after the above exist

---

## 15. Success criteria

The direction is successful when a user can open the app and:

- connect the assistant system without dropping to raw CLI for common setup
- understand the assistant’s identity, memory, and current behavior
- supervise and adjust automations safely
- inspect life domains in one coherent native app
- quickly diagnose when the daemon/gateway is unhealthy
- feel that Popeye is helping manage life, not just exposing backend internals
