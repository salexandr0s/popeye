# Bootstrap runbook

Step-by-step setup from a fresh macOS installation.

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
- if omitted, `runtimeDataDir` now defaults to `~/Library/Application Support/Popeye/`
- if omitted, `authFile` now defaults to `<runtimeDataDir>/config/auth.json`
- set `providerAuth.google.clientId` / `providerAuth.google.clientSecret` to
  enable the blessed Gmail and Google Calendar browser-OAuth flows
- set `providerAuth.github.clientId` / `providerAuth.github.clientSecret` to
  enable the blessed GitHub browser-OAuth flow

### 8. Verify the Pi checkout and version pin

```bash
pnpm verify:pi-checkout -- --pi-path ../pi
```

### 9. Initialize auth

```bash
pop auth init
```

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
Todoist flow uses a manual API token and stores it in the secret store. The
legacy CLI-backed adapters remain available only as experimental fallbacks.

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
```

## Bundled install (alternative)

Instead of running from the monorepo checkout, you can build standalone bundles.

### Prerequisites

- **Node.js 22 LTS** — required runtime
- **pnpm** — `corepack enable && corepack prepare pnpm@latest --activate`

### Run the installer

```bash
bash scripts/install.sh [--prefix /custom/path] [--force]
```

| Flag | Effect |
|------|--------|
| `--prefix <path>` | Launcher location (default: `/opt/homebrew/bin` on Apple Silicon Homebrew hosts, otherwise `/usr/local/bin`) |
| `--force` | Rebuild/reinstall bundles and launcher, while preserving an existing `config.json` |

### What install.sh does

1. Checks for `pnpm` and warns if Node < 22
2. Runs `pnpm install --frozen-lockfile`
3. Type-checks the project
4. Bundles CLI → `apps/cli/dist/index.js` (tsup, inlines all `@popeye/*` packages)
5. Bundles daemon → `apps/daemon/dist/index.js`
6. Builds the web inspector → `apps/web-inspector/dist/`
7. Writes a `pop` launcher to `<prefix>/pop`
8. Creates `~/Library/Application Support/Popeye/config.json` from `config/example.json` only if it does not already exist

Package builds emit to `dist/` only. Source-adjacent generated `src/*.js`,
`src/*.d.ts`, and sourcemap artifacts are intentionally rejected by
`pnpm verify:src-build-artifacts`.

### Where things end up

| Artifact | Location |
|----------|----------|
| CLI bundle | `apps/cli/dist/index.js` |
| Daemon bundle | `apps/daemon/dist/index.js` |
| Web inspector bundle | `apps/web-inspector/dist/` |
| Launcher | `/opt/homebrew/bin/pop` on Apple Silicon Homebrew hosts, otherwise `/usr/local/bin/pop` (or custom prefix) |
| Config | `~/Library/Application Support/Popeye/config.json` |
| Runtime data | `~/Library/Application Support/Popeye/` by default, or configured via `runtimeDataDir` |
| Auth store | `<runtimeDataDir>/config/auth.json` by default, or configured via `authFile` |

### After install

```bash
# 1. Set config path in ~/.zprofile
export POPEYE_CONFIG_PATH="$HOME/Library/Application Support/Popeye/config.json"

# 2. Edit config (set engine.kind, piPath, and any non-default runtime paths)

# 3. Initialize auth
pop auth init

# 4. Verify
pop --version
```

### How `pop daemon install` works in bundled mode

When running from a bundle, `pop daemon install` detects bundled mode and resolves the daemon entrypoint relative to the CLI bundle:

- CLI: `apps/cli/dist/index.js`
- Daemon: `apps/daemon/dist/index.js` (resolved as `../../daemon/dist/index.js` from CLI bundle)
- Working directory: monorepo root (resolved as `../../../` from CLI bundle)

The generated LaunchAgent plist points to `node apps/daemon/dist/index.js` with `POPEYE_CONFIG_PATH` set. In dev mode, it points to `apps/daemon/src/index.ts` via tsx instead.

## Common issues

- **Permission denied** — ensure `runtimeDataDir` exists with `chmod 700`
- **Daemon fails to start** — check `POPEYE_CONFIG_PATH` is set and valid
- **Pi version mismatch** — run `pnpm verify:pi-checkout -- --pi-path ../pi` and copy the `packages/coding-agent/package.json` version into `engine.piVersion`
- **Security audit fails** — most common: directory permissions not 700
- **LaunchAgent not loading** — check `~/Library/LaunchAgents/` permissions
- **CLI bundle not found** — run `pnpm pack:cli` to regenerate the bundle
- **Daemon bundle not found** — run `pnpm pack:daemon` to regenerate the bundle
