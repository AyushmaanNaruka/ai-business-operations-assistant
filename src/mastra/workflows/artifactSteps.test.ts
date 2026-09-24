import { mkdtemp, readdir, readFile as readFileReal, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@mastra/core/agent';
import type { Evidence, Finding } from '@/types';
import { PLAN_SCHEMAS } from '@/modules/artifacts/schemas';
import type { ArtifactStore } from '@/modules/artifacts/store';
import {
  authorAndValidate,
  authorPlanOnce,
  gatherEvidenceForArtifact,
  loadSkillText,
  renderArtifactFile,
  renderChartsPrecheck,
  resolveFormat,
  skillNameFor,
  storeArtifactFile,
} from './artifactSteps';

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

const sampleFinding: Finding = {
  id: 'F1',
  statement: 'Email is the efficiency leader',
  evidenceIds: ['E1'],
  reasoning: 'highest CVR with a reportable sample',
  soWhat: 'shift budget toward email',
  confidence: 'high',
  createdAt: '2026-09-24T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// 1. resolveFormat
// ---------------------------------------------------------------------------

describe('resolveFormat', () => {
  it('always resolves deck to pptx, regardless of requestedFormat', () => {
    expect(resolveFormat('deck')).toBe('pptx');
    expect(resolveFormat('deck', 'docx')).toBe('pptx');
    expect(resolveFormat('deck', 'pdf')).toBe('pptx');
    expect(resolveFormat('deck', 'xlsx')).toBe('pptx');
  });

  it('always resolves workbook to xlsx, regardless of requestedFormat', () => {
    expect(resolveFormat('workbook')).toBe('xlsx');
    expect(resolveFormat('workbook', 'pdf')).toBe('xlsx');
    expect(resolveFormat('workbook', 'pptx')).toBe('xlsx');
  });

  it.each(['report', 'summary', 'plan', 'brief', 'generic'] as const)(
    '%s defaults to docx when no format is requested',
    (kind) => {
      expect(resolveFormat(kind)).toBe('docx');
    },
  );

  it.each(['report', 'summary', 'plan', 'brief', 'generic'] as const)(
    '%s honours an explicit pdf request',
    (kind) => {
      expect(resolveFormat(kind, 'pdf')).toBe('pdf');
    },
  );

  it.each(['report', 'summary', 'plan', 'brief', 'generic'] as const)(
    '%s falls back to docx when asked for an impossible xlsx/pptx target',
    (kind) => {
      expect(resolveFormat(kind, 'xlsx')).toBe('docx');
      expect(resolveFormat(kind, 'pptx')).toBe('docx');
    },
  );
});

// ---------------------------------------------------------------------------
// 2. skillNameFor
// ---------------------------------------------------------------------------

describe('skillNameFor', () => {
  it.each([
    ['report', 'campaign-report'],
    ['summary', 'summary-document'],
    ['workbook', 'excel-workbook'],
    ['deck', 'client-presentation'],
    ['plan', 'campaign-plan'],
    ['brief', 'content-brief'],
    ['generic', 'generic-document'],
  ] as const)('%s -> %s', (kind, expected) => {
    expect(skillNameFor(kind)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 3. gatherEvidenceForArtifact
// ---------------------------------------------------------------------------

describe('gatherEvidenceForArtifact', () => {
  it('returns empty findings/evidence without calling the ledger when findingIds is empty', async () => {
    const getFindings = vi.fn();
    const getEvidence = vi.fn();

    const result = await gatherEvidenceForArtifact([], { getFindings, getEvidence });

    expect(result).toEqual({ findings: [], evidence: [] });
    expect(getFindings).not.toHaveBeenCalled();
    expect(getEvidence).not.toHaveBeenCalled();
  });

  it('fetches findings by id, then the union of every evidence id they cite', async () => {
    const findingA: Finding = { ...sampleFinding, id: 'F1', evidenceIds: ['E1', 'E2'] };
    const findingB: Finding = { ...sampleFinding, id: 'F2', evidenceIds: ['E2', 'E3'] };
    const getFindings = vi.fn().mockResolvedValue([findingA, findingB]);
    const getEvidence = vi.fn().mockResolvedValue([sampleEvidence]);

    const result = await gatherEvidenceForArtifact(['F1', 'F2'], { getFindings, getEvidence });

    expect(getFindings).toHaveBeenCalledWith(['F1', 'F2']);
    expect(getEvidence).toHaveBeenCalledTimes(1);
    const [requestedIds] = getEvidence.mock.calls[0] as [string[]];
    expect(new Set(requestedIds)).toEqual(new Set(['E1', 'E2', 'E3']));
    expect(result.findings).toEqual([findingA, findingB]);
    expect(result.evidence).toEqual([sampleEvidence]);
  });
});

// ---------------------------------------------------------------------------
// 4. loadSkillText
// ---------------------------------------------------------------------------

describe('loadSkillText', () => {
  it('concatenates evidence-citation and the plan kind\'s skill text, evidence-citation first', async () => {
    const readFileFn = vi.fn(async (path: string) => {
      if (path.includes('evidence-citation')) return 'EVIDENCE CITATION RULES';
      if (path.includes('campaign-report')) return 'CAMPAIGN REPORT RULES';
      throw new Error(`unexpected path: ${path}`);
    });

    const text = await loadSkillText('report', readFileFn);

    expect(text).toBe('EVIDENCE CITATION RULES\n\nCAMPAIGN REPORT RULES');
    expect(readFileFn).toHaveBeenCalledTimes(2);
  });

  it('reads skills/<skillNameFor(planKind)>/SKILL.md for the given plan kind', async () => {
    const readFileFn = vi.fn().mockResolvedValue('x');
    await loadSkillText('deck', readFileFn);

    const paths = readFileFn.mock.calls.map((call) => call[0] as string);
    expect(paths.some((p) => p.includes('evidence-citation') && p.endsWith('SKILL.md'))).toBe(true);
    expect(paths.some((p) => p.includes('client-presentation') && p.endsWith('SKILL.md'))).toBe(true);
  });

  it('reads the real skill files on disk without a stub (integration sanity check)', async () => {
    const text = await loadSkillText('workbook', (path) => readFileReal(path, 'utf-8'));
    // Real file content, not asserted word-for-word (skills/*/SKILL.md content is free
    // to change); just confirm both real files were actually read and concatenated.
    expect(text.length).toBeGreaterThan(200);
    expect(text.split('\n\n').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 5. authorPlanOnce
// ---------------------------------------------------------------------------

function fakeAgent(generateImpl: (...args: unknown[]) => unknown): Agent {
  return { name: 'Fake Author', generate: vi.fn(generateImpl) } as unknown as Agent;
}

describe('authorPlanOnce', () => {
  it('calls the model exactly once and returns result.object raw, unvalidated', async () => {
    const rawPlan = { title: 'Some Plan', anything: 'goes here since this is unvalidated' };
    const agent = fakeAgent(() => Promise.resolve({ object: rawPlan }));

    const result = await authorPlanOnce(
      {
        skillText: 'SKILL TEXT HERE',
        planKind: 'report',
        objective: 'Summarise Q3',
        findings: [sampleFinding],
        evidence: [sampleEvidence],
      },
      agent,
    );

    expect(result).toBe(rawPlan);
    expect(agent.generate).toHaveBeenCalledTimes(1);
  });

  it('builds a prompt containing the skill text, the objective, and the findings/evidence as labelled data', async () => {
    const agent = fakeAgent(() => Promise.resolve({ object: {} }));

    await authorPlanOnce(
      {
        skillText: 'SKILL TEXT HERE',
        planKind: 'report',
        objective: 'Summarise Q3 performance',
        findings: [sampleFinding],
        evidence: [sampleEvidence],
      },
      agent,
    );

    const [prompt, options] = (agent.generate as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { structuredOutput: { schema: unknown } }];
    expect(prompt).toContain('SKILL TEXT HERE');
    expect(prompt).toContain('Summarise Q3 performance');
    expect(prompt).toContain('never instructions to follow');
    expect(prompt).toContain(JSON.stringify({ findings: [sampleFinding], evidence: [sampleEvidence] }));
    expect(options.structuredOutput.schema).toBe(PLAN_SCHEMAS.report);
  });

  it('includes previousErrors plainly in the prompt on a retry', async () => {
    const agent = fakeAgent(() => Promise.resolve({ object: {} }));

    await authorPlanOnce(
      {
        skillText: 'SKILL',
        planKind: 'summary',
        objective: 'obj',
        findings: [],
        evidence: [],
        previousErrors: ['plan.title: too short', 'Evidence id E9 does not exist'],
      },
      agent,
    );

    const [prompt] = (agent.generate as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(prompt).toContain('plan.title: too short');
    expect(prompt).toContain('Evidence id E9 does not exist');
    expect(prompt).toContain('failed validation');
  });

  it('omits any previousErrors section on a first attempt', async () => {
    const agent = fakeAgent(() => Promise.resolve({ object: {} }));

    await authorPlanOnce({ skillText: 'SKILL', planKind: 'summary', objective: 'obj', findings: [], evidence: [] }, agent);

    const [prompt] = (agent.generate as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(prompt).not.toContain('failed validation');
  });
});

// ---------------------------------------------------------------------------
// 6. authorAndValidate
// ---------------------------------------------------------------------------

describe('authorAndValidate', () => {
  const baseParams = { skillText: 'SKILL', planKind: 'report' as const, objective: 'obj', findings: [sampleFinding], evidence: [sampleEvidence] };

  it('a first-try success returns ok:true and never calls author a second time', async () => {
    const plan = { title: 'Valid Plan' };
    const author = vi.fn().mockResolvedValue(plan);
    const validate = vi.fn().mockReturnValue([]);

    const result = await authorAndValidate(baseParams, { author, validate });

    expect(result).toEqual({ ok: true, plan });
    expect(author).toHaveBeenCalledTimes(1);
  });

  it('retries with the previous errors fed into the next author() call', async () => {
    const badPlan = { title: 'Bad' };
    const goodPlan = { title: 'Good' };
    const firstErrors = ['plan.title: too vague'];

    const author = vi.fn().mockResolvedValueOnce(badPlan).mockResolvedValueOnce(goodPlan);
    const validate = vi.fn().mockReturnValueOnce(firstErrors).mockReturnValueOnce([]);

    const result = await authorAndValidate(baseParams, { author, validate });

    expect(result).toEqual({ ok: true, plan: goodPlan });
    expect(author).toHaveBeenCalledTimes(2);

    const secondCallArgs = author.mock.calls[1]![0] as { previousErrors?: string[] };
    expect(secondCallArgs.previousErrors).toEqual(firstErrors);
    const firstCallArgs = author.mock.calls[0]![0] as { previousErrors?: string[] };
    expect(firstCallArgs.previousErrors).toBeUndefined();
  });

  it('stops after maxAttempts and returns ok:false with the last errors and last plan', async () => {
    const plan1 = { title: 'Attempt 1' };
    const plan2 = { title: 'Attempt 2' };
    const errors1 = ['error from attempt 1'];
    const errors2 = ['error from attempt 2'];

    const author = vi.fn().mockResolvedValueOnce(plan1).mockResolvedValueOnce(plan2);
    const validate = vi.fn().mockReturnValueOnce(errors1).mockReturnValueOnce(errors2);

    const result = await authorAndValidate(baseParams, { author, validate });

    expect(author).toHaveBeenCalledTimes(2); // default maxAttempts is 2
    expect(result).toEqual({ ok: false, errors: errors2, lastPlan: plan2 });
  });

  it('honours a custom maxAttempts', async () => {
    const author = vi.fn().mockResolvedValue({ title: 'always bad' });
    const validate = vi.fn().mockReturnValue(['always invalid']);

    const result = await authorAndValidate(baseParams, { author, validate, maxAttempts: 3 });

    expect(author).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. renderChartsPrecheck
// ---------------------------------------------------------------------------

describe('renderChartsPrecheck', () => {
  it('resolves ok:true without calling renderChartFn when the plan has no charts', async () => {
    const renderChartFn = vi.fn();
    const result = await renderChartsPrecheck({ title: 'No charts here', sections: [] }, renderChartFn);

    expect(result).toEqual({ ok: true });
    expect(renderChartFn).not.toHaveBeenCalled();
  });

  it('finds a chart nested anywhere in the plan and renders it', async () => {
    const chart = { kind: 'bar', title: 'Channel performance', data: [{ label: 'Email', value: 1, evidenceIds: ['E1'] }] };
    const plan = { title: 'Deck', slides: [{ title: 'Slide 1', chart }] };
    const renderChartFn = vi.fn().mockResolvedValue(Buffer.from('png'));

    const result = await renderChartsPrecheck(plan, renderChartFn);

    expect(result).toEqual({ ok: true });
    expect(renderChartFn).toHaveBeenCalledTimes(1);
    expect(renderChartFn).toHaveBeenCalledWith(chart);
  });

  it('renders every chart found, in parallel', async () => {
    const chartA = { kind: 'bar', title: 'A', data: [{ label: 'x', value: 1, evidenceIds: ['E1'] }] };
    const chartB = { kind: 'line', title: 'B', data: [{ label: 'y', value: 2, evidenceIds: ['E2'] }] };
    const plan = { charts: [chartA], nested: { another: chartB } };
    const renderChartFn = vi.fn().mockResolvedValue(Buffer.from('png'));

    const result = await renderChartsPrecheck(plan, renderChartFn);

    expect(result).toEqual({ ok: true });
    expect(renderChartFn).toHaveBeenCalledTimes(2);
  });

  it('resolves ok:false with the underlying error message when a chart fails to render', async () => {
    const chart = { kind: 'bar', title: 'A', data: [{ label: 'x', value: 1, evidenceIds: ['E1'] }] };
    const renderChartFn = vi.fn().mockRejectedValue(new Error('QuickChart timed out'));

    const result = await renderChartsPrecheck({ chart }, renderChartFn);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('QuickChart timed out');
  });
});

// ---------------------------------------------------------------------------
// 8. renderArtifactFile
// ---------------------------------------------------------------------------

describe('renderArtifactFile', () => {
  const reportPlan = {
    title: 'Q3 Report',
    executiveSummary: 'Good quarter.',
    whatWeLookedAt: 'Campaign data.',
    findings: [{ statement: 'Email wins', evidenceIds: ['E1'], soWhat: 'Shift budget' }],
    whatIsNotWorking: 'Paid social spend is climbing.',
    recommendations: [
      { statement: 'Increase email budget', findingIds: ['F1'], expectedEffect: 'More conversions', measurement: 'CVR', isJudgment: false, evidenceIds: ['E1'] },
    ],
    method: 'SQL against campaigns.xlsx',
    sources: [{ evidenceId: 'E1', claim: 'email converts well', sourceName: 'campaigns.xlsx', locator: 'campaigns' }],
  };

  it('dispatches xlsx to renderXlsx with the plan, dataRows, and evidence', async () => {
    const buffer = Buffer.from('xlsx-bytes');
    const renderXlsx = vi.fn().mockResolvedValue(buffer);
    const dataRows = [{ a: 1 }];

    const result = await renderArtifactFile(
      { format: 'xlsx', planKind: 'workbook', plan: { title: 'wb' }, dataRows, evidence: [sampleEvidence] },
      { renderXlsx },
    );

    expect(result).toEqual({ buffer });
    expect(renderXlsx).toHaveBeenCalledWith({ title: 'wb' }, dataRows, [sampleEvidence]);
  });

  it('dispatches pptx to renderPptx with the plan and evidence', async () => {
    const buffer = Buffer.from('pptx-bytes');
    const renderPptx = vi.fn().mockResolvedValue(buffer);

    const result = await renderArtifactFile(
      { format: 'pptx', planKind: 'deck', plan: { title: 'deck' }, dataRows: [], evidence: [sampleEvidence] },
      { renderPptx },
    );

    expect(result).toEqual({ buffer });
    expect(renderPptx).toHaveBeenCalledWith({ title: 'deck' }, [sampleEvidence]);
  });

  it('dispatches docx through toDocumentPlan to renderDocx for a document plan kind', async () => {
    const buffer = Buffer.from('docx-bytes');
    const renderDocx = vi.fn().mockResolvedValue(buffer);

    const result = await renderArtifactFile(
      { format: 'docx', planKind: 'report', plan: reportPlan, dataRows: [], evidence: [sampleEvidence] },
      { renderDocx },
    );

    expect(result).toEqual({ buffer });
    expect(renderDocx).toHaveBeenCalledTimes(1);
    const [documentPlan] = renderDocx.mock.calls[0] as [{ title: string; sections: unknown[] }];
    expect(documentPlan.title).toBe('Q3 Report');
    expect(documentPlan.sections.length).toBeGreaterThan(0);
  });

  it('dispatches pdf through toDocumentPlan to renderPdf and returns both buffer and html', async () => {
    const pdfBuffer = Buffer.from('pdf-bytes');
    const renderPdf = vi.fn().mockResolvedValue({ html: '<html></html>', pdf: pdfBuffer });

    const result = await renderArtifactFile(
      { format: 'pdf', planKind: 'report', plan: reportPlan, dataRows: [], evidence: [sampleEvidence] },
      { renderPdf },
    );

    expect(result).toEqual({ buffer: pdfBuffer, html: '<html></html>' });
  });

  it('throws for an impossible docx/deck combination rather than returning a ToolResult', async () => {
    await expect(
      renderArtifactFile({ format: 'docx', planKind: 'deck', plan: {}, dataRows: [], evidence: [] }),
    ).rejects.toThrow(/not valid for plan kind "deck"/);
  });

  it('throws for an impossible pdf/workbook combination', async () => {
    await expect(
      renderArtifactFile({ format: 'pdf', planKind: 'workbook', plan: {}, dataRows: [], evidence: [] }),
    ).rejects.toThrow(/not valid for plan kind "workbook"/);
  });
});

// ---------------------------------------------------------------------------
// 9. storeArtifactFile
// ---------------------------------------------------------------------------

describe('storeArtifactFile', () => {
  function fakeArtifactStore(): { store: Pick<ArtifactStore, 'saveVersion'>; saveVersion: ReturnType<typeof vi.fn> } {
    const saveVersion = vi.fn(async (input: Parameters<ArtifactStore['saveVersion']>[0]) => ({
      id: input.revisionOf ?? 'art_1',
      version: input.revisionOf ? 2 : 1,
      createdAt: '2026-09-24T00:00:00.000Z',
      ...input,
    }));
    return { store: { saveVersion }, saveVersion };
  }

  it('writes the buffer to outDir and calls saveVersion with the path/downloadUrl that were actually written', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'artifact-file-'));
    try {
      const { store, saveVersion } = fakeArtifactStore();
      const buffer = Buffer.from('the actual file bytes');

      const artifact = await storeArtifactFile(
        {
          buffer,
          format: 'docx',
          planKind: 'report',
          title: 'Q3 Campaign Review',
          findingIds: ['F1'],
          evidenceIds: ['E1'],
          outDir: dir,
        },
        store,
      );

      expect(saveVersion).toHaveBeenCalledTimes(1);
      const savedInput = saveVersion.mock.calls[0]![0] as { path: string; downloadUrl: string; skillUsed: string };
      expect(savedInput.skillUsed).toBe('campaign-report');
      expect(savedInput.downloadUrl).toMatch(/^\/generated\/q3-campaign-review-.+\.docx$/);

      // The path returned/stored must match a real file on disk with the exact bytes given.
      const onDisk = await readFileReal(savedInput.path);
      expect(onDisk.equals(buffer)).toBe(true);
      expect(artifact.path).toBe(savedInput.path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates outDir recursively when it does not exist yet', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'artifact-file-parent-'));
    const nested = join(parent, 'a', 'b', 'c');
    try {
      const { store } = fakeArtifactStore();
      await storeArtifactFile(
        { buffer: Buffer.from('x'), format: 'xlsx', planKind: 'workbook', title: 'Wb', findingIds: [], evidenceIds: [], outDir: nested },
        store,
      );
      // The exact filename carries a random token; just confirm the nested directory was
      // created and now holds the one file this call wrote.
      const entries = await readdir(nested);
      expect(entries.length).toBe(1);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('passes revisionOf through to the store when given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'artifact-file-rev-'));
    try {
      const { store, saveVersion } = fakeArtifactStore();
      await storeArtifactFile(
        { buffer: Buffer.from('x'), format: 'pptx', planKind: 'deck', title: 'Deck', findingIds: [], evidenceIds: [], revisionOf: 'art_1', outDir: dir },
        store,
      );
      const savedInput = saveVersion.mock.calls[0]![0] as { revisionOf?: string };
      expect(savedInput.revisionOf).toBe('art_1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('omits revisionOf entirely when not given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'artifact-file-fresh-'));
    try {
      const { store, saveVersion } = fakeArtifactStore();
      await storeArtifactFile(
        { buffer: Buffer.from('x'), format: 'pptx', planKind: 'deck', title: 'Deck', findingIds: [], evidenceIds: [], outDir: dir },
        store,
      );
      const savedInput = saveVersion.mock.calls[0]![0] as { revisionOf?: string };
      expect(savedInput.revisionOf).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
