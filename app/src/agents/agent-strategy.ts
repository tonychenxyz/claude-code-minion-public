export type AgentType = 'claude' | 'codex';

export interface AgentCommandOpts {
  mcpConfigPath: string;
  sessionId?: string;
  model?: string;
  oauthToken?: string;
  workingDirectory?: string;  // Repo root cwd; used by codex --cd
  channelId?: string;          // Used by codex to inject channel-specific MCP env via -c overrides if needed
  mcpPort?: number;
}

export interface AgentMcpConfigOpts {
  channelId: string;
  mcpPort: number;
  appDirectory: string;
  workingDirectory: string;     // Repo root; codex strategy points CODEX_HOME under this
  existingMcpServers?: Record<string, any>;
}

export interface AgentStrategy {
  readonly type: AgentType;

  // Build the CLI command string for sending a prompt
  buildCommand(input: string, opts: AgentCommandOpts): string;

  // Create the MCP config for this agent type, return path to config file
  createMcpConfig(opts: AgentMcpConfigOpts): string;

  // Parse session ID from terminal output (return null if not found)
  parseSessionId(output: string): string | null;

  // Parse usage stats from terminal output (return null if not found)
  parseUsageStats(output: string): any | null;

  // Check if a line indicates the command is done (sentinel detection)
  isDoneMarker(line: string): boolean;

  // Get the done sentinel command to append after the main command
  getDoneSentinel(): string;

  // Get environment variables needed for this agent
  getEnvVars(opts: { oauthToken?: string; workingDirectory?: string }): Record<string, string>;

  // Get the instructions file name this agent reads
  instructionsFileName(): string;
}
