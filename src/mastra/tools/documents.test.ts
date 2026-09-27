import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSourceRegistry } from '@/modules/sources/registry';
import type { Passage } from '@/modules/documents';
import type { Evidence, Source } from '@/types';

// A stubbed runtime, not the shared one: the source registry and document store are
// shared by every conversation, so these tests build their own two-source registry
// (one source per "conversation") and check that a scoped call only ever sees its own.
function docSource(id: string, name: string): Source {
  return {
    id,
    name,
    kind: 'pdf',
    origin: 'upload',
    status: 'ready',
    summary: '',
    addedAt: '2026-09-27T00:00:00.000Z',
    doc: { mode: 'full', tokenCount: 100, pageCount: 1, markdownPath: `data/documents/${id}.md` },
  };
}

vi.mock('../runtime', () => ({
  getRuntime: async () => {
    const registry = createSourceRegistry();
    registry.addSource(docSource('src_1', 'brief.pdf'));
    registry.addSource(docSource('src_215', 'brief.pdf'));
    const ledger = {
      addEvidence: async (entry: Omit<Evidence, 'id' | 'confidence' | 'createdAt'>) => ({
        ...entry,
        id: 'E1',
        confidence: 'high',
        createdAt: '2026-09-27T00:00:00.000Z',
      }),
    };
    return { registry, ledger };
  },
}));

const searchMock = vi.fn();
vi.mock('@/modules/documents', async () => {
  const actual = await vi.importActual<typeof import('@/modules/documents')>('@/modules/documents');
  return {
    ...actual,
    search: (...args: unknown[]) => searchMock(...args),
    getDocument: async (sourceId: string) => ({ ok: true, data: `# ${sourceId}` }),
  };
});

const { getDocumentTool, listDocumentsTool, recordEvidenceTool, searchDocumentsTool } = await import('./documents');

/** The second execute argument a delegated call carries: the task's source ids on the RequestContext. */
const scopedTo = (ids: string[]) => ({ requestContext: { get: (k: string) => (k === 'sourceIds' ? ids : undefined) } }) as never;
const unscoped = {} as never;

// execute!()'s declared return also admits a validation error, so the ok branch is narrowed here.
const dataOf = <T>(result: unknown) => (result as { ok: true; data: T }).data;
const messageOf = (result: unknown) => (result as { ok: false; error: { message: string } }).error.message;

function passage(sourceId: string, text: string): Passage {
  return { text, score: 0.9, sourceId, sourceName: 'brief.pdf', sourceType: 'pdf', chunkIndex: 0, retrievedAt: '2026-09-27T00:00:00.000Z' };
}

const evidenceInput = {
  claim: 'Acme targets mid-market SaaS teams',
  sourceName: 'brief.pdf',
  locator: 'page 1, Positioning',
  retrieved: false,
};

beforeEach(() => {
  searchMock.mockReset();
});

describe('list_documents', () => {
  it('lists only the sources in scope', async () => {
    const result = await listDocumentsTool.execute!({}, scopedTo(['src_1']));

    expect(result).toMatchObject({ ok: true });
    expect(dataOf<{ documents: { sourceId: string }[] }>(result).documents.map((d) => d.sourceId)).toEqual(['src_1']);
  });

  it('lists every source when unscoped', async () => {
    const result = await listDocumentsTool.execute!({}, unscoped);

    expect(result).toMatchObject({ ok: true });
    expect(dataOf<{ documents: { sourceId: string }[] }>(result).documents.map((d) => d.sourceId)).toEqual(['src_1', 'src_215']);
  });
});

describe('get_document', () => {
  it('refuses another conversation\'s source as not one of this conversation\'s sources', async () => {
    const result = await getDocumentTool.execute!({ sourceId: 'src_215' }, scopedTo(['src_1']));

    expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_NOT_FOUND', recoverable: false } });
    expect(messageOf(result)).toContain("not one of this conversation's sources");
  });

  it('reads an in-scope source, and any source when unscoped', async () => {
    const scoped = await getDocumentTool.execute!({ sourceId: 'src_1' }, scopedTo(['src_1']));
    const open = await getDocumentTool.execute!({ sourceId: 'src_215' }, unscoped);

    expect(scoped).toMatchObject({ ok: true, data: { sourceId: 'src_1', markdown: '# src_1' } });
    expect(open).toMatchObject({ ok: true, data: { sourceId: 'src_215' } });
  });
});

