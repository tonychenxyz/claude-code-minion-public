# Claude Code Minion

Talk to Claude Code running on a remote server through Slack. The server initiates all connections (Socket Mode), so no incoming ports need to be exposed.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Remote Server                               │
│                                                                       │
│  ┌─────────────────────┐      ┌────────────────────────────────────┐ │
│  │   Main Orchestrator │      │  Claude Code + MCP (Channel #1)    │ │
│  │   (Slack Socket     │◄────►│  - PTY terminal                    │ │
│  │    Mode Bot)        │      │  - slack-messenger MCP             │ │
│  │                     │      └────────────────────────────────────┘ │
│  │  - Session tokens   │      ┌────────────────────────────────────┐ │
│  │  - Channel mapping  │◄────►│  Claude Code + MCP (Channel #2)    │ │
│  │  - Message routing  │      └────────────────────────────────────┘ │
│  └──────────┬──────────┘                                             │
│             │ WebSocket (server-initiated)                           │
└─────────────┼────────────────────────────────────────────────────────┘
              ▼
       [ Slack API ]
```

## Features

- **Socket Mode**: Server initiates WebSocket connection to Slack (no exposed ports)
- **Multi-channel**: Each Slack channel gets its own Claude Code instance
- **MCP Integration**: Claude Code communicates back via MCP tools:
  - Send markdown messages
  - Send files
  - Tag/mention users for input
  - Notify about actions and results
- **Session Tokens**: Secure pairing between Slack users and server sessions

## Project Structure

```
.
├── app/                      # Bot application
│   ├── src/                  # TypeScript source
│   ├── dist/                 # Compiled JavaScript
│   ├── package.json
│   └── setup.sh
├── projects/                 # Your project files (Claude works here)
├── logs/                     # pm2 logs (auto-created)
├── .claude/                  # Claude settings
├── .env                      # Configuration (create from .env.example)
├── .env.example
├── CLAUDE.md                 # Instructions for Claude Code
├── slack-app-manifest.yaml   # Slack app manifest
├── start.sh                  # One-click launcher with pm2
├── stop.sh                   # Stop script
└── README.md
```

## Quick Start

### 1. Create Slack App

1. Go to [Slack API](https://api.slack.com/apps)
2. Click "Create New App" → "From an app manifest"
3. Select your workspace
4. Paste the contents of `slack-app-manifest.yaml`
5. Click "Create"

### 2. Get Tokens

After creating the app:

1. Go to **OAuth & Permissions** → Install to Workspace
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

3. Go to **Basic Information** → App-Level Tokens
4. Click "Generate Token and Scopes"
5. Name: `socket-mode`, Scope: `connections:write`
6. Copy the **App Token** (starts with `xapp-`)

### 3. Setup Claude Code Authentication

The bot needs Claude Code CLI authenticated to work. Choose one method:

**Option A: Claude Max Subscription (Recommended)**

```bash
# Generate a long-lived OAuth token
claude setup-token

# You'll see output like:
# Your OAuth token (valid for 1 year):
# sk-ant-oat01-...
# Store this token securely.

# Export the token
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-your-full-token"

# Add to your shell profile for persistence
echo 'export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-your-full-token"' >> ~/.bashrc
source ~/.bashrc
```

**Option B: Anthropic API Key**

```bash
export ANTHROPIC_API_KEY="sk-ant-your-api-key"
```

**Verify authentication:**

```bash
claude -p "hi"
# Should respond without "Invalid API key" error
```

### 4. Setup Server

```bash
# Clone the repo
git clone <this-repo> claude-code-minion
cd claude-code-minion/app

# Run setup
./setup.sh

# Configure tokens in .env (root directory)
nano ../.env
# Add: SLACK_BOT_TOKEN, SLACK_APP_TOKEN, CLAUDE_CODE_OAUTH_TOKEN

# Start the bot (with auto-restart)
cd ..
./start.sh
```

### 5. Connect via Slack

1. Copy the **Session Token** shown when the bot starts
2. DM the bot in Slack with the token
3. Create a new channel
4. Invite the bot to the channel
5. Start chatting!

## Configuration

Create `.env` file in root directory:

```env
# Required - Slack tokens
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token

# Required - Claude Code authentication (choose one)
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-your-token  # From `claude setup-token`
# OR
# ANTHROPIC_API_KEY=sk-ant-your-api-key          # Direct API key

# Multiple tokens with aliases (optional - for switching between accounts)
# CLAUDE_CODE_OAUTH_TOKEN_work=sk-ant-oat01-work-token
# CLAUDE_CODE_OAUTH_TOKEN_personal=sk-ant-oat01-personal-token

# Optional
ORCHESTRATOR_PORT=3000
WORKING_DIRECTORY=/path/to/your/projects  # Default: ../projects
CLAUDE_MODEL=claude-sonnet-4-5-20250929   # Default: sonnet-4.5
# Options: claude-opus-4-5-20251101, claude-sonnet-4-5-20250929, claude-haiku-4-5
```

## Usage

### Starting the Bot (Recommended)

```bash
./start.sh
```

This uses pm2 for auto-restart and will:
- Install pm2 if needed
- Start the bot with auto-restart on crash
- DM you the new session token on (re)starts
- Save logs to `./logs/`

### Managing the Bot

```bash
# Start
pm2 start claude-minion

# Stop
pm2 stop claude-minion

# Restart
pm2 restart claude-minion

# Check status
pm2 status

# View logs
pm2 logs claude-minion --lines 50

# Stop completely (alternative)
./stop.sh
```

### If pm2 process doesn't exist

If the process was deleted or this is a fresh setup:

```bash
cd /path/to/claude-code-minion/app
pm2 start dist/index.js --name claude-minion --time \
  --log ../logs/minion.log \
  --error ../logs/minion-error.log
```

### If port 3000 is stuck

If the bot crashes and leaves a zombie process on port 3000:

```bash
# Find what's using port 3000
lsof -i :3000

# Kill the process (replace <PID> with actual PID)
kill -9 <PID>

# Restart the bot
pm2 restart claude-minion
```

### Starting Without Auto-Restart

```bash
cd app && npm start
```

### First Time Setup

1. Run `./start.sh` on your server
2. Note the session token displayed (or check your DMs)
3. DM the Slack bot with the token
4. You're connected!

### Creating Claude Code Instances

1. Create a new Slack channel (e.g., `#project-feature-x`)
2. Invite the bot: `/invite @Claude Code`
3. A new Claude Code terminal is spawned for this channel
4. Send messages to interact with Claude

### Slash Commands

| Command | Description |
|---------|-------------|
| `/reset` | Start a new conversation |
| `/interrupt` | Interrupt Claude (sends Ctrl+C) |
| `/compact` | Compact conversation context |

### Text Commands (in channels)

| Command | Description |
|---------|-------------|
| `!interrupt` / `!stop` / `!esc` | Interrupt Claude (sends Ctrl+C) |
| `!reset` / `!new` | Start a new conversation |
| `!debug` / `!output` | Show terminal output |
| `!help` | Show available commands |

### DM Commands

| Command | Description |
|---------|-------------|
| `<8-char token>` | Connect with a session token |
| `tokens` | List available OAuth tokens |
| `use <alias>` | Switch to a different token |
| `help` | Show available commands |

### Multi-Token Support

If you have multiple Claude accounts (e.g., work and personal), you can configure multiple OAuth tokens and switch between them via DM.

**1. Configure tokens in `.env`:**

```env
CLAUDE_CODE_OAUTH_TOKEN_work=sk-ant-oat01-work-token
CLAUDE_CODE_OAUTH_TOKEN_personal=sk-ant-oat01-personal-token
```

**2. Restart the bot** (tokens are loaded at startup):

```bash
pm2 restart claude-minion
```

**3. Switch tokens via DM:**

```
tokens              # List available tokens and see current selection
use work            # Switch to 'work' token
use personal        # Switch to 'personal' token
```

New Claude Code sessions will use your selected token. Existing channel sessions continue using their original token until reset.

## MCP Tools

Claude Code in each session has access to these MCP tools for communicating via Slack:

| Tool | Description |
|------|-------------|
| `get_pending_messages` | Check for new messages from user |
| `send_message` | Send markdown message to channel |
| `send_file` | Upload file to channel |
| `request_input` | @mention user for input |
| `notify_action` | Notify about action being taken |
| `notify_result` | Notify about action result |

## Troubleshooting

### "Unhandled event 'server explicit disconnect'" error

This is a known bug in `@slack/socket-mode` 1.x. The bot includes an error handler that catches this and lets the connection retry automatically. If running with `./start.sh`, pm2 will also auto-restart on any crash.

### "Invalid API key" error

```bash
# Verify token is set
echo $CLAUDE_CODE_OAUTH_TOKEN

# Test authentication
claude -p "hi"

# If still failing, regenerate token
claude setup-token
# Copy the FULL token (it's very long!)
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-full-token-here"
```

### Bot not responding

- Check that both Slack tokens are correct in `.env`
- Ensure the bot is invited to the channel
- Check console for error messages

### Claude Code not starting

- Verify `claude` CLI is installed: `claude --version`
- Verify authentication: `claude -p "hi"`
- Check that the working directory exists (`projects/`)
- Look for errors in the terminal output

### Messages not being sent to Slack

- The orchestrator server must be running (port 3000 by default)
- Check MCP configuration in `app/.claude-minion/<channel-id>/mcp-config.json`

### Port 3000 already in use (EADDRINUSE)

If the bot crashes and leaves a zombie process:

```bash
# Find and kill the process using port 3000
lsof -i :3000
kill -9 <PID>

# Restart
pm2 restart claude-minion
```

## Development

```bash
cd app

# Install dependencies
npm install

# Build
npm run build

# Start
npm start
```

## Security Notes

- Session tokens are short-lived and should be regenerated for new sessions
- The bot only has access to channels it's invited to
- Claude Code runs with the permissions of the user who started the server
- Consider running in a sandboxed environment for untrusted code

## License

MIT
