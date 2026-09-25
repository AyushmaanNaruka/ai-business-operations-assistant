import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@mastra/core/agent';
import type { Artifact, Evidence, Finding, MetricKey, SessionManifest, SpecialistTask, Source } from '@/types';
import { emptyManifest, addSource, addFinding, addArtifact } from '@/modules/session';
import {
  buildPlan,
  checkSourcesReady,
  classifyIntent,
  decideAction,
  decideDelegationMode,
  gatherKnownFactsForData,
  relevantEvidenceIds,
  runTurn,
  type Intent,
} from './orchestrator';

/**
 * A minimal stand-in for a Mastra `Agent`, the same shape
 * src/mastra/agents/contracts.test.ts uses to stub `delegate()`'s agent parameter:
 * `classifyIntent` only ever calls `.generate()` on the agent it is given.
 */
function fakeClassifierAgent(intent: Intent): Agent {
  return {
    name: 'Fake Classifier',
    generate: vi.fn(() => Promise.resolve({ object: { intent } })),
  } as unknown as Agent;
}

function readySource(id: string, name: string, kind: Source['kind'] = 'xlsx'): Source {
  return {
    id,
    name,
    kind,
    origin: 'upload',
    status: 'ready',
    summary: `${id}  ${name}  ${kind}`,
    addedAt: '2026-09-24T00:00:00.000Z',
  };
}

function pendingSource(id: string, name: string, kind: Source['kind'] = 'xlsx'): Source {
  return { ...readySource(id, name, kind), status: 'pending' };
}

describe('classifyIntent', () => {
  const intents: Intent[] = ['data', 'document', 'research', 'recommendation', 'artifact', 'mixed', 'unsupported'];

  it.each(intents)('routes to intent "%s" when the stubbed model returns it', async (intent) => {
    const agent = fakeClassifierAgent(intent);
    const result = await classifyIntent('some request', 'SOURCES\n  (none)', agent);
    expect(result).toBe(intent);
    expect(agent.generate).toHaveBeenCalledTimes(1);
  });

  it('throws rather than passing through a result with no valid intent field', async () => {
    const agent = {
      name: 'Bad Classifier',
      generate: vi.fn(() => Promise.resolve({ object: { intent: 'not-a-real-class' } })),
    } as unknown as Agent;
    await expect(classifyIntent('x', 'SOURCES\n  (none)', agent)).rejects.toThrow(/does not match/);
  });
});

