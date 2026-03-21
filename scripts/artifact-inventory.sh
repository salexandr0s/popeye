#!/usr/bin/env bash
set -euo pipefail
# Produce an artifact inventory manifest for a Popeye release
# Idempotent: overwrites dist/pkg/INVENTORY.md on each run

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

DIST_DIR="dist/pkg"

# --- Check that dist/pkg exists ---
if [ ! -d "$DIST_DIR" ]; then
  echo "ERROR: ${DIST_DIR} does not exist."
  echo ""
  echo "Build the release artifacts first:"
  echo "  bash scripts/build-pkg.sh"
  echo ""
  echo "Then re-run this script:"
  echo "  bash scripts/artifact-inventory.sh"
  exit 1
fi

# --- Gather metadata ---
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
if [ -z "$VERSION" ] || [ "$VERSION" = "undefined" ]; then
  VERSION="0.0.0-dev"
  echo "WARN: No version in root package.json, using ${VERSION}"
fi
GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_SHA_SHORT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Pi engine version
PI_VERSION="unknown"
if [ -f "packages/engine-pi/package.json" ]; then
  PI_VERSION=$(node -p "require('./packages/engine-pi/package.json').version")
fi

# --- Read checksums ---
CHECKSUMS_FILE="$DIST_DIR/CHECKSUMS.sha256"

read_checksum() {
  local filename="$1"
  if [ -f "$CHECKSUMS_FILE" ]; then
    grep -F "$filename" "$CHECKSUMS_FILE" | awk '{print $1}' || echo "not found"
  else
    echo "no checksum file"
  fi
}

# --- Locate artifacts ---
PKG_FILE=$(find "$DIST_DIR" -maxdepth 1 -name "*.pkg" -type f 2>/dev/null | head -1 || true)
TAR_FILE=$(find "$DIST_DIR" -maxdepth 1 -name "*.tar.gz" -type f 2>/dev/null | head -1 || true)

PKG_BASENAME=""
PKG_CHECKSUM="n/a"
if [ -n "$PKG_FILE" ]; then
  PKG_BASENAME=$(basename "$PKG_FILE")
  PKG_CHECKSUM=$(read_checksum "$PKG_BASENAME")
fi

TAR_BASENAME=""
TAR_CHECKSUM="n/a"
if [ -n "$TAR_FILE" ]; then
  TAR_BASENAME=$(basename "$TAR_FILE")
  TAR_CHECKSUM=$(read_checksum "$TAR_BASENAME")
fi

# --- Contract generation verification ---
CONTRACT_STATUS="SKIP"
if command -v pnpm >/dev/null 2>&1; then
  echo "==> Verifying generated contracts..."
  if pnpm verify:generated-artifacts >/dev/null 2>&1; then
    CONTRACT_STATUS="PASS"
  else
    CONTRACT_STATUS="FAIL"
  fi
else
  CONTRACT_STATUS="SKIP (pnpm not available)"
fi

# --- Test suite status ---
TEST_STATUS="SKIP"
if command -v pnpm >/dev/null 2>&1; then
  echo "==> Running test suite..."
  if pnpm test >/dev/null 2>&1; then
    TEST_STATUS="PASS"
  else
    TEST_STATUS="FAIL"
  fi
else
  TEST_STATUS="SKIP (pnpm not available)"
fi

# --- Write inventory ---
OUTPUT_FILE="$DIST_DIR/INVENTORY.md"

cat > "$OUTPUT_FILE" << EOF
# Artifact Inventory

**Generated:** ${BUILD_DATE}

## Build metadata

| Field | Value |
|-------|-------|
| Version | ${VERSION} |
| Git SHA | ${GIT_SHA} |
| Git SHA (short) | ${GIT_SHA_SHORT} |
| Build date | ${BUILD_DATE} |
| Pi engine version | ${PI_VERSION} |

## Artifacts

| Artifact | Checksum (SHA-256) |
|----------|--------------------|
| ${PKG_BASENAME:-"(no .pkg found)"} | \`${PKG_CHECKSUM}\` |
| ${TAR_BASENAME:-"(no .tar.gz found)"} | \`${TAR_CHECKSUM}\` |

## Verification status

| Check | Result |
|-------|--------|
| Contract generation (\`pnpm verify:generated-artifacts\`) | ${CONTRACT_STATUS} |
| Test suite (\`pnpm test\`) | ${TEST_STATUS} |

## Checksum file

$(if [ -f "$CHECKSUMS_FILE" ]; then
  echo "\`\`\`"
  cat "$CHECKSUMS_FILE"
  echo "\`\`\`"
else
  echo "No checksum file found at \`${CHECKSUMS_FILE}\`."
fi)
EOF

echo "==> Artifact inventory written: ${OUTPUT_FILE}"
echo "==> Version: ${VERSION}, Git: ${GIT_SHA_SHORT}, Pi: ${PI_VERSION}"
echo "==> Contracts: ${CONTRACT_STATUS}, Tests: ${TEST_STATUS}"
