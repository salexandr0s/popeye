#!/usr/bin/env bash
set -euo pipefail
# Sign and notarize a Popeye .pkg for distribution
# Skips gracefully if no signing identity is available
cd "$(dirname "$0")/.."

DIST_DIR="dist/pkg"
VERSION=$(node -p "require('./package.json').version")
PKG_NAME="popeye-${VERSION}-darwin.pkg"
SIGNED_PKG_NAME="popeye-${VERSION}-darwin-signed.pkg"
PKG_PATH="$DIST_DIR/$PKG_NAME"

if [ ! -f "$PKG_PATH" ]; then
  echo "ERROR: Package not found at $PKG_PATH"
  echo "Run 'bash scripts/build-pkg.sh' first."
  exit 1
fi

# Check for signing identity
IDENTITY="${POPEYE_SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  # Try to find a Developer ID Installer identity
  IDENTITY=$(security find-identity -v -p basic 2>/dev/null | grep "Developer ID Installer" | head -1 | sed 's/.*"\(.*\)"/\1/' || true)
fi

if [ -z "$IDENTITY" ]; then
  echo "SKIP: No signing identity found. Set POPEYE_SIGN_IDENTITY or install a Developer ID Installer certificate."
  echo "  The unsigned package is still usable for local development."
  exit 0
fi

echo "==> Signing with identity: $IDENTITY"
productsign --sign "$IDENTITY" "$PKG_PATH" "$DIST_DIR/$SIGNED_PKG_NAME"

# Update checksums
CHECKSUM=$(shasum -a 256 "$DIST_DIR/$SIGNED_PKG_NAME" | cut -d' ' -f1)
echo "$CHECKSUM  $SIGNED_PKG_NAME" >> "$DIST_DIR/CHECKSUMS.sha256"
echo "  Signed package: $DIST_DIR/$SIGNED_PKG_NAME ($CHECKSUM)"

# Notarize if credentials are available
APPLE_ID="${POPEYE_APPLE_ID:-}"
TEAM_ID="${POPEYE_TEAM_ID:-}"
APP_PASSWORD="${POPEYE_APP_PASSWORD:-}"

if [ -n "$APPLE_ID" ] && [ -n "$TEAM_ID" ] && [ -n "$APP_PASSWORD" ]; then
  echo "==> Submitting for notarization..."
  xcrun notarytool submit "$DIST_DIR/$SIGNED_PKG_NAME" \
    --apple-id "$APPLE_ID" \
    --team-id "$TEAM_ID" \
    --password "$APP_PASSWORD" \
    --wait
  echo "==> Stapling notarization ticket..."
  xcrun stapler staple "$DIST_DIR/$SIGNED_PKG_NAME"
  echo "==> Notarization complete"
else
  echo "SKIP: Notarization skipped (set POPEYE_APPLE_ID, POPEYE_TEAM_ID, POPEYE_APP_PASSWORD)"
fi
