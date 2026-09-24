import { describe, expect, it, vi } from 'vitest';
import type { Artifact, Evidence, Finding } from '@/types';
import type { ArtifactStore } from '@/modules/artifacts/store';
import type { EvidenceLedger } from '@/modules/evidence';
import { buildArtifactWorkflow } from './artifact';

/**
 * Graph-level tests for the artifact workflow. Lighter than artifactSteps.test.ts on
 * purpose (D-33/D-40's own logic split): the heavy business logic (resolveFormat,
 * gatherEvidenceForArtifact, authorAndValidate's retry loop, renderChartsPrecheck,
 * renderArtifactFile's dispatch, storeArtifactFile's path handling) is already covered
 * there with plain-function tests. These tests exist only to prove the graph wiring
 * itself: that a completed run really does produce an Artifact, that a failed
 * authorAndValidate really does suspend the run rather than proceeding to render/store
 * (the P6.6 "Done when" bar's explicit requirement), and that a revision run really
 * does carry `revisionOf` through to the store.
 *
 * Every dependency is stubbed via `buildArtifactWorkflow(deps)`; no live model, network,
 * or database is touched anywhere in this file.
 */

const sampleFinding: Finding = {
  id: 'F1',
  statement: 'Email is the efficiency leader',
  evidenceIds: ['E1'],
  reasoning: 'highest CVR with a reportable sample',
  soWhat: 'shift budget toward email',
  confidence: 'high',
  createdAt: '2026-09-24T00:00:00.000Z',
};

const sampleEvidence: Evidence = {
  id: 'E1',
  claim: 'email converts at 4.2%',
  kind: 'computed',
  sourceId: 'src_1',
  sourceName: 'campaigns.xlsx',
  locator: 'campaigns',
  method: 'SELECT ...',
  value: 0.042,
  confidence: 'high',
  createdAt: '2026-09-24T00:00:00.000Z',
};

const fakeLedger: Pick<EvidenceLedger, 'getFindings' | 'getEvidence'> = {
  getFindings: vi.fn().mockResolvedValue([sampleFinding]),
  getEvidence: vi.fn().mockResolvedValue([sampleEvidence]),
};

function fakeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art_1',
    version: 1,
    kind: 'docx',
    skillUsed: 'campaign-report',
    title: 'Q3 Campaign Review',
    path: '/tmp/generated/q3.docx',
    downloadUrl: '/generated/q3.docx',
    findingIds: ['F1'],
    evidenceIds: ['E1'],
    createdAt: '2026-09-24T00:00:00.000Z',
    ...overrides,
  };
}

const baseInput = {
  planKind: 'report' as const,
  title: 'Q3 Campaign Review',
  objective: 'Summarise Q3 campaign performance',
  findingIds: ['F1'],
  dataRows: [] as Record<string, unknown>[],
};

