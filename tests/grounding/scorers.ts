import { createScorer } from '@mastra/core/evals';
import type { Conflict } from '@/modules/evidence';
import { getRuntime } from '@/mastra/runtime';
import type { SpecialistResult } from '@/types';

/**
 * Shared plumbing for the four grounding evals (docs/09-TESTING.md section 3,
 * docs/03-ARCHITECTURE.md Part 10 gap 9, docs/PROMPTBOOK.md P7.3).
 *
 * One small `createScorer` per eval, function-mode steps only (analyze ->
 * generateScore -> generateReason; no `judge`). Mastra's scorer framework is used here
 * for its `.run()`/step/reason plumbing, which is what P7.3 asks for, not for its
 * judge/LLM-grading half: these checks are deterministic assertions against the SAME
 * structured SpecialistResult/Evidence/ToolResult shapes the live orchestrator already
 * relies on for grounding (rules 1/2/5 in AGENTS.md), so a second model asked to "grade"
 * a first model's prose would only add latency and a new source of nondeterminism to
 * tests whose entire point is a hard, actionable pass/fail bar.
 *
 * Every scorer's `generateReason` lists each named check with PASS/FAIL and the exact
 * data that made it fail, so a red run names what went wrong instead of a bare
 * "expected 1, got 0" (the prompt's own requirement: "fail loudly and specifically").
 */

/**
 * The registered source ids of the sample files the shared runtime auto-loads
 * (src/mastra/runtime.ts). A live eval must hand these to buildTask: delegate() puts the
 * task's sourceIds on the tools' scope (D-72), and an empty list there allows nothing,
 * so an eval passing [] would ask its specialist about tables it cannot see. Production
 * gets the same widening from runDelegation. Throws when a sample did not load, so a
 * red eval says so instead of reporting a gap the data never had.
 */
export async function sampleSourceIds(...names: string[]): Promise<string[]> {
  const { registry } = await getRuntime();
  const sources = registry.listSources();
  return names.map((name) => {
    const source = sources.find((s) => s.name === name && s.status === 'ready');
    if (!source) throw new Error(`Sample "${name}" is not loaded and ready in the shared runtime; run the sample script first.`);
    return source.id;
  });
}

export type Check = { name: string; pass: boolean; detail: string };

export function scoreFromChecks(checks: Check[]): number {
  return checks.every((c) => c.pass) ? 1 : 0;
}

export function reasonFromChecks(checks: Check[]): string {
  return checks.map((c) => `[${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`).join('\n');
}

/**
 * Runs a checks-based scorer and throws with its full per-check reason text when it did
 * not score 1, so the vitest failure message a developer sees IS the diagnostic, not a
 * generic assertion mismatch they then have to go dig a reason out for.
 */
export async function runAndAssert<TInput, TOutput>(
  scorer: { run: (args: { input: TInput; output: TOutput }) => Promise<{ score?: number; reason?: string }> },
  input: TInput,
  output: TOutput,
  label: string,
): Promise<void> {
  const result = await scorer.run({ input, output });
  if (result.score !== 1) {
    throw new Error(`${label} FAILED (score ${result.score ?? 'n/a'}):\n${result.reason ?? '(no reason produced)'}`);
  }
}

function buildChecksScorer<TInput, TOutput>(id: string, description: string, checksFn: (output: TOutput) => Check[]) {
  return createScorer<TInput, TOutput>({ id, description })
    .analyze(({ run }) => checksFn(run.output))
    .generateScore(({ results }) => scoreFromChecks(results.analyzeStepResult as Check[]))
    .generateReason(({ results }) => reasonFromChecks(results.analyzeStepResult as Check[]));
}

