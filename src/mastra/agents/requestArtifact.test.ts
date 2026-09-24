import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '@/types';
import { emptyManifest } from '@/modules/session';

/**
 * Focused tests for `requestArtifactTool` (P6.7), kept separate from
 * `orchestrator.test.ts`'s existing 56 pure-function tests so this file's module
 * mocks (below) never risk touching that file's module graph. Every dependency this
 * tool actually reaches out to — the manifest store and the artifact workflow — is
 * mocked; no live model, network, or database is touched anywhere in this file, the
 * same discipline `artifact.test.ts` and `artifact.workflow`'s own tests already use.
 *
 * `vi.hoisted` is required here (not just plain top-level `const`s) because
 * `vi.mock` calls are hoisted above the rest of the file by Vitest's transform: a
 * factory that closed over an un-hoisted `const` would run before that `const` was
 * initialised.
 */

const { fakeStore, createRun } = vi.hoisted(() => ({
  fakeStore: {
    loadManifest: vi.fn(),
    saveManifest: vi.fn(),
  },
  createRun: vi.fn(),
}));

vi.mock('../session/manifestStore', () => ({
  openManifestStore: vi.fn(async () => fakeStore),
}));

vi.mock('../workflows/artifact', () => ({
  artifactWorkflow: { createRun },
}));

// Imported after the mocks above so orchestrator.ts's module-level
// `getManifestStore`/`artifactWorkflow` resolve against the fakes, not a live
// LibSQL file or the real workflow.
import { requestArtifactTool } from './orchestrator';

// requestArtifactTool.execute is typed by Mastra's ToolExecuteFunction, which takes a
// second `context` argument this file's own execute closures never use (see
// orchestrator.ts's other tool definitions, e.g. handleRequestTool); casting to a
// narrower single-argument function here mirrors that same one-argument shape rather
// than fabricating an unused context object.
type RequestArtifactInput = {
  objective: string;
  findingIds?: string[];
  artifacts: { kind: string; format?: string; title: string; revisionOf?: string }[];
};
const execute = requestArtifactTool.execute as unknown as (input: RequestArtifactInput) => Promise<any>;

function fakeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art_1',
    version: 1,
    kind: 'docx',
    skillUsed: 'campaign-report',
    title: 'Q3 Campaign Review',
    path: '/tmp/generated/q3.docx',
    downloadUrl: '/generated/q3.docx',
    findingIds: [],
    evidenceIds: [],
    createdAt: '2026-09-24T00:00:00.000Z',
    ...overrides,
  };
}

function successRun(artifact: Artifact) {
  return { start: vi.fn().mockResolvedValue({ status: 'success', result: { status: 'completed', artifact } }) };
}

function suspendedRun(errors: string[]) {
  return {
    start: vi.fn().mockResolvedValue({
      status: 'suspended',
      suspendPayload: { authorAndValidate: { errors, lastPlan: { title: 'bad plan' } } },
      suspended: [['authorAndValidate']],
    }),
  };
}

