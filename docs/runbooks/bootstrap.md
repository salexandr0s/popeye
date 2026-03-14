# Bootstrap runbook

Step-by-step setup from a fresh macOS installation.

## Prerequisites

- macOS (Apple Silicon or Intel)
- Terminal access
- API keys for configured providers

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

Set `runtimeDataDir`, `authFile`, `engine.kind`, `engine.command`, `engine.piPath`, and `engine.piVersion` in config.

- `config/example.json` defaults `engine.kind` to `"fake"`; change it to `"pi"` before the first real-engine run
- `engine.kind` should be `"pi"` when using the real engine
- `engine.piPath` should usually stay `../pi`
- `engine.piVersion` must match `../pi/packages/coding-agent/package.json`

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

### 12. Run Pi smoke test

```bash
pop pi smoke
```

### 13. Install as LaunchAgent (optional)

```bash
pop daemon install && pop daemon load
```

### 14. Verify

```bash
pop daemon status
```

## Common issues

- **Permission denied** — ensure `runtimeDataDir` exists with `chmod 700`
- **Daemon fails to start** — check `POPEYE_CONFIG_PATH` is set and valid
- **Pi version mismatch** — run `pnpm verify:pi-checkout -- --pi-path ../pi` and copy the `packages/coding-agent/package.json` version into `engine.piVersion`
- **Security audit fails** — most common: directory permissions not 700
- **LaunchAgent not loading** — check `~/Library/LaunchAgents/` permissions
