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

rm -rf "$APP_BUNDLE_DIR"
mkdir -p "$APP_BUNDLE_DIR/Contents/MacOS" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap"

ditto "$EXECUTABLE_PATH" "$APP_BUNDLE_DIR/Contents/MacOS/${APP_NAME}"
chmod 755 "$APP_BUNDLE_DIR/Contents/MacOS/${APP_NAME}"
ditto "$RESOURCE_BUNDLE_PATH" "$APP_BUNDLE_DIR/Contents/Resources/$(basename "$RESOURCE_BUNDLE_PATH")"
ditto "$BOOTSTRAP_SOURCE_DIR" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap"

cp "$CLI_BUNDLE" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/pop.cjs"
cp "$DAEMON_BUNDLE" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/popeyed.cjs"
chmod 644 "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/pop.cjs" "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/popeyed.cjs"

mkdir -p "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node_modules"
node scripts/copy-node-package-closure.mjs   "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/node_modules"   better-sqlite3 pino sqlite-vec

cat > "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/pop" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "Popeye requires Node 22+ to run the bundled companion CLI." >&2
  exit 1
fi
exec node "$SCRIPT_DIR/pop.cjs" "$@"
WRAPPER
chmod 755 "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/pop"

cat > "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/manifest.json" <<MANIFEST
{
  "app": "${APP_NAME}",
  "version": "${VERSION}",
  "gitSha": "${GIT_SHA}",
  "buildDate": "${BUILD_DATE}",
  "nodeRequirement": ">=22",
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
if [[ ! -f "$APP_BUNDLE_DIR/Contents/Resources/Bootstrap/popeyed.cjs" ]]; then
  echo "ERROR: bundled daemon bundle missing from packaged app"
  exit 1
fi
if [[ ! -d "$APP_BUNDLE_DIR/Contents/Resources/${APP_NAME}_${APP_NAME}.bundle" ]]; then
  echo "ERROR: SwiftPM resources missing from packaged app"
  exit 1
fi

echo "==> Packaged app bundle ready: $APP_BUNDLE_DIR"