describe('requestArtifactTool (P6.7)', () => {
  beforeEach(() => {
    fakeStore.loadManifest.mockReset();
    fakeStore.saveManifest.mockReset();
    createRun.mockReset();
    fakeStore.loadManifest.mockResolvedValue(emptyManifest());
    fakeStore.saveManifest.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a completed result with the real downloadUrl when the stubbed workflow run succeeds', async () => {
    const artifact = fakeArtifact({ id: 'art_report', title: 'Q3 Campaign Review', version: 1 });
    createRun.mockResolvedValue(successRun(artifact));

    const result = await execute({
      objective: 'Summarise Q3 campaign performance',
      artifacts: [{ kind: 'report', title: 'Q3 Campaign Review' }],
    });

    expect(result.ok).toBe(true);
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({
      status: 'completed',
      title: artifact.title,
      kind: artifact.kind,
      downloadUrl: artifact.downloadUrl,
      version: artifact.version,
    });
    expect(typeof result.data.results[0].description).toBe('string');
    expect(result.data.results[0].description.length).toBeGreaterThan(0);
  });

  it('runs two artifacts entries genuinely concurrently, both workflow-run stubs invoked, both in results', async () => {
    vi.useFakeTimers();
    const workbookArtifact = fakeArtifact({ id: 'art_wb', title: 'Campaign Workbook', kind: 'xlsx' });
    const deckArtifact = fakeArtifact({ id: 'art_deck', title: 'Client Deck', kind: 'pptx' });

    const startWorkbook = vi.fn(async () => {
      await new Promise((res) => setTimeout(res, 100));
      return { status: 'success', result: { status: 'completed', artifact: workbookArtifact } };
    });
    const startDeck = vi.fn(async () => {
      await new Promise((res) => setTimeout(res, 200));
      return { status: 'success', result: { status: 'completed', artifact: deckArtifact } };
    });

    createRun.mockResolvedValueOnce({ start: startWorkbook }).mockResolvedValueOnce({ start: startDeck });

    let settled = false;
    const resultPromise = execute({
      objective: 'Put the campaign metrics into an Excel file and create a presentation for the client',
      artifacts: [
        { kind: 'workbook', title: 'Campaign Workbook' },
        { kind: 'deck', title: 'Client Deck' },
      ],
    }).then((r) => {
      settled = true;
      return r;
    });

    // Both runs started concurrently: after only the shorter delay, the longer one is
    // still pending, so the whole call cannot have settled yet.
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;
    expect(settled).toBe(true);

    expect(startWorkbook).toHaveBeenCalledTimes(1);
    expect(startDeck).toHaveBeenCalledTimes(1);
    expect(result.data.results.map((r: { title: string }) => r.title).sort()).toEqual(['Campaign Workbook', 'Client Deck']);
    expect(result.data.results.every((r: { status: string }) => r.status === 'completed')).toBe(true);
  });

  it('surfaces a suspended run\'s real errors array, not a generic message', async () => {
    const errors = ['plan.title: too vague', 'Evidence id E9 does not exist'];
    createRun.mockResolvedValue(suspendedRun(errors));

    const result = await execute({
      objective: 'Build something ungrounded',
      artifacts: [{ kind: 'report', title: 'Bad Report' }],
    });

    expect(result.ok).toBe(true);
    expect(result.data.results).toEqual([{ status: 'suspended', title: 'Bad Report', errors }]);
  });

  it('folds a completed artifact into the manifest via addArtifact and saves it', async () => {
    const artifact = fakeArtifact({ id: 'art_folded', title: 'Folded Doc' });
    createRun.mockResolvedValue(successRun(artifact));

    await execute({
      objective: 'Write a doc',
      artifacts: [{ kind: 'generic', title: 'Folded Doc' }],
    });

    expect(fakeStore.saveManifest).toHaveBeenCalledTimes(1);
    const [, savedManifest] = fakeStore.saveManifest.mock.calls[0]!;
    expect(savedManifest.artifacts).toContainEqual(artifact);
  });

  it('one artifact failing does not prevent a second, concurrently requested artifact from completing', async () => {
    const goodArtifact = fakeArtifact({ id: 'art_good', title: 'Good Doc' });
    createRun
      .mockImplementationOnce(async () => {
        throw new Error('workflow crashed unexpectedly');
      })
      .mockImplementationOnce(async () => successRun(goodArtifact));

    const result = await execute({
      objective: 'Two files, one broken',
      artifacts: [
        { kind: 'generic', title: 'Bad Doc' },
        { kind: 'report', title: 'Good Doc' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.data.results).toHaveLength(2);
    expect(result.data.results[0]).toMatchObject({ status: 'failed', title: 'Bad Doc' });
    expect(result.data.results[0].message).toContain('workflow crashed unexpectedly');
    expect(result.data.results[1]).toMatchObject({ status: 'completed', title: 'Good Doc' });

    // The manifest is still saved with the one artifact that did complete.
    const [, savedManifest] = fakeStore.saveManifest.mock.calls[0]!;
    expect(savedManifest.artifacts).toContainEqual(goodArtifact);
  });
});
