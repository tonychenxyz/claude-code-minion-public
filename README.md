# Claude Code Minion

Run Claude Code or Codex on a remote server and talk to the active agent from Slack. The bot uses Slack Socket Mode, so the server only needs outbound network access.

## 1. What Can You Do

Claude Code Minion lets you run Claude Code or Codex on a remote machine and chat with it from Slack.

You can use it like a normal Slack teammate: ask it to inspect files, edit code, run commands, debug failures, and report back in the channel. You can switch between Claude Code and Codex, interrupt the current run, or start a fresh session at any time.

## 2. Quick Start

### Create The Slack App

1. Go to <https://api.slack.com/apps>.
2. Create a new app from a manifest.
3. Paste `app/slack-app-manifest.yaml`.
4. Install the app to your workspace.
5. Copy the bot token (`xoxb-...`) from **OAuth & Permissions**.
6. Create an app-level token with `connections:write` from **Basic Information > App-Level Tokens** and copy the `xapp-...` token.

If you are updating an existing Slack app, re-apply the manifest so Slack registers all slash commands, including `/agent`.

### Install Agent CLIs

Install and authenticate whichever agents you want to use:

```bash
# Claude Code must be available as `claude`
claude --version

# Codex must be available as `codex`
codex --version
```

Claude Code can use `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. Codex can use `OPENAI_API_KEY` or an existing `codex login` auth file.

### Configure And Start

```bash
cd /path/to/claude_code_minion_release
cd app
./setup.sh
cd ..
cp .env.example .env 2>/dev/null || touch .env
```

Edit `.env` with your Slack tokens and at least one agent credential, then start:

```bash
./start.sh
```

The bot prints a session token and also DMs the token to the last connected user on restart. DM that token to the bot, invite the bot to a channel, then send a normal message.

Useful process commands:

```bash
pm2 logs claude-minion
pm2 status
pm2 restart claude-minion
./stop.sh
```

## 3. Configuration

Required Slack settings:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

Claude Code settings:

```env
CLAUDE_CODE_OAUTH_TOKEN=your-claude-code-oauth-token
# or
ANTHROPIC_API_KEY=your-anthropic-api-key
CLAUDE_MODEL=claude-sonnet-4-5-20250929
```

Codex settings:

```env
OPENAI_API_KEY=your-openai-api-key
CODEX_MODEL=gpt-5.5
CODEX_REASONING_EFFORT=xhigh
```

For Codex, the bot keeps a repo-local `.codex/` home and links Codex instructions back to `CLAUDE.md` through `AGENTS.md`.

Bot settings:

```env
ORCHESTRATOR_PORT=3000
WORKING_DIRECTORY=/path/to/workspace
DEFAULT_AGENT=claude
CONTEXT_WINDOW_MAX=200000
```

`DEFAULT_AGENT` can be `claude` or `codex`. Existing channels keep their persisted agent type. Users can set their default agent by DMing `agent claude` or `agent codex`, and channels can switch with `/agent claude` or `/agent codex`.

## 4. Slash Commands

| Command | Agent Support | Description |
| --- | --- | --- |
| `/reset` | Claude Code and Codex | Start a fresh conversation for the current channel agent. |
| `/interrupt` | Claude Code and Codex | Send Ctrl+C to the current channel agent and clear stale queued work. |
| `/compact` | Claude Code only | Ask Claude Code to compact the current conversation context. |
| `/agent` | Bot control | Show the current channel agent and default agent. |
| `/agent claude` | Bot control | Switch the channel to Claude Code. |
| `/agent codex` | Bot control | Switch the channel to Codex. |
| `/context` | Diagnostics | Show the latest recorded usage stats for the channel. |
| `/debug` | Diagnostics | Show recent terminal output, visible only to the requester. |

Only `/reset` and `/interrupt` are shared model-control commands for both Claude Code and Codex. `/compact` is Claude Code only.
