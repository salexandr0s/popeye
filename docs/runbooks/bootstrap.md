# Bootstrap runbook

Step-by-step setup from a fresh macOS installation.

## Recommended macOS app-first bootstrap

If you are onboarding with the Popeye macOS app, you no longer need to copy a
bearer token out of `auth.json`. The preferred first-run path is:

1. Launch the Popeye macOS app
2. Click **Create Local Setup**
3. Click **Start Popeye**
4. Click **Grant Local Access**

That flow creates local config/runtime defaults if missing, starts the daemon,
and stores a native app session in macOS Keychain.

Manual bearer-token entry remains available only as an advanced fallback for
remote/debug setups.

For local bootstrap commands, the macOS app resolves the Popeye CLI in this
order:

1. bundled companion CLI at `Resources/Bootstrap/pop`
2. `POPEYE_MAC_BOOTSTRAP_CLI`
3. `/usr/local/bin/pop`
4. `/opt/homebrew/bin/pop`
5. ``which pop``

The packaged macOS distribution now makes that bundled companion path real at:

- `dist/pkg/PopeyeMac.app/Contents/Resources/Bootstrap/pop`

Use `bash scripts/build-macos-app.sh` for a raw app bundle or `bash scripts/build-pkg.sh` for the full release artifacts.

## Prerequisites

- macOS (Apple Silicon or Intel)
- Terminal access
- API keys for configured providers
- Google OAuth client credentials if you want the blessed Gmail / Google
  Calendar browser connect flows
- GitHub OAuth client credentials if you want the blessed GitHub browser
  connect flow

## Steps

### 1. Install Node.js 22 LTS

```bash
brew install node@22
# or: nvm install 22 && nvm use 22
```

### 2. Enable corepack and install pnpm

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

### 3. Clone and install

```bash
git clone <popeye-repo-url> popeye
git clone <pi-repo-url> pi
cd popeye
pnpm install
```

### 4. Build the sibling Pi checkout

```bash
cd ../pi
npm ci
npm run build
cd ../popeye
```

The default Popeye Pi path is the sibling checkout `../pi`.

### 5. Create configuration

```bash
cp config/example.json ~/Library/Application\ Support/Popeye/config.json
```

If you copy `config/example.json` directly, either delete or replace its sample
`runtimeDataDir` / `authFile` values before first real use. When those fields
are omitted, Popeye defaults them to:

- `runtimeDataDir`: `~/Library/Application Support/Popeye`
- `authFile`: `~/Library/Application Support/Popeye/config/auth.json`

For the built-in `default` workspace, Popeye also defaults `rootPath` to:

- `~/popeye-assistant`

and scaffolds a Popeye-owned assistant workspace there on first daemon start.

### 6. Set config path

Add to `~/.zprofile`:

```bash
export POPEYE_CONFIG_PATH="$HOME/Library/Application Support/Popeye/config.json"
```

### 7. Edit configuration

Set `engine.kind`, `engine.command`, `engine.piPath`, and `engine.piVersion` in config.

- `config/example.json` defaults `engine.kind` to `"fake"`; change it to `"pi"` before the first real-engine run
- `engine.kind` should be `"pi"` when using the real engine
- `engine.piPath` should usually stay `../pi`
- `engine.piVersion` must match `../pi/packages/coding-agent/package.json`
- if omitted, `runtimeDataDir` defaults to `~/Library/Application Support/Popeye/`
- if omitted, `authFile` now defaults to `<runtimeDataDir>/config/auth.json`
- if omitted for the built-in `default` workspace, `workspaces[0].rootPath` defaults to `~/popeye-assistant`
- on first daemon start, Popeye scaffolds:
  - `WORKSPACE.md`
  - `AGENTS.md` (compatibility context)
  - `.popeye/context/README.md` (preferred native context location)
  - `SOUL.md` (persona overlay)
  - `IDENTITY.md` (operator-facing mirror)
  - `identities/default.md` (canonical runtime identity)
  in `~/popeye-assistant`
