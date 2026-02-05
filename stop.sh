#!/bin/bash

# Stop Claude Code Minion

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"

# Find pm2
if command -v pm2 &> /dev/null; then
    PM2="pm2"
elif [ -f "$APP_DIR/node_modules/.bin/pm2" ]; then
    PM2="$APP_DIR/node_modules/.bin/pm2"
else
    echo "pm2 not found"
    exit 1
fi

$PM2 stop claude-minion
$PM2 delete claude-minion
echo "Claude Code Minion stopped."
