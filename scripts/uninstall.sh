#!/usr/bin/env bash
set -euo pipefail
echo "==> Uninstalling Popeye..."
# Unload LaunchAgent if loaded
PLIST="$HOME/Library/LaunchAgents/com.popeye.daemon.plist"
if launchctl list | grep -q com.popeye.daemon 2>/dev/null; then
  echo "  Unloading LaunchAgent..."
  launchctl unload "$PLIST" 2>/dev/null || true
fi
[ -f "$PLIST" ] && rm "$PLIST" && echo "  Removed LaunchAgent plist"
# Remove symlinks
for link in /usr/local/bin/pop /usr/local/bin/popeyed; do
  [ -L "$link" ] && rm "$link" && echo "  Removed $link"
done
# Remove .pkg installer receipt if installed via .pkg
if pkgutil --pkg-info com.popeye.cli &>/dev/null; then
  echo "  Forgetting .pkg receipt..."
  sudo pkgutil --forget com.popeye.cli 2>/dev/null || true
fi
# Remove installed lib directory
[ -d /usr/local/lib/popeye ] && rm -rf /usr/local/lib/popeye && echo "  Removed /usr/local/lib/popeye"
echo "==> Popeye uninstalled. Data preserved at ~/Library/Application Support/Popeye/"
