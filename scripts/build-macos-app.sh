#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"
APP_PACKAGE_DIR="apps/macos/PopeyeMac"
APP_NAME="PopeyeMac"
APP_BUNDLE_DIR="${1:-dist/pkg/${APP_NAME}.app}"
SWIFT_CONFIGURATION="${SWIFT_CONFIGURATION:-release}"
VERSION="$(node -p "require('./package.json').version")"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_DATE="$(date -u +%Y-%m-%d)"
BUILD_NUMBER="$(date -u +%Y%m%d%H%M)"
BUNDLED_NODE_PLATFORM="darwin-arm64"

CLI_BUNDLE="apps/cli/dist/index.cjs"
DAEMON_BUNDLE="apps/daemon/dist/index.cjs"
INFO_TEMPLATE="${APP_PACKAGE_DIR}/Sources/PopeyeMac/Resources/Info.plist"
BOOTSTRAP_SOURCE_DIR="${APP_PACKAGE_DIR}/Sources/PopeyeMac/Resources/Bootstrap"

mkdir -p "$(dirname "$APP_BUNDLE_DIR")"

echo "==> Building ${APP_NAME} (${SWIFT_CONFIGURATION})..."
swift build --package-path "$APP_PACKAGE_DIR" --configuration "$SWIFT_CONFIGURATION"
BIN_DIR="$(swift build --package-path "$APP_PACKAGE_DIR" --configuration "$SWIFT_CONFIGURATION" --show-bin-path)"
EXECUTABLE_PATH="${BIN_DIR}/${APP_NAME}"
RESOURCE_BUNDLE_PATH="${BIN_DIR}/${APP_NAME}_${APP_NAME}.bundle"

if [[ ! -x "$EXECUTABLE_PATH" ]]; then
  echo "ERROR: built app executable not found at $EXECUTABLE_PATH"
  exit 1
fi
if [[ ! -d "$RESOURCE_BUNDLE_PATH" ]]; then
  echo "ERROR: SwiftPM resource bundle not found at $RESOURCE_BUNDLE_PATH"
  exit 1
fi
if [[ ! -f "$CLI_BUNDLE" ]]; then
  echo "ERROR: bundled CLI not found at $CLI_BUNDLE. Run 'pnpm pack:cli' first."
  exit 1
fi
if [[ ! -f "$DAEMON_BUNDLE" ]]; then
  echo "ERROR: bundled daemon not found at $DAEMON_BUNDLE. Run 'pnpm pack:daemon' first."
  exit 1
fi

BUNDLED_NODE_RUNTIME_ROOT="$(node scripts/fetch-bundled-node-runtime.mjs)"
BUNDLED_NODE_VERSION="$(node -p "require('./scripts/bundled-node-runtime.json').version")"
BUNDLED_NODE_SOURCE_URL="$(node -p "require('./scripts/bundled-node-runtime.json').platforms['${BUNDLED_NODE_PLATFORM}'].url")"
BUNDLED_KNOWLEDGE_CLOSURE_ROOT="$(node scripts/build-bundled-knowledge-python.mjs)"
BUNDLED_PYTHON_VERSION="$(node -p "require('./scripts/bundled-python-runtime.json').version")"
BUNDLED_PYTHON_RELEASE_TRAIN="$(node -p "require('./scripts/bundled-python-runtime.json').releaseTrain")"
BUNDLED_PYTHON_SOURCE_URL="$(node -p "require('./scripts/bundled-python-runtime.json').platforms['darwin-arm64'].url")"
BUNDLED_KNOWLEDGE_MANIFEST_PATH="${BUNDLED_KNOWLEDGE_CLOSURE_ROOT}/manifest.json"

if [[ ! -d "$BUNDLED_KNOWLEDGE_CLOSURE_ROOT/python" ]]; then
  echo "ERROR: bundled Knowledge Python runtime closure not found at $BUNDLED_KNOWLEDGE_CLOSURE_ROOT/python"
  exit 1
fi
if [[ ! -d "$BUNDLED_KNOWLEDGE_CLOSURE_ROOT/python-site-packages" ]]; then
  echo "ERROR: bundled Knowledge Python site-packages missing at $BUNDLED_KNOWLEDGE_CLOSURE_ROOT/python-site-packages"
  exit 1
fi
if [[ ! -d "$BUNDLED_KNOWLEDGE_CLOSURE_ROOT/knowledge-python-shims" ]]; then
  echo "ERROR: bundled Knowledge Python shims missing at $BUNDLED_KNOWLEDGE_CLOSURE_ROOT/knowledge-python-shims"
  exit 1
fi

rm -rf "$APP_BUNDLE_DIR"
mkdir -p "$APP_BUNDLE_DIR/Contents/MacOS" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap"

ditto "$EXECUTABLE_PATH" "$APP_BUNDLE_DIR/Contents/MacOS/${APP_NAME}"
chmod 755 "$APP_BUNDLE_DIR/Contents/MacOS/${APP_NAME}"
ditto "$RESOURCE_BUNDLE_PATH" "$APP_BUNDLE_DIR/Contents/Resources/$(basename "$RESOURCE_BUNDLE_PATH")"
ditto "$BOOTSTRAP_SOURCE_DIR" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap"

cp "$CLI_BUNDLE" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/pop.cjs"
cp "$DAEMON_BUNDLE" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/popeyed.cjs"
chmod 644 "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/pop.cjs" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/popeyed.cjs"

