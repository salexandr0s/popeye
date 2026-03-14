# ADR 0009: Security SAST Tooling

- Status: Accepted
- Date: 2025-03-13
- Updated: 2026-03-14

## Decision

Keep ESLint with strict TypeScript rules as the local developer-facing baseline,
and add a dedicated CI security workflow that runs **Semgrep** against the
repository on pushes to `main` and on pull requests.

## Rationale

- The repository now includes a browser-facing web inspector bootstrap flow,
  which crosses the threshold originally called out for revisiting SAST posture.
- ESLint strict mode still catches type confusion, unsafe operations, and code
  quality issues during local development.
- A dedicated Semgrep workflow adds a security-specific signal in CI without
  forcing every local developer to install Semgrep.
- The split posture keeps `security:sast` cheap locally while making CI enforce
  a broader security ruleset.

## Consequences

- `security:sast` remains ESLint-backed for local and `dev-verify` usage.
- CI now enforces an additional Semgrep pass via `.github/workflows/security.yml`.
- Future expansion to CodeQL or SARIF upload can layer on top of the Semgrep job
  without changing the local developer workflow.
