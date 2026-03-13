# @popeye/instructions

Instruction bundle compilation by precedence ordering. Resolves and merges
instruction sources (WORKSPACE.md, PROJECT.md, IDENTITY.md, task-level
instructions) into a single compiled bundle respecting the defined priority
chain. Sensitive content is redacted via the observability package before output.

## Key exports

- `compileInstructionBundle(sources)` -- merge instruction sources by precedence

## Dependencies

- `@popeye/contracts`
- `@popeye/observability`

## Layer

Runtime domain. Pure compilation logic with redaction at the output boundary.
