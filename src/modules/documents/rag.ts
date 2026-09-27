import { resolve } from 'node:path';
import { embedMany } from 'ai';
import { MDocument, createVectorQueryTool, rerankWithScorer, MastraAgentRelevanceScorer, type RerankResult } from '@mastra/rag';
import { LibSQLVector } from '@mastra/libsql';
import { ModelRouterEmbeddingModel, ModelRouterLanguageModel } from '@mastra/core/llm';
import { noopObserve } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import type { QueryResult } from '@mastra/core/vector';
import type { SourceKind, ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import { MODELS } from '@/mastra/models';

/**
 * The RAG indexed path (docs/04-MODULES.md M3, docs/03-ARCHITECTURE.md Part
 * 2.5): the exception, not the default. Full context wins for the normal
 * business document; this file only runs once `route()` (route.ts) has
 * already decided a source is too large to hold in context whole. Every
 * exported function still returns `ToolResult<T>` and never throws (rule 5),
 * even though embedding and reranking mean this is the one file in
 * `src/modules/*` that legitimately imports Mastra packages: chunking,
 * embedding and reranking cannot exist without a model, so AGENTS.md's
 * "no Mastra dependency where possible" does not apply to this file.
 */

// The embedding model comes from the EMBEDDER tier (src/mastra/models.ts), so a
// deployment with only an OpenAI key embeds with OpenAI. Vectors from two different
// models live in different spaces with different dimensions, so each model gets its
// own index: the original Gemini model keeps the original index name, so passages
// indexed before this change stay searchable.
const EMBEDDING_MODEL_ID = MODELS.EMBEDDER;
const INDEX_NAME =
  EMBEDDING_MODEL_ID === 'google/gemini-embedding-001'
    ? 'document_passages'
    : `document_passages_${EMBEDDING_MODEL_ID.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
const RERANK_SCORER_NAME = 'document-rerank';

/**
 * A retrieved chunk, reranked and ready to cite. Not specified in
 * docs/05-DATA-MODEL.md, so defined here per docs/PROMPTBOOK.md P3.4.
 * Carries the same metadata fields stored on every chunk at index time, so a
 * `search()` result cites as precisely as the full-context path's inline
 * markers do.
 */
export type Passage = {
  text: string;
  score: number;
  sourceId: string;
  sourceName: string;
  sourceType: SourceKind;
  page?: number;
  heading?: string;
  chunkIndex: number;
  retrievedAt: string;
};

/**
 * The fields `index(sourceId, markdown)` cannot get from its two-argument
 * spec signature but the metadata list in docs/04-MODULES.md M3 requires on
 * every chunk. Kept as one small options object (mirroring `toMarkdown`'s
 * `(path, kind)` pairing style) rather than widening `index`'s own
 * signature with three more positional strings.
 */
export type IndexSourceInfo = {
  sourceName: string;
  sourceType: SourceKind;
  /** ISO timestamp. Defaults to "now" (indexing time) when omitted, matching how `formatWebMarker` treats a page's own fetch time. */
  retrievedAt?: string;
};

/**
 * True when the document has at least one markdown heading line. Drives the
 * chunk strategy choice in `index()`: `semantic-markdown` groups related
 * header families, which only means something when there are headers to
 * group. A flat document (a scraped page, a plain-text dump) falls back to
 * `recursive`. Exported so the selection logic is testable without a model
 * call (docs/PROMPTBOOK.md P3.4).
 */
export function hasHeadings(markdown: string): boolean {
  return /^#{1,6}\s+\S/m.test(markdown);
}

// Our own page marker, emitted by marker.ts's formatPageMarker: `<!-- source: name | page: N -->`.
const PAGE_MARKER_RE = /<!-- source: [^|>]*?\|\s*page:\s*(\d+)\s*-->/g;
// A markdown heading line, used to attribute a chunk to the section it falls under.
const HEADING_RE = /^#{1,6}\s+(.+)$/gm;

type Marker = { index: number; value: string };

function collectMarkers(re: RegExp, text: string): Marker[] {
  const markers: Marker[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    markers.push({ index: m.index, value: m[1]! });
  }
  return markers;
}

/** The last marker at or before `offset`. Markers arrive in ascending index order, so a single forward scan finds it. */
function nearestAtOrBefore(markers: Marker[], offset: number): string | undefined {
  let found: string | undefined;
  for (const marker of markers) {
    if (marker.index > offset) break;
    found = marker.value;
  }
  return found;
}

/**
 * Resolves a chunk's page and heading from the full document, the way
 * docs/03-ARCHITECTURE.md's "keeping citations sharp without chunking"
 * section resolves them for the full-context path, just applied per chunk
 * instead of per sentence. `startCharIdx` (from `addStartIndex: true` in
 * `chunk()`) gives an exact offset into the source markdown; `indexOf` is
 * the fallback for the rare case a transformer does not set it.
 */
function locateChunk(
  markdown: string,
  chunk: { text: string; startCharIdx?: number },
  pageMarkers: Marker[],
  headingMarkers: Marker[],
): { page?: number; heading?: string } {
  const offset = chunk.startCharIdx ?? Math.max(markdown.indexOf(chunk.text), 0);

  const pageValue = nearestAtOrBefore(pageMarkers, offset);
  const page = pageValue !== undefined ? Number(pageValue) : undefined;

  // Prefer a heading that appears inside the chunk's own text: that is the
  // section the chunk is actually about. Only fall back to the nearest
  // preceding heading in the whole document for a continuation chunk that
  // starts mid-section and carries no heading line of its own.
  const withinChunk = collectMarkers(HEADING_RE, chunk.text);
  const heading = withinChunk.length > 0 ? withinChunk[withinChunk.length - 1]!.value : nearestAtOrBefore(headingMarkers, offset);

  return { page, heading };
}

/**
 * Same relative-to-INIT_CWD resolution as src/mastra/index.ts (see
 * docs/DECISIONS.md D-09): `mastra dev` runs with its cwd set to
 * `src/mastra/public`, so a bare relative `file:` URL would silently open
 * (or create) the database in the wrong place. Duplicated here rather than
 * imported from `src/mastra/index.ts`, because that file constructs the
 * whole Mastra instance (agents, observability, the DuckDB store) as a side
 * effect of module load; pulling it into a `src/modules/*` file just to
 * reuse eleven lines of path math would drag the entire app into this
 * module's import graph.
 */
function resolveDatabaseUrl(raw: string): string {
  if (!raw.startsWith('file:')) return raw;
  const projectRoot = process.env.INIT_CWD || process.cwd();
  const filePath = raw.slice('file:'.length);
  const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath);
  return isAbsolute ? raw : `file:${resolve(projectRoot, filePath)}`;
}

