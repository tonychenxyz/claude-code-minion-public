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
- **MCP Integration**: Claude Code communicates back via MCP tools
- **Session Tokens**: Secure pairing between Slack users and server sessions

## Quick Start

### 1. Create Slack App

1. Go to [Slack API](https://api.slack.com/apps)
2. Click "Create New App" → "From an app manifest"
3. Select your workspace
4. Paste the contents of `app/slack-app-manifest.yaml`
5. Click "Create"

### 2. Get Slack Tokens

After creating the app:

1. Go to **OAuth & Permissions** → Install to Workspace
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

3. Go to **Basic Information** → App-Level Tokens
4. Click "Generate Token and Scopes"
5. Name: `socket-mode`, Scope: `connections:write`
6. Copy the **App Token** (starts with `xapp-`)

### 3. Setup Claude Code Authentication

**Option A: Claude Max Subscription (Recommended)**

```bash
claude setup-token
# Copy the token (sk-ant-oat01-...)
```

**Option B: Anthropic API Key**

```bash
export ANTHROPIC_API_KEY="sk-ant-your-api-key"
```

### 4. Configure Environment

```bash
cd claude-code-minion/app
./setup.sh

# Edit .env in root directory
nano ../.env
```

Add to `.env`:
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-your-token
```

### 5. Start the Bot

```bash
./start.sh
```

This uses pm2 for auto-restart and will:
- Install pm2 if needed
- Start the bot with auto-restart on crash
- DM you the session token on (re)starts

### 6. Connect via Slack

1. Copy the **Session Token** shown when the bot starts (or check your DMs)
2. DM the bot in Slack with the token
3. Create a new channel and invite the bot
4. Start chatting!

## Managing the Bot

```bash
# View logs
pm2 logs claude-minion

# Check status
pm2 status

# Restart
pm2 restart claude-minion

# Stop
pm2 stop claude-minion
# or
./stop.sh
```

### If port 3000 is stuck

```bash
lsof -i :3000
kill -9 <PID>
pm2 restart claude-minion
```

## Configuration

Full `.env` options:

```env
# Required
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-your-token

# Optional
ORCHESTRATOR_PORT=3000
WORKING_DIRECTORY=/path/to/your/projects
CLAUDE_MODEL=claude-sonnet-4-5-20250929

# Multiple tokens (for switching accounts)
# CLAUDE_CODE_OAUTH_TOKEN_work=sk-ant-oat01-work-token
# CLAUDE_CODE_OAUTH_TOKEN_personal=sk-ant-oat01-personal-token
```

## Commands

### Slash Commands
| Command | Description |
|---------|-------------|
| `/reset` | Start a new conversation |
| `/interrupt` | Interrupt Claude (Ctrl+C) |
| `/compact` | Compact conversation context |

### Text Commands (in channels)
| Command | Description |
|---------|-------------|
| `!interrupt` / `!stop` | Interrupt Claude |
| `!reset` / `!new` | New conversation |
| `!debug` | Show terminal output |

### DM Commands
| Command | Description |
|---------|-------------|
| `<token>` | Connect with session token |
| `tokens` | List available OAuth tokens |
| `use <alias>` | Switch token |

## Troubleshooting

### Bot not responding
- Check Slack tokens in `.env`
- Ensure bot is invited to the channel
- Check logs: `pm2 logs claude-minion`

### "Invalid API key" error
```bash
claude -p "hi"  # Test authentication
claude setup-token  # Regenerate if needed
```

## License

MIT
