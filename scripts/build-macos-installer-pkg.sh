#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$#" -ne 2 ]; then
  echo "Usage: bash scripts/build-macos-installer-pkg.sh <app-bundle> <output-pkg>" >&2
  exit 1
fi

APP_BUNDLE_DIR="$1"
OUTPUT_PKG_PATH="$2"
APP_BASENAME="$(basename "$APP_BUNDLE_DIR")"
VERSION=$(node -p "require('./package.json').version")

if [ ! -d "$APP_BUNDLE_DIR" ]; then
  echo "ERROR: App bundle not found at $APP_BUNDLE_DIR" >&2
  exit 1
fi
if [ ! -f "apps/cli/dist/index.cjs" ]; then
  echo "ERROR: bundled CLI not found at apps/cli/dist/index.cjs. Run 'pnpm pack:cli' first." >&2
  exit 1
fi
if [ ! -f "apps/daemon/dist/index.cjs" ]; then
  echo "ERROR: bundled daemon not found at apps/daemon/dist/index.cjs. Run 'pnpm pack:daemon' first." >&2
  exit 1
fi

PAYLOAD_DIR="$(dirname "$OUTPUT_PKG_PATH")/payload"
SCRIPTS_DIR="$(dirname "$OUTPUT_PKG_PATH")/scripts-pkg"

rm -rf "$PAYLOAD_DIR" "$SCRIPTS_DIR"
rm -f "$OUTPUT_PKG_PATH"

mkdir -p "$PAYLOAD_DIR/Applications"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/cli"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/daemon"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/node_modules"

ditto "$APP_BUNDLE_DIR" "$PAYLOAD_DIR/Applications/$APP_BASENAME"
cp apps/cli/dist/index.cjs "$PAYLOAD_DIR/usr/local/lib/popeye/cli/pop.cjs"
cp apps/daemon/dist/index.cjs "$PAYLOAD_DIR/usr/local/lib/popeye/daemon/popeyed.cjs"

node scripts/copy-node-package-closure.mjs \
  "$PAYLOAD_DIR/usr/local/lib/popeye/node_modules" \
  better-sqlite3 pino sqlite-vec

mkdir -p "$SCRIPTS_DIR"
cat > "$SCRIPTS_DIR/postinstall" <<'POSTINSTALL'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p /usr/local/bin

cat > /usr/local/bin/pop <<'WRAPPER'
#!/usr/bin/env bash
exec node /usr/local/lib/popeye/cli/pop.cjs "$@"
WRAPPER
chmod 755 /usr/local/bin/pop

cat > /usr/local/bin/popeyed <<'WRAPPER'
#!/usr/bin/env bash
exec node /usr/local/lib/popeye/daemon/popeyed.cjs "$@"
WRAPPER
chmod 755 /usr/local/bin/popeyed

CONSOLE_USER=$(stat -f '%Su' /dev/console 2>/dev/null || logname 2>/dev/null || echo "")
if [ -n "$CONSOLE_USER" ] && [ "$CONSOLE_USER" != "root" ]; then
  CONSOLE_HOME=$(eval echo "~$CONSOLE_USER")
  DATA_DIR="$CONSOLE_HOME/Library/Application Support/Popeye"
  if [ ! -d "$DATA_DIR" ]; then
    mkdir -p "$DATA_DIR"
    chown "$CONSOLE_USER" "$DATA_DIR"
    chmod 700 "$DATA_DIR"
  fi
fi
POSTINSTALL
chmod 755 "$SCRIPTS_DIR/postinstall"

pkgbuild \
  --root "$PAYLOAD_DIR" \
  --scripts "$SCRIPTS_DIR" \
  --identifier com.popeye.cli \
  --version "$VERSION" \
  --install-location / \
  "$OUTPUT_PKG_PATH"

rm -rf "$PAYLOAD_DIR" "$SCRIPTS_DIR"

echo "==> Installer ready: $OUTPUT_PKG_PATH"
