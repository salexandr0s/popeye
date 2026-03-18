# Popeye personal assistant fix plan

Date: 2026-03-16

# Evidence legend

- **VERIFIED IN CODE** — I directly inspected the repository tree and/or file contents and confirmed the statement in code.
- **DOC CLAIM ONLY** — the statement appears in repo documentation, but I did not find it confirmed in code during this audit.
- **INFERRED** — the statement is a reasoned conclusion from inspected structure, tests, docs, or adjacent code, but not line-verified end-to-end.
- **PROPOSED** — this is my recommended future design or implementation step.


## Summary

This fix plan focuses on the structural issues that will block Popeye from safely becoming the target personal assistant if left unchanged.

## Fixes

| Issue | Evidence | Priority | Action | Exact packages/files | Migration implications | Test implications |
|---|---|---|---|---|---|---|
| Docs overstate product completeness | **VERIFIED IN CODE** docs mention near-complete phase status, but code lacks core assistant capability packages | **Blocking** | **Refactor docs** | `README.md`, `docs/phase-audit-2026-03-14.md`, roadmap docs, package READMEs | None | none/minimal |
| Scheduler task model hardcodes `sideEffectProfile: 'read_only'` | **VERIFIED IN CODE** in `packages/scheduler/src/task-manager.ts` | **Blocking** | **Extend** | `packages/contracts/src/execution.ts`, `packages/scheduler/src/task-manager.ts`, runtime-core usage sites | schema/data migration for richer action metadata | approval/action policy tests |
| Current classification model is too coarse for restricted domains | **VERIFIED IN CODE** `DataClassificationSchema` only covers `secret/sensitive/internal/embeddable` | **Blocking** | **Refactor** | `packages/contracts/src/config.ts`, `packages/contracts/src/memory.ts`, `packages/memory`, `packages/runtime-core` | migrate memory records and config defaults | migration + retrieval filter tests |
| No explicit domain/action approval model | **VERIFIED IN CODE** interventions exist but no email/calendar/finance/medical action classes | **Blocking** | **Extend** | `packages/contracts/src/execution.ts`, `packages/runtime-core`, `packages/control-api`, UI/CLI surfaces | extend intervention records/API payloads | approval lifecycle tests |
| No secret-store abstraction for provider tokens | **VERIFIED IN CODE** macOS keychain helper exists, but no general provider secret-store model is present | **Blocking before external integrations** | **Extend** | `packages/runtime-core/src/keychain.ts`, new `secret-store.ts`, config/contracts | no existing provider-token migration yet | backend/fallback/rotation tests |
| Backups are not yet suitable for restricted vaults | **VERIFIED IN CODE** backup copies config/state/receipts/workspaces with checksums but not encryption | **Blocking before finance/medical** | **Extend** | `packages/runtime-core/src/backup.ts`, contracts, runbooks | backup format version bump | encrypted backup/restore tests |
| Workspace policy is too narrow | **VERIFIED IN CODE** only named critical files are protected in `packages/workspace/src/policy.ts` | **High** | **Extend** | `packages/workspace`, new `packages/cap-files`, config/contracts | add new file-root/permission records | path/root permission tests |
| No capability-local sync model | **VERIFIED IN CODE** no sync cursor/provider record model exists for email/calendar/GitHub/todo | **High** | **Add** | new capability packages, contracts, runtime-core | new capability stores only | sync/replay tests |
| `runtime-service.ts` is accumulating too much responsibility | **VERIFIED IN CODE / INFERRED** large central file already orchestrates many domains | **High** | **Refactor** | `packages/runtime-core/src/runtime-service.ts`, add service modules | internal only if done before feature rollout | regression suite |
| Pi runtime-tool bridge still depends on workaround path | **VERIFIED IN CODE / DOC CLAIM ONLY** fallback via `extension_ui_request("popeye.runtime_tool")` exists | **Medium** | **Extend / harden** | `packages/engine-pi`, related docs/tests | none to data model initially | tool RPC fallback tests |
| No context-release audit policy | **INFERRED** embeddings policy exists, but context-release policy/receipts do not | **High** | **Add** | contracts, runtime-core, memory, receipts, observability | new receipt/event types | context assembly and release tests |
| No finance/medical vault separation | **VERIFIED IN CODE** no restricted vault packages/stores exist | **Blocking before restricted domains** | **Add** | new `packages/vault-finance`, `packages/vault-medical`, runtime-core vault manager | new stores only | encryption/restore/redaction tests |
| Web inspector lacks future approval/review domain surfaces | **VERIFIED IN CODE / INFERRED** app exists but assistant-domain surfaces are not present | **Medium** | **Extend** | `apps/web-inspector/src/views/*` | none | UI/API integration tests |
| `apps/macos` is deferred | **VERIFIED IN CODE** README says deferred/not started | **Low** | **Defer** | `apps/macos` | none | none now |

## Recommended order

### Order 1: must happen before real provider integrations
- correct docs
- add approval/action model
- add domain/trust/context-release model
- add secret-store abstraction
- add backup/vault plan

### Order 2: should happen before multiple new capabilities land
- modularize runtime-core
- expand workspace/file permission model
- define capability-local sync/store pattern

### Order 3: can happen while early capability slices are landing
- harden Pi host-tool boundary
- improve web-inspector approval/review surfaces

## Fix-plan conclusion

**VERIFIED IN CODE** — The repo does not need a rewrite.  
**PROPOSED** — It does need several foundational corrections before sensitive or side-effectful assistant domains are added, especially around approvals, secret storage, vaults, and memory/context policy.
