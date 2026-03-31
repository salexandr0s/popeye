# Release engineering runbook

For a real release-candidate pass, use:

- `internal/release-readiness.md` as the canonical readiness plan
- `internal/release-readiness-checklist.md` as the command companion

This runbook covers packaging/release mechanics; it is not a substitute for the
full installed-instance, domain, policy, recovery, and soak validation gate.

## Build and package

Use the `build-pkg.sh` script to create a distribution tarball:

```bash
bash scripts/build-pkg.sh
```

This will:
1. Install dependencies with `pnpm install --frozen-lockfile`
2. Build all packages with `pnpm build`
3. Create a tarball at `dist/pkg/popeye-<version>-darwin.tar.gz`
4. Generate a SHA-256 checksum file alongside the tarball

## Signing (macOS)

For distribution outside the development machine:

1. Build the package -- `bash scripts/build-pkg.sh`
2. Sign the tarball with a developer identity:
   ```bash
   codesign --sign "Developer ID Application: <identity>" dist/pkg/popeye-*.tar.gz
   ```
3. Notarize if distributing outside the App Store:
   ```bash
   xcrun notarytool submit dist/pkg/popeye-*.tar.gz \
     --apple-id <apple-id> \
     --team-id <team-id> \
     --password <app-specific-password> \
     --wait
   ```

Note: For local-only use (single machine), signing and notarization are not required.

## Installation

Use the install script:

```bash
bash scripts/install.sh [--prefix /custom/path] [--force]
```

This builds, bundles the CLI and daemon, builds the web inspector, and installs a `pop` launcher in the
default local bin directory (`/opt/homebrew/bin` on Apple Silicon Homebrew
hosts, otherwise `/usr/local/bin`),
and creates a default config at `~/Library/Application Support/Popeye/`.

## Smoke test

After installation or upgrade, run the smoke test:

```bash
bash scripts/smoke-test.sh
```

This verifies:
- `pop` binary is on PATH
- `pop --version` returns successfully
- Daemon health check responds (warning if daemon is not running)

## Upgrade verification

After upgrading a running installation:

```bash
bash scripts/verify-upgrade.sh
```

This checks daemon status and version.

## Uninstall

To remove Popeye binaries and LaunchAgent without deleting data:

```bash
bash scripts/uninstall.sh
```

This will:
1. Unload the LaunchAgent if active
2. Remove the LaunchAgent plist
3. Remove `pop` / `popeyed` launchers from both `/usr/local/bin/` and `/opt/homebrew/bin/` when present
4. Preserve data at `~/Library/Application Support/Popeye/`

To fully remove data after uninstalling:

```bash
rm -rf "$HOME/Library/Application Support/Popeye"
```

## Version management

- The version is read from the root `package.json`
- All `@popeye/` packages share a workspace version
- Bump versions before building a release package
- Tag releases with `git tag v<version>` after verification passes

## Release notes generation

After commits are finalized for a release, generate draft release notes:

```bash
bash scripts/generate-release-notes.sh
```

This will:
1. Parse `git log` from the last tag to HEAD (or all commits if no tags exist)
2. Categorize commits by conventional type (feat, fix, chore, refactor, etc.)
3. Flag any commits containing "BREAKING" or "breaking change"
4. Read the version from `package.json` and Pi engine version from `packages/engine-pi/package.json`
5. Write a draft to `dist/pkg/RELEASE-NOTES.md` following the template in `docs/templates/release-notes.md`

The script is idempotent and can be re-run safely. Review and edit the output
before publishing -- the script produces a first draft, not the final document.

## Breaking changes

All breaking changes are tracked in `docs/BREAKING-CHANGES.md`. This file is
manually curated -- the release notes generator flags potential breaking changes
but does not update this document.

Before each release:
1. Review flagged breaking changes in the generated release notes
2. Add confirmed breaking changes to `docs/BREAKING-CHANGES.md` under the
   appropriate version heading with a description and migration steps
3. Ensure the release notes reference the breaking changes document

