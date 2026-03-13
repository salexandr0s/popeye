# @popeye/contracts

Shared Zod schemas and TypeScript types that define the domain model for the
Popeye platform. This is the leaf dependency -- every other package imports from
here to ensure consistent data shapes across all layers.

## Purpose

Provides a single source of truth for all domain types: configuration, tasks,
jobs, runs, receipts, sessions, instructions, memory, messaging, security
events, backup records, and API request/response schemas. All schemas use Zod
for runtime validation and TypeScript type inference.

## Layer

Cross-cutting. No runtime, engine, or interface dependencies.

## Provenance

New platform implementation.

## Key exports

| Domain file        | Key schemas / types                                                        |
| ------------------ | -------------------------------------------------------------------------- |
| `config.ts`        | `AppConfigSchema`, `AppConfig`, `RuntimePaths`                             |
| `engine.ts`        | `NormalizedEngineEvent`, `UsageMetrics`, `EngineFailureClassification`      |
| `execution.ts`     | `TaskRecordSchema`, `JobRecordSchema`, `RunRecordSchema`, `RunEventRecord` |
| `receipts.ts`      | `ReceiptRecordSchema`, `ReceiptRecord`                                     |
| `sessions.ts`      | `SessionRootRecord`, `SessionRootKind`                                     |
| `instructions.ts`  | `InstructionSource`, `CompiledInstructionBundle`                           |
| `memory.ts`        | `MemoryRecordSchema`, `MemorySearchResponse`, `EmbeddingEligibility`       |
| `security.ts`      | `SecurityAuditEvent`, `AuthRotationRecord`                                 |
| `messaging.ts`     | `IngestMessageInput`, `MessageIngressResponse`, `TelegramChatType`         |
| `backup.ts`        | `BackupManifest`                                                           |
| `api.ts`           | `HealthResponse`, `DaemonStatusResponse`, `UsageSummary`, etc.             |

## Dependencies

- `zod` -- runtime schema validation and TypeScript type inference

## Usage

```ts
import { AppConfigSchema, type TaskRecord } from '@popeye/contracts';

const config = AppConfigSchema.parse(rawJson);
```

See `src/contracts.test.ts` for schema validation examples.
