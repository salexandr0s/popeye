#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$#" -ne 2 ]; then
  echo "Usage: bash scripts/create-macos-tarball.sh <app-bundle> <output-tar.gz>" >&2
  exit 1
fi

APP_BUNDLE_DIR="$1"
OUTPUT_TAR_PATH="$2"
APP_BASENAME="$(basename "$APP_BUNDLE_DIR")"
STAGE_DIR="$(dirname "$OUTPUT_TAR_PATH")/tar-stage"

if [ ! -d "$APP_BUNDLE_DIR" ]; then
  echo "ERROR: App bundle not found at $APP_BUNDLE_DIR" >&2
  exit 1
fi

rm -rf "$STAGE_DIR"
rm -f "$OUTPUT_TAR_PATH"
mkdir -p "$STAGE_DIR"

ditto "$APP_BUNDLE_DIR" "$STAGE_DIR/$APP_BASENAME"
tar czf "$OUTPUT_TAR_PATH" -C "$STAGE_DIR" "$APP_BASENAME"
rm -rf "$STAGE_DIR"

echo "==> Tarball ready: $OUTPUT_TAR_PATH"