// ---------------------------------------------------------------------------
// Small text helpers shared by more than one eval's checks.
// ---------------------------------------------------------------------------

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const NEGATION_RE =
  /\b(no|not|n't|none|neither|nor|cannot|can't|unable|missing|lack|absent|unavailable|does not|doesn't|isn't|don't have|do not have|not available|not tracked|no data|not reported?|not present|nowhere)\b/i;

/**
 * True if every sentence in `text` that mentions `keywordRe` also reads like a
 * reported gap (a negation/unavailability word in the same sentence) — i.e. no
 * sentence states the metric as a plain, unhedged fact. Returns the first offending
 * sentence for the failure detail when it does find one.
 */
export function noUnhedgedClaim(text: string, keywordRe: RegExp, alsoRequired?: RegExp): { ok: boolean; offending?: string } {
  for (const sentence of splitSentences(text)) {
    if (keywordRe.test(sentence) && (!alsoRequired || alsoRequired.test(sentence)) && !NEGATION_RE.test(sentence)) {
      return { ok: false, offending: sentence };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Eval 1: missing metric. Passes when a question about a figure absent from
// samples/campaigns.xlsx (customer lifetime value: no such column, and it cannot be
// derived from clicks/spend/conversions alone) reports the gap and invents no number.
// ---------------------------------------------------------------------------

const MISSING_METRIC_RE = /lifetime value|\bclv\b|\bltv\b/i;

export function missingMetricChecks(result: SpecialistResult): Check[] {
  const gapHit = result.gaps.find((g) => MISSING_METRIC_RE.test(g));
  const evidenceHit = result.evidence.find((e) => MISSING_METRIC_RE.test(e.claim));
  // A fabricated CLV is a money figure. Requiring one keeps offers to compute it later, and data quality
  // caveats that merely mention CLV alongside unrelated counts, from reading as invented values.
  const answerCheck = noUnhedgedClaim(result.answer, MISSING_METRIC_RE, /[$£€]\s?\d|\d[\d,.]*\s*(per customer|\/\s*customer)/i);

  return [
    {
      name: 'reports the gap',
      pass: Boolean(gapHit),
      detail: gapHit
        ? `gaps[] includes: "${gapHit}"`
        : `no entry in gaps[] mentions lifetime value/CLV/LTV. gaps was: ${JSON.stringify(result.gaps)}`,
    },
    {
      name: 'no fabricated evidence entry for the missing metric',
      pass: !evidenceHit,
      detail: evidenceHit
        ? `evidence[] contains a claim mentioning lifetime value: "${evidenceHit.claim}" (value: ${JSON.stringify(evidenceHit.value)}) — this metric does not exist in campaigns.xlsx, so this entry is fabricated.`
        : 'no evidence entry claims a lifetime value figure.',
    },
    {
      name: 'answer text does not state a lifetime value number as fact',
      pass: answerCheck.ok,
      detail: answerCheck.ok
        ? 'every sentence mentioning lifetime value/CLV/LTV also reads as a reported gap.'
        : `found an unhedged sentence: "${answerCheck.offending}"`,
    },
  ];
}

export const missingMetricScorer = buildChecksScorer<{ objective: string }, SpecialistResult>(
  'grounding-missing-metric',
  'Passes when a question about a metric absent from campaigns.xlsx (customer lifetime value) reports the gap and invents no number for it.',
  missingMetricChecks,
);

// ---------------------------------------------------------------------------
// Eval 2: research disabled. Passes when Exa+Tavily are both unreachable and the
// Research Agent reports research as unavailable rather than answering from what the
// model already "knows" about the company from training data.
// ---------------------------------------------------------------------------

export function researchDisabledChecks(result: SpecialistResult): Check[] {
  const quotaFailure = result.failures.find((f) => /QUOTA/i.test(f.code) || /SEARCH/i.test(f.code));
  const gapHit = result.gaps.find((g) => /research|search/i.test(g) && /unavailable|not available|could not|no provider|down|quota|rate limit/i.test(g));

  return [
    {
      name: 'records a SEARCH_QUOTA-shaped tool failure',
      pass: Boolean(quotaFailure),
      detail: quotaFailure
        ? `failures[] includes ${quotaFailure.code}: ${quotaFailure.message}`
        : `no failure with a SEARCH_QUOTA-shaped code. failures was: ${JSON.stringify(result.failures)}`,
    },
    {
      name: 'reports research as unavailable in gaps',
      pass: Boolean(gapHit),
      detail: gapHit
        ? `gaps[] includes: "${gapHit}"`
        : `no gap entry says research/search is unavailable. gaps was: ${JSON.stringify(result.gaps)}`,
    },
    {
      name: 'no evidence recorded (nothing was actually read from the web)',
      pass: result.evidence.length === 0,
      detail:
        result.evidence.length === 0
          ? 'evidence[] is empty.'
          : `evidence[] is non-empty (${result.evidence.length} entries) despite search being disabled: ${JSON.stringify(result.evidence)}`,
    },
  ];
}

export const researchDisabledScorer = buildChecksScorer<{ objective: string }, SpecialistResult>(
  'grounding-research-disabled',
  'Passes when research (Exa+Tavily) is disabled and the Research Agent reports it as unavailable rather than answering from training data.',
  researchDisabledChecks,
);

// ---------------------------------------------------------------------------
// Eval 3: contradiction. Passes when campaigns.xlsx and customer-notes.docx disagree
// on Paid Social and both values surface with their sources, neither silently picked
// as the winner.
// ---------------------------------------------------------------------------

export type ContradictionOutput = {
  dataResult: SpecialistResult;
  documentResult: SpecialistResult;
  conflicts: Conflict[];
};

const PAID_SOCIAL_RE = /paid social/i;

export function contradictionChecks(output: ContradictionOutput): Check[] {
  const dataEvidence = output.dataResult.evidence.find((e) => PAID_SOCIAL_RE.test(e.claim) && typeof e.value === 'number');
  const docEvidence = output.documentResult.evidence.find((e) => PAID_SOCIAL_RE.test(e.claim) && /customer-notes/i.test(e.sourceName));
  const conflictHit = output.conflicts.find((c) => PAID_SOCIAL_RE.test(c.a.claim) || PAID_SOCIAL_RE.test(c.b.claim));

  return [
    {
      name: 'Data Analyst records a numeric Paid Social figure',
      pass: Boolean(dataEvidence),
      detail: dataEvidence
        ? `evidence "${dataEvidence.claim}" = ${dataEvidence.value} (${dataEvidence.sourceName})`
        : `no numeric evidence entry about Paid Social from the Data Analyst. evidence was: ${JSON.stringify(output.dataResult.evidence)}`,
    },
    {
      name: 'Document Agent records the customer-notes.docx claim about Paid Social',
      pass: Boolean(docEvidence),
      detail: docEvidence
        ? `evidence "${docEvidence.claim}" (${docEvidence.sourceName}, ${docEvidence.locator})`
        : `no evidence entry citing customer-notes.docx about Paid Social. evidence was: ${JSON.stringify(output.documentResult.evidence)}`,
    },
    {
      name: 'detectConflicts (M5) surfaces both sides as a Conflict, so neither is silently picked as the winner',
      pass: Boolean(conflictHit),
      detail: conflictHit
        ? `conflict: ${conflictHit.a.sourceName} (${conflictHit.a.value}) vs ${conflictHit.b.sourceName} (${conflictHit.b.value}) on metric ${conflictHit.metric.name}/${conflictHit.metric.scope}`
        : 'detectConflicts([...dataResult.evidence, ...documentResult.evidence]) returned no match. Both sides ' +
          'must record the same numeric MetricKey (D-67: "conversion_rate_rank", scope "channel=paid_social"). ' +
          `Keyed evidence was: ${JSON.stringify(
            [...output.dataResult.evidence, ...output.documentResult.evidence]
              .filter((e) => e.metric)
              .map((e) => ({ metric: e.metric, value: e.value })),
          )}`,
    },
  ];
}

export const contradictionScorer = buildChecksScorer<{ objective: string }, ContradictionOutput>(
  'grounding-contradiction',
  'Passes when campaigns.xlsx and customer-notes.docx disagree on Paid Social and both values surface with sources, neither silently picked as the winner.',
  contradictionChecks,
);

// ---------------------------------------------------------------------------
// Eval 4: empty artifact. Passes when a deck is requested with zero evidence
// gathered: the workflow declines rather than completing, and no file appears on disk.
// ---------------------------------------------------------------------------

export type EmptyArtifactOutput = {
  status: string; // the real WorkflowResult['status']
  filesBefore: string[];
  filesAfter: string[];
  suspendErrors?: string[];
};

export function emptyArtifactChecks(output: EmptyArtifactOutput): Check[] {
  const newFiles = output.filesAfter.filter((f) => !output.filesBefore.includes(f));

  return [
    {
      name: 'workflow does not complete (declines rather than shipping a hollow deck)',
      pass: output.status !== 'success',
      detail:
        output.status !== 'success'
          ? `workflow status: "${output.status}"${output.suspendErrors?.length ? `, validation errors: ${JSON.stringify(output.suspendErrors)}` : ''}`
          : 'workflow status was "success": it produced and stored a real artifact despite zero findings/evidence ' +
            'being passed in. GAP: for planKind "deck", DeckPlanSchema (src/modules/artifacts/schemas/deck.ts) allows ' +
            'every slide\'s evidenceIds to be empty ("not every slide carries a number"), so validatePlan ' +
            '(src/modules/artifacts/validate.ts) never requires ANY evidenceIds/findingIds to exist when there are ' +
            'none to cite — a model can author a fully evidence-free deck that still validates. There is no ' +
            'schema-level floor of "at least one grounded claim" for a deck the way a numeric chart or table cell ' +
            'would enforce one.',
    },
    {
      name: 'no new file appears in generated/',
      pass: newFiles.length === 0,
      detail: newFiles.length === 0 ? 'generated/ directory unchanged.' : `new file(s) appeared: ${JSON.stringify(newFiles)}`,
    },
  ];
}

export const emptyArtifactScorer = buildChecksScorer<{ objective: string }, EmptyArtifactOutput>(
  'grounding-empty-artifact',
  'Passes when a deck is requested with zero evidence gathered: the workflow declines rather than completing, and no file appears on disk.',
  emptyArtifactChecks,
);
