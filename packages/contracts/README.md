# @popeye/contracts

Shared Zod schemas and TypeScript types that define the domain model for the
entire Popeye platform. This is the leaf dependency used by all other packages
to ensure consistent data shapes across layers.

## Key exports

- `AppConfigSchema` / `AppConfig` -- application configuration
- `TaskRecordSchema` / `TaskRecord` -- task lifecycle records
- `RunRecordSchema` / `RunRecord` -- individual run records
- `ReceiptRecordSchema` / `ReceiptRecord` -- receipted run outcomes with cost/usage
- `MemoryRecordSchema` / `MemoryRecord` -- memory entries with provenance and confidence
- `JobRecordSchema` / `JobRecord` -- job orchestration records
- All shared enums, status types, and event payload schemas

## Dependencies

- `zod` -- runtime schema validation and TypeScript type inference

## Layer

Cross-cutting. No runtime or interface dependencies.
