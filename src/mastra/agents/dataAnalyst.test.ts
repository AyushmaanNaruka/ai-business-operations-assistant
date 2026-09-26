import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@mastra/core/agent';
import type { Evidence } from '@/types/evidence';
import { buildTask, delegate } from './contracts';
import { dataAnalyst } from './dataAnalyst';

/**
 * P5.5, docs/PROMPTBOOK.md "Evidence conditioned queries": the mechanism that lets
 * a document derived fact actually shape the Data Analyst's SQL rather than just
 * sitting next to the answer. The worked example is docs/03-ARCHITECTURE.md Part
 * 9's own: "target audience is Mid-Market product teams in North America" becomes
 * `WHERE segment = 'Mid-Market' AND region = 'NA'`, and this project's own sample
 * data (samples/campaigns.xlsx, per docs/08-DEMO-SCENARIOS.md) really does have a
 * `segment` column (SMB, Mid-Market, Enterprise) and a `region` column (NA, UK),
 * and samples/src/northwind-brief.md really does say "Northwind's primary audience
 * is Mid-Market product teams in North America", so this uses that exact claim
 * rather than an invented one.
 *
 * What these tests can and cannot prove, honestly: `delegate()` sends the
 * serialised SpecialistTask as the entire user-turn prompt and never touches the
 * model beyond that (contracts.ts); `dataAnalyst`'s system instructions (rule 2,
 * added in P5.5) are the other half of what a real call sends to the model. Both
 * are inspectable and assertable here without a live model. What is NOT provable
 * without a live model is that Gemini, given both of those, actually writes SQL
 * containing `segment = 'Mid-Market' AND region = 'NA'`: no test in this file (or
 * this codebase's no-live-model testing style generally, see contracts.test.ts and
 * orchestrator.test.ts) can assert that, because it would require either a real API
 * call or scripting the exact answer the test wants to see, which proves nothing
 * about the model's actual behaviour. The third describe block below scripts that
 * exact answer deliberately, and says so.
 */

// The Agent class exposes its system instructions only through the async
// getInstructions() (it resolves function-based instructions when configured
// that way); dataAnalyst's are a plain string, so this resolves immediately with
// no model call. Fetched once at module load and reused by every test below that
// checks the instructions text, rather than each test awaiting it separately.
// Cast: getInstructions() is typed to also allow message-array/object forms for
// dynamic instructions, but dataAnalyst.ts configures a plain string, verified
// directly (typeof check) below rather than assumed.
const dataAnalystInstructions = (await dataAnalyst.getInstructions()) as string;
if (typeof dataAnalystInstructions !== 'string') {
  throw new Error('Expected dataAnalyst.getInstructions() to resolve to a plain string in this build.');
}

const midMarketNaEvidence: Evidence = {
  id: 'E12',
  claim: "Northwind's primary audience is Mid-Market product teams in North America",
  kind: 'document',
  sourceId: 'src_2',
  sourceName: 'northwind-brief.pdf',
  locator: 'page 3, Target Audience',
  confidence: 'high',
  createdAt: '2026-09-24T00:00:00.000Z',
};

/**
 * The same minimal Agent stand-in contracts.test.ts uses: delegate() only calls
 * `.generate()`. Used where a test needs full control over the model's reply
 * (e.g. to script a correctly-scoped SpecialistResult); tests that only care about
 * what delegate() sends spy on the real dataAnalyst's own `.generate` instead, so
 * its real `instructions` (rule 2) are the ones actually exercised.
 */
function fakeAgent(generateImpl: (...args: unknown[]) => unknown): Agent {
  return { name: 'Fake Data Analyst', generate: vi.fn(generateImpl) } as unknown as Agent;
}

function wellFormedResult(evidence: Evidence[] = []) {
  return {
    answer: 'ok',
    evidence,
    gaps: [],
    failures: [],
  };
}

describe('dataAnalyst instructions: the evidence-conditioned-query hard rule exists', () => {
  it('states the Mid-Market/North America worked example and instructs turning a relevant knownFacts entry into a WHERE constraint', () => {
    // Not a live-model test: this simply reads the static instructions string sent
    // as this agent's system prompt on every real call, and checks the P5.5 rule
    // (Task 1) is actually present and uses this project's own column names rather
    // than a generic placeholder.
    expect(dataAnalystInstructions).toContain('knownFacts');
    expect(dataAnalystInstructions).toContain("WHERE segment = 'Mid-Market' AND\n   region = 'NA'");
    expect(dataAnalystInstructions).toContain('Mid-Market product teams in North America');
    expect(dataAnalystInstructions).toContain('cite');
  });

  it('also states the other half: no relevant knownFacts means no invented constraint', () => {
    expect(dataAnalystInstructions).toContain('do not invent a\n   constraint out of nowhere');
    expect(dataAnalystInstructions).toContain('An unscoped question gets an unscoped query.');
  });
});

