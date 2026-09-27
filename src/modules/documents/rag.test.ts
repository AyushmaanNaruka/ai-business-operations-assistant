import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasHeadings, type Passage } from './rag';

describe('hasHeadings', () => {
  it('is true for markdown with at least one heading line', () => {
    expect(hasHeadings('## Positioning\n\nAcme targets mid-market SaaS teams.')).toBe(true);
    expect(hasHeadings('Intro\n\n# Title\n\nBody text.')).toBe(true);
  });

  it('is false for prose with no heading line', () => {
    expect(hasHeadings('Just a paragraph of plain text, no markdown headings at all.')).toBe(false);
    expect(hasHeadings('')).toBe(false);
  });

  it('does not mistake a "#" mid-sentence (not at line start) for a heading', () => {
    expect(hasHeadings('The ticket is #42 and needs attention.')).toBe(false);
  });

  it('is not confused by our own citation markers, which never start a line with "#"', () => {
    expect(hasHeadings('<!-- source: brief.pdf | page: 1 -->\n\nJust prose, no headings.')).toBe(false);
  });
});

describe('index()', () => {
  const upsertMock = vi.fn();
  const createIndexMock = vi.fn();
  const embedManyMock = vi.fn();

  beforeEach(() => {
    upsertMock.mockReset().mockResolvedValue(['ok']);
    createIndexMock.mockReset().mockResolvedValue(undefined);
    embedManyMock.mockReset().mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => [0.1, 0.2, 0.3]),
    }));

    vi.doMock('@mastra/libsql', async () => {
      const actual = await vi.importActual<typeof import('@mastra/libsql')>('@mastra/libsql');
      return {
        ...actual,
        LibSQLVector: vi.fn().mockImplementation(function LibSQLVectorMock() {
          return { createIndex: createIndexMock, upsert: upsertMock };
        }),
      };
    });
    vi.doMock('ai', () => ({ embedMany: embedManyMock }));
    // ModelRouterEmbeddingModel's constructor resolves a provider client and
    // validates its API key eagerly, before embedMany (mocked above) ever
    // runs, so this module has to be mocked too: without it, `new
    // ModelRouterEmbeddingModel(EMBEDDING_MODEL_ID)` (rag.ts's `model:`
    // argument) throws on a machine with no provider key set, and every test
    // in this file fails with a real "API key not found" error instead of
    // exercising rag.ts's own chunking and metadata logic.
    vi.doMock('@mastra/core/llm', async () => {
      const actual = await vi.importActual<typeof import('@mastra/core/llm')>('@mastra/core/llm');
      return { ...actual, ModelRouterEmbeddingModel: vi.fn().mockImplementation(function ModelRouterEmbeddingModelMock() {}) };
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@mastra/libsql');
    vi.doUnmock('ai');
    vi.doUnmock('@mastra/core/llm');
    vi.resetModules();
  });

  it('fails with PARSE_FAILED for empty markdown, without calling embedMany (rule 5: never throw)', async () => {
    const { index } = await import('./rag');
    const result = await index('src_empty', '   \n  ', { sourceName: 'empty.txt', sourceType: 'txt' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PARSE_FAILED');
    expect(embedManyMock).not.toHaveBeenCalled();
  });

  it('fails with NETWORK, not a throw, when embedMany rejects', async () => {
    embedManyMock.mockRejectedValue(new Error('quota exceeded'));
    const { index } = await import('./rag');
    const result = await index('src_1', 'Some plain prose with no headings at all, long enough to chunk.', {
      sourceName: 'brief.txt',
      sourceType: 'txt',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NETWORK');
  });

  it('fails with NETWORK, not a throw, when the vector store upsert rejects', async () => {
    upsertMock.mockRejectedValue(new Error('database locked'));
    const { index } = await import('./rag');
    const result = await index('src_1', 'Some plain prose with no headings at all, long enough to chunk.', {
      sourceName: 'brief.txt',
      sourceType: 'txt',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NETWORK');
  });

  it('chunks a heading-less document with the recursive fallback (maxSize 512, overlap 50) and attaches every required metadata field', async () => {
    const page1 = 'Acme targets mid-market SaaS teams in North America. '.repeat(20);
    const page2 = 'Self-Serve is priced per tracked user at nineteen dollars per month. '.repeat(20);
    const markdown = `<!-- source: brief.pdf | page: 1 -->\n\n${page1}\n\n<!-- source: brief.pdf | page: 2 -->\n\n${page2}`;

    expect(hasHeadings(markdown)).toBe(false);

    const { index } = await import('./rag');
    const result = await index('src_pdf', markdown, {
      sourceName: 'brief.pdf',
      sourceType: 'pdf',
      retrievedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(createIndexMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);

    const call = upsertMock.mock.calls[0]![0] as { metadata: Record<string, unknown>[]; ids: string[]; deleteFilter: unknown };
    expect(call.deleteFilter).toEqual({ sourceId: 'src_pdf' });
    expect(call.metadata.length).toBeGreaterThan(1); // long enough to split into more than one chunk

    // recursive with maxSize 512 keeps every chunk close to that bound (small
    // overlap/separator tolerance), unlike semantic-markdown which is not size bound.
    for (const m of call.metadata) {
      expect((m.text as string).length).toBeLessThanOrEqual(600);
      expect(m.sourceId).toBe('src_pdf');
      expect(m.sourceName).toBe('brief.pdf');
      expect(m.sourceType).toBe('pdf');
      expect(m.retrievedAt).toBe('2026-09-01T00:00:00.000Z');
      expect(m.heading).toBeUndefined(); // no heading lines anywhere in this document
    }
    call.metadata.forEach((m, i) => expect(m.chunkIndex).toBe(i));

    // a chunk drawn purely from page 1's text is attributed to page 1, and
    // one drawn purely from page 2's text to page 2 (docs/04-MODULES.md M3:
    // every chunk carries a page number for citation).
    const page1Chunk = call.metadata.find((m) => (m.text as string).includes('Acme') && !(m.text as string).includes('Self-Serve'));
    const page2Chunk = call.metadata.find((m) => (m.text as string).includes('Self-Serve') && !(m.text as string).includes('Acme'));
    expect(page1Chunk?.page).toBe(1);
    expect(page2Chunk?.page).toBe(2);
  });

  it('chunks a document with headings using semantic-markdown, and attaches the heading metadata', async () => {
    const markdown = '<!-- source: notes.docx -->\n\n## Positioning\n\nAcme targets mid-market SaaS teams.';
    expect(hasHeadings(markdown)).toBe(true);

    const { index } = await import('./rag');
    const result = await index('src_docx', markdown, { sourceName: 'notes.docx', sourceType: 'docx' });

    expect(result.ok).toBe(true);
    const call = upsertMock.mock.calls[0]![0] as { metadata: Record<string, unknown>[] };
    expect(call.metadata.length).toBeGreaterThan(0);
    for (const m of call.metadata) {
      expect(m.heading).toBe('Positioning');
      expect(m.sourceType).toBe('docx');
    }
  });

  it('drops empty/whitespace-only chunks rather than embedding blank text', async () => {
    // a single short sentence is very unlikely to split into any empty pieces,
    // but the metadata array must in any case only ever contain non-blank text.
    const { index } = await import('./rag');
    const result = await index('src_short', 'A short sentence.', { sourceName: 'short.txt', sourceType: 'txt' });

    expect(result.ok).toBe(true);
    const call = upsertMock.mock.calls[0]![0] as { metadata: Record<string, unknown>[] };
    for (const m of call.metadata) {
      expect((m.text as string).trim().length).toBeGreaterThan(0);
    }
  });
});

describe('search()', () => {
  const executeMock = vi.fn();
  const rerankMock = vi.fn();

  beforeEach(() => {
    executeMock.mockReset();
    rerankMock.mockReset();

    vi.doMock('@mastra/libsql', async () => {
      const actual = await vi.importActual<typeof import('@mastra/libsql')>('@mastra/libsql');
      return {
        ...actual,
        LibSQLVector: vi.fn().mockImplementation(function LibSQLVectorMock() {
          return {};
        }),
      };
    });
    vi.doMock('@mastra/rag', async () => {
      const actual = await vi.importActual<typeof import('@mastra/rag')>('@mastra/rag');
      return {
        ...actual,
        createVectorQueryTool: vi.fn(() => ({ execute: executeMock })),
        rerankWithScorer: rerankMock,
      };
    });
    // Same reason as the index() block above: getQueryTool() and
    // getRelevanceScorer() build a `new ModelRouterEmbeddingModel(...)` /
    // `new ModelRouterLanguageModel(...)` argument before passing it to the
    // mocked createVectorQueryTool/rerankWithScorer, and that construction
    // throws with no provider key set unless this is mocked too.
    vi.doMock('@mastra/core/llm', async () => {
      const actual = await vi.importActual<typeof import('@mastra/core/llm')>('@mastra/core/llm');
      return {
        ...actual,
        ModelRouterEmbeddingModel: vi.fn().mockImplementation(function ModelRouterEmbeddingModelMock() {}),
        ModelRouterLanguageModel: vi.fn().mockImplementation(function ModelRouterLanguageModelMock() {}),
      };
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@mastra/libsql');
    vi.doUnmock('@mastra/rag');
    vi.doUnmock('@mastra/core/llm');
    vi.resetModules();
  });

  it('returns ok([]) without reranking when the vector store has no matches', async () => {
    executeMock.mockResolvedValue({ sources: [] });
    const { search } = await import('./rag');
    const result = await search('pricing');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it('fails with NETWORK, not a throw, when the vector query tool rejects', async () => {
    executeMock.mockRejectedValue(new Error('embedding API down'));
    const { search } = await import('./rag');
    const result = await search('pricing');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NETWORK');
  });

  it('fails with NETWORK, not a throw, when reranking rejects', async () => {
    executeMock.mockResolvedValue({ sources: [{ id: 'a', score: 0.5, metadata: { text: 'x' } }] });
    rerankMock.mockRejectedValue(new Error('rerank model unavailable'));
    const { search } = await import('./rag');
    const result = await search('pricing');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NETWORK');
  });

  it('maps reranked results into Passages in reranked order, and forwards the sourceId filter as JSON', async () => {
    const chunkA = {
      id: 'src_1::0',
      score: 0.4,
      metadata: {
        text: 'Self-Serve is priced per user.',
        sourceId: 'src_1',
        sourceName: 'brief.pdf',
        sourceType: 'pdf',
        page: 2,
        heading: 'Pricing',
        chunkIndex: 0,
        retrievedAt: '2026-09-01T00:00:00.000Z',
      },
    };
    const chunkB = {
      id: 'src_1::1',
      score: 0.9,
      metadata: {
        text: 'Acme targets mid-market SaaS teams.',
        sourceId: 'src_1',
        sourceName: 'brief.pdf',
        sourceType: 'pdf',
        page: 1,
        heading: 'Positioning',
        chunkIndex: 1,
        retrievedAt: '2026-09-01T00:00:00.000Z',
      },
    };
    executeMock.mockResolvedValue({ sources: [chunkA, chunkB] });
    // reranking flips the order relative to the raw vector-similarity scores above
    rerankMock.mockResolvedValue([
      { result: chunkA, score: 0.95, details: {} },
      { result: chunkB, score: 0.2, details: {} },
    ]);

    const { search } = await import('./rag');
    const result = await search('pricing', { sourceId: 'src_1' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
    const [first, second] = result.data as [Passage, Passage];
    expect(first).toMatchObject({ text: 'Self-Serve is priced per user.', score: 0.95, sourceId: 'src_1', page: 2, heading: 'Pricing' });
    expect(second).toMatchObject({ text: 'Acme targets mid-market SaaS teams.', score: 0.2, page: 1, heading: 'Positioning' });

    const [inputData] = executeMock.mock.calls[0]! as [{ filter: string; topK: number }];
    expect(JSON.parse(inputData.filter)).toEqual({ sourceId: 'src_1' });
    expect(inputData.topK).toBe(10);
  });

  it('queries with an empty filter object when no sourceId is given', async () => {
    executeMock.mockResolvedValue({ sources: [] });
    const { search } = await import('./rag');
    await search('pricing');

    const [inputData] = executeMock.mock.calls[0]! as [{ filter: string }];
    expect(JSON.parse(inputData.filter)).toEqual({});
  });

  it('filters the vector query itself to a set of allowed source ids', async () => {
    executeMock.mockResolvedValue({ sources: [] });
    const { search } = await import('./rag');
    await search('pricing', { sourceIds: ['src_1', 'src_2'] });

    const [inputData] = executeMock.mock.calls[0]! as [{ filter: string; topK: number }];
    expect(JSON.parse(inputData.filter)).toEqual({ sourceId: { $in: ['src_1', 'src_2'] } });
    expect(inputData.topK).toBe(10);
  });

  it('returns ok([]) without querying when the allowed set is empty or excludes the requested source', async () => {
    const { search } = await import('./rag');
    const empty = await search('pricing', { sourceIds: [] });
    const excluded = await search('pricing', { sourceId: 'src_9', sourceIds: ['src_1'] });

    expect(empty).toEqual({ ok: true, data: [] });
    expect(excluded).toEqual({ ok: true, data: [] });
    expect(executeMock).not.toHaveBeenCalled();
  });
});

// Only runs against the real embedding and rerank models when a real API key
// is present (docs/PROMPTBOOK.md P3.4). One document, one index call, one
// search call, to stay well inside the free-tier quota.
describe('index() + search() (live)', () => {
  let hasLiveKeys = false;
  try {
    process.loadEnvFile();
  } catch {
    // no .env file to load; process.env may already carry the keys (CI, shell export)
  }
  hasLiveKeys = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) && Boolean(process.env.GROQ_API_KEY);

  it.skipIf(!hasLiveKeys)(
    'indexes a short synthetic document and finds the right passage back through the real embedding and rerank models',
    async () => {
      const { index, search } = await import('./rag');
      const sourceId = `test_live_rag_${Date.now()}`;
      const markdown = [
        '<!-- source: live-test.txt | page: 1 -->',
        '',
        '## Refund policy',
        'Refunds are issued within fourteen business days of a written cancellation request.',
        '',
        '<!-- source: live-test.txt | page: 2 -->',
        '',
        '## Support hours',
        'Support is available Monday through Friday, nine to five Eastern time.',
      ].join('\n');

      const indexed = await index(sourceId, markdown, { sourceName: 'live-test.txt', sourceType: 'txt' });
      expect(indexed.ok).toBe(true); // real Google embeddings + a real LibSQLVector upsert

      const found = await search('When are refunds issued?', { sourceId });
      // search() must never throw regardless of what the model APIs do
      // (rule 5). This is asserted unconditionally. Whether it *succeeds*
      // additionally depends on MODELS.RERANK's Groq model being reachable
      // with this environment's GROQ_API_KEY, which is outside this
      // module's control, so both outcomes are accepted; a success is
      // checked for the right retrieved content, a failure for the right
      // error code rather than a thrown exception.
      if (found.ok) {
        expect(found.data.length).toBeGreaterThan(0);
        expect(found.data.every((p) => p.sourceId === sourceId)).toBe(true);
        expect(found.data.some((p) => p.text.includes('fourteen business days'))).toBe(true);
      } else {
        expect(found.error.code).toBe('NETWORK');
      }
    },
    30000,
  );
});
