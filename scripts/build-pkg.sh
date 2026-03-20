#!/usr/bin/env bash
set -euo pipefail
# Build and package Popeye for macOS distribution
echo "==> Building Popeye..."
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm build
echo "==> Creating distribution package..."
DIST_DIR="dist/pkg"
mkdir -p "$DIST_DIR"
VERSION=$(node -p "require('./package.json').version")
TAR_NAME="popeye-${VERSION}-darwin.tar.gz"
tar czf "$DIST_DIR/$TAR_NAME" \
  --exclude='node_modules' --exclude='.git' --exclude='dist' \
  apps/ packages/ package.json pnpm-lock.yaml pnpm-workspace.yaml
CHECKSUM=$(shasum -a 256 "$DIST_DIR/$TAR_NAME" | cut -d' ' -f1)
echo "$CHECKSUM  $TAR_NAME" > "$DIST_DIR/$TAR_NAME.sha256"
echo "==> Package: $DIST_DIR/$TAR_NAME"
echo "==> Checksum: $CHECKSUM"
