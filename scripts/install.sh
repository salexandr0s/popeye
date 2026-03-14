#!/usr/bin/env bash
# Popeye install script — builds, bundles, and symlinks `pop` to /usr/local/bin.
# Usage: bash scripts/install.sh [--prefix /custom/path]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PREFIX="/usr/local/bin"
APP_SUPPORT_DIR="$HOME/Library/Application Support/Popeye"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "==> Installing dependencies"
cd "$ROOT_DIR"
pnpm install --frozen-lockfile

echo "==> Building"
pnpm typecheck

echo "==> Bundling CLI"
pnpm pack:cli

echo "==> Bundling daemon"
pnpm pack:daemon

echo "==> Symlinking pop → $PREFIX/pop"
CLI_BUNDLE="$ROOT_DIR/apps/cli/dist/index.mjs"
if [[ ! -f "$CLI_BUNDLE" ]]; then
  echo "Error: CLI bundle not found at $CLI_BUNDLE"
  exit 1
fi
chmod +x "$CLI_BUNDLE"
ln -sf "$CLI_BUNDLE" "$PREFIX/pop"

echo "==> Ensuring config directory"
mkdir -p "$APP_SUPPORT_DIR"
chmod 700 "$APP_SUPPORT_DIR"
if [[ ! -f "$APP_SUPPORT_DIR/config.json" ]]; then
  cp "$ROOT_DIR/config/example.json" "$APP_SUPPORT_DIR/config.json"
  echo "    Created default config at $APP_SUPPORT_DIR/config.json"
  echo "    Edit it before first run (set engine.kind, engine.piPath, etc.)"
fi

echo "==> Done. Run 'pop --help' to get started."
