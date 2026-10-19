#!/bin/sh
# Runs the STEVE Blender connector whenever you log in to macOS (a LaunchAgent), restarting it if it stops.
#   ./service/macos/install.sh [config.json] [data] [name]
# "name" tells several Blender instances' services apart (e.g. studio); the default is one service.
# Remove: launchctl bootout gui/$(id -u)/<label> && rm ~/Library/LaunchAgents/<label>.plist
# (the label is printed when you install; by default studio.steve.blender-connector)
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="${1:-config.json}"
DATA="${2:-data}"
NAME="${3:-}"
NODE="$(command -v node)" || { echo "node not found on PATH"; exit 1; }
[ -f "$ROOT/$CONFIG" ] || { echo "No $CONFIG in $ROOT. Run 'node setup.js' first."; exit 1; }
[ -f "$ROOT/$DATA/state.json" ] || { echo "Not paired yet. Run 'node connector.js --pair <CODE>' once first."; exit 1; }
LABEL="studio.steve.blender-connector${NAME:+.$NAME}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# launchd starts with a bare PATH; give it the one that finds node (Homebrew) and Blender.
SVC_PATH="$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
# Values go into XML: escape &, < and >.
x() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(x "$NODE")</string>
    <string>$(x "$ROOT/connector.js")</string>
    <string>--config</string><string>$(x "$CONFIG")</string>
    <string>--data</string><string>$(x "$DATA")</string>
  </array>
  <key>WorkingDirectory</key><string>$(x "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(x "$SVC_PATH")</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <!-- The connector keeps its own rotated log in the data folder; only crashes go here. -->
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>$(x "$ROOT/$DATA/crash.log")</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed and started $LABEL. Log: $ROOT/$DATA/connector.log"
