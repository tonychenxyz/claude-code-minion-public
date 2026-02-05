#!/bin/bash

set -e

echo "═══════════════════════════════════════════════════════════"
echo "        Claude Code Minion - Setup Script"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Node.js 18+ is required (found v$NODE_VERSION)"
    exit 1
fi

echo "✓ Node.js $(node -v) detected"

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed"
    exit 1
fi

echo "✓ npm $(npm -v) detected"

# Check for Claude CLI
if ! command -v claude &> /dev/null; then
    echo "Warning: Claude CLI not found"
    echo "Install it with: npm install -g @anthropic-ai/claude-code"
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Build the project
echo ""
echo "Building..."
npm run build

# Create projects directory if it doesn't exist
if [ ! -d "../projects" ]; then
    mkdir -p ../projects
    echo "✓ Created ../projects directory"
fi

# Check for .env file at root level
if [ ! -f "../.env" ]; then
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  CONFIGURATION REQUIRED"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "No .env file found. Creating from template..."
    cp ../.env.example ../.env
    echo ""
    echo "Please edit .env (in root directory) and add your tokens:"
    echo "  - SLACK_BOT_TOKEN (starts with xoxb-)"
    echo "  - SLACK_APP_TOKEN (starts with xapp-)"
    echo "  - CLAUDE_CODE_OAUTH_TOKEN (from 'claude setup-token')"
    echo ""
    echo "Get Slack tokens from your Slack App settings:"
    echo "  https://api.slack.com/apps"
    echo ""
    exit 0
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  SETUP COMPLETE!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "To start the bot, run:"
echo "  cd app && npm start"
echo ""
echo "Working directory: ../projects"
echo ""
