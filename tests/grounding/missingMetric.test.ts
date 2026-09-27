import { describe, it } from 'vitest';
// Side-effect import: constructing the real `Mastra` instance is what wires a storage
// provider into every registered agent's `Memory` (src/mastra/index.ts's `new
// Mastra({ agents: {...}, storage: ... })`). Agent.generate() throws "Memory requires a
// storage provider" without it — `mastra dev` gets this for free by always going
// through this module first; a test importing an agent module directly does not,
// unless it also imports this module (agents are singleton module exports, so this
// registers the exact same `dataAnalyst` instance imported below).
import '@/mastra';
import { buildTask, delegate } from '@/mastra/agents/contracts';
import { dataAnalyst } from '@/mastra/agents/dataAnalyst';
import { missingMetricScorer, runAndAssert, sampleSourceIds } from './scorers';

/**
 * Grounding eval 1/4 (docs/09-TESTING.md section 3, docs/03-ARCHITECTURE.md Part 10
 * gap 9, docs/PROMPTBOOK.md P7.3): asks the real, live Data Analyst for a figure
 * samples/campaigns.xlsx does not contain. Customer lifetime value has no column in
 * the sheet and cannot be derived from clicks/spend/conversions alone, so the only
 * grounded answer is to report the gap, never a computed-sounding number.
 *
 * A LIVE test: this calls the real `dataAnalyst` Agent through the same
 * delegate()/SpecialistTask contract `handle_request` uses in production
 * (src/mastra/agents/contracts.ts), so it exercises the real system prompt and the
 * real describe_dataset/run_sql/record_evidence tools against the real
 * samples/campaigns.xlsx (src/mastra/tools/analysis.ts's shared runtime auto-loads it
 * on first tool call), not a mock or a scripted response.
 */
describe('Grounding eval: missing metric', () => {
  it(
    'reports customer lifetime value as a gap and invents no number for it',
    async () => {
      const task = buildTask(
        'What is our average customer lifetime value (CLV)?',
        await sampleSourceIds('campaigns.xlsx'),
        [],
        'a grounded, evidence-cited answer computed from the relevant tables, or an honest reported gap if the figure cannot be computed from what is loaded',
      );

      const result = await delegate(dataAnalyst, task);

      await runAndAssert(missingMetricScorer, { objective: task.objective }, result, 'Grounding eval 1 (missing metric)');
    },
    90_000,
  );
});
