import * as path from 'path';
import * as fs from 'fs';
import { AgentStrategy, AgentCommandOpts, AgentMcpConfigOpts } from './agent-strategy.js';

export class ClaudeStrategy implements AgentStrategy {
  readonly type = 'claude' as const;

  buildCommand(input: string, opts: AgentCommandOpts): string {
    const model = opts.model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

    const escapedInput = this.escapeForShell(input);

    if (opts.sessionId) {
      return `claude -p "${escapedInput}" --model ${model} --output-format json --resume "${opts.sessionId}" --mcp-config "${opts.mcpConfigPath}" ${this.getDoneSentinel()}`;
    } else {
      return `claude -p "${escapedInput}" --model ${model} --output-format json --mcp-config "${opts.mcpConfigPath}" ${this.getDoneSentinel()}`;
    }
  }

  createMcpConfig(opts: AgentMcpConfigOpts): string {
    const mcpConfigDir = path.join(opts.appDirectory, '.claude-minion', opts.channelId);
    fs.mkdirSync(mcpConfigDir, { recursive: true });

    const mcpConfigPath = path.join(mcpConfigDir, 'mcp-config.json');
    const mcpConfig = {
      mcpServers: {
        'slack-messenger': {
          command: 'node',
          args: [path.join(opts.appDirectory, 'dist', 'mcp-server.js')],
          env: {
            MCP_PORT: opts.mcpPort.toString(),
            CHANNEL_ID: opts.channelId,
            ORCHESTRATOR_URL: `http://localhost:${process.env.ORCHESTRATOR_PORT || 3000}`,
          },
        },
        ...(opts.existingMcpServers || {}),
      },
    };
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
    return mcpConfigPath;
  }

  parseSessionId(output: string): string | null {
    const match = output.match(/"session_id"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  }

  parseUsageStats(output: string): any | null {
    const resultStart = output.indexOf('{"type":"result"');
    if (resultStart === -1) return null;

    let braceCount = 0;
    let endIdx = -1;
    for (let i = resultStart; i < output.length; i++) {
      if (output[i] === '{') braceCount++;
      if (output[i] === '}') braceCount--;
      if (braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
    if (endIdx === -1) return null;

    try {
      const resultJson = JSON.parse(output.substring(resultStart, endIdx));
      return resultJson.usage || null;
    } catch {
      return null;
    }
  }

  isDoneMarker(line: string): boolean {
    return line.trim() === '___CLAUDE_DONE___';
  }

  getDoneSentinel(): string {
    return '; echo "___CLAUDE_DONE___"';
  }

  getEnvVars(opts: { oauthToken?: string }): Record<string, string> {
    const env: Record<string, string> = {};
    if (opts.oauthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = opts.oauthToken;
    }
    return env;
  }

  instructionsFileName(): string {
    return 'CLAUDE.md';
  }

  private escapeForShell(input: string): string {
    return input
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '');
  }
}
