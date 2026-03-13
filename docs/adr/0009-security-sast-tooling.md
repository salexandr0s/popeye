# ADR 0009: Security SAST Tooling

- Status: Accepted
- Date: 2025-03-13

## Decision

ESLint with strict TypeScript rules serves as the current SAST layer. Defer external SAST tool (semgrep/CodeQL) until a network-facing surface is added.

## Rationale

- Loopback-only daemon with auth/CSRF/file-permissions defense in depth
- ESLint strict mode catches type confusion, unsafe operations, and code quality issues
- External SAST adds CI complexity without proportional value for a local-only v1
- `security:sast` script provides the hook point for future tooling

## Consequences

- `security:sast` remains ESLint-backed for now
- Revisit when adding web inspector, remote access, or any network-facing surface
- The script name is intentionally forward-looking — swapping in semgrep/CodeQL requires only a script change
