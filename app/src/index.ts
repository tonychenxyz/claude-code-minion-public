#!/usr/bin/env node

import { SlackBot } from './slack-bot.js';
import { SessionManager } from './session-manager.js';
import { TerminalManager } from './terminal-manager.js';
import { Session, OAuthToken } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Handle the known socket-mode bug where "server explicit disconnect"
// arrives during "connecting" state - just log and let it reconnect
process.on('uncaughtException', (error) => {
  if (error.message?.includes("Unhandled event 'server explicit disconnect'")) {
    console.log('[Socket] Disconnect during reconnect - ignoring, will retry...');
    return;
  }
  console.error('Uncaught exception:', error);
  process.exit(1);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// App directory is where this script lives (app/dist -> app/)
const appDirectory = path.resolve(__dirname, '..');
// Root directory is parent of app/
const rootDirectory = path.resolve(appDirectory, '..');

interface Config {
  slackBotToken: string;
  slackAppToken: string;
  orchestratorPort: number;
  workingDirectory: string;
  appDirectory: string;
  oauthTokens: OAuthToken[];  // Multiple OAuth tokens with aliases
}

function loadConfig(): Config {
  // Try to load from .env file in root directory
  const envPath = path.join(rootDirectory, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        process.env[key.trim()] = value;
      }
    }
  }

  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackAppToken = process.env.SLACK_APP_TOKEN;
  const orchestratorPort = parseInt(process.env.ORCHESTRATOR_PORT || '3000', 10);
  // Default working directory is root (parent of app/)
  const defaultWorkingDir = rootDirectory;
  const workingDirectory = process.env.WORKING_DIRECTORY || defaultWorkingDir;

  if (!slackBotToken) {
    console.error('Error: SLACK_BOT_TOKEN is required');
    console.error('Set it in .env file or as environment variable');
    process.exit(1);
  }

  if (!slackAppToken) {
    console.error('Error: SLACK_APP_TOKEN is required');
    console.error('Set it in .env file or as environment variable');
    process.exit(1);
  }

  // Parse OAuth tokens - support multiple tokens with aliases
  // Format: CLAUDE_CODE_OAUTH_TOKEN_<alias>=<token>
  // Also support: CLAUDE_CODE_OAUTH_TOKEN=<token> (alias = "default")
  const oauthTokens: OAuthToken[] = [];

  // Check for single token format (backwards compatibility)
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    oauthTokens.push({
      alias: 'default',
      token: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      isDefault: true,
    });
  }

  // Check for multi-token format: CLAUDE_CODE_OAUTH_TOKEN_<alias>
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^CLAUDE_CODE_OAUTH_TOKEN_(.+)$/);
    if (match && value) {
      const alias = match[1].toLowerCase();
      // Skip if this alias already exists (e.g., from single token format with alias "default")
      if (!oauthTokens.some(t => t.alias === alias)) {
        oauthTokens.push({
          alias,
          token: value,
          isDefault: oauthTokens.length === 0, // First token is default if no default exists
        });
      }
    }
  }

  // If no tokens found, warn but don't exit (some users might use ANTHROPIC_API_KEY)
  if (oauthTokens.length === 0) {
    console.warn('Warning: No CLAUDE_CODE_OAUTH_TOKEN found');
    console.warn('Set CLAUDE_CODE_OAUTH_TOKEN or CLAUDE_CODE_OAUTH_TOKEN_<alias> in .env file');
  }

  // Ensure exactly one default token
  const hasDefault = oauthTokens.some(t => t.isDefault);
  if (!hasDefault && oauthTokens.length > 0) {
    oauthTokens[0].isDefault = true;
  }

  return {
    slackBotToken,
    slackAppToken,
    orchestratorPort,
    workingDirectory,
    appDirectory,
    oauthTokens,
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('           Claude Code Minion - Slack Bot');
  console.log('═══════════════════════════════════════════════════════════');

  const config = loadConfig();

  console.log(`App directory: ${config.appDirectory}`);
  console.log(`Working directory: ${config.workingDirectory}`);
  console.log(`Orchestrator port: ${config.orchestratorPort}`);

  // Log available OAuth tokens
  if (config.oauthTokens.length > 0) {
    console.log(`OAuth tokens configured: ${config.oauthTokens.length}`);
    for (const token of config.oauthTokens) {
      const defaultLabel = token.isDefault ? ' (default)' : '';
      console.log(`  - ${token.alias}${defaultLabel}: ${token.token.substring(0, 20)}...`);
    }
  }

  // Ensure working directory exists
  if (!fs.existsSync(config.workingDirectory)) {
    fs.mkdirSync(config.workingDirectory, { recursive: true });
    console.log(`Created working directory: ${config.workingDirectory}`);
  }

  // Initialize managers
  const sessionManager = new SessionManager(config.workingDirectory, config.oauthTokens);

  // Initialize Slack bot (need to create early to pass callback to terminalManager)
  const bot = new SlackBot(
    config.slackBotToken,
    config.slackAppToken,
    config.workingDirectory,
    config.appDirectory,
    sessionManager,
    null as any, // Will set terminalManager after creating it
    config.oauthTokens
  );

  // Create terminal manager with callbacks to bot
  const terminalManager = new TerminalManager(
    config.workingDirectory,
    config.appDirectory,
    (channelId, message) => bot.handleQueueProcess(channelId, message),
    (channelId) => bot.handleAgentTurnComplete(channelId)
  );

  // Wire up the terminal manager to the bot
  (bot as any).terminalManager = terminalManager;

  // Check for existing session with a known user (for restart notifications)
  const existingSessions: Session[] = Array.from((sessionManager as any).sessions?.values() || []);
  const existingUserSession = existingSessions.find((s) => s.userId && s.dmChannelId);

  // Create a session token on startup
  const session = sessionManager.createSession(
    existingUserSession?.userId || '', // Reuse existing user ID if available
    existingUserSession?.dmChannelId || '', // Reuse existing DM channel if available
    config.workingDirectory
  );

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SESSION TOKEN: ' + session.token);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('To connect:');
  console.log('1. DM the bot in Slack with this token');
  console.log('2. Create a channel and invite the bot');
  console.log('3. Start chatting with Claude Code!');
  console.log('');

  // Start orchestrator server (receives messages from MCP servers)
  process.env.ORCHESTRATOR_PORT = config.orchestratorPort.toString();
  bot.startOrchestratorServer(config.orchestratorPort);

  // Start the bot
  await bot.start();

  // If we have an existing user, DM them the new session token
  if (existingUserSession?.userId && existingUserSession?.dmChannelId) {
    try {
      await bot.sendDirectMessage(
        existingUserSession.dmChannelId,
        `🔄 *Bot restarted!*\n\nNew session token: \`${session.token}\`\n\nYour existing channel sessions should continue working.`
      );
      console.log(`Sent restart notification to user ${existingUserSession.userId}`);
    } catch (error) {
      console.error('Failed to send restart notification:', error);
    }
  }

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await bot.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
