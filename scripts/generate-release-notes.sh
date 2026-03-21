#!/usr/bin/env bash
set -euo pipefail
# Generate release notes from git log and template
# Idempotent: overwrites dist/pkg/RELEASE-NOTES.md on each run

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

# --- Read version and metadata ---
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
if [ -z "$VERSION" ] || [ "$VERSION" = "undefined" ]; then
  VERSION="0.0.0-dev"
  echo "WARN: No version in root package.json, using ${VERSION}"
fi
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u +%Y-%m-%d)

# Pi engine version: read from engine-pi package.json
PI_VERSION="unknown"
if [ -f "packages/engine-pi/package.json" ]; then
  PI_VERSION=$(node -p "require('./packages/engine-pi/package.json').version")
fi

# --- Determine commit range ---
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  RANGE="${LAST_TAG}..HEAD"
  echo "==> Generating release notes from ${LAST_TAG} to HEAD"
else
  RANGE=""
  echo "==> No tags found, generating release notes from all commits"
fi

# --- Collect commits by type ---
collect_commits() {
  local type_prefix="$1"
  if [ -n "$RANGE" ]; then
    git log "$RANGE" --pretty=format:"%s" --no-merges 2>/dev/null | grep -E "^${type_prefix}" || true
  else
    git log --pretty=format:"%s" --no-merges 2>/dev/null | grep -E "^${type_prefix}" || true
  fi
}

FEAT_COMMITS=$(collect_commits "feat")
FIX_COMMITS=$(collect_commits "fix")
CHORE_COMMITS=$(collect_commits "chore")
REFACTOR_COMMITS=$(collect_commits "refactor")
TEST_COMMITS=$(collect_commits "test")
DOCS_COMMITS=$(collect_commits "docs")
STYLE_COMMITS=$(collect_commits "style")
PERF_COMMITS=$(collect_commits "perf")

# --- Detect breaking changes ---
BREAKING_COMMITS=""
if [ -n "$RANGE" ]; then
  BREAKING_COMMITS=$(git log "$RANGE" --pretty=format:"%s" --no-merges 2>/dev/null | grep -iE "BREAKING|breaking change" || true)
else
  BREAKING_COMMITS=$(git log --pretty=format:"%s" --no-merges 2>/dev/null | grep -iE "BREAKING|breaking change" || true)
fi

# --- Format commit list as markdown bullets ---
format_list() {
  local commits="$1"
  if [ -z "$commits" ]; then
    echo "- None."
  else
    echo "$commits" | while IFS= read -r line; do
      echo "- ${line}"
    done
  fi
}

# --- Build improvements section from refactor + perf + chore ---
IMPROVEMENTS=""
for section in "$REFACTOR_COMMITS" "$PERF_COMMITS" "$CHORE_COMMITS"; do
  if [ -n "$section" ]; then
    if [ -n "$IMPROVEMENTS" ]; then
      IMPROVEMENTS="${IMPROVEMENTS}
${section}"
    else
      IMPROVEMENTS="$section"
    fi
  fi
done

# --- Ensure output directory exists ---
DIST_DIR="dist/pkg"
mkdir -p "$DIST_DIR"

# --- Write release notes ---
OUTPUT_FILE="$DIST_DIR/RELEASE-NOTES.md"

cat > "$OUTPUT_FILE" << EOF
## Popeye v${VERSION}

**Date:** ${BUILD_DATE}
**Git tag:** v${VERSION}
**Pi engine version:** ${PI_VERSION}

### Highlights

- Release v${VERSION} (${GIT_SHA})

### Breaking changes

$(if [ -n "$BREAKING_COMMITS" ]; then
  echo "**WARNING: Breaking changes detected. Review carefully and update \`docs/BREAKING-CHANGES.md\`.**"
  echo ""
  format_list "$BREAKING_COMMITS"
else
  echo "- None."
fi)

### New features

$(format_list "$FEAT_COMMITS")

### Bug fixes

$(format_list "$FIX_COMMITS")

### Improvements

$(format_list "$IMPROVEMENTS")

### Dependencies

- Pi engine: v${PI_VERSION}

### Upgrade instructions

1. Stop daemon: \`pop daemon stop\`
2. Create backup: \`pop backup create\`
3. Pull version: \`git checkout v${VERSION}\`
4. Install and build: \`pnpm install --frozen-lockfile && pnpm build\`
5. Start daemon: \`pop daemon start\`
6. Verify: \`bash scripts/verify-upgrade.sh && pop security audit\`

See \`docs/runbooks/upgrade.md\` for detailed upgrade procedures.

### Verification evidence

- \`dev-verify\` pass: _{fill in before publishing}_
- Smoke test pass: _{fill in before publishing}_
- Artifact checksums: see \`CHECKSUMS.sha256\`
- Backup/restore drill: _{fill in before publishing}_

### Artifacts

| Artifact | Checksum (SHA-256) |
|----------|--------------------|
| \`popeye-${VERSION}-darwin.pkg\` | _{fill in after build}_ |
| \`popeye-${VERSION}-darwin.tar.gz\` | _{fill in after build}_ |
EOF

echo "==> Release notes generated: ${OUTPUT_FILE}"
echo "==> Version: ${VERSION}, Pi: ${PI_VERSION}, SHA: ${GIT_SHA}"
if [ -n "$BREAKING_COMMITS" ]; then
  echo "==> WARNING: Breaking changes detected — review the output"
fi
