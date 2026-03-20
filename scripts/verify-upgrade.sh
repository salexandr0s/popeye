#!/usr/bin/env bash
set -euo pipefail
echo "==> Verifying Popeye upgrade..."
echo "  Checking daemon status..."
pop daemon status || { echo "FAIL: daemon not accessible"; exit 1; }
echo "  Checking version..."
pop --version
echo "==> Upgrade verification passed"
