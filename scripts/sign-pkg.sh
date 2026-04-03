#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DIST_DIR="dist/pkg"
APP_NAME="PopeyeMac"
VERSION=$(node -p "require('./package.json').version")
APP_PATH="$DIST_DIR/${APP_NAME}.app"
APP_ZIP_PATH="$DIST_DIR/${APP_NAME}-notarize.zip"
TAR_NAME="popeye-${VERSION}-darwin.tar.gz"
TAR_PATH="$DIST_DIR/$TAR_NAME"
PKG_NAME="popeye-${VERSION}-darwin.pkg"
PKG_PATH="$DIST_DIR/$PKG_NAME"
UNSIGNED_PKG_PATH="$DIST_DIR/${PKG_NAME%.pkg}-unsigned.pkg"
CHECKSUMS_FILE="$DIST_DIR/CHECKSUMS.sha256"
STATUS_FILE="$DIST_DIR/SIGNING-STATUS.md"
SIGNING_REQUIRED_RAW="${POPEYE_SIGNING_REQUIRED:-false}"

if [ ! -d "$APP_PATH" ] || [ ! -f "$PKG_PATH" ]; then
  echo "ERROR: Packaged macOS artifacts not found in $DIST_DIR"
  echo "Run 'bash scripts/build-pkg.sh' first."
  exit 1
fi

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|True|yes|YES|Yes|on|ON|On) return 0 ;;
    *) return 1 ;;
  esac
}

SIGNING_REQUIRED=false
if is_truthy "$SIGNING_REQUIRED_RAW"; then
  SIGNING_REQUIRED=true
fi

find_identity() {
  local env_value="$1"
  local identity_class="$2"
  local find_args="$3"
  if [ -n "$env_value" ]; then
    printf '%s\n' "$env_value"
    return
  fi
  security find-identity -v $find_args 2>/dev/null | grep "$identity_class" | head -1 | sed 's/.*"\(.*\)"/\1/' || true
}

APP_IDENTITY="$(find_identity "${POPEYE_APP_SIGN_IDENTITY:-}" "Developer ID Application" "-p codesigning")"
INSTALLER_IDENTITY="$(find_identity "${POPEYE_INSTALLER_SIGN_IDENTITY:-${POPEYE_SIGN_IDENTITY:-}}" "Developer ID Installer" "-p basic")"

APPLE_ID="${POPEYE_APPLE_ID:-}"
TEAM_ID="${POPEYE_TEAM_ID:-}"
APP_PASSWORD="${POPEYE_APP_PASSWORD:-}"
HAS_NOTARY_CREDENTIALS=false
if [ -n "$APPLE_ID" ] && [ -n "$TEAM_ID" ] && [ -n "$APP_PASSWORD" ]; then
  HAS_NOTARY_CREDENTIALS=true
fi

APP_SIGNING_STATUS="skipped"
APP_NOTARIZATION_STATUS="not requested"
APP_STAPLE_STATUS="not requested"
APP_GATEKEEPER_STATUS="not checked"
PKG_SIGNING_STATUS="skipped"
PKG_NOTARIZATION_STATUS="not requested"
PKG_STAPLE_STATUS="not requested"
PKG_GATEKEEPER_STATUS="not checked"

write_status() {
  cat > "$STATUS_FILE" <<EOF
# Signing Status

| Artifact | Status |
|----------|--------|
| App signing | ${APP_SIGNING_STATUS} |
| App notarization | ${APP_NOTARIZATION_STATUS} |
| App stapling | ${APP_STAPLE_STATUS} |
| App Gatekeeper assessment | ${APP_GATEKEEPER_STATUS} |
| Installer signing | ${PKG_SIGNING_STATUS} |
| Installer notarization | ${PKG_NOTARIZATION_STATUS} |
| Installer stapling | ${PKG_STAPLE_STATUS} |
| Installer Gatekeeper assessment | ${PKG_GATEKEEPER_STATUS} |
EOF
}

if [ -z "$APP_IDENTITY" ]; then
  APP_SIGNING_STATUS="skipped (no Developer ID Application identity)"
  APP_NOTARIZATION_STATUS="skipped"
  APP_STAPLE_STATUS="skipped"
  PKG_SIGNING_STATUS="skipped"
  PKG_NOTARIZATION_STATUS="skipped"
  PKG_STAPLE_STATUS="skipped"
  write_status
  echo "SKIP: No Developer ID Application identity found. Set POPEYE_APP_SIGN_IDENTITY to produce shippable macOS artifacts."
  if $SIGNING_REQUIRED; then
    echo "ERROR: Strict signing mode is enabled and no Developer ID Application identity is available." >&2
    exit 1
  fi
  exit 0
fi

sign_file() {
  local path="$1"
  shift
  codesign --force --sign "$APP_IDENTITY" --timestamp "$@" "$path"
}