## Artifact inventory

After building release artifacts, produce an inventory manifest:

```bash
bash scripts/artifact-inventory.sh
```

This will:
1. Enumerate `.pkg` and `.tar.gz` artifacts in `dist/pkg/`
2. Read checksums from `CHECKSUMS.sha256`
3. Record version, Git SHA, build date, and Pi engine version
4. Run `pnpm verify:generated-artifacts` and `pnpm test` to report pass/fail status
5. Write the manifest to `dist/pkg/INVENTORY.md`

The script requires `dist/pkg/` to exist (run `bash scripts/build-pkg.sh` first).
It is idempotent and can be re-run safely.

## GitHub Actions release workflow

The `.github/workflows/release.yml` workflow automates the full release pipeline:

1. **Trigger:** Manual dispatch with a `version` input
2. **Verification:** lint, typecheck, tests, contract verification, secret scan
3. **Build:** `pnpm build` + `build-pkg.sh` (includes tsup bundling)
4. **Artifacts:** release notes, artifact inventory, checksums
5. **Signing:** optional (runs `sign-pkg.sh`, skips gracefully without certs)
6. **Release:** creates a GitHub draft release with all artifacts attached

To run: **Actions → release → Run workflow → enter version (e.g. `0.1.0`)**

### Signing prerequisites

To enable signing and notarization, add these repository secrets:

| Secret | Purpose |
|--------|---------|
| `POPEYE_SIGN_IDENTITY` | Developer ID Installer certificate name |
| `POPEYE_APPLE_ID` | Apple ID email for notarization |
| `POPEYE_TEAM_ID` | Apple Developer Team ID |
| `POPEYE_APP_PASSWORD` | App-specific password for notarization |

Without these secrets, the workflow skips signing and produces an unsigned .pkg.

## Candidate SHA gate

Before cutting a release or calling a candidate GO, require green results on the
same frozen SHA for:

- `ci / verify`
- `security / semgrep`
- `codeql / Analyze (javascript-typescript)`
- `pi-smoke` if the intended Pi ref is part of the release bar

Do not mix release packaging with a moving candidate branch or a dirty worktree.

## Pi smoke CI (daily)

The `.github/workflows/pi-smoke.yml` runs nightly at 03:00 UTC. To activate:

1. Go to **Settings → Variables → Repository variables**
2. Add `PI_REPOSITORY` with the value `owner/repo` for the Pi fork
3. Go to **Settings → Secrets → Repository secrets**
4. Add `PI_CHECKOUT_TOKEN` with a PAT that has read access to the Pi repo

The workflow also supports manual dispatch with custom Pi ref, command, and args.

## Version bump checklist

When preparing a release:

1. Bump `"version"` in root `package.json`
2. Commit: `git commit -am "chore: bump version to X.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push origin main --tags`
5. Run the release workflow from GitHub Actions

## Checklist

Before releasing:

- [ ] All tests pass -- `pnpm dev-verify`
- [ ] No security audit findings -- `pop security audit`
- [ ] Contracts generated and verified -- `pnpm verify:generated-artifacts`
- [ ] No source-adjacent build artifacts -- `pnpm verify:src-build-artifacts`
- [ ] Changelog updated
- [ ] Breaking changes documented -- `docs/BREAKING-CHANGES.md`
- [ ] Version bumped in `package.json`
- [ ] Git tag created -- `git tag vX.Y.Z`
- [ ] Package built -- `bash scripts/build-pkg.sh`
- [ ] Release notes generated -- `bash scripts/generate-release-notes.sh`
- [ ] Artifact inventory produced -- `bash scripts/artifact-inventory.sh`
- [ ] Smoke test passes -- `bash scripts/smoke-test.sh`
- [ ] Upgrade verification passes -- `bash scripts/verify-upgrade-path.sh --json`
- [ ] Installed-instance playbook/proposal smoke completed on the candidate host
- [ ] `internal/release-readiness.md` / `internal/release-readiness-checklist.md` evidence set is complete