- configure Google OAuth in Popeye so `providerAuth.google.clientId` is set and
  `providerAuth.google.clientSecretRefId` points at a stored secret; this
  enables the blessed Gmail, Google Calendar, and Google Tasks browser-OAuth flows
- configure GitHub OAuth in Popeye so `providerAuth.github.clientId` is set and
  `providerAuth.github.clientSecretRefId` points at a stored secret; this
  enables the blessed GitHub browser-OAuth flow

### 8. Verify the Pi checkout and version pin

```bash
pnpm verify:pi-checkout -- --pi-path ../pi
```

### 9. Initialize auth (CLI / advanced fallback only)

```bash
pop auth init
```

The macOS app-first bootstrap path now performs local auth/session setup for
you. Manual `pop auth init` is only required for CLI-first or advanced/manual
connection flows.

### 10. Test foreground start

```bash
pop daemon start
```

### 11. Run security audit

```bash
pop security audit
```

### 12. Verify daemon health

```bash
pop daemon health
```

### 13. Run Pi smoke test

```bash
pop pi smoke
```

### 14. Connect blessed providers (optional after the daemon is running)

```bash
pop email connect --gmail
pop calendar connect
pop github connect
pop todo connect
```

These commands open browser OAuth for the blessed direct-provider paths. The
Google Tasks flow reuses the same shared Google OAuth substrate as Gmail and
Calendar. Todo writes then use the stored OAuth secret through the runtime's
connection and secret-store system.

If you are driving a remote host over SSH, prefer `--no-open`, establish a
local port forward for the callback port first, and then open the printed URL
in your local browser.

### 15. Verify generated contracts

```bash
pnpm verify:generated-artifacts
```

### 16. Install as LaunchAgent (optional)

```bash
pop daemon install && pop daemon load
```

### 17. Verify

```bash
pop daemon status
pop daemon health
pop instructions preview --workspace default --explain
pop identity list --workspace default
pop playbook recommend "triage inbox" --workspace default
```

## Local-install vs packaged-install alternatives

Once the repo is available, you can either:

- use `bash scripts/install.sh` to wire the local repo checkout into `/usr/local/bin` (still requires a system Node 22+), or
- build and ship the packaged Apple Silicon artifacts from `bash scripts/build-pkg.sh` (these carry a private Node runtime plus a bundled Knowledge Python converter runtime and do not require a system Node install or `pip install` for packaged Knowledge conversion)

### Prerequisites for `install.sh`

- **Node.js 22 LTS**
- **pnpm** — `corepack enable && corepack prepare pnpm@latest --activate`

### Run the installer

```bash
bash scripts/install.sh [--prefix /custom/path] [--force]
```

| Flag | Effect |
|------|--------|
| `--prefix <path>` | Symlink location (default: `/usr/local/bin`) |
| `--force` | Rebuild/relink bundles and symlink; preserves existing `config.json` |

### What install.sh does

1. Checks for `pnpm` and warns if Node < 22
2. Runs `pnpm install --frozen-lockfile`
3. Type-checks the project
4. Bundles CLI → `apps/cli/dist/index.cjs` (tsup, inlines all `@popeye/*` packages)
5. Bundles daemon → `apps/daemon/dist/index.cjs`
6. Symlinks `pop` → `<prefix>/pop`
7. Creates `~/Library/Application Support/Popeye/config.json` from `config/example.json` (skips if exists, unless `--force`)
8. Rewrites first-run config defaults to local paths:
   - `runtimeDataDir` → `~/Library/Application Support/Popeye`
   - `authFile` → `~/Library/Application Support/Popeye/config/auth.json`
   - built-in default workspace root → `~/popeye-assistant`

Package builds emit to `dist/` only. Source-adjacent generated `src/*.js`,
`src/*.d.ts`, and sourcemap artifacts are intentionally rejected by
`pnpm verify:src-build-artifacts`.

