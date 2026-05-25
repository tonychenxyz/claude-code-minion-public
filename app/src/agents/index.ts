export { AgentType, AgentStrategy, AgentCommandOpts, AgentMcpConfigOpts } from './agent-strategy.js';
export { ClaudeStrategy } from './claude-strategy.js';
export { CodexStrategy } from './codex-strategy.js';

import { AgentType, AgentStrategy } from './agent-strategy.js';
import { ClaudeStrategy } from './claude-strategy.js';
import { CodexStrategy } from './codex-strategy.js';

export function createAgentStrategy(type: AgentType): AgentStrategy {
  switch (type) {
    case 'claude':
      return new ClaudeStrategy();
    case 'codex':
      return new CodexStrategy();
    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}
