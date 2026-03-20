#!/usr/bin/env bash
set -euo pipefail
echo "==> Running Popeye smoke test..."
echo "  Checking pop binary..."
command -v pop >/dev/null 2>&1 || { echo "FAIL: pop not found"; exit 1; }
echo "  Checking version..."
pop --version || { echo "FAIL: pop --version failed"; exit 1; }
echo "  Checking daemon health..."
pop daemon health || echo "WARN: daemon not running (expected for fresh install)"
echo "==> Smoke test passed"
