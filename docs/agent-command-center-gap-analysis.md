# Agent Command Center — Handoff Prompt

Use this prompt for the next agent working on command-center follow-ups.

---

You are continuing work in `/Users/nationalbank/GitHub/popeye`.

Primary spec:
- `docs/specs/agent-command-center.md`

Read first:
- `AGENTS.md`
- `docs/specs/agent-command-center.md`
- `apps/web-inspector/src/views/command-center.tsx`
- `apps/web-inspector/src/views/command-center-model.ts`
- `apps/web-inspector/src/api/hooks.ts`
- `vitest.config.ts`

## Mission

Perform a pragmatic gap analysis between the current Agent Command Center implementation and the spec, then complete the highest-value follow-up slice with minimal complexity and good test coverage.

## Current known state

- The repo already has a command-center spec in `docs/specs/agent-command-center.md`.
- Coverage policy was intentionally tightened to exclude low-value UI shells/wrappers.
- Coverage still keeps the behavior-heavy command-center/operator workflow screens in scope.
- Current command-center-related files in scope include:
  - `apps/web-inspector/src/views/command-center.tsx`
  - `apps/web-inspector/src/views/command-center-model.ts`
  - `apps/web-inspector/src/views/instructions.tsx`
  - `apps/web-inspector/src/views/interventions.tsx`
  - `apps/web-inspector/src/views/jobs-list.tsx`
  - `apps/web-inspector/src/views/memory-search.tsx`
  - `apps/web-inspector/src/views/run-detail.tsx`
- Existing tests already cover at least:
  - `apps/web-inspector/src/views/command-center.test.tsx`
  - `apps/web-inspector/src/views/command-center-model.test.ts`
  - hook/provider/data-table/badge tests

## What to do

1. Compare the current implementation against `docs/specs/agent-command-center.md`.
2. Produce a concise gap analysis:
   - what is already implemented
   - what is partially implemented
   - what is missing
   - what is intentionally deferred / not worth doing now
3. Pick the smallest high-value follow-up slice.
4. Implement it.
5. Add/adjust tests only where they protect meaningful workflow behavior.
6. Update docs if the implemented slice changes operator expectations or closes a spec item.

## Prioritization guidance

Prefer real operator workflow gaps over cosmetic completeness.

Highest-value likely follow-ups:
- `run-detail.tsx`
  - action visibility by run state
  - cancel / retry flows
  - event rendering
- `jobs-list.tsx`
  - pause / resume / enqueue actions
  - status-based action visibility
- `interventions.tsx`
  - intervention action flows
  - refresh/error behavior
- `instructions.tsx`
  - preview fetch flow
  - query param behavior
  - loading/error/success states
- `memory-search.tsx`
  - empty-query guard
  - keyboard/button search behavior
  - result rendering

Lower priority:
- dashboard-style read-only wrappers
- thin presentational wrappers already excluded from coverage

## Constraints

- Follow `AGENTS.md`.
- Interface layer only.
- Do not bypass the control API.
- Do not expand architecture unnecessarily.
- Prefer a thin, testable improvement over a broad UI refactor.
- Do not chase coverage for trivial wrappers.

## Deliverables

1. Code changes for the selected follow-up slice.
2. Tests for meaningful behavior.
3. A short gap-analysis summary, either:
   - appended to this file, or
   - added to a nearby doc if a better home becomes obvious.

## Suggested output structure

At the end, report:

- Intent
- Layer
- Provenance
- Files changed
- Tests run
- Docs updated
- Risks / follow-ups

## Verification

Run at minimum:

- targeted vitest for changed web-inspector files
- `pnpm run test:coverage` if coverage-relevant files changed
- `pnpm run dev-verify:quick` if the slice is broader than isolated UI tests

## Practical definition of done

The work is done when:

- the chosen follow-up closes a real spec/UX gap
- tests cover the behavior that could regress
- no low-value noise was added back into coverage expectations
- the final write-up clearly states what remains out of scope

---

Recommended first follow-up if no better candidate appears after inspection:

1. Add tests for `apps/web-inspector/src/views/jobs-list.tsx`
2. Add tests for `apps/web-inspector/src/views/run-detail.tsx`
3. Document remaining command-center gaps vs the spec