### Packaged `.app` / `.pkg` artifacts

For packaged release artifacts built via `bash scripts/build-pkg.sh`:

- the packaged artifacts are currently **Apple Silicon-only**
- the app bundle includes a private Node runtime at
  `PopeyeMac.app/Contents/Resources/Bootstrap/node/bin/node`
- the app bundle also includes a bundled Knowledge Python runtime at
  `PopeyeMac.app/Contents/Resources/Bootstrap/python/bin/python3`
- packaged Knowledge converter shims live at
  `PopeyeMac.app/Contents/Resources/Bootstrap/knowledge-python-shims`
- the installer installs that same runtime at
  `/usr/local/lib/popeye/node/bin/node`
- the installer also places the Knowledge Python runtime + site-packages under
  `/usr/local/lib/popeye/python`, `/usr/local/lib/popeye/python-site-packages`,
  and `/usr/local/lib/popeye/knowledge-python-shims`
- end users do **not** need to install Node globally for those packaged paths
- end users do **not** need to run `python3 -m pip install markitdown trafilatura docling`
  for packaged `.app` / `.pkg` installs
- source-checkout / `install.sh` workflows still require a system Node 22+
- source-checkout / `install.sh` workflows still use system Python tools or native
  degraded fallback for Knowledge converters

### Where things end up

| Artifact | Location |
|----------|----------|
| CLI bundle | `apps/cli/dist/index.cjs` |
| Daemon bundle | `apps/daemon/dist/index.cjs` |
| Symlink | `/usr/local/bin/pop` (or custom prefix) |
| Config | `~/Library/Application Support/Popeye/config.json` |
| Default assistant workspace | `~/popeye-assistant/` |
| Runtime data | `~/Library/Application Support/Popeye/` by default, or configured via `runtimeDataDir` |
| Auth store | `<runtimeDataDir>/config/auth.json` by default, or configured via `authFile` |

### After install

```bash
# 1. Set config path in ~/.zprofile
export POPEYE_CONFIG_PATH="$HOME/Library/Application Support/Popeye/config.json"

# 2. Edit config (set engine.kind, piPath, and any non-default runtime paths)

# 3. (Optional) initialize auth for CLI-first or advanced/manual flows
pop auth init

# 4. Start once to scaffold the default assistant workspace
pop daemon start

# 5. Verify
pop --version
```

### How `pop daemon install` works in bundled mode

When running from a bundle, `pop daemon install` detects bundled mode and resolves the daemon entrypoint relative to the CLI bundle:

- CLI: `apps/cli/dist/index.cjs`
- Daemon: `apps/daemon/dist/index.cjs` (resolved as `../../daemon/dist/index.cjs` from CLI bundle)
- Working directory: monorepo root (resolved as `../../../` from CLI bundle)

The generated LaunchAgent plist points to `node apps/daemon/dist/index.cjs` with `POPEYE_CONFIG_PATH` set. In dev mode, it points to `apps/daemon/src/index.ts` via tsx instead.

## Common issues

- **Permission denied** — ensure `runtimeDataDir` exists with `chmod 700`
- **Daemon fails to start** — check `POPEYE_CONFIG_PATH` is set and valid
- **Pi version mismatch** — run `pnpm verify:pi-checkout -- --pi-path ../pi` and copy the `packages/coding-agent/package.json` version into `engine.piVersion`
- **Security audit fails** — most common: directory permissions not 700
- **LaunchAgent not loading** — check `~/Library/LaunchAgents/` permissions
- **LaunchAgent stop/load flake** — use `pop daemon stop`/`pop daemon load`; Popeye unloads via plist-path `launchctl bootout` because raw label-target bootout can leave services stuck `SIGTERMed` on macOS.
- **CLI bundle not found** — run `pnpm pack:cli` to regenerate the bundle
- **Daemon bundle not found** — run `pnpm pack:daemon` to regenerate the bundle
