# @popeye/playbooks

Owned playbook parsing, canonical hashing, scope loading, and deterministic
selection for Popeye.

## Purpose

Implements the first-class Popeye playbook domain as operator-owned canonical
markdown artifacts. This package parses playbook front matter, normalizes body
content, computes canonical revision hashes, and loads scoped playbooks from
global, workspace, and project storage. Proposal review/apply lifecycle lives
in the runtime layer and materializes back into these canonical markdown files.

## Layer

Runtime domain. File-backed procedural artifact loading for instruction
resolution.

## Provenance

New platform implementation.

## Key exports

| Export | Description |
| --- | --- |
| `parsePlaybookMarkdown()` | Parse markdown front matter and compute canonical hashes |
| `discoverScopedPlaybooks()` | Load playbooks from scoped directories and deterministically select active matches |
| `renderPlaybookMarkdown()` | Render canonical markdown for file-backed playbooks |
| `buildPlaybookDiff()` | Produce a deterministic preview diff for playbook changes |
| `toAppliedPlaybook()` | Convert a resolved playbook into the auditable applied-playbook summary |

## Dependencies

- `@popeye/contracts` — playbook schemas and shared types
- `@popeye/observability` — SHA-256 hashing
