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
BUNDLED_NODE_SOURCE_DIR="$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node"
BUNDLED_KNOWLEDGE_PYTHON_SOURCE_DIR="$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/python"
BUNDLED_KNOWLEDGE_SITE_PACKAGES_SOURCE_DIR="$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/python-site-packages"
BUNDLED_KNOWLEDGE_SHIMS_SOURCE_DIR="$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/knowledge-python-shims"

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
if [ ! -x "$BUNDLED_NODE_SOURCE_DIR/bin/node" ]; then
  echo "ERROR: bundled private Node runtime not found at $BUNDLED_NODE_SOURCE_DIR/bin/node. Rebuild the app bundle first." >&2
  exit 1
fi
if [ ! -x "$BUNDLED_KNOWLEDGE_SHIMS_SOURCE_DIR/python3" ]; then
  echo "ERROR: bundled Knowledge Python shim not found at $BUNDLED_KNOWLEDGE_SHIMS_SOURCE_DIR/python3. Rebuild the app bundle first." >&2
  exit 1
fi

PAYLOAD_DIR="$(dirname "$OUTPUT_PKG_PATH")/payload"
SCRIPTS_DIR="$(dirname "$OUTPUT_PKG_PATH")/scripts-pkg"

rm -rf "$PAYLOAD_DIR" "$SCRIPTS_DIR"
rm -f "$OUTPUT_PKG_PATH"

mkdir -p "$PAYLOAD_DIR/Applications"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/cli"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/daemon"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/node"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/node_modules"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/python"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/python-site-packages"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/knowledge-python-shims"

ditto "$APP_BUNDLE_DIR" "$PAYLOAD_DIR/Applications/$APP_BASENAME"
cp apps/cli/dist/index.cjs "$PAYLOAD_DIR/usr/local/lib/popeye/cli/pop.cjs"
cp apps/daemon/dist/index.cjs "$PAYLOAD_DIR/usr/local/lib/popeye/daemon/popeyed.cjs"
ditto "$BUNDLED_NODE_SOURCE_DIR" "$PAYLOAD_DIR/usr/local/lib/popeye/node"
ditto "$BUNDLED_KNOWLEDGE_PYTHON_SOURCE_DIR" "$PAYLOAD_DIR/usr/local/lib/popeye/python"
ditto "$BUNDLED_KNOWLEDGE_SITE_PACKAGES_SOURCE_DIR" "$PAYLOAD_DIR/usr/local/lib/popeye/python-site-packages"
ditto "$BUNDLED_KNOWLEDGE_SHIMS_SOURCE_DIR" "$PAYLOAD_DIR/usr/local/lib/popeye/knowledge-python-shims"

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
set -euo pipefail

resolve_node() {
  if [[ -n "${POPEYE_NODE:-}" ]]; then
    if [[ -x "${POPEYE_NODE}" ]]; then
      printf '%s\n' "${POPEYE_NODE}"
      return 0
    fi
    echo "POPEYE_NODE points to a non-executable path: ${POPEYE_NODE}" >&2
    return 1
  fi

  local candidate
  for candidate in \
    "/usr/local/lib/popeye/node/bin/node" \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node" \
    "/opt/homebrew/opt/node@22/bin/node" \
    "/usr/local/opt/node@22/bin/node"
  do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  echo "Popeye requires Node 22+ to run the bundled CLI tools. The packaged install ships a private runtime at /usr/local/lib/popeye/node/bin/node. Set POPEYE_NODE to override it." >&2
  return 1
}

export_bundled_knowledge_env() {
  local shims_dir="/usr/local/lib/popeye/knowledge-python-shims"
  if [[ -x "$shims_dir/python3" ]]; then
    export POPEYE_KNOWLEDGE_SHIMS="$shims_dir"
    export POPEYE_KNOWLEDGE_PYTHON="$shims_dir/python3"
    if [[ -x "$shims_dir/markitdown" ]]; then
      export POPEYE_KNOWLEDGE_MARKITDOWN="$shims_dir/markitdown"
    fi
  fi
}

NODE_BIN="$(resolve_node)"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  echo "Popeye requires Node 22+ to run the bundled CLI tools. Resolved: $NODE_BIN" >&2
  exit 1
fi

export_bundled_knowledge_env
exec "$NODE_BIN" /usr/local/lib/popeye/cli/pop.cjs "$@"
WRAPPER
chmod 755 /usr/local/bin/pop

cat > /usr/local/bin/popeyed <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

resolve_node() {
  if [[ -n "${POPEYE_NODE:-}" ]]; then
    if [[ -x "${POPEYE_NODE}" ]]; then
      printf '%s\n' "${POPEYE_NODE}"
      return 0
    fi
    echo "POPEYE_NODE points to a non-executable path: ${POPEYE_NODE}" >&2
    return 1
  fi

  local candidate
  for candidate in \
    "/usr/local/lib/popeye/node/bin/node" \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node" \
    "/opt/homebrew/opt/node@22/bin/node" \
    "/usr/local/opt/node@22/bin/node"
  do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  echo "Popeye requires Node 22+ to run the bundled CLI tools. The packaged install ships a private runtime at /usr/local/lib/popeye/node/bin/node. Set POPEYE_NODE to override it." >&2
  return 1
}

export_bundled_knowledge_env() {
  local shims_dir="/usr/local/lib/popeye/knowledge-python-shims"
  if [[ -x "$shims_dir/python3" ]]; then
    export POPEYE_KNOWLEDGE_SHIMS="$shims_dir"
    export POPEYE_KNOWLEDGE_PYTHON="$shims_dir/python3"
    if [[ -x "$shims_dir/markitdown" ]]; then
      export POPEYE_KNOWLEDGE_MARKITDOWN="$shims_dir/markitdown"
    fi
  fi
}

NODE_BIN="$(resolve_node)"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  echo "Popeye requires Node 22+ to run the bundled CLI tools. Resolved: $NODE_BIN" >&2
  exit 1
fi

export_bundled_knowledge_env
exec "$NODE_BIN" /usr/local/lib/popeye/daemon/popeyed.cjs "$@"
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
