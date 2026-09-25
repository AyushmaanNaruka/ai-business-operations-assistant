import { describe, it } from 'vitest';
// Side-effect import: see missingMetric.test.ts's comment on the same import. Wires a
// storage provider into both dataAnalyst's and documentAgent's Memory before delegate()
// ever calls .generate() on either.
import '@/mastra';
import { buildTask, delegate } from '@/mastra/agents/contracts';
import { dataAnalyst } from '@/mastra/agents/dataAnalyst';
import { documentAgent } from '@/mastra/agents/documentAgent';
import { detectConflicts } from '@/modules/evidence';
import { contradictionScorer, runAndAssert, type ContradictionOutput } from './scorers';

/**
 * Grounding eval 3/4 (docs/09-TESTING.md section 3, docs/03-ARCHITECTURE.md Part 10
 * gap 9, docs/PROMPTBOOK.md P7.3): samples/campaigns.xlsx and samples/customer-notes.docx
 * disagree about Paid Social by construction (scripts/make-samples.ts plants a spend
 * climb with flat/declining conversion efficiency from month 12; scripts/
 * make-customer-notes.ts plants a note that the growth team's gut read is "Paid Social
 * has been the strongest performing channel this year", explicitly to exercise M5
 * conflict detection). Passes when both values surface with their sources and neither
 * is silently picked as the winner.
 *
 * A LIVE test, run at the level the prompt names ("drives these agents directly"): the
 * real Data Analyst and the real Document Agent are delegated to in parallel, exactly
 * as handle_request's own "mixed" intent path does (src/mastra/agents/orchestrator.ts's
 * runTurn, not reimplemented here), against samples/campaigns.xlsx and
 * samples/customer-notes.docx (both auto-loaded by tools/analysis.ts's and
 * tools/documents.ts's shared runtimes). detectConflicts (src/modules/evidence) is then
 * run on the combined evidence, the same mechanism runTurn itself uses before
 * synthesis, and orchestrator.ts's own rule 10 depends on its result being non-empty to
 * ever present both sides instead of one.
 */
describe('Grounding eval: contradiction', () => {
  it(
    'surfaces both the computed Paid Social figure and the customer-notes claim, with sources, picking no winner',
    async () => {
      const dataTask = buildTask(
        "What is Paid Social's conversion rate, computed from our campaign data?",
        [],
        [],
        'a grounded, evidence-cited answer computed from the relevant tables',
      );
      const documentTask = buildTask(
        'What do our internal customer/team notes say about which channel performs best, specifically about Paid Social?',
        [],
        [],
        'a grounded, evidence-cited answer quoting or citing the relevant document passages',
      );

      const [dataResult, documentResult] = await Promise.all([
        delegate(dataAnalyst, dataTask),
        delegate(documentAgent, documentTask),
      ]);

      const conflicts = detectConflicts([...dataResult.evidence, ...documentResult.evidence]);
      const output: ContradictionOutput = { dataResult, documentResult, conflicts };

      await runAndAssert(
        contradictionScorer,
        { objective: 'Paid Social performance: computed data vs customer notes' },
        output,
        'Grounding eval 3 (contradiction)',
      );
    },
    45_000,
  );
});