describe('search_documents', () => {
  it('filters the query to the scope and drops any passage from outside it', async () => {
    searchMock.mockResolvedValue({ ok: true, data: [passage('src_1', 'ours'), passage('src_215', 'theirs')] });
    const result = await searchDocumentsTool.execute!({ query: 'positioning' }, scopedTo(['src_1']));

    expect(searchMock).toHaveBeenCalledWith('positioning', { sourceIds: ['src_1'] });
    expect(result).toMatchObject({ ok: true });
    expect(dataOf<{ passages: Passage[] }>(result).passages.map((p) => p.text)).toEqual(['ours']);
  });

  it('refuses an explicit sourceId outside the scope without searching', async () => {
    const result = await searchDocumentsTool.execute!({ query: 'positioning', sourceId: 'src_215' }, scopedTo(['src_1']));

    expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_NOT_FOUND', recoverable: false } });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('passes an in-scope sourceId through alongside the scope', async () => {
    searchMock.mockResolvedValue({ ok: true, data: [] });
    await searchDocumentsTool.execute!({ query: 'positioning', sourceId: 'src_1' }, scopedTo(['src_1']));

    expect(searchMock).toHaveBeenCalledWith('positioning', { sourceId: 'src_1', sourceIds: ['src_1'] });
  });

  it('searches every source when unscoped', async () => {
    searchMock.mockResolvedValue({ ok: true, data: [passage('src_1', 'ours'), passage('src_215', 'theirs')] });
    const result = await searchDocumentsTool.execute!({ query: 'positioning' }, unscoped);

    expect(searchMock).toHaveBeenCalledWith('positioning', {});
    expect(result).toMatchObject({ ok: true });
    expect(dataOf<{ passages: Passage[] }>(result).passages).toHaveLength(2);
  });
});

describe('record_evidence (documents)', () => {
  it('refuses a sourceId outside the scope, recoverably', async () => {
    const result = await recordEvidenceTool.execute!({ ...evidenceInput, sourceId: 'src_215' }, scopedTo(['src_1']));

    expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_NOT_FOUND', recoverable: true } });
  });

  it('records an in-scope source, and any source when unscoped', async () => {
    const scoped = await recordEvidenceTool.execute!({ ...evidenceInput, sourceId: 'src_1' }, scopedTo(['src_1']));
    const open = await recordEvidenceTool.execute!({ ...evidenceInput, sourceId: 'src_215' }, unscoped);

    expect(scoped).toMatchObject({ ok: true, data: { evidence: { sourceId: 'src_1' } } });
    expect(open).toMatchObject({ ok: true, data: { evidence: { sourceId: 'src_215' } } });
  });

  it('refuses a metric key with no numeric value, since it could never be compared', async () => {
    const result = await recordEvidenceTool.execute!(
      {
        claim: 'Growth team says Paid Social is the strongest performing channel',
        sourceId: 'src_notes',
        sourceName: 'customer-notes.docx',
        locator: 'Jan 28',
        value: 'strongest performing channel',
        metric: { name: 'conversion_rate_rank', scope: 'channel=paid_social', unit: 'count' },
        retrieved: false,
      },
      {} as never,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED', recoverable: true } });
  });

  it('accepts a keyed figure passed as a digit string and stores it as a number', async () => {
    const result = await recordEvidenceTool.execute!(
      {
        claim: 'Growth team says Paid Social is the strongest performing channel',
        sourceId: 'src_notes',
        sourceName: 'customer-notes.docx',
        locator: 'Jan 28',
        value: '1',
        metric: { name: 'conversion_rate_rank', scope: 'channel=paid_social', unit: 'count' },
        retrieved: false,
      },
      {} as never,
    );

    expect(result).toMatchObject({ ok: true, data: { evidence: { value: 1 } } });
  });
});