describe('checkSourcesReady', () => {
  it('is ready when no specific sources are named', () => {
    const result = checkSourcesReady([], emptyManifest());
    expect(result).toEqual({ ok: true, data: 'ready' });
  });

  it('fails with SOURCE_PENDING when a named source is still ingesting', () => {
    const manifest = addSource(emptyManifest(), pendingSource('src_1', 'campaigns.xlsx'));
    const result = checkSourcesReady(['src_1'], manifest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SOURCE_PENDING');
    expect(result.error.message).toContain('campaigns.xlsx');
  });

  it('fails with SOURCE_NOT_FOUND when a named source id is not in the manifest', () => {
    const result = checkSourcesReady(['src_missing'], emptyManifest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SOURCE_NOT_FOUND');
  });

  it('is ready when every named source is ready', () => {
    const manifest = addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx'));
    const result = checkSourcesReady(['src_1'], manifest);
    expect(result).toEqual({ ok: true, data: 'ready' });
  });
});

describe('decideAction', () => {
  const manifest = addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx'));

  it('routes "data" to delegate with only the data specialist', () => {
    expect(decideAction('data', ['src_1'], manifest)).toEqual({ kind: 'delegate', specialists: ['data'] });
  });

  it('routes "document" to delegate with only the document specialist', () => {
    expect(decideAction('document', ['src_1'], manifest)).toEqual({ kind: 'delegate', specialists: ['document'] });
  });

  it('routes "research" to delegate with only the research specialist', () => {
    expect(decideAction('research', ['src_1'], manifest)).toEqual({ kind: 'delegate', specialists: ['research'] });
  });

  it('routes "mixed" to delegate with the specialists matching the scoped sources\' kinds', () => {
    const mixedManifest = addSource(manifest, readySource('src_2', 'brief.pdf', 'pdf'));
    const result = decideAction('mixed', ['src_1', 'src_2'], mixedManifest);
    expect(result.kind).toBe('delegate');
    if (result.kind !== 'delegate') return;
    expect(result.specialists.sort()).toEqual(['data', 'document']);
  });

  it('routes "recommendation" to answer_directly, never delegate', () => {
    expect(decideAction('recommendation', [], manifest)).toEqual({ kind: 'answer_directly' });
  });

  it('routes "artifact" to artifact_stub, never delegate', () => {
    const result = decideAction('artifact', [], manifest);
    expect(result.kind).toBe('artifact_stub');
  });

  it('routes "unsupported" to a canned unsupported message', () => {
    const result = decideAction('unsupported', [], manifest);
    expect(result.kind).toBe('unsupported');
  });

  it('routes a delegating intent to "wait" when the scoped source is pending, not to delegate', () => {
    const pendingManifest = addSource(emptyManifest(), pendingSource('src_1', 'campaigns.xlsx'));
    const result = decideAction('data', ['src_1'], pendingManifest);
    expect(result.kind).toBe('wait');
  });
});

describe('runTurn: recommendation never delegates', () => {
  it('does not call any specialist for a "recommendation" classification', async () => {
    const delegateFn = vi.fn();
    const classify = vi.fn(async () => 'recommendation' as Intent);
    const manifest = addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx'));

    const turn = await runTurn('suggest three campaign ideas', [], manifest, { classify, delegateFn });

    expect(turn.action).toBe('answer_directly');
    expect(turn.outcomes).toEqual([]);
    expect(delegateFn).not.toHaveBeenCalled();
  });
});

describe('runTurn: a pending source produces a wait, not delegation and not an empty answer', () => {
  it('never calls delegate when the request is scoped to a still-pending source', async () => {
    const delegateFn = vi.fn();
    const classify = vi.fn(async () => 'data' as Intent);
    const manifest = addSource(emptyManifest(), pendingSource('src_1', 'campaigns.xlsx'));

    const turn = await runTurn('what is our conversion rate', ['src_1'], manifest, { classify, delegateFn });

    expect(turn.action).toBe('wait');
    expect(turn.message).toBeTruthy();
    expect(turn.message).toContain('campaigns.xlsx');
    expect(turn.outcomes).toEqual([]);
    expect(delegateFn).not.toHaveBeenCalled();
  });
});

describe('runTurn: an unsupported request', () => {
  it('produces an "I cannot do X, what I can do is Y" shaped reply without delegating', async () => {
    const delegateFn = vi.fn();
    const classify = vi.fn(async () => 'unsupported' as Intent);
    const manifest: SessionManifest = emptyManifest();

    const turn = await runTurn('email this to my manager', [], manifest, { classify, delegateFn });

    expect(turn.action).toBe('unsupported');
    expect(turn.message).toBeTruthy();
    expect(turn.message!.toLowerCase()).toContain('cannot');
    expect(turn.message!.toLowerCase()).toContain('what i can do');
    expect(delegateFn).not.toHaveBeenCalled();
  });

  it('offers the file instead of the generic capabilities list when a send request follows an already-built artifact', async () => {
    const delegateFn = vi.fn();
    const classify = vi.fn(async () => 'unsupported' as Intent);
    const artifact: Artifact = {
      id: 'art_1',
      version: 1,
      kind: 'pptx',
      skillUsed: 'client-presentation',
      title: 'Q3 Campaign Review',
      path: '/generated/art_1.pptx',
      downloadUrl: '/downloads/art_1.pptx',
      findingIds: [],
      evidenceIds: [],
      createdAt: new Date().toISOString(),
    };
    const manifest = addArtifact(emptyManifest(), artifact);

    const turn = await runTurn('Can you email this to my manager?', [], manifest, { classify, delegateFn });

    expect(turn.action).toBe('unsupported');
    expect(turn.message).toContain(artifact.downloadUrl);
    expect(turn.message).toContain(artifact.title);
    expect(delegateFn).not.toHaveBeenCalled();
  });
});

describe('runTurn: delegation happens for data/document/research/mixed', () => {
  it('delegates to the data specialist and returns its result for a "data" classification', async () => {
    const specialistResult = { answer: 'Email converts at 4.2% [E1].', evidence: [], gaps: [], failures: [] };
    const delegateFn = vi.fn(async (_agent: Agent, _task: SpecialistTask) => specialistResult);
    const classify = vi.fn(async () => 'data' as Intent);
    const manifest = addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx'));

    const turn = await runTurn('what is our conversion rate', ['src_1'], manifest, { classify, delegateFn });

    expect(turn.action).toBe('delegate');
    expect(turn.outcomes).toHaveLength(1);
    expect(turn.outcomes[0]!.specialist).toBe('data');
    expect(turn.outcomes[0]!.result).toEqual({ ok: true, data: specialistResult });
    expect(delegateFn).toHaveBeenCalledTimes(1);

    // Rule 3: delegate() must be called with a typed SpecialistTask whose objective is
    // the clean request, never a dump of prior conversation turns.
    const [, task] = delegateFn.mock.calls[0]!;
    expect(task).toMatchObject({ objective: 'what is our conversion rate', sourceIds: ['src_1'] });
  });

  it('delegates to more than one specialist in parallel for "mixed", one call per specialist', async () => {
    const specialistResult = { answer: 'ok', evidence: [], gaps: [], failures: [] };
    const delegateFn = vi.fn(async () => specialistResult);
    const classify = vi.fn(async () => 'mixed' as Intent);
    const manifest = addSource(addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx')), readySource('src_2', 'brief.pdf', 'pdf'));

    const turn = await runTurn('research this and analyse my data', ['src_1', 'src_2'], manifest, { classify, delegateFn });

    expect(turn.action).toBe('delegate');
    expect(turn.outcomes.map((o) => o.specialist).sort()).toEqual(['data', 'document']);
    expect(delegateFn).toHaveBeenCalledTimes(2);
  });

  it('turns a delegate() throw (a malformed specialist result) into a failed outcome instead of throwing', async () => {
    const delegateFn = vi.fn(async () => {
      throw new Error('does not match SpecialistResultSchema');
    });
    const classify = vi.fn(async () => 'data' as Intent);
    const manifest = addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx'));

    const turn = await runTurn('what is our conversion rate', ['src_1'], manifest, { classify, delegateFn });

    expect(turn.outcomes).toHaveLength(1);
    expect(turn.outcomes[0]!.result.ok).toBe(false);
  });
});

describe('decideDelegationMode', () => {
  it('is always parallel with fewer than two specialists, whatever the text says', () => {
    expect(decideDelegationMode('research this company, then analyse my data', ['research'])).toEqual({ mode: 'parallel' });
    expect(decideDelegationMode('anything', [])).toEqual({ mode: 'parallel' });
  });

  it('is parallel for the promptbook\'s parallel example: two independent asks, no dependency language', () => {
    const result = decideDelegationMode('Research this company and analyse my campaign data', ['research', 'data']);
    expect(result).toEqual({ mode: 'parallel' });
  });

  it('is sequential for the promptbook\'s sequential example, ordered by which clause came first', () => {
    const result = decideDelegationMode(
      'Research this company, then analyse my data against what you find',
      ['data', 'research'], // specialistsForMixed's own order; decideDelegationMode must reorder it
    );
    expect(result).toEqual({ mode: 'sequential', order: ['research', 'data'] });
  });

  it.each([
    'Research the competitor, then analyse our campaign data against it',
    'Research the competitor. Once you have that, analyse our campaign data',
    'Research the competitor and, based on what you find, analyse our campaign data',
    'Research the competitor, after that analyse our campaign data',
  ])('treats "%s" as sequential too (dependency-language variants)', (message) => {
    const result = decideDelegationMode(message, ['data', 'research']);
    expect(result.mode).toBe('sequential');
  });

  it('does not misfire on ordinary text that happens to contain "data" or "research" without a dependency word', () => {
    const result = decideDelegationMode('Pull the research summary and the data summary together', ['research', 'data']);
    expect(result).toEqual({ mode: 'parallel' });
  });
});

describe('runTurn: mixed delegation mode (P5.4)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function mixedManifest(): SessionManifest {
    return addSource(
      addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx', 'xlsx')),
      readySource('src_2', 'acme.com', 'web'),
    );
  }

  const specialistResult = { answer: 'ok', evidence: [] as Evidence[], gaps: [], failures: [] };

  it('a parallel mixed request resolves both specialists via Promise.all, in roughly the slower one\'s time', async () => {
    vi.useFakeTimers();
    const classify = vi.fn(async () => 'mixed' as Intent);
    // task.expect differs per specialist (see expectFor in orchestrator.ts); use it to
    // give the "data" leg the longer delay without depending on call order.
    const delegateFn = vi.fn(async (_agent: Agent, task: SpecialistTask) => {
      const delayMs = task.expect.includes('tables') ? 150 : 50;
      await new Promise((res) => setTimeout(res, delayMs));
      return specialistResult;
    });

    let settled = false;
    const turnPromise = runTurn('Research this company and analyse my campaign data', ['src_1', 'src_2'], mixedManifest(), {
      classify,
      delegateFn,
    }).then((t) => {
      settled = true;
      return t;
    });

    // Both legs started concurrently: after only the shorter delay, the longer one is
    // still pending, so the whole turn cannot have settled yet.
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);

    // Advancing to the slower leg's own delay is enough to finish both, proving this
    // ran in roughly the time of the slower specialist (150ms), not the sum (200ms).
    await vi.advanceTimersByTimeAsync(50);
    const turn = await turnPromise;
    expect(settled).toBe(true);

    expect(turn.delegationMode).toBe('parallel');
    expect(turn.delegationOrder).toBeUndefined();
    expect(turn.outcomes.map((o) => o.specialist).sort()).toEqual(['data', 'research']);
    expect(delegateFn).toHaveBeenCalledTimes(2);
  });

  it('a sequential mixed request delegates in order and passes the first result\'s evidence into the second task\'s knownFacts', async () => {
    const researchEvidence: Evidence[] = [
      {
        id: 'E1',
        claim: 'Acme targets mid-market SaaS buyers',
        kind: 'web',
        sourceId: 'src_2',
        sourceName: 'acme.com',
        locator: 'https://acme.com/about',
        confidence: 'high',
        createdAt: '2026-09-24T00:00:00.000Z',
      },
    ];
    const classify = vi.fn(async () => 'mixed' as Intent);
    const delegateFn = vi.fn(async (_agent: Agent, task: SpecialistTask) => {
      if (task.expect.includes('public web')) {
        return { answer: 'researched Acme', evidence: researchEvidence, gaps: [], failures: [] };
      }
      return { answer: 'analysed campaigns', evidence: [], gaps: [], failures: [] };
    });

    const turn = await runTurn(
      'Research this company, then analyse my data against what you find',
      ['src_1', 'src_2'],
      mixedManifest(),
      { classify, delegateFn },
    );

    expect(turn.delegationMode).toBe('sequential');
    expect(turn.delegationOrder).toEqual(['research', 'data']);
    expect(turn.outcomes.map((o) => o.specialist)).toEqual(['research', 'data']);
    expect(delegateFn).toHaveBeenCalledTimes(2);

    const [, secondTask] = delegateFn.mock.calls[1]! as [Agent, SpecialistTask];
    expect(secondTask.knownFacts).toEqual(researchEvidence);
  });

  it('when the first leg of a sequential chain fails, the second specialist still runs with empty knownFacts and the failure is surfaced, not dropped', async () => {
    const classify = vi.fn(async () => 'mixed' as Intent);
    const delegateFn = vi.fn(async (_agent: Agent, task: SpecialistTask) => {
      if (task.expect.includes('public web')) {
        throw new Error('does not match SpecialistResultSchema');
      }
      return { answer: 'analysed campaigns', evidence: [], gaps: [], failures: [] };
    });

    const turn = await runTurn(
      'Research this company, then analyse my data against what you find',
      ['src_1', 'src_2'],
      mixedManifest(),
      { classify, delegateFn },
    );

    expect(turn.delegationMode).toBe('sequential');
    expect(turn.delegationOrder).toEqual(['research', 'data']);
    expect(delegateFn).toHaveBeenCalledTimes(2);

    // The second specialist still ran, but with empty knownFacts: the failed first leg
    // produced nothing to carry forward.
    const [, secondTask] = delegateFn.mock.calls[1]! as [Agent, SpecialistTask];
    expect(secondTask.knownFacts).toEqual([]);

    // The first failure is not silently dropped: it is right there in outcomes for
    // the orchestrator's synthesis step to report as a gap.
    expect(turn.outcomes).toHaveLength(2);
    expect(turn.outcomes[0]!.specialist).toBe('research');
    expect(turn.outcomes[0]!.result.ok).toBe(false);
    expect(turn.outcomes[1]!.specialist).toBe('data');
    expect(turn.outcomes[1]!.result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P5.5: evidence conditioned queries, the parallel-path knownFacts gap.
// docs/03-ARCHITECTURE.md Part 9 "Evidence conditioned queries": a document (or
// other) derived fact already sitting in the manifest's findings should reach the
// Data Analyst's task as knownFacts even on a plain, single-specialist "data"
// delegation, not only on P5.4's sequential-chain path. These tests exercise
// `runTurn` directly, the same level P5.4's own sequential tests above do, using
// `RunTurnDeps.gatherKnownFactsForData` the same way `classify`/`delegateFn` are
// already stubbed: this is the file's own established DI pattern (decideAction,
// checkSourcesReady, decideDelegationMode are all unit tested with plain objects;
// runTurn's model- and I/O-touching dependencies are all swappable via `deps`),
// so this is "whatever level actually exercises the new code path" without a real
// evidence ledger or database file.
// ---------------------------------------------------------------------------

function midMarketFinding(): Finding {
  return {
    id: 'F1',
    statement: "Northwind's primary audience is Mid-Market product teams in North America",
    evidenceIds: ['E12'],
    reasoning: 'Stated directly in the company brief.',
    soWhat: 'Campaign analysis should be scoped to this audience when relevant.',
    confidence: 'high',
    createdAt: '2026-09-24T00:00:00.000Z',
  };
}

const midMarketEvidence: Evidence = {
  id: 'E12',
  claim: "Northwind's primary audience is Mid-Market product teams in North America",
  kind: 'document',
  sourceId: 'src_2',
  sourceName: 'northwind-brief.pdf',
  locator: 'page 3, Target Audience',
  confidence: 'high',
  createdAt: '2026-09-24T00:00:00.000Z',
};

describe('relevantEvidenceIds: pure policy, no I/O', () => {
  it('collects every evidenceId cited by a finding already in the manifest, deduplicated', () => {
    const manifest = addFinding(
      addFinding(emptyManifest(), midMarketFinding()),
      { ...midMarketFinding(), id: 'F2', evidenceIds: ['E12', 'E13'] },
    );
    expect(relevantEvidenceIds(manifest)).toEqual(['E12', 'E13']);
  });

  it('is empty for a manifest with no findings', () => {
    expect(relevantEvidenceIds(emptyManifest())).toEqual([]);
  });
});

describe('gatherKnownFactsForData: fetches evidence for relevant ids, never touches the ledger when there are none', () => {
  it('returns [] and never calls ledgerFn when the manifest has no findings', async () => {
    const ledgerFn = vi.fn();
    const result = await gatherKnownFactsForData(emptyManifest(), ledgerFn);
    expect(result).toEqual([]);
    expect(ledgerFn).not.toHaveBeenCalled();
  });

  it('fetches the Evidence objects for the relevant ids via the injected ledger', async () => {
    const manifest = addFinding(emptyManifest(), midMarketFinding());
    const getEvidence = vi.fn(async (ids: string[]) => (ids.includes('E12') ? [midMarketEvidence] : []));
    const ledgerFn = vi.fn(async () => ({ getEvidence }) as never);

    const result = await gatherKnownFactsForData(manifest, ledgerFn);

    expect(result).toEqual([midMarketEvidence]);
    expect(getEvidence).toHaveBeenCalledWith(['E12']);
  });

  it('swallows a ledger failure and returns [] rather than breaking the turn', async () => {
    const manifest = addFinding(emptyManifest(), midMarketFinding());
    const ledgerFn = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const result = await gatherKnownFactsForData(manifest, ledgerFn);
    expect(result).toEqual([]);
  });
});

describe('runTurn: a plain single-specialist "data" delegation picks up relevant evidence already in the manifest (P5.5)', () => {
  it('calls delegate with a task whose knownFacts is non-empty and contains the manifest-derived evidence', async () => {
    const delegateFn = vi.fn(async (_agent: Agent, _task: SpecialistTask) => ({ answer: 'ok', evidence: [], gaps: [], failures: [] }));
    const classify = vi.fn(async () => 'data' as Intent);
    const gatherKnownFactsForDataStub = vi.fn(async (m: SessionManifest) =>
      relevantEvidenceIds(m).includes('E12') ? [midMarketEvidence] : [],
    );
    const manifest = addFinding(
      addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx')),
      midMarketFinding(),
    );

    const turn = await runTurn('how is our campaign performance doing', ['src_1'], manifest, {
      classify,
      delegateFn,
      gatherKnownFactsForData: gatherKnownFactsForDataStub,
    });

    expect(turn.action).toBe('delegate');
    expect(delegateFn).toHaveBeenCalledTimes(1);
    expect(gatherKnownFactsForDataStub).toHaveBeenCalledTimes(1);

    const [, task] = delegateFn.mock.calls[0]! as [Agent, SpecialistTask];
    expect(task.knownFacts).not.toEqual([]);
    expect(task.knownFacts).toContainEqual(midMarketEvidence);
  });

  it('never calls gatherKnownFactsForData for a "document" or "research" only delegation', async () => {
    const delegateFn = vi.fn(async (_agent: Agent, _task: SpecialistTask) => ({ answer: 'ok', evidence: [], gaps: [], failures: [] }));
    const classify = vi.fn(async () => 'document' as Intent);
    const gatherKnownFactsForDataStub = vi.fn(async () => [midMarketEvidence]);
    const manifest = addFinding(
      addSource(emptyManifest(), readySource('src_2', 'brief.pdf', 'pdf')),
      midMarketFinding(),
    );

    const turn = await runTurn('what does the brief say about positioning', ['src_2'], manifest, {
      classify,
      delegateFn,
      gatherKnownFactsForData: gatherKnownFactsForDataStub,
    });

    expect(turn.action).toBe('delegate');
    expect(gatherKnownFactsForDataStub).not.toHaveBeenCalled();

    const [, task] = delegateFn.mock.calls[0]! as [Agent, SpecialistTask];
    expect(task.knownFacts).toEqual([]);
  });

  it('produces an unscoped task (empty knownFacts) when the manifest has no relevant findings, proving the mechanism does not invent facts', async () => {
    const delegateFn = vi.fn(async (_agent: Agent, _task: SpecialistTask) => ({ answer: 'ok', evidence: [], gaps: [], failures: [] }));
    const classify = vi.fn(async () => 'data' as Intent);
    const manifest = addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx'));

    // No gatherKnownFactsForData stub: uses the real default, which (per the tests
    // above) returns [] without touching any ledger when there are no findings.
    const turn = await runTurn('how is our campaign performance doing', ['src_1'], manifest, {
      classify,
      delegateFn,
    });

    expect(turn.action).toBe('delegate');
    const [, task] = delegateFn.mock.calls[0]! as [Agent, SpecialistTask];
    expect(task.knownFacts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P5.6: plan, progress and conflicts. docs/03-ARCHITECTURE.md Part 10 gap 7
// ("Multi part requests need a visible plan") and the promptbook's own P5.6 entry.
// ---------------------------------------------------------------------------

function mixedDataResearchManifest(): SessionManifest {
  return addSource(
    addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx', 'xlsx')),
    readySource('src_2', 'acme.com', 'web'),
  );
}

describe('buildPlan: pure policy, no I/O', () => {
  it('returns undefined for a single specialist, whatever the mode', () => {
    expect(buildPlan(['data'], 'parallel')).toBeUndefined();
    expect(buildPlan([], 'sequential')).toBeUndefined();
  });

  it('starts every step "running" for a parallel plan', () => {
    expect(buildPlan(['data', 'research'], 'parallel')).toEqual([
      { label: 'Analyse your data', status: 'running' },
      { label: 'Research the web', status: 'running' },
    ]);
  });

  it('starts only the first step "running" for a sequential plan, the rest "waiting"', () => {
    expect(buildPlan(['research', 'data'], 'sequential')).toEqual([
      { label: 'Research the web', status: 'running' },
      { label: 'Analyse your data', status: 'waiting' },
    ]);
  });
});

describe('runTurn: plan (P5.6)', () => {
  it('produces no plan for a single-specialist delegation', async () => {
    const delegateFn = vi.fn(async () => ({ answer: 'ok', evidence: [], gaps: [], failures: [] }));
    const classify = vi.fn(async () => 'data' as Intent);
    const manifest = addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx'));

    const turn = await runTurn('what is our conversion rate', ['src_1'], manifest, { classify, delegateFn });

    expect(turn.plan).toBeUndefined();
  });

  it('produces a plan with one step per specialist, in decision order, all "done" once a parallel mixed turn completes', async () => {
    const specialistResult = { answer: 'ok', evidence: [] as Evidence[], gaps: [], failures: [] };
    const delegateFn = vi.fn(async () => specialistResult);
    const classify = vi.fn(async () => 'mixed' as Intent);

    const turn = await runTurn(
      'Research this company and analyse my campaign data',
      ['src_1', 'src_2'],
      mixedDataResearchManifest(),
      { classify, delegateFn },
    );

    expect(turn.delegationMode).toBe('parallel');
    expect(turn.plan).toHaveLength(2);
    expect(turn.plan!.map((s) => s.label)).toEqual(['Analyse your data', 'Research the web']);
    expect(turn.plan!.every((s) => s.status === 'done')).toBe(true);
  });

  it('produces a plan whose step order matches the sequential delegationOrder, "done" once complete', async () => {
    const classify = vi.fn(async () => 'mixed' as Intent);
    const delegateFn = vi.fn(async (_agent: Agent, task: SpecialistTask) =>
      task.expect.includes('public web')
        ? { answer: 'researched', evidence: [], gaps: [], failures: [] }
        : { answer: 'analysed', evidence: [], gaps: [], failures: [] },
    );

    const turn = await runTurn(
      'Research this company, then analyse my data against what you find',
      ['src_1', 'src_2'],
      mixedDataResearchManifest(),
      { classify, delegateFn },
    );

    expect(turn.delegationMode).toBe('sequential');
    expect(turn.delegationOrder).toEqual(['research', 'data']);
    expect(turn.plan!.map((s) => s.label)).toEqual(['Research the web', 'Analyse your data']);
    expect(turn.plan!.every((s) => s.status === 'done')).toBe(true);
  });
});

describe('runTurn: progress events (P5.6)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a delegation_start then delegation_end for a single-specialist turn', async () => {
    const delegateFn = vi.fn(async () => ({ answer: 'ok', evidence: [], gaps: [], failures: [] }));
    const classify = vi.fn(async () => 'data' as Intent);
    const manifest = addSource(emptyManifest(), readySource('src_1', 'campaigns.xlsx'));

    const turn = await runTurn('what is our conversion rate', ['src_1'], manifest, { classify, delegateFn });

    expect(turn.progressEvents).toHaveLength(2);
    expect(turn.progressEvents!.map((e) => e.kind)).toEqual(['delegation_start', 'delegation_end']);
    expect(turn.progressEvents!.every((e) => e.specialist === 'data')).toBe(true);
  });

  it('emits both legs\' start events before either finish event for a parallel mixed turn', async () => {
    vi.useFakeTimers();
    const classify = vi.fn(async () => 'mixed' as Intent);
    const delegateFn = vi.fn(async (_agent: Agent, task: SpecialistTask) => {
      const delayMs = task.expect.includes('tables') ? 150 : 50;
      await new Promise((res) => setTimeout(res, delayMs));
      return { answer: 'ok', evidence: [], gaps: [], failures: [] };
    });

    const turnPromise = runTurn(
      'Research this company and analyse my campaign data',
      ['src_1', 'src_2'],
      mixedDataResearchManifest(),
      { classify, delegateFn },
    );
    await vi.advanceTimersByTimeAsync(150);
    const turn = await turnPromise;

    expect(turn.progressEvents!.map((e) => `${e.kind}:${e.specialist}`)).toEqual([
      'delegation_start:data',
      'delegation_start:research',
      'delegation_end:research',
      'delegation_end:data',
    ]);
  });

  it('emits the first leg\'s start/end strictly before the second leg\'s start, for a sequential mixed turn', async () => {
    const classify = vi.fn(async () => 'mixed' as Intent);
    const delegateFn = vi.fn(async (_agent: Agent, task: SpecialistTask) =>
      task.expect.includes('public web')
        ? { answer: 'researched', evidence: [], gaps: [], failures: [] }
        : { answer: 'analysed', evidence: [], gaps: [], failures: [] },
    );

    const turn = await runTurn(
      'Research this company, then analyse my data against what you find',
      ['src_1', 'src_2'],
      mixedDataResearchManifest(),
      { classify, delegateFn },
    );

    expect(turn.progressEvents!.map((e) => `${e.kind}:${e.specialist}`)).toEqual([
      'delegation_start:research',
      'delegation_end:research',
      'delegation_start:data',
      'delegation_end:data',
    ]);
  });
});

// samples/campaigns.xlsx and samples/customer-notes.docx both exist in this repo
// (docs/PROMPTBOOK.md P5.6's own demo case: customer notes claims Paid Social is the
// strongest channel, which should conflict with the campaign data's own computed
// numbers). Ingestion is not exercised here; these Evidence objects mirror what
// document-agent and data-analyst evidence would look like for this exact scenario,
// the same synthetic style src/modules/evidence/conflicts.test.ts already uses.
describe('runTurn: conflicts (P5.6)', () => {
  const paidSocialMetric: MetricKey = { name: 'conversion_rate', scope: 'channel=paid_social', unit: 'ratio' };

  function customerNotesEvidence(): Evidence {
    return {
      id: 'E20',
      claim: 'Customer notes describe Paid Social as the strongest converting channel',
      kind: 'document',
      sourceId: 'src_notes',
      sourceName: 'customer-notes.docx',
      locator: 'page 1',
      value: 0.06,
      confidence: 'medium',
      metric: paidSocialMetric,
      createdAt: '2026-09-24T00:00:00.000Z',
    };
  }

  function campaignsEvidence(): Evidence {
    return {
      id: 'E21',
      claim: 'Paid Social converts at 4.2% in the campaign data',
      kind: 'computed',
      sourceId: 'src_campaigns',
      sourceName: 'campaigns.xlsx',
      locator: 'campaigns',
      method: 'SELECT channel, conversions::FLOAT / clicks AS rate FROM campaigns WHERE channel = \'paid_social\'',
      value: 0.042,
      confidence: 'high',
      metric: paidSocialMetric,
      createdAt: '2026-09-24T00:00:00.000Z',
    };
  }

  it('surfaces the customer-notes vs campaign-data Paid Social disagreement, both sides cited', async () => {
    const classify = vi.fn(async () => 'mixed' as Intent);
    const delegateFn = vi.fn(async (_agent: Agent, task: SpecialistTask) => {
      if (task.expect.includes('document passages')) {
        return { answer: 'Per customer notes, Paid Social is the strongest channel.', evidence: [customerNotesEvidence()], gaps: [], failures: [] };
      }
      return { answer: 'Per the campaign data, Paid Social converts at 4.2%.', evidence: [campaignsEvidence()], gaps: [], failures: [] };
    });
    const manifest = addSource(
      addSource(emptyManifest(), readySource('src_campaigns', 'campaigns.xlsx', 'xlsx')),
      readySource('src_notes', 'customer-notes.docx', 'docx'),
    );

    const turn = await runTurn('How is Paid Social performing?', ['src_campaigns', 'src_notes'], manifest, {
      classify,
      delegateFn,
    });

    expect(turn.conflicts).toBeDefined();
    expect(turn.conflicts).toHaveLength(1);
    const conflict = turn.conflicts![0]!;
    expect(conflict.metric).toEqual(paidSocialMetric);
    expect([conflict.a.sourceName, conflict.b.sourceName].sort()).toEqual(['campaigns.xlsx', 'customer-notes.docx']);
    expect([conflict.a.value, conflict.b.value].sort()).toEqual([0.042, 0.06]);
  });

  it('leaves conflicts undefined when the gathered evidence does not disagree', async () => {
    const classify = vi.fn(async () => 'data' as Intent);
    const delegateFn = vi.fn(async () => ({
      answer: 'Paid Social converts at 4.2%.',
      evidence: [campaignsEvidence()],
      gaps: [],
      failures: [],
    }));
    const manifest = addSource(emptyManifest(), readySource('src_campaigns', 'campaigns.xlsx', 'xlsx'));

    const turn = await runTurn('what is our paid social conversion rate', ['src_campaigns'], manifest, {
      classify,
      delegateFn,
    });

    expect(turn.conflicts).toBeUndefined();
  });
});