// Lazy singletons: constructed on first use so importing this module (e.g. for
// hasHeadings() in a test) never requires a database file or an API key, and
// so tests can vi.doMock() the underlying packages before anything is built.
let cachedVectorStore: LibSQLVector | undefined;
function getVectorStore(): LibSQLVector {
  if (!cachedVectorStore) {
    const url = resolveDatabaseUrl(process.env.DATABASE_URL || 'file:./data/app.db');
    // The same LibSQL file as Mastra memory and the evidence ledger (docs/06-RESEARCH-STACK.md 2.9, D-09): one file, no Docker, no second signup.
    cachedVectorStore = new LibSQLVector({ id: 'documents-vector-store', url });
  }
  return cachedVectorStore;
}

let cachedQueryTool: ReturnType<typeof createVectorQueryTool> | undefined;
function getQueryTool() {
  if (!cachedQueryTool) {
    cachedQueryTool = createVectorQueryTool({
      vectorStore: getVectorStore(),
      indexName: INDEX_NAME,
      model: new ModelRouterEmbeddingModel(EMBEDDING_MODEL_ID),
      enableFilter: true,
    });
  }
  return cachedQueryTool;
}

let cachedScorer: MastraAgentRelevanceScorer | undefined;
function getRelevanceScorer(): MastraAgentRelevanceScorer {
  if (!cachedScorer) {
    cachedScorer = new MastraAgentRelevanceScorer(RERANK_SCORER_NAME, new ModelRouterLanguageModel(MODELS.RERANK));
  }
  return cachedScorer;
}

/**
 * Chunks, embeds and upserts a document into the shared vector store: the
 * RAG indexed path (docs/04-MODULES.md M3). Only called once `route()` has
 * decided a source is too large for full context. `deleteFilter: { sourceId }`
 * on upsert makes re-indexing the same source (a re-upload, or a session
 * rebalance flipping it from `full` to `indexed`) replace its old chunks
 * atomically rather than accumulate stray ones.
 */
