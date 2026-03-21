# Release engineering runbook

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

This builds, bundles the CLI and daemon, symlinks `pop` to `/usr/local/bin`,
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
3. Remove `/usr/local/bin/pop` and `/usr/local/bin/popeyed` symlinks
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

## Checklist

Before releasing:

- [ ] All tests pass -- `dev-verify`
- [ ] No security audit findings -- `pop security audit`
- [ ] Contracts generated and verified -- `pnpm generate:contracts && pnpm verify:generated-artifacts`
- [ ] No source-adjacent build artifacts -- `pnpm verify:src-build-artifacts`
- [ ] Changelog updated
- [ ] Breaking changes documented -- `docs/BREAKING-CHANGES.md`
- [ ] Version bumped in `package.json`
- [ ] Package built -- `bash scripts/build-pkg.sh`
- [ ] Release notes generated -- `bash scripts/generate-release-notes.sh`
- [ ] Artifact inventory produced -- `bash scripts/artifact-inventory.sh`
- [ ] Smoke test passes -- `bash scripts/smoke-test.sh`
- [ ] Upgrade verification passes on a test installation -- `bash scripts/verify-upgrade.sh`