describe('artifact workflow (graph level)', () => {
  it('a run whose plan validates on the first attempt reaches status: completed with a real Artifact, every dependency stubbed', async () => {
    const savedArtifact = fakeArtifact();
    const renderArtifactFileFn = vi.fn().mockResolvedValue({ buffer: Buffer.from('docx bytes') });
    const storeArtifactFileFn = vi.fn().mockResolvedValue(savedArtifact);
    const authorAndValidateFn = vi.fn().mockResolvedValue({ ok: true, plan: { title: 'A valid plan' } });

    const workflow = buildArtifactWorkflow({
      getLedger: async () => fakeLedger,
      getStore: async () => ({ saveVersion: vi.fn() }) as unknown as Pick<ArtifactStore, 'saveVersion'>,
      loadSkill: async () => 'SKILL TEXT',
      authorAndValidateFn,
      renderChartsPrecheckFn: async () => ({ ok: true }),
      renderArtifactFileFn,
      storeArtifactFileFn,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: baseInput });

    // Mastra's own run status ('success' | 'failed' | 'suspended' | ...) is distinct
    // from this workflow's own `{ status: 'completed', artifact }` result shape (see
    // artifact.ts's module doc comment): a successful run reports `result.status ===
    // 'success'`, and `result.result` is this workflow's declared output.
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result).toEqual({ status: 'completed', artifact: savedArtifact });
    }
    expect(authorAndValidateFn).toHaveBeenCalledTimes(1);
    expect(renderArtifactFileFn).toHaveBeenCalledTimes(1);
    expect(storeArtifactFileFn).toHaveBeenCalledTimes(1);
  });

  it('suspends rather than completing when authorAndValidate fails (forced two-attempt validation failure), and never renders or stores anything', async () => {
    const renderArtifactFileFn = vi.fn();
    const storeArtifactFileFn = vi.fn();
    const authorAndValidateFn = vi.fn().mockResolvedValue({
      ok: false,
      errors: ['plan.title: too vague', 'Evidence id E9 does not exist'],
      lastPlan: { title: 'bad plan' },
    });

    const workflow = buildArtifactWorkflow({
      getLedger: async () => fakeLedger,
      getStore: async () => ({ saveVersion: vi.fn() }) as unknown as Pick<ArtifactStore, 'saveVersion'>,
      loadSkill: async () => 'SKILL TEXT',
      authorAndValidateFn,
      renderChartsPrecheckFn: async () => ({ ok: true }),
      renderArtifactFileFn,
      storeArtifactFileFn,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: baseInput });

    expect(result.status).toBe('suspended');
    if (result.status === 'suspended') {
      // Mastra namespaces a run's suspendPayload by the id of the step that suspended
      // (confirmed empirically here, not assumed): { <stepId>: <the object passed to
      // suspend()> }.
      expect(result.suspendPayload).toEqual({
        authorAndValidate: {
          errors: ['plan.title: too vague', 'Evidence id E9 does not exist'],
          lastPlan: { title: 'bad plan' },
        },
      });
      expect(result.suspended).toEqual([['authorAndValidate']]);
    }

    // No file was rendered and no artifact was ever saved for this run.
    expect(renderArtifactFileFn).not.toHaveBeenCalled();
    expect(storeArtifactFileFn).not.toHaveBeenCalled();
  });

  it('a revision run (revisionOf set) produces version 2 under the same artifact id', async () => {
    const revisedArtifact = fakeArtifact({ id: 'art_1', version: 2 });
    const storeArtifactFileFn = vi.fn().mockResolvedValue(revisedArtifact);

    const workflow = buildArtifactWorkflow({
      getLedger: async () => fakeLedger,
      getStore: async () => ({ saveVersion: vi.fn() }) as unknown as Pick<ArtifactStore, 'saveVersion'>,
      loadSkill: async () => 'SKILL TEXT',
      authorAndValidateFn: async () => ({ ok: true, plan: { title: 'Revised plan' } }),
      renderChartsPrecheckFn: async () => ({ ok: true }),
      renderArtifactFileFn: async () => ({ buffer: Buffer.from('docx bytes') }),
      storeArtifactFileFn,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { ...baseInput, revisionOf: 'art_1' } });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect((result.result as { artifact: Artifact }).artifact.version).toBe(2);
      expect((result.result as { artifact: Artifact }).artifact.id).toBe('art_1');
    }

    const storeCallArgs = storeArtifactFileFn.mock.calls[0]![0] as { revisionOf?: string };
    expect(storeCallArgs.revisionOf).toBe('art_1');
  });

  it('resolves deck/workbook format server-side rather than trusting an unresolved request (graph wiring for resolveKind)', async () => {
    const renderArtifactFileFn = vi.fn().mockResolvedValue({ buffer: Buffer.from('pptx bytes') });
    const storeArtifactFileFn = vi.fn().mockResolvedValue(fakeArtifact({ kind: 'pptx', skillUsed: 'client-presentation' }));

    const workflow = buildArtifactWorkflow({
      getLedger: async () => fakeLedger,
      getStore: async () => ({ saveVersion: vi.fn() }) as unknown as Pick<ArtifactStore, 'saveVersion'>,
      loadSkill: async () => 'SKILL TEXT',
      authorAndValidateFn: async () => ({ ok: true, plan: { title: 'Deck plan' } }),
      renderChartsPrecheckFn: async () => ({ ok: true }),
      renderArtifactFileFn,
      storeArtifactFileFn,
    });

    const run = await workflow.createRun();
    await run.start({ inputData: { ...baseInput, planKind: 'deck' as const, title: 'Client Deck' } });

    const renderCallArgs = renderArtifactFileFn.mock.calls[0]![0] as { format: string };
    expect(renderCallArgs.format).toBe('pptx');
  });
});
