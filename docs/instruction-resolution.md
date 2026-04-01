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
| 4 | `context_compat`, `context_native`, `workspace` | Compatibility context (`AGENTS.md`) first, then Popeye-native context fragments (`.popeye/context/**/*.md`), then workspace-level instructions (`WORKSPACE.md`) |
| 5 | `project` | Project-level instructions |
| 6 | `playbook` | Active operator-owned canonical playbooks selected for the run |
| 7 | `identity`, `soul` | Identity instructions (`identities/<name>.md`) first, then persona overlay (`SOUL.md`) |
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
2. Detects unexpected precedence collisions -- warnings are emitted when multiple sources share a precedence band outside the expected additive pairs/groups.
3. Concatenates content in precedence order, separated by double newlines.
4. Computes a `bundleHash` (SHA-256 of the compiled text).
5. Records any selected active playbooks in additive bundle metadata for audit and receipt use. Draft playbooks and pending proposals never compile.
6. Returns a `CompiledInstructionBundle` with a unique ID, the ordered sources, the compiled text, the bundle hash, any warnings, and a timestamp.

Expected same-band groups:

- precedence 4: zero or more `context_compat` sources discovered from `AGENTS.md` files between the effective `cwd` and the workspace root, then zero or more lexicographically ordered `context_native` sources from `.popeye/context/**/*.md`, then `WORKSPACE.md`
- precedence 7: `identities/<name>.md`, then `SOUL.md`

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
compilation until activation.

The control API exposes:

- `GET /v1/instruction-previews/:scope` — compiled bundle preview
- `GET /v1/instruction-previews/:scope/explain` — bundle plus effective context and ordered source metadata
- `POST /v1/instruction-previews/diff` — additive diff between two instruction contexts

The CLI exposes:

- `pop instructions preview --workspace <id> [--project <id>] [--profile <id>] [--identity <id>] [--cwd <path>]`
- `pop instructions preview --workspace <id> --explain`
- `pop instructions diff --left-workspace <id> --right-workspace <id> [...]`
- `pop identity list|current|show|use`

## Compatibility and persona files

- `AGENTS.md` is supported as a read-only compatibility context source inside a registered workspace.
- The resolver walks upward from the effective `cwd` to the workspace root and compiles each discovered `AGENTS.md` in root-most to leaf-most order.
- `.popeye/context/**/*.md` is the canonical Popeye-native recursive context surface and compiles after compatibility files but before `WORKSPACE.md`.
- `SOUL.md` is supported as an additive voice/persona overlay and compiles after the selected identity file.
- Workspace default identity is resolved in this order: explicit task/request override, stored workspace default, then `default`.
- Reusable procedures remain playbooks. Popeye does not compile a mutable `skills/` folder into instruction bundles.
- `WORKSPACE.md`, `PROJECT.md`, `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`, and `.popeye/context/**` are operator-owned and protected by default.