export async function index(sourceId: string, markdown: string, source: IndexSourceInfo): Promise<ToolResult<void>> {
  if (!markdown.trim()) {
    return fail('PARSE_FAILED', `Nothing to index for "${sourceId}": the markdown is empty.`, { recoverable: false });
  }

  const doc = MDocument.fromMarkdown(markdown);

  let chunks: Awaited<ReturnType<typeof doc.chunk>>;
  try {
    chunks = hasHeadings(markdown)
      ? await doc.chunk({ strategy: 'semantic-markdown', addStartIndex: true })
      : await doc.chunk({ strategy: 'recursive', maxSize: 512, overlap: 50, addStartIndex: true });
  } catch (err) {
    return fail('PARSE_FAILED', `Could not chunk "${sourceId}" for indexing: ${(err as Error).message}`, {
      recoverable: false,
    });
  }

  const nonEmptyChunks = chunks.filter((c) => c.text.trim().length > 0);
  if (nonEmptyChunks.length === 0) {
    return fail('PARSE_FAILED', `Chunking "${sourceId}" produced no usable text.`, { recoverable: false });
  }

  const pageMarkers = collectMarkers(PAGE_MARKER_RE, markdown);
  const headingMarkers = collectMarkers(HEADING_RE, markdown);
  const retrievedAt = source.retrievedAt ?? new Date().toISOString();

  const metadata = nonEmptyChunks.map((chunk, chunkIndex) => {
    const { page, heading } = locateChunk(markdown, chunk, pageMarkers, headingMarkers);
    return {
      sourceId,
      sourceName: source.sourceName,
      sourceType: source.sourceType,
      page,
      heading,
      chunkIndex,
      retrievedAt,
      // Not in the M3 metadata list, but required: LibSQLVector's query()
      // returns metadata only, never the chunk body, so the chunk text has
      // to travel as a metadata field for `search()` to have anything to
      // return (per @mastra/rag's own vector-query-tool reference: "Read the
      // chunk text from sources[i].metadata.text").
      text: chunk.text,
    };
  });

  try {
    const { embeddings } = await embedMany({
      model: new ModelRouterEmbeddingModel(EMBEDDING_MODEL_ID),
      values: nonEmptyChunks.map((c) => c.text),
    });
    const dimension = embeddings[0]?.length;
    if (!dimension) throw new Error('embedMany returned no vectors');

    const vectorStore = getVectorStore();
    // @mastra/core's own EMBEDDING_MODELS table lists gemini-embedding-001 at
    // 768 dimensions, but the live API returns 3072 by default (it is a
    // Matryoshka model; 768 is only what you get back if you ask for
    // truncation via providerOptions). Trusting that static table produced a
    // real "Vector dimension mismatch" error against the live model, so the
    // index is created from the embeddings actually returned instead.
    await vectorStore.createIndex({ indexName: INDEX_NAME, dimension });
    await vectorStore.upsert({
      indexName: INDEX_NAME,
      vectors: embeddings,
      metadata,
      ids: metadata.map((_, i) => `${sourceId}::${i}`),
      deleteFilter: { sourceId },
    });
  } catch (err) {
    return fail('NETWORK', `Could not index "${sourceId}": ${(err as Error).message}`, { recoverable: true });
  }

  return ok(undefined);
}

function toPassage(result: RerankResult): Passage {
  const metadata = (result.result.metadata ?? {}) as Record<string, unknown>;
  return {
    text: typeof metadata.text === 'string' ? metadata.text : (result.result.document ?? ''),
    score: result.score,
    sourceId: typeof metadata.sourceId === 'string' ? metadata.sourceId : '',
    sourceName: typeof metadata.sourceName === 'string' ? metadata.sourceName : '',
    sourceType: metadata.sourceType as SourceKind,
    page: typeof metadata.page === 'number' ? metadata.page : undefined,
    heading: typeof metadata.heading === 'string' ? metadata.heading : undefined,
    chunkIndex: typeof metadata.chunkIndex === 'number' ? metadata.chunkIndex : 0,
    retrievedAt: typeof metadata.retrievedAt === 'string' ? metadata.retrievedAt : '',
  };
}

/**
 * Which chunks a `search()` may return. `sourceId` narrows to one document;
 * `sourceIds` narrows to a set (a conversation's own sources, since the vector
 * index is shared by every conversation the process serves). Both set means a
 * chunk must satisfy both. An empty `sourceIds` allows nothing.
 */
export type SearchFilter = { sourceId?: string; sourceIds?: readonly string[] };

/**
 * Retrieves the four passages most relevant to `query` from the indexed
 * store, per docs/04-MODULES.md M3: vector search (topK 10) then a rerank
 * pass down to 4. Filtering by `sourceId` is what keeps attribution honest
 * once more than one document is indexed (docs/03-ARCHITECTURE.md Part 2.5)
 * instead of quietly searching every source at once. The filter is applied in
 * the vector query itself (LibSQLVector takes a metadata filter with `$in`), so
 * a scoped search still gets its full topK from the allowed sources rather than
 * a post filtered remainder.
 */
export async function search(query: string, filter?: SearchFilter): Promise<ToolResult<Passage[]>> {
  const allowed = filter?.sourceIds;
  if (allowed && (allowed.length === 0 || (filter?.sourceId !== undefined && !allowed.includes(filter.sourceId)))) {
    return ok([]);
  }

  let sources: QueryResult[];
  try {
    const tool = getQueryTool();
    const filterValue = filter?.sourceId
      ? { sourceId: filter.sourceId }
      : allowed
        ? { sourceId: { $in: [...allowed] } }
        : {};
    // The tool's execute() is normally only ever called by the agent/tool
    // runtime, which always supplies requestContext and observe; called
    // directly here (no agent involved, per docs/03-ARCHITECTURE.md's "the
    // indexed path" pattern), those have to be built by hand. `noopObserve`
    // is @mastra/core's own stand-in for "no tracing span active".
    const result = await tool.execute(
      { queryText: query, topK: 10, filter: JSON.stringify(filterValue) },
      { requestContext: new RequestContext(), observe: noopObserve },
    );
    sources = (result?.sources ?? []) as QueryResult[];
  } catch (err) {
    return fail('NETWORK', `Could not search documents: ${(err as Error).message}`, { recoverable: true });
  }

  if (sources.length === 0) return ok([]);

  try {
    const reranked = await rerankWithScorer({
      results: sources,
      query,
      scorer: getRelevanceScorer(),
      options: { topK: 4 },
    });
    return ok(reranked.map(toPassage));
  } catch (err) {
    return fail('NETWORK', `Could not rerank search results: ${(err as Error).message}`, { recoverable: true });
  }
}
