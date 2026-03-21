# ADR 0018: Hand-written TypeScript API client

**Date:** 2026-03-21
**Status:** accepted
**Classification:** new platform implementation

## Context

The build plan (Phase 8) specified "Generated TypeScript client (auto-generated)" as a
deliverable for the control API. During implementation, the client was written by hand
as `PopeyeApiClient` in `@popeye/api-client` (approximately 1,500 lines with 560 lines
of tests).

The hand-written client imports Zod schemas directly from `@popeye/contracts` and
validates responses at runtime. This means the client and server share the same schema
source of truth, and any schema drift causes a build or test failure immediately.

## Decision

Keep the hand-written `PopeyeApiClient` as the canonical TypeScript client. Do not
introduce a code generation step.

## Rationale

1. **Schema drift is already prevented.** Both the Fastify server routes and the API
   client import Zod schemas from `@popeye/contracts`. A shape change in one place
   propagates to both sides through the type system and the `pnpm typecheck` step.
   `pnpm verify:generated-artifacts` confirms generated Swift/JSON Schema bundles
   also stay aligned.

2. **Code generation adds toolchain complexity.** An OpenAPI generator or similar tool
   introduces a build dependency, a code generation step, template maintenance, and
   output formatting decisions — all for marginal benefit when the shared-schema
   approach already provides the same guarantee.

3. **Hand-written client is higher quality.** The client includes typed method
   signatures with JSDoc, consistent error handling, bearer and CSRF token
   propagation, SSE helper, and domain-specific convenience methods. Generated
   clients typically require post-generation wrappers to achieve the same
   ergonomics.

4. **Single consumer.** The TypeScript client is consumed only by the CLI and web
   inspector — both within the monorepo. There is no external SDK distribution
   requirement. The generated Swift models (`PopeyeModels.swift`) cover the
   cross-language case.

## Consequences

- The API client must be updated manually when new routes are added. This is
  acceptable because new routes are always accompanied by contract schema changes
  that trigger type errors in the client.
- If Popeye ever publishes a public TypeScript SDK for third-party consumers, this
  decision should be revisited.
- The `docs/api-contracts.md` route table serves as the human-readable reference for
  all endpoints.
