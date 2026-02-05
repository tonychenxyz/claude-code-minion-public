import pkg from '@slack/bolt';
const { App, LogLevel } = pkg;
import { SessionManager } from './session-manager.js';
import { TerminalManager } from './terminal-manager.js';
import { OAuthToken } from './types.js';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

interface PendingMessage {
  user: string;
  text: string;
  timestamp: Date;
  files?: string[]; // Paths to downloaded files
}

// Retry configuration for Slack API calls
const RETRY_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

// Helper function to retry Slack API calls with exponential backoff
async function retrySlackCall<T>(
  fn: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;
  let delay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || String(error);

      // Check if it's a "client not ready" error - worth retrying
      const isRetryable =
        errorMessage.includes('not ready') ||
        errorMessage.includes('WebSocket') ||
        errorMessage.includes('socket') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT');

      if (!isRetryable || attempt === RETRY_CONFIG.maxRetries) {
        console.error(`[Slack] ${operationName} failed after ${attempt} attempt(s): ${errorMessage}`);
        throw error;
      }

      console.log(`[Slack] ${operationName} failed (attempt ${attempt}/${RETRY_CONFIG.maxRetries}), retrying in ${delay}ms: ${errorMessage}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
    }
  }

  throw lastError;
}

interface SlackFile {
  id: string;
  name: string;
  url_private_download?: string;
  url_private?: string;
}

export class SlackBot {
  private app: InstanceType<typeof App>;
  private sessionManager: SessionManager;
  private terminalManager: TerminalManager;
  private orchestratorServer: http.Server | null = null;
  private botUserId: string = '';
  private workingDirectory: string;
  private appDirectory: string;
  private oauthTokens: OAuthToken[];

  // Message queue per channel - Claude pulls from this via MCP
  private messageQueues: Map<string, PendingMessage[]> = new Map();

  constructor(
    botToken: string,
    appToken: string,
    workingDirectory: string,
    appDirectory: string,
    sessionManager: SessionManager,
    terminalManager: TerminalManager,
    oauthTokens: OAuthToken[] = []
  ) {
    this.workingDirectory = workingDirectory;
    this.appDirectory = appDirectory;
    this.sessionManager = sessionManager;
    this.terminalManager = terminalManager;
    this.oauthTokens = oauthTokens;

    this.app = new App({
      token: botToken,
      appToken: appToken,
      socketMode: true,
      logLevel: LogLevel.INFO,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle DMs - session token configuration
    this.app.message(async ({ message, say, client }) => {
      // Ignore bot messages
      if ('bot_id' in message) return;
      if (!('user' in message) || !('channel' in message)) return;

      const channelType = (message as any).channel_type;
      const text = ('text' in message ? message.text : '') || '';
      const userId = message.user as string;
      const channelId = message.channel;

      // DM handling - session token
      if (channelType === 'im') {
        await this.handleDM(userId, channelId, text, async (msg: string) => {
          await say(msg);
        });
        return;
      }

      // Channel message - forward to Claude Code
      // Process any attached files
      const downloadedFiles = await this.processMessageFiles(message, channelId);
      await this.handleChannelMessage(channelId, userId, text, client, downloadedFiles);
    });

    // Handle bot being added to a channel
    this.app.event('member_joined_channel', async ({ event, client }) => {
      if (event.user !== this.botUserId) return;

      const channelId = event.channel;
      const inviterId = event.inviter;

      if (!inviterId) {
        console.log('No inviter found for channel join');
        return;
      }

      // Check if inviter has a session
      const session = this.sessionManager.getSessionByUserId(inviterId);
      if (!session) {
        await client.chat.postMessage({
          channel: channelId,
          text: `Hello! To use me, please DM me your session token first. You can get a session token by running the minion setup on your server.`,
        });
        return;
      }

      // Check if channel already has a session
      if (this.sessionManager.getChannelSession(channelId)) {
        await client.chat.postMessage({
          channel: channelId,
          text: `Claude Code is already running in this channel. Send a message to interact with it.`,
        });
        return;
      }

      // Create channel session and spawn Claude Code
      await this.spawnClaudeCodeForChannel(channelId, session.token, inviterId, client);
    });

    // Handle app mentions
    this.app.event('app_mention', async ({ event, client }) => {
      const channelId = event.channel;
      const userId = event.user;
      if (!userId) return;
      const text = event.text.replace(/<@[A-Z0-9]+>/gi, '').trim();

      // Process any attached files
      const downloadedFiles = await this.processMessageFiles(event, channelId);
      await this.handleChannelMessage(channelId, userId, text, client, downloadedFiles);
    });

    // Slash command: /reset - Start a fresh conversation
    this.app.command('/reset', async ({ command, ack, respond }) => {
      await ack();
      const channelId = command.channel_id;
      const channelSession = this.sessionManager.getChannelSession(channelId);

      if (!channelSession) {
        await respond({
          text: `No active Claude Code session in this channel. Send a message first to start one.`,
          response_type: 'ephemeral',
        });
        return;
      }

      this.terminalManager.resetConversation(channelId);
      this.messageQueues.set(channelId, []);
      await respond({
        text: `🔄 Conversation reset. Next message will start a new Claude Code session.`,
        response_type: 'in_channel',
      });
    });

    // Slash command: /interrupt - Stop current Claude operation
    this.app.command('/interrupt', async ({ command, ack, respond }) => {
      await ack();
      const channelId = command.channel_id;
      const channelSession = this.sessionManager.getChannelSession(channelId);

      if (!channelSession) {
        await respond({
          text: `No active Claude Code session in this channel.`,
          response_type: 'ephemeral',
        });
        return;
      }

      const success = this.terminalManager.sendInterrupt(channelSession.terminalId);
      this.terminalManager.clearBusyState(channelId);
      this.messageQueues.set(channelId, []);

      if (success) {
        await respond({
          text: `⏹️ Interrupted Claude Code (sent Ctrl+C) and cleared message queue`,
          response_type: 'in_channel',
        });
      } else {
        await respond({
          text: `Failed to interrupt - terminal not found`,
          response_type: 'ephemeral',
        });
      }
    });

    // Slash command: /compact - Trigger Claude Code's /compact command
    this.app.command('/compact', async ({ command, ack, respond }) => {
      await ack();
      const channelId = command.channel_id;
      const userId = command.user_id;
      const channelSession = this.sessionManager.getChannelSession(channelId);

      if (!channelSession) {
        await respond({
          text: `No active Claude Code session in this channel. Send a message first to start one.`,
          response_type: 'ephemeral',
        });
        return;
      }

      // Send /compact command to Claude Code (with user's current token)
      const userToken = this.sessionManager.getOAuthTokenForUser(userId);
      const success = await this.terminalManager.sendInput(channelSession.terminalId, '/compact', userToken?.token);
      if (success) {
        await respond({
          text: `📦 Sent /compact to Claude Code - compacting conversation context...`,
          response_type: 'in_channel',
        });
      } else {
        await respond({
          text: `Failed to send /compact - terminal not found`,
          response_type: 'ephemeral',
        });
      }
    });

    // Slash command: /context - Display latest context/usage stats
    this.app.command('/context', async ({ command, ack, respond }) => {
      await ack();
      const channelId = command.channel_id;

      const usage = this.terminalManager.getLatestUsageStats(channelId);

      if (!usage) {
        await respond({
          text: `No usage stats available yet. Send a message first to generate stats.`,
          response_type: 'ephemeral',
        });
        return;
      }

      const usageText = JSON.stringify(usage, null, 2);
      const totalContext = (usage.input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0);
      const contextMax = parseInt(process.env.CONTEXT_WINDOW_MAX || '200000', 10);
      const percentage = ((totalContext / contextMax) * 100).toFixed(1);

      await respond({
        text: `📊 *Context Usage Stats:*\n\`\`\`\n${usageText}\n\`\`\`\n\n` +
          `*Breakdown:*\n` +
          `• Input tokens (new): ${usage.input_tokens || 0}\n` +
          `• Cache creation: ${usage.cache_creation_input_tokens || 0}\n` +
          `• Cache read: ${usage.cache_read_input_tokens || 0}\n` +
          `• Output tokens: ${usage.output_tokens || 0}\n\n` +
          `*Total context:* ${totalContext.toLocaleString()} / ${contextMax.toLocaleString()} tokens (*${percentage}%*)`,
        response_type: 'in_channel',
      });
    });

    // Slash command: /debug - Show terminal output for debugging
    this.app.command('/debug', async ({ command, ack, respond }) => {
      await ack();
      const channelId = command.channel_id;
      const channelSession = this.sessionManager.getChannelSession(channelId);

      if (!channelSession) {
        await respond({
          text: `No active Claude Code session in this channel. Send a message first to start one.`,
          response_type: 'ephemeral',
        });
        return;
      }

      const output = this.terminalManager.getOutput(channelSession.terminalId, 30);
      const outputText = output.join('').slice(-3000); // Last 3000 chars

      await respond({
        text: `📟 *Terminal output (last 30 chunks):*\n\`\`\`\n${outputText || '(no output)'}\n\`\`\``,
        response_type: 'ephemeral', // Only visible to the user who ran the command
      });
    });
  }

  private async handleDM(
    userId: string,
    channelId: string,
    text: string,
    say: (msg: string) => Promise<void>
  ): Promise<void> {
    const trimmedText = text.trim();
    const upperText = trimmedText.toUpperCase();

    // Check if it's a session token (8 character hex)
    if (/^[A-F0-9]{8}$/.test(upperText)) {
      const session = this.sessionManager.getSessionByToken(upperText);
      if (session) {
        // Update session with this user's info and persist
        this.sessionManager.updateSessionUser(upperText, userId, channelId);
        await say(
          `✅ Session configured!\n` +
          `Working directory: \`${session.workingDirectory}\`\n\n` +
          `Now go to any channel where I'm a member and send a message - Claude Code will start automatically.`
        );
      } else {
        await say(`❌ Invalid session token \`${upperText}\`. Please check and try again.\n\nThe token should be 8 characters like \`A1B2C3D4\` - shown in the terminal when you run \`npm start\`.`);
      }
      return;
    }

    // Handle DM commands (case-insensitive)
    const lowerText = trimmedText.toLowerCase();

    // Command: tokens - List available OAuth tokens
    if (lowerText === 'tokens' || lowerText === '!tokens') {
      await this.handleTokensCommand(userId, say);
      return;
    }

    // Command: use <alias> - Select an OAuth token
    const useMatch = lowerText.match(/^!?use\s+(\S+)$/);
    if (useMatch) {
      const alias = useMatch[1];
      await this.handleUseTokenCommand(userId, alias, say);
      return;
    }

    // Command: help - Show available commands
    if (lowerText === 'help' || lowerText === '!help') {
      await this.handleDMHelpCommand(userId, say);
      return;
    }

    // Check if user has a session
    const session = this.sessionManager.getSessionByUserId(userId);
    if (!session) {
      await say(
        `Welcome! To get started:\n` +
        `1. Run \`npm start\` on your server\n` +
        `2. Copy the *SESSION TOKEN* shown (8 characters like \`A1B2C3D4\`)\n` +
        `3. Send me that token here\n\n` +
        `⚠️ Note: Send the session token, not your Slack user ID!\n\n` +
        `*DM Commands:*\n` +
        `• \`tokens\` - List available OAuth tokens\n` +
        `• \`use <alias>\` - Switch to a different token\n` +
        `• \`help\` - Show this help`
      );
      return;
    }

    // Get user's current token
    const currentToken = this.sessionManager.getOAuthTokenForUser(userId);
    const tokenInfo = currentToken ? `\nCurrent token: \`${currentToken.alias}\`` : '';

    await say(
      `✅ You're connected! Session token: \`${session.token}\`\n` +
      `Working directory: \`${session.workingDirectory}\`${tokenInfo}\n\n` +
      `Create a channel and invite me to start a Claude Code instance.\n\n` +
      `*DM Commands:*\n` +
      `• \`tokens\` - List available OAuth tokens\n` +
      `• \`use <alias>\` - Switch to a different token\n` +
      `• \`help\` - Show available commands`
    );
  }

  // Handle 'tokens' command - list available OAuth tokens
  private async handleTokensCommand(userId: string, say: (msg: string) => Promise<void>): Promise<void> {
    const tokens = this.oauthTokens;

    if (tokens.length === 0) {
      await say(
        `❌ No OAuth tokens configured.\n\n` +
        `Add tokens to your \`.env\` file:\n` +
        `• Single token: \`CLAUDE_CODE_OAUTH_TOKEN=<token>\`\n` +
        `• Multiple tokens: \`CLAUDE_CODE_OAUTH_TOKEN_<alias>=<token>\``
      );
      return;
    }

    // Get user's current selection
    const currentToken = this.sessionManager.getOAuthTokenForUser(userId);
    const currentAlias = currentToken?.alias || 'default';

    let tokenList = '*Available OAuth Tokens:*\n';
    for (const token of tokens) {
      const isSelected = token.alias === currentAlias;
      const selectedMarker = isSelected ? ' ✅ (selected)' : '';
      const defaultMarker = token.isDefault ? ' (default)' : '';
      const preview = token.token.substring(0, 15) + '...';
      tokenList += `• \`${token.alias}\`${defaultMarker}${selectedMarker} - \`${preview}\`\n`;
    }

    tokenList += `\nTo switch tokens: \`use <alias>\``;

    await say(tokenList);
  }

  // Handle 'use <alias>' command - select an OAuth token
  private async handleUseTokenCommand(userId: string, alias: string, say: (msg: string) => Promise<void>): Promise<void> {
    const tokens = this.oauthTokens;

    if (tokens.length === 0) {
      await say(`❌ No OAuth tokens configured.`);
      return;
    }

    // Find the token
    const token = tokens.find(t => t.alias.toLowerCase() === alias.toLowerCase());
    if (!token) {
      const availableAliases = tokens.map(t => `\`${t.alias}\``).join(', ');
      await say(
        `❌ Token \`${alias}\` not found.\n\n` +
        `Available tokens: ${availableAliases}`
      );
      return;
    }

    // Save preference
    const success = this.sessionManager.setUserTokenPreference(userId, token.alias);
    if (success) {
      await say(
        `✅ Switched to token \`${token.alias}\`\n\n` +
        `All channels will use this token for future messages immediately - no reset required.`
      );
    } else {
      await say(`❌ Failed to save token preference.`);
    }
  }

  // Handle 'help' command in DM
  private async handleDMHelpCommand(userId: string, say: (msg: string) => Promise<void>): Promise<void> {
    const session = this.sessionManager.getSessionByUserId(userId);
    const currentToken = this.sessionManager.getOAuthTokenForUser(userId);

    let status = '';
    if (session) {
      status = `*Status:* Connected (session: \`${session.token}\`)`;
      if (currentToken) {
        status += `\n*Current token:* \`${currentToken.alias}\``;
      }
      status += '\n\n';
    }

    await say(
      `${status}*DM Commands:*\n` +
      `• \`<8-char token>\` - Connect with a session token\n` +
      `• \`tokens\` - List available OAuth tokens\n` +
      `• \`use <alias>\` - Switch to a different token\n` +
      `• \`help\` - Show this help\n\n` +
      `*Channel Commands:*\n` +
      `• \`!interrupt\` - Stop current Claude operation\n` +
      `• \`!reset\` - Start a new conversation\n` +
      `• \`!debug\` - Show terminal output\n` +
      `• \`!help\` - Show channel help`
    );
  }

  private async handleChannelMessage(
    channelId: string,
    userId: string,
    text: string,
    client: any,
    files: string[] = []
  ): Promise<void> {
    const channelSession = this.sessionManager.getChannelSession(channelId);
    if (!channelSession) {
      // Check if user has a session and auto-setup
      const session = this.sessionManager.getSessionByUserId(userId);
      if (session) {
        await this.spawnClaudeCodeForChannel(channelId, session.token, userId, client);
        // Wait for setup then send message
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        await client.chat.postMessage({
          channel: channelId,
          text: `Please DM me your session token first to set up Claude Code.`,
        });
        return;
      }
    }

    // Get updated channel session
    const updatedSession = this.sessionManager.getChannelSession(channelId);
    if (!updatedSession) return;

    // Check for special commands
    const trimmedText = text.trim().toLowerCase();

    // Interrupt command
    if (trimmedText === '!interrupt' || trimmedText === '!stop' || trimmedText === '!esc') {
      const success = this.terminalManager.sendInterrupt(updatedSession.terminalId);
      // Clear busy state and message queue (terminal-manager clears its queue)
      this.terminalManager.clearBusyState(channelId);
      // Also clear slack-bot's message queue
      this.messageQueues.set(channelId, []);
      if (success) {
        await client.chat.postMessage({
          channel: channelId,
          text: `⏹️ Interrupted Claude Code (sent Ctrl+C) and cleared message queue`,
        });
      } else {
        await client.chat.postMessage({
          channel: channelId,
          text: `Failed to interrupt - terminal not found`,
        });
      }
      return;
    }

    // Reset command - start fresh conversation
    if (trimmedText === '!reset' || trimmedText === '!new') {
      this.terminalManager.resetConversation(channelId);
      // Clear message queue
      this.messageQueues.set(channelId, []);
      await client.chat.postMessage({
        channel: channelId,
        text: `🔄 Conversation reset. Next message will start a new Claude Code session.`,
      });
      return;
    }

    // Debug command - show terminal output
    if (trimmedText === '!debug' || trimmedText === '!output') {
      const output = this.terminalManager.getOutput(updatedSession.terminalId, 30);
      const outputText = output.join('').slice(-3000); // Last 3000 chars
      await client.chat.postMessage({
        channel: channelId,
        text: `📟 Terminal output (last 30 chunks):\n\`\`\`\n${outputText || '(no output)'}\n\`\`\``,
      });
      return;
    }

    // Help command - show available commands
    if (trimmedText === '!help') {
      await client.chat.postMessage({
        channel: channelId,
        text: `📖 *Available Commands:*\n` +
          `• \`!interrupt\` / \`!stop\` / \`!esc\` - Interrupt current Claude operation\n` +
          `• \`!reset\` / \`!new\` - Start a new conversation\n` +
          `• \`!debug\` / \`!output\` - Show terminal output\n` +
          `• \`!help\` - Show this help message`,
      });
      return;
    }

    // Build message with file info if files were attached
    let messageWithFiles = text;
    if (files.length > 0) {
      const fileList = files.map(f => `  - ${f}`).join('\n');
      messageWithFiles = `${text}\n\n[Attached files saved to:\n${fileList}]`;
    }

    // Queue the message and trigger Claude to check
    this.queueMessage(channelId, userId, messageWithFiles);

    // Check if Claude is busy and notify user
    if (this.terminalManager.isChannelBusy(channelId)) {
      const queuePos = this.terminalManager.getQueueLength(channelId) + 1;
      await client.chat.postMessage({
        channel: channelId,
        text: `⏳ Claude is busy. Your message is queued (position ${queuePos}).`,
      });
    }

    // Get user's current OAuth token (for dynamic token switching)
    const userToken = this.sessionManager.getOAuthTokenForUser(userId);
    const oauthTokenValue = userToken?.token;

    // Trigger Claude to process the message (will queue if busy)
    let success = await this.terminalManager.sendInput(updatedSession.terminalId, messageWithFiles, oauthTokenValue);
    if (!success) {
      // Terminal not found - respawn and retry
      console.log(`[Channel ${channelId}] Terminal not found, respawning...`);
      await this.spawnClaudeCodeForChannel(channelId, updatedSession.sessionToken, userId, client);

      // Wait for terminal to be ready and retry sending the message
      await new Promise(resolve => setTimeout(resolve, 1000));
      const newSession = this.sessionManager.getChannelSession(channelId);
      if (newSession) {
        success = await this.terminalManager.sendInput(newSession.terminalId, messageWithFiles, oauthTokenValue);
        if (!success) {
          await client.chat.postMessage({
            channel: channelId,
            text: `Failed to start Claude Code. Please try again.`,
          });
        }
      }
    }
  }

  private queueMessage(channelId: string, userId: string, text: string): void {
    if (!this.messageQueues.has(channelId)) {
      this.messageQueues.set(channelId, []);
    }

    const queue = this.messageQueues.get(channelId)!;
    queue.push({
      user: userId,
      text: text,
      timestamp: new Date(),
    });

    // Keep only last 100 messages
    if (queue.length > 100) {
      queue.shift();
    }
  }

  // Get and clear pending messages for a channel
  getPendingMessages(channelId: string): PendingMessage[] {
    const messages = this.messageQueues.get(channelId) || [];
    // Clear the queue after reading
    this.messageQueues.set(channelId, []);
    return messages;
  }

  // Callback for when a queued message starts processing
  async handleQueueProcess(channelId: string, message: string): Promise<void> {
    try {
      // Truncate long messages for display
      const displayMessage = message.length > 100
        ? message.substring(0, 97) + '...'
        : message;

      await this.app.client.chat.postMessage({
        channel: channelId,
        text: `▶️ Processing message: "${displayMessage}"`,
        mrkdwn: true,
      });
    } catch (error) {
      console.error('[SlackBot] Error posting queue process notification:', error);
    }
  }

  // Callback for when an agent turn completes
  async handleAgentTurnComplete(channelId: string): Promise<void> {
    try {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: `⏸️ Agent turn complete`,
        mrkdwn: true,
      });
    } catch (error) {
      console.error('[SlackBot] Error posting agent turn complete notification:', error);
    }
  }

  private async spawnClaudeCodeForChannel(
    channelId: string,
    sessionToken: string,
    userId: string,
    client: any | null
  ): Promise<void> {
    const session = this.sessionManager.getSessionByToken(sessionToken);
    if (!session) {
      console.error('Session not found:', sessionToken);
      return;
    }

    // Get user's selected OAuth token
    const userToken = this.sessionManager.getOAuthTokenForUser(userId);
    const oauthTokenValue = userToken?.token;

    // Create channel session first to get MCP port
    const channelSession = this.sessionManager.createChannelSession(
      channelId,
      sessionToken,
      userId,
      '' // Will update after terminal creation
    );

    try {
      // Spawn Claude Code with user's selected OAuth token
      const terminal = await this.terminalManager.spawnClaudeCode(
        channelId,
        channelSession.mcpPort,
        oauthTokenValue
      );

      // Update channel session with terminal ID
      channelSession.terminalId = terminal.id;

      // Build token info for message
      const tokenInfo = userToken ? `\nUsing token: \`${userToken.alias}\`` : '';

      // Only post message if client is provided (not from DM where we use say())
      if (client) {
        await client.chat.postMessage({
          channel: channelId,
          text: `Claude Code started! Send a message to interact with it.\n` +
            `Working directory: \`${session.workingDirectory}\`${tokenInfo}`,
        });
      }

      console.log(`Spawned Claude Code for channel ${channelId} on MCP port ${channelSession.mcpPort}${userToken ? ` using token ${userToken.alias}` : ''}`);
    } catch (error) {
      console.error('Failed to spawn Claude Code:', error);
      this.sessionManager.removeChannelSession(channelId);
      if (client) {
        await client.chat.postMessage({
          channel: channelId,
          text: `Failed to start Claude Code. Please try again.`,
        });
      }
    }
  }

  // HTTP server to receive messages from MCP servers and serve pending messages
  startOrchestratorServer(port: number): void {
    this.orchestratorServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      // GET /messages/:channelId - MCP server fetches pending messages
      if (req.method === 'GET' && url.pathname.startsWith('/messages/')) {
        const channelId = url.pathname.split('/messages/')[1];
        const messages = this.getPendingMessages(channelId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages }));
        return;
      }

      // POST / - MCP server sends messages to Slack
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            await this.handleMCPMessage(data);
            res.writeHead(200);
            res.end('OK');
          } catch (error) {
            console.error('Error handling MCP message:', error);
            res.writeHead(500);
            res.end('Error');
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    this.orchestratorServer.listen(port, () => {
      console.log(`Orchestrator server listening on port ${port}`);
    });
  }

  private async handleMCPMessage(data: any): Promise<void> {
    const { type, channelId, content, filename, fileContent, mentionText } = data;

    const channelSession = this.sessionManager.getChannelSession(channelId);
    const userId = channelSession?.userId;

    switch (type) {
      case 'markdown':
        await retrySlackCall(
          () => this.app.client.chat.postMessage({
            channel: channelId,
            text: content,
            mrkdwn: true,
          }),
          `postMessage(markdown) to ${channelId}`
        );
        break;

      case 'file':
        await retrySlackCall(
          () => this.app.client.filesUploadV2({
            channel_id: channelId,
            content: fileContent,
            filename: filename,
            title: filename,
          }),
          `filesUploadV2(file) to ${channelId}`
        );
        break;

      case 'file_upload':
        // Handle binary file upload (base64 encoded)
        const { base64Content, title } = data;
        const fileBuffer = Buffer.from(base64Content, 'base64');
        await retrySlackCall(
          () => this.app.client.filesUploadV2({
            channel_id: channelId,
            file: fileBuffer,
            filename: filename,
            title: title || filename,
          }),
          `filesUploadV2(file_upload) to ${channelId}`
        );
        break;

      case 'mention':
        const mention = userId ? `<@${userId}>` : '';
        await retrySlackCall(
          () => this.app.client.chat.postMessage({
            channel: channelId,
            text: `${mention} ${mentionText || content}`,
            mrkdwn: true,
          }),
          `postMessage(mention) to ${channelId}`
        );
        break;

      case 'action':
        // Notification of action being taken
        await retrySlackCall(
          () => this.app.client.chat.postMessage({
            channel: channelId,
            text: `🔄 ${content}`,
            mrkdwn: true,
          }),
          `postMessage(action) to ${channelId}`
        );
        break;

      case 'result':
        // Notification of action result
        await retrySlackCall(
          () => this.app.client.chat.postMessage({
            channel: channelId,
            text: `✅ ${content}`,
            mrkdwn: true,
          }),
          `postMessage(result) to ${channelId}`
        );
        break;

      default:
        console.log('Unknown MCP message type:', type);
    }
  }

  async start(): Promise<void> {
    await this.app.start();

    // Get bot user ID
    const authResult = await this.app.client.auth.test();
    this.botUserId = authResult.user_id || '';

    console.log(`⚡️ Slack bot is running! Bot ID: ${this.botUserId}`);
  }

  async stop(): Promise<void> {
    await this.app.stop();
    if (this.orchestratorServer) {
      this.orchestratorServer.close();
    }
  }

  // Send a direct message to a channel (used for restart notifications)
  async sendDirectMessage(channelId: string, text: string): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: channelId,
      text: text,
      mrkdwn: true,
    });
  }

  // Download a file from Slack and save to tmp directory
  private async downloadSlackFile(file: SlackFile, channelId: string): Promise<string | null> {
    const url = file.url_private_download || file.url_private;
    if (!url) {
      console.error('No download URL for file:', file.name);
      return null;
    }

    // Create tmp directory for this channel (stored in app directory)
    const tmpDir = path.join(this.appDirectory, '.claude-minion', 'tmp', channelId);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(tmpDir, `${timestamp}-${safeName}`);

    const token = this.app.client.token;

    console.log(`Downloading file from: ${url.substring(0, 80)}...`);

    // Helper to download from a URL - always include auth for Slack URLs
    const downloadFromUrl = (downloadUrl: string): Promise<string | null> => {
      return new Promise((resolve) => {
        // Parse URL to determine if it's a Slack URL (needs auth) or CDN URL (signed, no auth needed)
        const isSlackUrl = downloadUrl.includes('slack.com') || downloadUrl.includes('slack-files.com');
        const headers: Record<string, string> = {};

        if (isSlackUrl) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        console.log(`Fetching: ${downloadUrl.substring(0, 60)}... (auth: ${isSlackUrl})`);

        const request = https.get(downloadUrl, { headers }, (response) => {
          // Handle redirects
          if (response.statusCode === 302 || response.statusCode === 301) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              console.log(`Redirect -> ${redirectUrl.substring(0, 60)}...`);
              // Check if redirect is to a login page (error case)
              if (redirectUrl.includes('?redir=') || redirectUrl.includes('/signin')) {
                console.error('ERROR: Redirect to login page - authentication failed');
                resolve(null);
                return;
              }
              downloadFromUrl(redirectUrl).then(resolve);
            } else {
              console.error('Redirect without location header');
              resolve(null);
            }
            return;
          }

          if (response.statusCode !== 200) {
            console.error(`Failed to download file: HTTP ${response.statusCode}`);
            let body = '';
            response.on('data', (chunk) => body += chunk);
            response.on('end', () => {
              console.error('Response body:', body.substring(0, 500));
              resolve(null);
            });
            return;
          }

          // Check content type - if HTML, something went wrong
          const contentType = response.headers['content-type'] || '';
          if (contentType.includes('text/html')) {
            console.error('ERROR: Received HTML instead of file - likely auth issue');
            let body = '';
            response.on('data', (chunk) => body += chunk);
            response.on('end', () => {
              console.error('HTML content:', body.substring(0, 300));
              resolve(null);
            });
            return;
          }

          // Collect all data chunks
          const chunks: Buffer[] = [];

          response.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on('end', () => {
            try {
              const buffer = Buffer.concat(chunks);
              fs.writeFileSync(filePath, buffer);
              const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
              console.log(`Downloaded file: ${filePath} (${sizeMB} MB, ${chunks.length} chunks)`);
              resolve(filePath);
            } catch (err) {
              console.error('Error writing file:', err);
              resolve(null);
            }
          });

          response.on('error', (err) => {
            console.error('Error reading response:', err);
            resolve(null);
          });
        });

        request.on('error', (err) => {
          console.error('Error downloading file:', err);
          resolve(null);
        });
      });
    };

    return downloadFromUrl(url);
  }

  // Process files attached to a message
  private async processMessageFiles(message: any, channelId: string): Promise<string[]> {
    const downloadedFiles: string[] = [];

    if (message.files && Array.isArray(message.files)) {
      for (const file of message.files as SlackFile[]) {
        const filePath = await this.downloadSlackFile(file, channelId);
        if (filePath) {
          downloadedFiles.push(filePath);
        }
      }
    }

    return downloadedFiles;
  }
}