echo "==> Signing app bundle with identity: $APP_IDENTITY"
find "$APP_PATH" -name '*.cstemp' -delete
MACH_O_LIST="$(mktemp)"
find "$APP_PATH" -type f ! -name '*.cstemp' -print0 > "$MACH_O_LIST"
if tr '\0' '\n' < "$MACH_O_LIST" | grep -q '\.cstemp$'; then
  rm -f "$MACH_O_LIST"
  echo "ERROR: Refusing to sign transient codesign temp files." >&2
  exit 1
fi
while IFS= read -r -d '' candidate; do
  if file -b "$candidate" | grep -q 'Mach-O'; then
    sign_file "$candidate"
  fi
done < "$MACH_O_LIST"
rm -f "$MACH_O_LIST"

codesign --force --sign "$APP_IDENTITY" --timestamp --options runtime "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
APP_SIGNING_STATUS="signed"

if $HAS_NOTARY_CREDENTIALS; then
  echo "==> Notarizing app bundle archive..."
  rm -f "$APP_ZIP_PATH"
  ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP_PATH"
  xcrun notarytool submit "$APP_ZIP_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$TEAM_ID" \
    --password "$APP_PASSWORD" \
    --wait
  xcrun stapler staple "$APP_PATH"
  xcrun stapler validate "$APP_PATH"
  APP_NOTARIZATION_STATUS="submitted and accepted"
  APP_STAPLE_STATUS="validated"
else
  echo "SKIP: App notarization skipped (set POPEYE_APPLE_ID, POPEYE_TEAM_ID, POPEYE_APP_PASSWORD)"
  APP_NOTARIZATION_STATUS="skipped (missing Apple notarization credentials)"
  APP_STAPLE_STATUS="skipped"
fi

if spctl --assess --type execute --verbose=4 "$APP_PATH" >/dev/null 2>&1; then
  APP_GATEKEEPER_STATUS="pass"
else
  APP_GATEKEEPER_STATUS="fail"
fi

echo "==> Rebuilding drag-and-drop tarball from final app bundle..."
bash scripts/create-macos-tarball.sh "$APP_PATH" "$TAR_PATH"

echo "==> Rebuilding installer payload from signed app bundle..."
bash scripts/build-macos-installer-pkg.sh "$APP_PATH" "$UNSIGNED_PKG_PATH"

if [ -n "$INSTALLER_IDENTITY" ]; then
  echo "==> Signing installer with identity: $INSTALLER_IDENTITY"
  rm -f "$PKG_PATH"
  productsign --sign "$INSTALLER_IDENTITY" "$UNSIGNED_PKG_PATH" "$PKG_PATH"
  pkgutil --check-signature "$PKG_PATH" >/dev/null
  PKG_SIGNING_STATUS="signed"

  if $HAS_NOTARY_CREDENTIALS; then
    echo "==> Notarizing installer package..."
    xcrun notarytool submit "$PKG_PATH" \
      --apple-id "$APPLE_ID" \
      --team-id "$TEAM_ID" \
      --password "$APP_PASSWORD" \
      --wait
    xcrun stapler staple "$PKG_PATH"
    xcrun stapler validate "$PKG_PATH"
    PKG_NOTARIZATION_STATUS="submitted and accepted"
    PKG_STAPLE_STATUS="validated"
  else
    echo "SKIP: Installer notarization skipped (set POPEYE_APPLE_ID, POPEYE_TEAM_ID, POPEYE_APP_PASSWORD)"
    PKG_NOTARIZATION_STATUS="skipped (missing Apple notarization credentials)"
    PKG_STAPLE_STATUS="skipped"
  fi

  if spctl --assess --type install --verbose=4 "$PKG_PATH" >/dev/null 2>&1; then
    PKG_GATEKEEPER_STATUS="pass"
  else
    PKG_GATEKEEPER_STATUS="fail"
  fi
else
  echo "SKIP: No Developer ID Installer identity found. Leaving installer unsigned."
  PKG_SIGNING_STATUS="skipped (no Developer ID Installer identity)"
  PKG_NOTARIZATION_STATUS="skipped"
  PKG_STAPLE_STATUS="skipped"
  if $SIGNING_REQUIRED; then
    write_status
    rm -f "$UNSIGNED_PKG_PATH" "$APP_ZIP_PATH"
    echo "ERROR: Strict signing mode is enabled and no Developer ID Installer identity is available." >&2
    exit 1
  fi
  rm -f "$PKG_PATH"
  mv "$UNSIGNED_PKG_PATH" "$PKG_PATH"
fi

rm -f "$UNSIGNED_PKG_PATH" "$APP_ZIP_PATH"

echo "==> Regenerating checksums for final artifacts..."
: > "$CHECKSUMS_FILE"
for artifact in "$TAR_PATH" "$PKG_PATH"; do
  CHECKSUM=$(shasum -a 256 "$artifact" | cut -d' ' -f1)
  BASENAME=$(basename "$artifact")
  echo "$CHECKSUM  $BASENAME" >> "$CHECKSUMS_FILE"
done

write_status

echo "==> Signing status written: $STATUS_FILE"
