# @popeye/observability

Redact-on-write engine for sensitive data. All secret patterns are stripped
before content reaches logs, receipts, memory storage, or any persisted output.
This ensures secrets never leak into operational records.

## Key exports

- `redactText(input)` -- apply all configured patterns to strip sensitive data
- `sha256(input)` -- deterministic hash for dedup keys and identifiers
- Built-in patterns for OpenAI API keys, GitHub PATs, JWTs, PEM private keys, Bearer tokens

## Dependencies

- `@popeye/contracts`

## Layer

Cross-cutting. Used by runtime and domain packages that persist data.
