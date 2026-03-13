# @popeye/observability

Redact-on-write engine and hashing utilities for the Popeye platform. Ensures
secrets never leak into logs, receipts, memory storage, or any persisted output.

## Purpose

Applies pattern-based redaction to text before it reaches any persistence
boundary. Ships with built-in patterns for common secret formats and supports
custom regex patterns per deployment. Also provides a deterministic SHA-256
hashing utility used throughout the platform for dedup keys and content hashes.

## Layer

Cross-cutting. Used by runtime and domain packages that persist data.

## Provenance

New platform implementation.

## Key exports

| Export          | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `redactText()`  | Apply all configured patterns, returning cleaned text + audit events |
| `sha256()`      | Deterministic SHA-256 hash for dedup keys and identifiers    |

### Built-in redaction patterns

- OpenAI API keys (`sk-...`)
- Anthropic API keys (`sk-ant-...`)
- GitHub PATs (`github_pat_...`)
- AWS access keys (`AKIA...`)
- Bearer tokens
- PEM private key blocks
- JWTs (`eyJ...`)
- Hex secrets (40+ chars)
- Slack webhook URLs

## Dependencies

- `@popeye/contracts` -- `SecurityAuditEvent` type for redaction audit trail

## Usage

```ts
import { redactText, sha256 } from '@popeye/observability';

const { text, events } = redactText('My key is sk-abc123def456ghi789');
// text => 'My key is [REDACTED:openai-key]'
// events => [{ code: 'redaction_applied', ... }]

const hash = sha256('some content');
```

See `src/index.test.ts` for redaction pattern coverage tests.
