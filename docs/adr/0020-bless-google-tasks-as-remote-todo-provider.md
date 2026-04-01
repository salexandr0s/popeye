# ADR 0020: Bless Google Tasks as the remote todo provider

- Status: Accepted
- Date: 2026-04-01

## Context

ADR 0015 established one blessed provider path per domain and named Todoist as
the polished-bar todo provider. That no longer matches the product direction or
the implementation.

Popeye now has a native Google Tasks adapter that:

- reuses the shared Google OAuth substrate already used by Gmail and Google
  Calendar
- keeps secrets inside Popeye's existing connection and secret-store model
- avoids external CLI wrapper dependencies for the blessed path
- provides a first-class runtime/account/control-API/CLI/web flow

Keeping Todoist as the blessed remote path would conflict with the product goal
of owning the todo stack natively and reducing dependence on extra provider
setup steps that do not fit the blessed browser-OAuth connection model.

## Decision Drivers

- keep the polished bar aligned with a Popeye-owned runtime path
- reuse the shared Google OAuth substrate instead of growing parallel auth flows
- avoid external CLI dependencies for a blessed product path
- keep docs, release readiness, and operator onboarding focused on one clear
  remote todo story

## Considered Options

### Option 1: Keep Todoist as the blessed remote provider

Pros:
- no migration for existing Todoist users
- preserves stronger Todoist semantics such as priority

Cons:
- conflicts with the native Google direction
- keeps the blessed path dependent on a separate token/provider model
- weakens product consistency across Gmail, Calendar, and Todos

### Option 2: Bless Google Tasks, keep Todoist only as legacy or experimental

Pros:
- aligns the product with a native runtime-owned implementation
- reuses shared Google OAuth and secret handling
- gives operators one browser-OAuth remote todo path

Cons:
- Google Tasks semantics are narrower than Todoist
- requires migration away from Todoist-specific connect surfaces

### Option 3: Bless no remote todo provider yet

Pros:
- avoids immediate migration churn

Cons:
- leaves the todo story ambiguous
- blocks honest polished-bar claims for the todos domain

## Decision

Adopt **Option 2**.

Popeye's blessed **remote** todo provider is now **Google Tasks**.

- Local todos remain supported.
- Google Tasks is the blessed remote path across runtime, control API, CLI,
  tests, and operator docs.
- Todoist no longer defines the polished-bar contract.

Semantic limits are explicit rather than hidden:

- task lists map to Popeye projects
- completion maps to Google Tasks completion
- due dates are supported as date-only
- due times, labels, and native priorities are not supported

## Consequences

Positive:
- the todo story matches the shared Google connection model
- operators get a clearer connect flow and fewer blessed-path dependencies
- runtime/provider ownership improves long-term maintainability

Negative:
- Todoist-specific flows and assumptions require migration
- some richer Todoist semantics are intentionally unavailable on the blessed
  path

## Revisit Triggers

- Google Tasks becomes operationally unreliable for the polished bar
- a future native provider offers materially better product fit
- operators require richer remote todo semantics that cannot be modeled
  acceptably within the current product constraints

## Follow-ups

- keep breaking-change and migration notes current
- keep unsupported Google Tasks semantics explicit in docs and runtime errors
- revisit whether Todoist remains worth carrying as a non-blessed path
