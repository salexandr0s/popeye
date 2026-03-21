#!/usr/bin/env bash
set -euo pipefail
# Build and package Popeye for macOS distribution
cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

echo "==> Building Popeye..."
pnpm install --frozen-lockfile
pnpm build

VERSION=$(node -p "require('./package.json').version")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u +%Y-%m-%d)
DIST_DIR="dist/pkg"
mkdir -p "$DIST_DIR"

echo "==> Version: $VERSION ($GIT_SHA) built $BUILD_DATE"

# --- Tarball (developer/CI distribution) ---
echo "==> Creating distribution tarball..."
TAR_NAME="popeye-${VERSION}-darwin.tar.gz"
tar czf "$DIST_DIR/$TAR_NAME" \
  --exclude='node_modules' --exclude='.git' --exclude='dist' \
  apps/ packages/ package.json pnpm-lock.yaml pnpm-workspace.yaml

# --- macOS .pkg installer ---
echo "==> Creating macOS .pkg installer..."
PKG_NAME="popeye-${VERSION}-darwin.pkg"
PAYLOAD_DIR="$DIST_DIR/payload"
SCRIPTS_DIR="$DIST_DIR/scripts-pkg"
rm -rf "$PAYLOAD_DIR" "$SCRIPTS_DIR"

# Stage payload
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/cli"
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/daemon"
cp apps/cli/dist/index.js "$PAYLOAD_DIR/usr/local/lib/popeye/cli/pop.js"
cp apps/daemon/dist/index.js "$PAYLOAD_DIR/usr/local/lib/popeye/daemon/popeyed.js"

# Include native dependencies alongside the bundles
mkdir -p "$PAYLOAD_DIR/usr/local/lib/popeye/node_modules"
for dep in better-sqlite3 pino sqlite-vec; do
  if [ -d "node_modules/$dep" ]; then
    cp -R "node_modules/$dep" "$PAYLOAD_DIR/usr/local/lib/popeye/node_modules/$dep"
  fi
done

# Post-install script: create symlinks and default config
mkdir -p "$SCRIPTS_DIR"
cat > "$SCRIPTS_DIR/postinstall" << 'POSTINSTALL'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p /usr/local/bin

# Create wrapper scripts
cat > /usr/local/bin/pop << 'WRAPPER'
#!/usr/bin/env bash
exec node /usr/local/lib/popeye/cli/pop.js "$@"
WRAPPER
chmod 755 /usr/local/bin/pop

cat > /usr/local/bin/popeyed << 'WRAPPER'
#!/usr/bin/env bash
exec node /usr/local/lib/popeye/daemon/popeyed.js "$@"
WRAPPER
chmod 755 /usr/local/bin/popeyed

# Create default config directory for the console user (not root)
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

# Build the .pkg
pkgbuild \
  --root "$PAYLOAD_DIR" \
  --scripts "$SCRIPTS_DIR" \
  --identifier com.popeye.cli \
  --version "$VERSION" \
  --install-location / \
  "$DIST_DIR/$PKG_NAME"

# Clean up staging
rm -rf "$PAYLOAD_DIR" "$SCRIPTS_DIR"

# --- Checksums ---
echo "==> Generating checksums..."
CHECKSUMS_FILE="$DIST_DIR/CHECKSUMS.sha256"
: > "$CHECKSUMS_FILE"
for artifact in "$DIST_DIR/$TAR_NAME" "$DIST_DIR/$PKG_NAME"; do
  if [ -f "$artifact" ]; then
    CHECKSUM=$(shasum -a 256 "$artifact" | cut -d' ' -f1)
    BASENAME=$(basename "$artifact")
    echo "$CHECKSUM  $BASENAME" >> "$CHECKSUMS_FILE"
    echo "  $BASENAME: $CHECKSUM"
  fi
done

echo "==> Build complete"
echo "  Tarball: $DIST_DIR/$TAR_NAME"
echo "  Package: $DIST_DIR/$PKG_NAME"
echo "  Checksums: $DIST_DIR/CHECKSUMS.sha256"