mkdir -p "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node/bin"
cp "$BUNDLED_NODE_RUNTIME_ROOT/bin/node" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node/bin/node"
chmod 755 "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node/bin/node"
for metadata_file in LICENSE README.md CHANGELOG.md; do
  if [[ -f "$BUNDLED_NODE_RUNTIME_ROOT/$metadata_file" ]]; then
    cp "$BUNDLED_NODE_RUNTIME_ROOT/$metadata_file" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node/$metadata_file"
    chmod 644 "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node/$metadata_file"
  fi
done

mkdir -p "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node_modules"
node scripts/copy-node-package-closure.mjs   "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node_modules"   better-sqlite3 pino sqlite-vec

ditto "$BUNDLED_KNOWLEDGE_CLOSURE_ROOT/python" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/python"
ditto "$BUNDLED_KNOWLEDGE_CLOSURE_ROOT/python-site-packages" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/python-site-packages"
ditto "$BUNDLED_KNOWLEDGE_CLOSURE_ROOT/knowledge-python-shims" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/knowledge-python-shims"
cp "$BUNDLED_KNOWLEDGE_MANIFEST_PATH" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/knowledge-python-manifest.json"
chmod -R u+rwX,go+rX "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/python" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/python-site-packages" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/knowledge-python-shims"
find "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/knowledge-python-shims" -type f -exec chmod 755 {} \;
chmod 644 "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/knowledge-python-manifest.json"

cat > "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/pop" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
    "$SCRIPT_DIR/node/bin/node" \
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

  echo "Popeye requires Node 22+ to run the bundled companion CLI. This packaged build should include a private runtime at $SCRIPT_DIR/node/bin/node; reinstall the app or set POPEYE_NODE to override it." >&2
  return 1
}

export_bundled_knowledge_env() {
  local shims_dir="$SCRIPT_DIR/knowledge-python-shims"
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
  echo "Popeye requires Node 22+ to run the bundled companion CLI. Resolved: $NODE_BIN" >&2
  exit 1
fi

export_bundled_knowledge_env
exec "$NODE_BIN" "$SCRIPT_DIR/pop.cjs" "$@"
WRAPPER
chmod 755 "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/pop"

cat > "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/manifest.json" <<MANIFEST
{
  "app": "${APP_NAME}",
  "version": "${VERSION}",
  "gitSha": "${GIT_SHA}",
  "buildDate": "${BUILD_DATE}",
  "nodeRequirement": "bundled-private-node",
  "bundledNode": {
    "version": "${BUNDLED_NODE_VERSION}",
    "platform": "${BUNDLED_NODE_PLATFORM}",
    "binary": "node/bin/node",
    "sourceUrl": "${BUNDLED_NODE_SOURCE_URL}"
  },
  "bundledKnowledgePython": {
    "version": "${BUNDLED_PYTHON_VERSION}",
    "releaseTrain": "${BUNDLED_PYTHON_RELEASE_TRAIN}",
    "platform": "darwin-arm64",
    "binary": "python/bin/python3",
    "sitePackages": "python-site-packages",
    "shims": "knowledge-python-shims",
    "sourceUrl": "${BUNDLED_PYTHON_SOURCE_URL}",
    "manifest": "knowledge-python-manifest.json"
  },
  "cli": "pop",
  "cliBundle": "pop.cjs",
  "daemonBundle": "popeyed.cjs"
}
MANIFEST

python3 - <<'PY' "$INFO_TEMPLATE" "$APP_BUNDLE_DIR/Contents/Info.plist" "$VERSION" "$BUILD_NUMBER"
import plistlib
import sys
from pathlib import Path

template_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
version = sys.argv[3]
build_number = sys.argv[4]

with template_path.open('rb') as f:
    info = plistlib.load(f)

info.update({
    'CFBundleDevelopmentRegion': 'en',
    'CFBundleExecutable': 'PopeyeMac',
    'CFBundleIdentifier': 'com.popeye.mac',
    'CFBundleInfoDictionaryVersion': '6.0',
    'CFBundleName': 'PopeyeMac',
    'CFBundleDisplayName': 'Popeye',
    'CFBundlePackageType': 'APPL',
    'CFBundleShortVersionString': version,
    'CFBundleVersion': build_number,
    'LSMinimumSystemVersion': '15.0',
    'NSPrincipalClass': 'NSApplication',
})

with output_path.open('wb') as f:
    plistlib.dump(info, f)
PY

if [[ ! -x "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/pop" ]]; then
  echo "ERROR: bundled companion CLI wrapper was not created"
  exit 1
fi
if [[ ! -x "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node/bin/node" ]]; then
  echo "ERROR: bundled private Node runtime missing from packaged app"
  exit 1
fi
if [[ ! -x "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/knowledge-python-shims/python3" ]]; then
  echo "ERROR: bundled Knowledge Python shim missing from packaged app"
  exit 1
fi
if [[ ! -x "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/knowledge-python-shims/markitdown" ]]; then
  echo "ERROR: bundled Knowledge MarkItDown shim missing from packaged app"
  exit 1
fi
if [[ ! -f "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/popeyed.cjs" ]]; then
  echo "ERROR: bundled daemon bundle missing from packaged app"
  exit 1
fi
if [[ ! -d "$APP_BUNDLE_DIR/Contents/Resources/${APP_NAME}_${APP_NAME}.bundle" ]]; then
  echo "ERROR: SwiftPM resources missing from packaged app"
  exit 1
fi

echo "==> Packaged app bundle ready: $APP_BUNDLE_DIR"
