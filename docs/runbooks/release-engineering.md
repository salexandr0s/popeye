# Release engineering runbook

For a real release-candidate pass, use:

- `internal/release-readiness.md` as the canonical readiness plan
- `internal/release-readiness-checklist.md` as the command companion

This runbook covers packaging/release mechanics; it is not a substitute for the
full installed-instance, domain, policy, recovery, and soak validation gate.

## Build and package

Use the `build-pkg.sh` script to create the packaged macOS distribution:

```bash
bash scripts/build-pkg.sh
```

This will:
1. Install dependencies with `pnpm install --frozen-lockfile`
2. Build the TypeScript workspace and bundle the companion CLI + daemon
3. Build a release `dist/pkg/PopeyeMac.app` bundle
4. Bundle the companion CLI at `PopeyeMac.app/Contents/Resources/Bootstrap/pop`
5. Bundle a private Apple Silicon Node 22 runtime at `PopeyeMac.app/Contents/Resources/Bootstrap/node/bin/node`
6. Bundle a private Apple Silicon Knowledge Python runtime closure at `PopeyeMac.app/Contents/Resources/Bootstrap/python/bin/python3` plus `python-site-packages/` and `knowledge-python-shims/`
7. Create a drag-and-drop tarball at `dist/pkg/popeye-<version>-darwin-arm64.tar.gz`
8. Create a `.pkg` installer at `dist/pkg/popeye-<version>-darwin-arm64.pkg` that installs the app to `/Applications`, the CLI/daemon wrappers to `/usr/local/bin`, the private Node runtime to `/usr/local/lib/popeye/node/bin/node`, and the Knowledge Python closure to `/usr/local/lib/popeye/python*`
9. Generate a SHA-256 checksum file alongside the release artifacts
10. Write `dist/pkg/SIGNING-STATUS.md` describing the current artifact state (unsigned until the signing step runs)

The bundled Node dependency closure is pruned to runtime-only files so packaged artifacts do not carry test/docs/build-source content from third-party packages.
The packaged Apple Silicon release now carries its own private Node 22 runtime; only source-checkout / local-dev workflows still require a separately installed Node 22+.
Packaged Apple Silicon releases now also carry a Popeye-owned Knowledge Python converter closure for **MarkItDown**, **Trafilatura**, and **Docling**. Packaged users should not be told to run `pip install` for those converters; only **Jina Reader** remains remote.

## Signing (macOS)

For distribution outside the development machine:

1. Build the package -- `bash scripts/build-pkg.sh`
2. Sign the packaged app first, then rebuild/sign the installer and final tarball:
   ```bash
   bash scripts/sign-pkg.sh
   ```

`scripts/sign-pkg.sh` now:
- signs `dist/pkg/PopeyeMac.app` with a Developer ID Application identity
- rebuilds `dist/pkg/popeye-<version>-darwin-arm64.tar.gz` from that signed app
- rebuilds `dist/pkg/popeye-<version>-darwin-arm64.pkg` from the signed app bundle
- signs the installer with a Developer ID Installer identity
- notarizes/staples the app archive and installer when Apple credentials are present
- rewrites `CHECKSUMS.sha256` and `SIGNING-STATUS.md` for the final artifact set

Note: For local-only use (single machine), signing and notarization are not required. Without signing identities, `scripts/sign-pkg.sh` exits cleanly and leaves the artifacts marked as local-only in `SIGNING-STATUS.md`. For release publishing, the workflow now sets `POPEYE_SIGNING_REQUIRED=true`, so missing Developer ID signing identities fail the release before artifacts are uploaded or drafted.

## Installation

### Packaged macOS distribution

After `bash scripts/build-pkg.sh`, you have two packaged install paths:

1. **Drag-and-drop app bundle**
   - unpack `dist/pkg/popeye-<version>-darwin-arm64.tar.gz`
   - move `PopeyeMac.app` into `/Applications`
   - launch the app and use the in-app bootstrap flow

2. **Installer package**
   - install `dist/pkg/popeye-<version>-darwin-arm64.pkg`
   - this places `PopeyeMac.app` in `/Applications`
   - it also installs `pop` / `popeyed` wrappers into `/usr/local/bin`, companion bundles into `/usr/local/lib/popeye`, a private Node runtime into `/usr/local/lib/popeye/node/bin/node`, and bundled Knowledge Python converter assets into `/usr/local/lib/popeye/python*`

These packaged release artifacts are currently Apple Silicon-only and do not require any system-wide Node installation or `pip install` for packaged Knowledge converters.

### Source-checkout / dev install

Use the install script when you want the local repo checkout wired into `/usr/local/bin`:

```bash
bash scripts/install.sh [--prefix /custom/path] [--force]
```

This builds local CLI bundles, symlinks `pop` to `/usr/local/bin`, and creates a default config at `~/Library/Application Support/Popeye/`.

## Smoke test

After installation or upgrade, run the smoke test:

```bash
bash scripts/smoke-test.sh
```

This verifies:
- `pop` binary is on PATH
- `pop --version` returns successfully
- Daemon health check responds (warning if daemon is not running)
- if the daemon is running, `pop knowledge converters` responds successfully so packaged converter readiness can be inspected

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
4. Remove `/Applications/PopeyeMac.app` if it was installed by the package
5. Preserve data at `~/Library/Application Support/Popeye/`

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
5. **Signing:** required for release publishing (runs `sign-pkg.sh` with `POPEYE_SIGNING_REQUIRED=true`; the job fails if Developer ID Application or Developer ID Installer signing is unavailable)
6. **Release:** creates a GitHub draft release with all artifacts attached

To run: **Actions → release → Run workflow → enter version (e.g. `0.1.0`)**

### Signing prerequisites

To enable signing and notarization, add these repository secrets:

| Secret | Purpose |
|--------|---------|
| `POPEYE_APP_SIGN_IDENTITY` | Developer ID Application certificate name |
| `POPEYE_SIGN_IDENTITY` | Developer ID Installer certificate name |
| `POPEYE_APPLE_ID` | Apple ID email for notarization |
| `POPEYE_TEAM_ID` | Apple Developer Team ID |
| `POPEYE_APP_PASSWORD` | App-specific password for notarization |

Without the signing identities, the workflow now fails before publishing a release. Apple notarization credentials remain optional; without them, the signed artifacts are still produced but notarization/stapling is skipped and reflected in `dist/pkg/SIGNING-STATUS.md`.

## Candidate SHA gate

Before cutting a release or calling a candidate GO, require green results on the
same frozen SHA for:

- `ci / verify`
- `security / semgrep`
- `codeql / Analyze (javascript-typescript)`
- `pi-smoke` if the intended Pi ref is part of the release bar

Do not mix release packaging with a moving candidate branch or a dirty worktree.

### Knowledge v1 gate

If the candidate includes Knowledge changes or is the first Knowledge-enabled
release, also require a green pass from `docs/runbooks/knowledge-beta-corpus.md`
on the same frozen SHA. That gate includes:

- the committed Knowledge corpus fixture suite
- the private beta corpus harness/report pass
- a stored Knowledge beta run with `gate.status = "passed"` for that candidate
- the beta run ID recorded in the release checklist or notes for the same SHA
- zero blocker-class Knowledge findings

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