describe('delegate(dataAnalyst, task): knownFacts plumbing, evidence present', () => {
  it('serialises the knownFacts evidence claim into the prompt sent to the model', async () => {
    const generateSpy = vi.spyOn(dataAnalyst, 'generate').mockResolvedValue({
      steps: [{ text: JSON.stringify(wellFormedResult()), toolResults: [] }],
    } as never);

    const task = buildTask(
      'How is our campaign performance doing?',
      ['src_1'],
      [midMarketNaEvidence],
      'a grounded, evidence-cited answer computed from the relevant tables',
    );

    await delegate(dataAnalyst, task);

    expect(generateSpy).toHaveBeenCalledTimes(1);
    const [prompt] = generateSpy.mock.calls[0] as [string];

    // The plumbing under this codebase's control: the fact actually reaches the
    // model, verbatim, as part of the task JSON.
    expect(prompt).toContain("Northwind's primary audience is Mid-Market product teams in North America");
    expect(prompt).toContain('"id":"E12"');

    generateSpy.mockRestore();
  });

  it("the real dataAnalyst agent's system instructions (sent on every call, not part of delegate()'s own prompt) carry the constrain-by-knownFacts rule", () => {
    // Documents explicitly which half of "what gets sent to the model" each test
    // covers: delegate()'s prompt carries the *data* (the claim, per the test
    // above); the agent's own instructions carry the *rule* telling the model what
    // to do with that data. A live Mastra Agent.generate() call sends both; this
    // repo cannot invoke that live call, so each half is checked at the level this
    // codebase actually controls.
    expect(dataAnalystInstructions).toMatch(/knownFacts.*constraint|constraint.*knownFacts/s);
  });
});

describe('delegate(dataAnalyst, task): knownFacts plumbing, no relevant evidence', () => {
  it('produces a prompt with no scoping/constraint instruction when knownFacts is empty (the unscoped-query half of the bar)', async () => {
    const generateSpy = vi.spyOn(dataAnalyst, 'generate').mockResolvedValue({
      steps: [{ text: JSON.stringify(wellFormedResult()), toolResults: [] }],
    } as never);

    const task = buildTask(
      'How is our campaign performance doing?',
      ['src_1'],
      [],
      'a grounded, evidence-cited answer computed from the relevant tables',
    );

    await delegate(dataAnalyst, task);

    const [prompt] = generateSpy.mock.calls[0] as [string];
    expect(prompt).toContain('"knownFacts":[]');
    // Nothing in the per-task prompt itself names a WHERE constraint: the only
    // place a WHERE clause could come from for this task is the model inventing
    // one unprompted, which is exactly what rule 2's second half forbids.
    expect(prompt).not.toContain('WHERE');
    expect(prompt).not.toContain('Mid-Market');
    expect(prompt).not.toContain('segment');

    generateSpy.mockRestore();
  });
});

describe('delegate(dataAnalyst, task): a correctly-scoped SQL answer survives validation unchanged', () => {
  it('passes through an Evidence entry whose method contains both the segment and region constraints, untouched', async () => {
    // This is the part that fundamentally needs either a live model or a scripted
    // response: no test can assert Gemini *generates* this SQL from the improved
    // instructions without actually calling it. What this test proves instead is
    // narrower but real: given a correctly-scoped SpecialistResult (as a
    // correctly-behaving model, following rule 2, would produce), the plumbing
    // between the model boundary and the orchestrator (delegate()'s
    // SpecialistResultSchema validation) preserves it exactly, drops nothing, and
    // does not re-derive or retype the evidence.
    const scopedEvidence: Evidence = {
      id: 'E13',
      claim: 'Mid-Market / North America conversion rate is 5.1%, scoped to the stated target audience [E12]',
      kind: 'computed',
      sourceId: 'campaigns',
      sourceName: 'campaigns',
      locator: 'campaigns',
      method:
        "SELECT SUM(conversions) / SUM(clicks) FROM campaigns WHERE segment = 'Mid-Market' AND region = 'NA'",
      value: 0.051,
      confidence: 'high',
      createdAt: '2026-09-24T00:00:00.000Z',
    };

    const agent = fakeAgent(() =>
      Promise.resolve({
        steps: [
          { toolResults: [{ payload: { toolName: 'record_evidence', result: { ok: true, data: { evidence: scopedEvidence } } } }] },
          { text: 'Scoped to Mid-Market / North America, the stated target audience [E12]: conversion rate is 5.1% [E13].', toolResults: [] },
        ],
      }),
    );

    const task = buildTask(
      'How is our campaign performance doing?',
      ['src_1'],
      [midMarketNaEvidence],
      'a grounded, evidence-cited answer computed from the relevant tables',
    );

    const result = await delegate(agent, task, { extractGaps: async () => [] });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.method).toContain("segment = 'Mid-Market'");
    expect(result.evidence[0]!.method).toContain("region = 'NA'");
    expect(result.evidence[0]).toEqual(scopedEvidence);
    expect(result.answer).toContain('E12');
  });
});
