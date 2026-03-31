#!/usr/bin/env bash
set -euo pipefail
echo "==> Uninstalling Popeye..."
CURRENT_LABEL="dev.popeye.popeyed"
LEGACY_LABEL="com.popeye.daemon"
for label in "$CURRENT_LABEL" "$LEGACY_LABEL"; do
  PLIST="$HOME/Library/LaunchAgents/$label.plist"
  echo "  Unloading LaunchAgent $label if present..."
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  [ -f "$PLIST" ] && rm "$PLIST" && echo "  Removed LaunchAgent plist $PLIST"
done
# Remove symlinks
for link in /usr/local/bin/pop /usr/local/bin/popeyed /opt/homebrew/bin/pop /opt/homebrew/bin/popeyed; do
  [ -e "$link" ] && rm "$link" && echo "  Removed $link"
done
# Remove .pkg installer receipt if installed via .pkg
if pkgutil --pkg-info com.popeye.cli &>/dev/null; then
  echo "  Forgetting .pkg receipt..."
  sudo pkgutil --forget com.popeye.cli 2>/dev/null || true
fi
# Remove installed lib directory
[ -d /usr/local/lib/popeye ] && rm -rf /usr/local/lib/popeye && echo "  Removed /usr/local/lib/popeye"
echo "==> Popeye uninstalled. Data preserved at ~/Library/Application Support/Popeye/"
