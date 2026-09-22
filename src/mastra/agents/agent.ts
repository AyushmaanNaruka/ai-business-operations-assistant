import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { MODELS } from '../models';

/**
 * Placeholder agent so Mastra Studio has something to chat with while the real
 * orchestrator and specialists are built out phase by phase. Phase 5 replaces this
 * with src/mastra/agents/orchestrator.ts per docs/03-ARCHITECTURE.md section 3.3.
 *
 * No workspace, sandbox or code execution tools here: docs/03-ARCHITECTURE.md
 * (decision D-02) and AGENTS.md's "Out of scope" list both rule those out for this
 * system. Numerical work goes through DuckDB and SQL, never a sandboxed interpreter.
 */
export const agent = new Agent({
  id: 'agent',
  name: 'Business Operations Assistant (placeholder)',
  description: 'Temporary smoke-test agent. Replaced by the orchestrator in Phase 5.',
  instructions:
    'You are a placeholder for the AI Business Operations Assistant, which is still under construction. ' +
    'If asked what you can do, say plainly that you are a placeholder used to confirm Mastra Studio is wired up correctly, ' +
    'and that the real orchestrator, data analyst, document and research agents are built in later phases of this project.',
  model: MODELS.ANALYST,
  memory: new Memory(),
});
