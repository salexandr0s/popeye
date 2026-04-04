# Release notes template

Use this template when drafting release notes for a Popeye version. The
`scripts/generate-release-notes.sh` script produces a first draft; edit the
output to match this structure.

---

## Popeye v{VERSION}

**Date:** {YYYY-MM-DD}
**Git tag:** v{VERSION}
**Pi engine version:** {PI_VERSION}

### Highlights

- {1-3 sentence summary of the most important changes}

### Breaking changes

- {List each breaking change with migration steps. If none, write "None."}

### New features

- {feat commits, grouped by domain/area}

### Bug fixes

- {fix commits}

### Improvements

- {refactor, perf, chore commits worth noting}

### Dependencies

- {Notable dependency additions, removals, or version bumps}

### Upgrade instructions

1. Stop daemon: `pop daemon stop`
2. Create backup: `pop backup create`
3. Pull version: `git checkout v{VERSION}`
4. Install and build: `pnpm install --frozen-lockfile && pnpm build`
5. Start daemon: `pop daemon start`
6. Verify: `bash scripts/verify-upgrade.sh && pop security audit`

See `docs/runbooks/upgrade.md` for detailed upgrade procedures.

### Verification evidence

- `dev-verify` pass: {timestamp}
- Smoke test pass: {timestamp}
- Artifact checksums: see `CHECKSUMS.sha256`
- Backup/restore drill: {pass/fail with timestamp}

### Artifacts

| Artifact | Checksum (SHA-256) |
|----------|--------------------|
| `popeye-{VERSION}-darwin-arm64.pkg` | `{hash}` |
| `popeye-{VERSION}-darwin-arm64.tar.gz` | `{hash}` |
