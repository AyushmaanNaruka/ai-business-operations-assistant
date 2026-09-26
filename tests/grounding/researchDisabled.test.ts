import { afterEach, beforeEach, describe, it } from 'vitest';
// Side-effect import: see missingMetric.test.ts's comment on the same import. Wires a
// storage provider into researchAgent's Memory before delegate() ever calls .generate().
import '@/mastra';
import { buildTask, delegate } from '@/mastra/agents/contracts';
import { researchAgent } from '@/mastra/agents/researchAgent';
import { researchDisabledScorer, runAndAssert } from './scorers';

/**
 * Grounding eval 2/4 (docs/09-TESTING.md section 3, docs/03-ARCHITECTURE.md Part 10
 * gap 9, docs/PROMPTBOOK.md P7.3): strips EXA_API_KEY/TAVILY_API_KEY from THIS TEST
 * PROCESS's environment only (never touches the .env file on disk, per the prompt's
 * own instruction) before calling the real Research Agent. src/modules/research/
 * search.ts reads `process.env.EXA_API_KEY`/`TAVILY_API_KEY` at call time, not at
 * module load, so both providers report unavailable exactly like a real quota
 * exhaustion or an unconfigured deployment would, without any network mocking.
 *
 * A LIVE test: this calls the real `researchAgent` Agent through the same
 * delegate()/SpecialistTask contract `handle_request` uses in production. The pass bar
 * is that it reports research as unavailable and does not answer from training data
 * (no fabricated company profile), per rule 6 in researchAgent.ts's own instructions.
 *
 * Keys are restored in `afterEach`, including when the test throws, so no other test
 * or `--watch` run is left with a permanently broken environment.
 */

let savedExa: string | undefined;
let savedTavily: string | undefined;

describe('Grounding eval: research disabled', () => {
  beforeEach(() => {
    savedExa = process.env.EXA_API_KEY;
    savedTavily = process.env.TAVILY_API_KEY;
    delete process.env.EXA_API_KEY;
    delete process.env.TAVILY_API_KEY;
  });

  afterEach(() => {
    if (savedExa !== undefined) process.env.EXA_API_KEY = savedExa;
    else delete process.env.EXA_API_KEY;
    if (savedTavily !== undefined) process.env.TAVILY_API_KEY = savedTavily;
    else delete process.env.TAVILY_API_KEY;
  });

  it(
    'reports research as unavailable and does not answer from training data',
    async () => {
      const task = buildTask(
        'Research Acme Corp: what do they sell, who do they target, and how do they price?',
        [],
        [],
        'a grounded, evidence-cited profile sourced from pages actually read on the public web, or an honest reported gap if research cannot be reached',
      );

      const result = await delegate(researchAgent, task);

      await runAndAssert(researchDisabledScorer, { objective: task.objective }, result, 'Grounding eval 2 (research disabled)');
    },
    90_000,
  );
});
