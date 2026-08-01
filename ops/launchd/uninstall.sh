#!/bin/bash
# Remove the FinDesk api-server launchd agent (stops auto-start; logs kept).
set -euo pipefail
LABEL="com.findesk.api-server"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Removed $LABEL. The server no longer auto-starts (logs kept in ~/Library/Logs/findesk)."
