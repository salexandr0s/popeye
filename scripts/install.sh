#!/usr/bin/env bash
# Popeye install script — builds, bundles, and installs a `pop` launcher.
# Usage: bash scripts/install.sh [--prefix /custom/path] [--force]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" && -d "/opt/homebrew/bin" ]]; then
  PREFIX="/opt/homebrew/bin"
else
  PREFIX="/usr/local/bin"
fi
APP_SUPPORT_DIR="$HOME/Library/Application Support/Popeye"
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Prerequisites
command -v pnpm >/dev/null 2>&1 || { echo "Error: pnpm not found. Install with: corepack enable && corepack prepare pnpm@latest --activate"; exit 1; }

NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
if [[ -z "$NODE_MAJOR" ]]; then
  echo "Error: node not found"; exit 1
fi
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Warning: Node $NODE_MAJOR detected. Node 22+ is recommended."
fi

echo "==> Installing dependencies"
cd "$ROOT_DIR"
pnpm install --frozen-lockfile

echo "==> Building"
pnpm typecheck

echo "==> Bundling CLI"
pnpm pack:cli

echo "==> Bundling daemon"
pnpm pack:daemon

echo "==> Building web inspector"
pnpm --filter @popeye/web-inspector build

echo "==> Installing pop launcher → $PREFIX/pop"
CLI_BUNDLE="$ROOT_DIR/apps/cli/dist/index.js"
if [[ ! -f "$CLI_BUNDLE" ]]; then
  echo "Error: CLI bundle not found at $CLI_BUNDLE"
  exit 1
fi
if [[ ! -d "$PREFIX" ]]; then
  echo "Error: install prefix $PREFIX does not exist. Pass --prefix <path> to override."
  exit 1
fi
if [[ ! -w "$PREFIX" ]]; then
  echo "Error: install prefix $PREFIX is not writable. Pass --prefix <path> to override."
  exit 1
fi
chmod +x "$CLI_BUNDLE"
cat > "$PREFIX/pop" <<EOF
#!/usr/bin/env bash
exec node "$CLI_BUNDLE" "\$@"
EOF
chmod 755 "$PREFIX/pop"

echo "==> Ensuring config directory"
mkdir -p "$APP_SUPPORT_DIR"
chmod 700 "$APP_SUPPORT_DIR"
if [[ ! -f "$APP_SUPPORT_DIR/config.json" ]]; then
  cp "$ROOT_DIR/config/example.json" "$APP_SUPPORT_DIR/config.json"
  echo "    Created default config at $APP_SUPPORT_DIR/config.json"
  echo "    Edit it before first run (set engine.kind, engine.piPath, etc.)"
elif [[ "$FORCE" -eq 1 ]]; then
  echo "    Preserving existing config at $APP_SUPPORT_DIR/config.json"
fi

echo ""
echo "==> Done!"
echo ""
echo "Next steps:"
echo "  1. Add to ~/.zprofile:"
echo "     export POPEYE_CONFIG_PATH=\"\$HOME/Library/Application Support/Popeye/config.json\""
echo "  2. Edit config: $APP_SUPPORT_DIR/config.json"
echo "  3. Initialize auth: pop auth init"
echo "  4. Verify: pop --version"
