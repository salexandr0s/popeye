# Popeye macOS App — Personal Control Center Roadmap

**Status:** proposed implementation roadmap
**Depends on:** `docs/internal/dashboard/product_direction.md`, `docs/internal/dashboard/architecture.md`

---

## 1. Roadmap summary

This roadmap turns the current native app from a solid operator-console foundation into the primary personal-assistant control center.

The roadmap is intentionally phased.

Do **not** try to build every screen in one pass.

### Phase order
1. Setup Hub
2. Brain / Memory / Identity
3. Automations / Scheduler control
4. Life-domain surfaces
5. Finance / Medical polish
6. Home / daily review synthesis

---

## 2. Phase 1 — Setup Hub

### Goal
Make the app the easiest place to bootstrap Popeye on a user’s Mac.

### Core deliverables
- unified Setup screen/section
- provider connection cards
- connect/reconnect flows for:
  - GitHub
  - Gmail
  - Calendar
  - Telegram
  - Google Tasks later when available
- setup progress checklist
- provider health/readiness states
- connection remediation entry points

### User stories

#### Story 1.1 — Connect providers
As a user, I want to connect GitHub and Google services from the Mac app, so that setup feels simple and centralized.

**Acceptance criteria**
- Given valid provider config exists, when I open Setup, then I can start supported OAuth flows from the app.
- Given a provider is connected, when I revisit Setup, then I see it as connected with freshness/health state.
- Given a provider is degraded or missing, when I view Setup, then the remediation state is obvious.

**Definition of Done**
- control-API-only
- tests for happy/degraded/missing states
- docs updated
- no secrets leaked in UI/logs

#### Story 1.2 — Setup checklist
As a user, I want to see what parts of Popeye are configured vs incomplete, so that I know exactly what remains.

**Acceptance criteria**
- Given a fresh install, when I open Setup, then I see a checklist with incomplete items.
- Given I complete a connection, when status updates arrive, then the checklist updates.

---

## 3. Phase 2 — Brain / Memory / Identity

### Goal
Make the assistant understandable and editable in a human-centered way.

### Core deliverables
- Brain section in sidebar
- identity and soul inspection
- instruction composition UI
- richer memory browser
- daily memory timeline/calendar view
- playbook list + detail
- assistant/workspace overview

### User stories

#### Story 2.1 — Inspect the assistant brain
As a user, I want to see the assistant’s soul, identity, instructions, and playbooks, so that I understand how it is configured.

**Acceptance criteria**
- Given the assistant is configured, when I open Brain, then I can inspect soul, identity, and instruction composition separately.
- Given instruction sources change, when I refresh, then the app shows updated instruction provenance.

#### Story 2.2 — Browse memory by day
As a user, I want to browse memory through a calendar/timeline, so that I can review what the assistant learned and did over time.

**Acceptance criteria**
- Given daily memories exist, when I open Memory calendar view, then I can pick a date and inspect that day’s memory.
- Given memories have provenance, when I inspect one, then I can see where it came from.

#### Story 2.3 — Search and promote memory
As a user, I want to search memory and inspect promotion flows, so that I can curate the assistant brain intentionally.

**Acceptance criteria**
- Search returns real results from the API.
- Promotion proposal/review is visible before execution.

---

## 4. Phase 3 — Automations / Scheduler control

### Goal
Make recurring work visible and governable.

### Core deliverables
- automation list / status board
- scheduler health view
- heartbeat and recurring job grouping
- enable/disable toggles where API supports it
- cadence/frequency editing where API supports it
- recent failures, intervention links, last success timestamps

### User stories

#### Story 3.1 — See automation health
As a user, I want to see what automations exist and whether they are healthy, so that I trust the system.

**Acceptance criteria**
- Every surfaced automation shows status, last run, and next/expected cadence.
- Failed or stalled automations are highlighted.

#### Story 3.2 — Control automations
As a user, I want to turn automations on/off and adjust frequency, so that I can govern background behavior.

**Acceptance criteria**
- Given supported API endpoints exist, when I change an automation state/frequency, then the app confirms the change and shows updated status.
- Unsupported operations are not faked.

---

## 5. Phase 4 — Life-domain surfaces

### Goal
Turn domain APIs into coherent user-facing product areas.

### Core deliverables
- people view
- files view
- email view
- calendar view
- todos view
- domain freshness/health/status indicators

### User stories

#### Story 4.1 — People and files
As a user, I want to manage people and files in the app, so that Popeye becomes the center of my working context.

**Acceptance criteria**
- People view supports browse/search/inspect.
- Files view supports browse/search/inspect within current product boundaries.

#### Story 4.2 — Communication and planning domains
As a user, I want to see email, calendar, and todos in one app, so that the assistant helps coordinate my day.

**Acceptance criteria**
- Email, calendar, and todo surfaces are clearly separated but visually cohesive.
- Each shows account state, freshness, and core read workflows.

---

## 6. Phase 5 — Finance / Medical polish

### Goal
Present high-trust restricted domains clearly and safely.

### Core deliverables
- finance overview + history + digest surfaces
- medical overview + appointments + medications + digest surfaces
- explicit restricted-vault encryption status
- provenance and freshness affordances

### User stories

#### Story 5.1 — Finance view
As a user, I want a well-presented finance surface, so that I can understand what the assistant knows about money.

**Acceptance criteria**
- Finance digest is clearly visible.
- Transaction/search/history views feel purpose-built, not generic tables.
- Encryption/restricted-vault state is visible.

#### Story 5.2 — Medical view
As a user, I want a careful medical surface, so that I can review appointments, medications, and summaries with confidence.

**Acceptance criteria**
- Medical digest, appointments, and medications are visible.
- Restricted-vault state is prominent.
- UI clearly signals trust/privacy sensitivity.

---

## 7. Phase 6 — Home / Daily review synthesis

### Goal
Turn the app into a real daily-use home for supervising life + assistant behavior.

### Core deliverables
- redesigned Home screen
- today/this week summary
- upcoming items
- notable memory/events
- open issues needing intervention
- assistant performance / reliability summary

### User stories

#### Story 6.1 — Daily review home
As a user, I want one daily home screen, so that I can understand what the assistant is doing for me and what needs attention.

**Acceptance criteria**
- Home combines operational, memory, and life-domain signals into one coherent screen.
- It feels calm and prioritized rather than noisy.

---

## 8. Cross-cutting requirements

Every phase must preserve:
- control API boundary only
- bearer auth + CSRF
- no direct runtime file or SQLite reads
- explicit mutation affordances for risky actions
- good keyboard navigation
- strong empty/loading/error states
- auditability and provenance visibility

---

## 9. Immediate next build slice

The recommended **next implementation slice** is:

### Slice A — Setup + Brain foundation
Build these together:
- Setup hub shell
- provider connect status cards
- instruction/identity/soul inspector refinement
- memory daily-calendar foundation

Why this slice first:
- it moves the app toward personal daily use immediately
- it avoids waiting on every domain surface
- it makes Popeye feel like a coherent assistant product, not just a run console

---

## 10. Exit criteria for this roadmap

The roadmap is materially complete when:
- setup no longer depends primarily on CLI for common user-facing provider flows
- assistant brain/memory are understandable in the app
- automations are controllable in-app
- major life domains are visible in-app
- finance/medical have trustworthy presentation
- the Home screen feels like a genuine personal AI control center
