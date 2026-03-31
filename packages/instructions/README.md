# @popeye/instructions

Instruction bundle compilation and resolution for the Popeye runtime. Resolves
instruction sources from the file system and merges them into a single compiled
bundle respecting a defined precedence chain.

## Purpose

Implements the instruction resolution pipeline: discover sources (WORKSPACE.md,
PROJECT.md, active playbooks, IDENTITY.md, task briefs, trigger overlays,
runtime notes), order them by precedence, detect conflicts, and compile into a
hashed bundle. Only active canonical playbooks participate; drafts and pending
proposals remain outside instruction compilation until activation. Content is
hashed via `@popeye/observability` for change detection and dedup.

## Layer

Runtime domain. Resolution reads instruction files; compilation is pure logic.

## Provenance

New platform implementation.

## Key exports

| Export                          | Description                                                |
| -------------------------------- | ---------------------------------------------------------- |
| `compileInstructionBundle()`    | Merge instruction sources by precedence into a bundle       |
| `buildPlaybookInstructionSource()` | Collapse selected playbooks into the deterministic playbook source |
| `resolveInstructionSources()`   | Discover and read instruction files for a given context     |
| `ResolverDependencies`          | Interface for workspace/project lookup during resolution    |

### Precedence order (lowest number = lowest precedence, applied first)

1. Pi base instructions
2. Popeye base instructions
3. Global operator instructions
4. Workspace (`WORKSPACE.md`)
5. Project (`PROJECT.md`)
6. Playbooks
7. Identity (`identities/<name>.md`)
8. Task brief
9. Trigger overlay
10. Runtime notes

## Dependencies

- `@popeye/contracts` -- `InstructionSource`, `CompiledInstructionBundle`, `InstructionResolutionContext`
- `@popeye/observability` -- `sha256` for content hashing

## Usage

```ts
import { compileInstructionBundle } from '@popeye/instructions';

const bundle = compileInstructionBundle(sources);
console.log(bundle.compiledText, bundle.bundleHash);
```

See `src/index.test.ts` and `src/resolver.test.ts` for precedence and
resolution tests.
