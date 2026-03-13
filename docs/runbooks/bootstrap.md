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
git clone <repo-url> popeye && cd popeye
pnpm install
```

### 4. Create configuration

```bash
cp config/example.json ~/Library/Application\ Support/Popeye/config.json
```

### 5. Set config path

Add to `~/.zprofile`:

```bash
export POPEYE_CONFIG_PATH="$HOME/Library/Application Support/Popeye/config.json"
```

### 6. Edit configuration

Set `runtimeDataDir`, `authFile`, `engine.command`, `engine.piPath` in config.

### 7. Initialize auth

```bash
pop auth init
```

### 8. Test foreground start

```bash
pop daemon start
```

### 9. Run security audit

```bash
pop security audit
```

### 10. Install as LaunchAgent (optional)

```bash
pop daemon install && pop daemon load
```

### 11. Verify

```bash
pop daemon status
```

## Common issues

- **Permission denied** — ensure `runtimeDataDir` exists with `chmod 700`
- **Daemon fails to start** — check `POPEYE_CONFIG_PATH` is set and valid
- **Security audit fails** — most common: directory permissions not 700
- **LaunchAgent not loading** — check `~/Library/LaunchAgents/` permissions
