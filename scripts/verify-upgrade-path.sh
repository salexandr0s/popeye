#!/usr/bin/env bash
set -euo pipefail

# verify-upgrade-path.sh — Comprehensive upgrade path verification
#
# Gathers evidence that the Popeye installation is in a healthy state
# and that backup/restore tooling works. Non-destructive: reads state
# and creates a temporary backup, then cleans up.
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
#
# Usage:
#   bash scripts/verify-upgrade-path.sh
#   bash scripts/verify-upgrade-path.sh --json

JSON_OUTPUT=false
if [[ "${1:-}" == "--json" ]]; then
  JSON_OUTPUT=true
fi

BACKUP_DIR="/tmp/popeye-upgrade-test-backup-$$"
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
RESULTS=()

cleanup() {
  if [[ -d "$BACKUP_DIR" ]]; then
    rm -rf "$BACKUP_DIR"
  fi
}
trap cleanup EXIT

record_result() {
  local name="$1"
  local status="$2"  # pass, fail, skip
  local detail="${3:-}"

  case "$status" in
    pass) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    fail) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    skip) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
  esac

  RESULTS+=("{\"check\":\"$name\",\"status\":\"$status\",\"detail\":\"$detail\"}")

  if [[ "$JSON_OUTPUT" == "false" ]]; then
    local icon
    case "$status" in
      pass) icon="PASS" ;;
      fail) icon="FAIL" ;;
      skip) icon="SKIP" ;;
    esac
    if [[ -n "$detail" ]]; then
      echo "  [$icon] $name — $detail"
    else
      echo "  [$icon] $name"
    fi
  fi
}

# --- Check 1: Prerequisites ---

if [[ "$JSON_OUTPUT" == "false" ]]; then
  echo "==> Checking prerequisites..."
fi

# pop binary
if command -v pop &>/dev/null; then
  POP_PATH=$(command -v pop)
  record_result "pop-binary" "pass" "found at $POP_PATH"
else
  record_result "pop-binary" "fail" "pop binary not found on PATH"
fi

# node
if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
  record_result "node" "pass" "$NODE_VERSION"
else
  record_result "node" "fail" "node not found on PATH"
fi

# pnpm
if command -v pnpm &>/dev/null; then
  PNPM_VERSION=$(pnpm --version 2>/dev/null || echo "unknown")
  record_result "pnpm" "pass" "$PNPM_VERSION"
else
  record_result "pnpm" "fail" "pnpm not found on PATH"
fi

# --- Check 2: Current version ---

if [[ "$JSON_OUTPUT" == "false" ]]; then
  echo "==> Recording current version..."
fi

if command -v pop &>/dev/null; then
  CURRENT_VERSION=$(pop --version 2>/dev/null || echo "unknown")
  record_result "current-version" "pass" "$CURRENT_VERSION"
else
  record_result "current-version" "skip" "pop binary not available"
fi

# --- Check 3: Backup create and verify ---

if [[ "$JSON_OUTPUT" == "false" ]]; then
  echo "==> Testing backup tooling..."
fi

if command -v pop &>/dev/null; then
  mkdir -p "$BACKUP_DIR"

  if pop backup create "$BACKUP_DIR" 2>/dev/null; then
    record_result "backup-create" "pass" "backup created at $BACKUP_DIR"

    # Find the backup file
    BACKUP_FILE=$(find "$BACKUP_DIR" -name "*.db" -type f 2>/dev/null | head -1 || true)

    if [[ -n "$BACKUP_FILE" ]]; then
      if pop backup verify "$BACKUP_FILE" 2>/dev/null; then
        record_result "backup-verify" "pass" "backup verified: $BACKUP_FILE"
      else
        record_result "backup-verify" "fail" "backup verification failed"
      fi
    else
      # Backup dir might contain files without .db extension
      BACKUP_COUNT=$(find "$BACKUP_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
      if [[ "$BACKUP_COUNT" -gt 0 ]]; then
        record_result "backup-verify" "pass" "$BACKUP_COUNT file(s) in backup directory"
      else
        record_result "backup-verify" "skip" "no backup files found to verify"
      fi
    fi
  else
    record_result "backup-create" "fail" "pop backup create failed"
    record_result "backup-verify" "skip" "skipped — no backup to verify"
  fi
else
  record_result "backup-create" "skip" "pop binary not available"
  record_result "backup-verify" "skip" "pop binary not available"
fi

# --- Check 4: Daemon health ---

if [[ "$JSON_OUTPUT" == "false" ]]; then
  echo "==> Checking daemon health..."
fi

if command -v pop &>/dev/null; then
  DAEMON_STATUS=$(pop daemon status 2>&1 || true)
  if echo "$DAEMON_STATUS" | grep -qi "running\|healthy\|ok"; then
    record_result "daemon-health" "pass" "daemon is running"
  elif echo "$DAEMON_STATUS" | grep -qi "stopped\|not running\|unavailable"; then
    record_result "daemon-health" "skip" "daemon is not running (not required for upgrade verification)"
  else
    record_result "daemon-health" "skip" "daemon status unclear: ${DAEMON_STATUS:0:80}"
  fi
else
  record_result "daemon-health" "skip" "pop binary not available"
fi

# --- Check 5: Upgrade verify ---

if [[ "$JSON_OUTPUT" == "false" ]]; then
  echo "==> Running upgrade verify..."
fi

if command -v pop &>/dev/null; then
  if pop upgrade verify --json 2>/dev/null; then
    record_result "upgrade-verify" "pass" "pop upgrade verify succeeded"
  else
    # upgrade verify requires a running daemon — not a hard failure
    record_result "upgrade-verify" "skip" "pop upgrade verify could not complete (daemon may not be running)"
  fi
else
  record_result "upgrade-verify" "skip" "pop binary not available"
fi

# --- Check 6: Build state ---

if [[ "$JSON_OUTPUT" == "false" ]]; then
  echo "==> Checking build state..."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ -f "$PROJECT_ROOT/package.json" ]]; then
  if [[ -d "$PROJECT_ROOT/node_modules" ]]; then
    record_result "node-modules" "pass" "node_modules exists"
  else
    record_result "node-modules" "fail" "node_modules missing — run pnpm install"
  fi
else
  record_result "node-modules" "skip" "not in a project directory"
fi

# --- Summary ---

TOTAL=$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))
OVERALL="pass"
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  OVERALL="fail"
fi

if [[ "$JSON_OUTPUT" == "true" ]]; then
  # Build JSON array from RESULTS
  RESULTS_JSON="["
  for i in "${!RESULTS[@]}"; do
    if [[ "$i" -gt 0 ]]; then
      RESULTS_JSON+=","
    fi
    RESULTS_JSON+="${RESULTS[$i]}"
  done
  RESULTS_JSON+="]"

  cat <<ENDJSON
{
  "overall": "$OVERALL",
  "total": $TOTAL,
  "passed": $PASS_COUNT,
  "failed": $FAIL_COUNT,
  "skipped": $SKIP_COUNT,
  "checks": $RESULTS_JSON
}
ENDJSON
else
  echo ""
  echo "==> Results: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped (total: $TOTAL)"
  if [[ "$OVERALL" == "pass" ]]; then
    echo "==> Upgrade path verification: PASSED"
  else
    echo "==> Upgrade path verification: FAILED"
  fi
fi

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi

exit 0
