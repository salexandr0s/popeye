#!/usr/bin/env bash
set -euo pipefail
echo "==> Running Popeye smoke test..."

echo "  Checking pop binary..."
command -v pop >/dev/null 2>&1 || { echo "FAIL: pop not found on PATH"; exit 1; }

echo "  Checking version..."
VERSION_OUTPUT=$(pop --version) || { echo "FAIL: pop --version failed"; exit 1; }
echo "    $VERSION_OUTPUT"

# Verify version output includes expected components
if ! echo "$VERSION_OUTPUT" | grep -q "^pop v"; then
  echo "FAIL: unexpected version format"
  exit 1
fi

echo "  Checking daemon health..."
pop daemon health || echo "WARN: daemon not running (expected for fresh install)"

# Check .pkg receipt if installed via installer
if pkgutil --pkg-info com.popeye.cli &>/dev/null; then
  echo "  Package installer receipt: OK (com.popeye.cli)"
  PKG_VERSION=$(pkgutil --pkg-info com.popeye.cli | grep version | awk '{print $2}')
  echo "    Installed version: $PKG_VERSION"
fi

echo "==> Smoke test passed"
