import * as path from 'path';
import * as fs from 'fs';
import { AgentStrategy, AgentCommandOpts, AgentMcpConfigOpts } from './agent-strategy.js';

// Path inside the repo root where the shared Codex home lives.
// All channels share this single CODEX_HOME — no per-channel files.
const CODEX_HOME_DIRNAME = '.codex';

export class CodexStrategy implements AgentStrategy {
  readonly type = 'codex' as const;

  buildCommand(input: string, opts: AgentCommandOpts): string {
    const model = opts.model || process.env.CODEX_MODEL || 'gpt-5.5';
    const reasoningEffort = process.env.CODEX_REASONING_EFFORT || 'xhigh';

    const isSlashCommand = input.trim().startsWith('/');
    const bridgeReminder =
      'Codex Slack bridge: your final text output is not visible to the Slack user. ' +
      'Do not use tool_search/tool_suggest or the public Slack connector for Slack messages. ' +
      'Use Bash commands `node scripts/slack-message.js regular "..."` for progress and ' +
      '`node scripts/slack-message.js mention "..."` when done or blocked. ' +
      'Original user request: ';
    const prompt = isSlashCommand ? input : `${bridgeReminder}${input}`;
    const escapedInput = this.escapeForShell(prompt);
    const cd = opts.workingDirectory ? ` --cd "${opts.workingDirectory}"` : '';

    // Keep shared settings explicit on every invocation. `codex exec resume` does
    // not accept `--sandbox` or `--cd`, so sandbox settings are passed via config
    // overrides and the PTY cwd supplies the working directory on resumed turns.
    const commonOptions =
      ` --json --model ${model}` +
      ` -c model_reasoning_effort='"${reasoningEffort}"'` +
      ` -c sandbox_mode='"workspace-write"'` +
      ` -c sandbox_workspace_write.network_access=true` +
      ` --skip-git-repo-check`;

    // codex exec [options] "<prompt>"
    // codex exec resume [options] <session-id> "<prompt>"
    const subcmd = opts.sessionId
      ? `exec resume${commonOptions} ${opts.sessionId} "${escapedInput}"`
      : `exec${commonOptions}${cd} "${escapedInput}"`;

    return `codex ${subcmd} ${this.getDoneSentinel()}`;
  }

  // For codex, the "MCP config path" is the shared CODEX_HOME directory.
  // Idempotent: ensures the directory exists. The actual config.toml + symlinks
  // are written once at startup by index.ts.
  createMcpConfig(opts: AgentMcpConfigOpts): string {
    const codexHome = path.join(opts.workingDirectory, CODEX_HOME_DIRNAME);
    fs.mkdirSync(codexHome, { recursive: true });
    return codexHome;
  }

  parseSessionId(output: string): string | null {
    // Codex emits {"type":"thread.started","thread_id":"<UUID>"} as the first JSONL event.
    const match = output.match(/"thread_id"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  }

  parseUsageStats(output: string): any | null {
    // Codex emits usage inside turn.completed events:
    // {"type":"turn.completed","usage":{"input_tokens":N,"cached_input_tokens":N,"output_tokens":N,"reasoning_output_tokens":N}}
    const lines = output.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'turn.completed' && parsed.usage) {
          return parsed.usage;
        }
        if (parsed.usage && (parsed.usage.input_tokens !== undefined || parsed.usage.output_tokens !== undefined)) {
          return parsed.usage;
        }
      } catch {
        // Not JSON, skip
      }
    }
    return null;
  }

  isDoneMarker(line: string): boolean {
    return line.trim() === '___CODEX_DONE___';
  }

  getDoneSentinel(): string {
    return '; echo "___CODEX_DONE___"';
  }

  // CODEX_HOME points at the shared <repo>/.codex/ for every channel.
  getEnvVars(opts: { oauthToken?: string; workingDirectory?: string }): Record<string, string> {
    const env: Record<string, string> = {};
    if (opts.oauthToken) {
      env.OPENAI_API_KEY = opts.oauthToken;
    }
    if (opts.workingDirectory) {
      env.CODEX_HOME = path.join(opts.workingDirectory, CODEX_HOME_DIRNAME);
    }
    return env;
  }

  instructionsFileName(): string {
    return 'AGENTS.md';
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
