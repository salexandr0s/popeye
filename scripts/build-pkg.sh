#!/usr/bin/env bash
set -euo pipefail
# Build and package Popeye for macOS distribution

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"
DIST_DIR="dist/pkg"
APP_NAME="PopeyeMac"
APP_BUNDLE_DIR="${DIST_DIR}/${APP_NAME}.app"

VERSION=$(node -p "require('./package.json').version")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u +%Y-%m-%d)
mkdir -p "$DIST_DIR"

echo "==> Building Popeye..."
pnpm install --frozen-lockfile
pnpm build

echo "==> Bundling CLI and daemon with tsup..."
pnpm -w run pack:cli
pnpm -w run pack:daemon

echo "==> Building packaged macOS app bundle..."
bash scripts/build-macos-app.sh "$APP_BUNDLE_DIR"

echo "==> Version: $VERSION ($GIT_SHA) built $BUILD_DATE"

TAR_NAME="popeye-${VERSION}-darwin.tar.gz"
TAR_PATH="$DIST_DIR/$TAR_NAME"
echo "==> Creating app bundle tarball..."
bash scripts/create-macos-tarball.sh "$APP_BUNDLE_DIR" "$TAR_PATH"

PKG_NAME="popeye-${VERSION}-darwin.pkg"
PKG_PATH="$DIST_DIR/$PKG_NAME"
echo "==> Creating macOS .pkg installer..."
bash scripts/build-macos-installer-pkg.sh "$APP_BUNDLE_DIR" "$PKG_PATH"

# --- Checksums ---
echo "==> Generating checksums..."
CHECKSUMS_FILE="$DIST_DIR/CHECKSUMS.sha256"
: > "$CHECKSUMS_FILE"
for artifact in "$TAR_PATH" "$PKG_PATH"; do
  if [ -f "$artifact" ]; then
    CHECKSUM=$(shasum -a 256 "$artifact" | cut -d' ' -f1)
    BASENAME=$(basename "$artifact")
    echo "$CHECKSUM  $BASENAME" >> "$CHECKSUMS_FILE"
    echo "  $BASENAME: $CHECKSUM"
  fi
done

cat > "$DIST_DIR/SIGNING-STATUS.md" <<EOF
# Signing Status

This artifact set is currently **unsigned**.

Run \`bash scripts/sign-pkg.sh\` after \`bash scripts/build-pkg.sh\` to produce signed/notarized macOS release artifacts when signing credentials are available.
EOF

echo "==> Build complete"
echo "  App bundle: $APP_BUNDLE_DIR"
echo "  Tarball: $TAR_PATH"
echo "  Package: $PKG_PATH"
echo "  Checksums: $DIST_DIR/CHECKSUMS.sha256"
