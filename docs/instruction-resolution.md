# Instruction Resolution

Instructions are the system prompts and configuration text compiled into a bundle before each engine run. The instruction system lives in `@popeye/instructions`.

## Precedence levels

Instructions are sourced from 10 precedence levels, ordered lowest
(applied first) to highest (applied last, highest priority):

| Precedence | Type | Description |
|------------|------|-------------|
| 1 | `pi_base` | Pi engine base instructions |
| 2 | `popeye_base` | Popeye platform base instructions |
| 3 | `global_operator` | Operator-wide global instructions |
| 4 | `workspace` | Workspace-level instructions |
| 5 | `project` | Project-level instructions |
| 6 | `playbook` | Active operator-owned canonical playbooks selected for the run |
| 7 | `identity` | Identity instructions (IDENTITY.md) |
| 8 | `task_brief` | Task-specific instructions |
| 9 | `trigger_overlay` | Trigger or event-specific overlays |
| 10 | `runtime_notes` | Runtime-injected notes and context |

## Instruction sources

Each instruction source is represented by an `InstructionSource` record:

- **precedence** -- integer 1-10
- **type** -- one of the types listed above
- **path** -- optional filesystem path (for file-backed sources)
- **inlineId** -- optional identifier (for programmatic sources)
- **contentHash** -- SHA-256 hash of the content
- **content** -- the instruction text

## Compilation

The `compileInstructionBundle()` function:

1. Sorts all sources by precedence (ascending).
2. Detects precedence collisions -- if two sources share the same precedence, a warning is emitted.
3. Concatenates content in precedence order, separated by double newlines.
4. Computes a `bundleHash` (SHA-256 of the compiled text).
5. Records any selected active playbooks in additive bundle metadata for audit and receipt use. Draft playbooks and pending proposals never compile.
6. Returns a `CompiledInstructionBundle` with a unique ID, the ordered sources, the compiled text, the bundle hash, any warnings, and a timestamp.

## Bundle schema

```typescript
{
  id: string,            // UUID
  sources: InstructionSource[],
  playbooks: AppliedPlaybook[],
  compiledText: string,  // Concatenated instruction text
  bundleHash: string,    // SHA-256 of compiledText
  warnings: string[],    // e.g., precedence collision warnings
  createdAt: string      // ISO 8601
}
```

## Snapshots

The runtime persists instruction bundles as snapshots in the
`instruction_snapshots` table (keyed by scope) for audit and debugging. The
snapshot payload now includes additive playbook metadata so operators can trace
exactly which active playbooks were compiled into a run. Playbook proposals
and inactive drafts are auditable elsewhere, but remain outside instruction
compilation until activation. The control API exposes previews via
`GET /v1/instruction-previews/:scope`.

## Critical instruction files

The following files are operator-owned and protected by default: `WORKSPACE.md`, `PROJECT.md`, `IDENTITY.md`, `HEARTBEAT.md`. Writes to these files require explicit approval and produce a receipt. See `@popeye/workspace` and `@popeye/runtime-core` policy enforcement.
