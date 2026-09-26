import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ToolResult } from '@/types';
import { getDocument, search } from '@/modules/documents';
import { numericValue } from '@/modules/evidence';
import { fail } from '@/modules/reliability';
import { getRuntime } from '../runtime';

const toolResultSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data: dataSchema }),
    z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.string(),
        message: z.string(),
        recoverable: z.boolean(),
        suggestion: z.string().optional(),
      }),
    }),
  ]);

const sourceKindSchema = z.enum(['xlsx', 'csv', 'pdf', 'docx', 'txt', 'json', 'web']);

/**
 * Wraps a tool's execute body so an unexpected throw (a filesystem error, a
 * dropped vector store connection, etc.) becomes a ToolResult failure instead
 * of reaching the agent loop. AGENTS.md rule 5: tools return ToolResult<T>,
 * they never throw. Mirrors src/mastra/tools/analysis.ts's safe() exactly.
 */
function safe<T>(fn: () => Promise<ToolResult<T>>): () => Promise<ToolResult<T>> {
  return async () => {
    try {
      return await fn();
    } catch (err) {
      return fail('PARSE_FAILED', `Unexpected error: ${(err as Error).message}`, { recoverable: false });
    }
  };
}

export const listDocumentsTool = createTool({
  id: 'list_documents',
  description:
    'Lists every document source loaded in this session (pdf, docx, txt), showing each one\'s mode: "full" ' +
    '(read it whole with get_document) or "indexed" (too large for full context, search it with search_documents). ' +
    'Call this first, before choosing get_document or search_documents, so you never have to guess which tool ' +
    'applies to which source.',
  inputSchema: z.object({}),
  outputSchema: toolResultSchema(
    z.object({
      documents: z.array(
        z.object({
          sourceId: z.string(),
          name: z.string(),
          mode: z.enum(['full', 'indexed']),
          pageCount: z.number().optional(),
          tokenCount: z.number(),
          hasTables: z.boolean(),
        }),
      ),
    }),
  ),
  execute: safe(async () => {
    const { registry } = await getRuntime();
    const documents = registry
      .listSources()
      .filter((s) => s.status === 'ready' && s.doc)
      .map((s) => ({
        sourceId: s.id,
        name: s.name,
        mode: s.doc!.mode,
        ...(s.doc!.pageCount !== undefined ? { pageCount: s.doc!.pageCount } : {}),
        tokenCount: s.doc!.tokenCount,
        hasTables: (s.tables?.length ?? 0) > 0,
      }));
    return { ok: true as const, data: { documents } };
  }),
});

export const getDocumentTool = createTool({
  id: 'get_document',
  description:
    'Returns the full markdown of a "full" mode document source, page markers and headings included. ' +
    'Only call this after list_documents confirms the source is in "full" mode; calling it on an "indexed" ' +
    'source fails, since a too-large document is never returned in one piece. Use search_documents for those.',
  inputSchema: z.object({ sourceId: z.string() }),
  outputSchema: toolResultSchema(
    z.object({
      sourceId: z.string(),
      name: z.string(),
      markdown: z.string(),
      pageCount: z.number().optional(),
    }),
  ),
  execute: async (inputData: { sourceId: string }) =>
    safe(async () => {
      const { registry } = await getRuntime();
      const source = registry.getSource(inputData.sourceId);

      if (!source) {
        return fail('SOURCE_NOT_FOUND', `No source "${inputData.sourceId}" in this session. Call list_documents to see what is loaded.`, {
          recoverable: true,
          suggestion: 'Call list_documents first.',
        });
      }
      if (source.status === 'pending') {
        return fail('SOURCE_PENDING', `"${source.name}" is still being ingested.`, { recoverable: true });
      }
      if (source.status === 'failed') {
        return fail('PARSE_FAILED', `"${source.name}" failed to ingest: ${source.error?.message ?? 'unknown error'}.`, {
          recoverable: false,
        });
      }
      if (!source.doc) {
        return fail('UNSUPPORTED', `"${source.name}" has no document content (it is a tabular source only); get_document does not apply.`, {
          recoverable: true,
          suggestion: 'Use the Data Analyst\'s list_datasets/describe_dataset for this source instead.',
        });
      }
      if (source.doc.mode === 'indexed') {
        return fail(
          'UNSUPPORTED',
          `"${source.name}" is in "indexed" mode: it is too large to return whole. get_document only works on "full" mode sources.`,
          { recoverable: true, suggestion: 'Call search_documents with a query instead.' },
        );
      }

      const result = await getDocument(source.id);
      if (!result.ok) return result;

      return {
        ok: true as const,
        data: {
          sourceId: source.id,
          name: source.name,
          markdown: result.data,
          ...(source.doc.pageCount !== undefined ? { pageCount: source.doc.pageCount } : {}),
        },
      };
    })(),
});

export const searchDocumentsTool = createTool({
  id: 'search_documents',
  description:
    'Filtered vector search over "indexed" mode document sources, reranked to the four most relevant passages. ' +
    'Use this for sources list_documents shows as "indexed" (too large for get_document). Pass sourceId to search ' +
    'within one document only, which keeps citations honest when several documents are loaded.',
  inputSchema: z.object({
    query: z.string().describe('What to search for, in natural language.'),
    sourceId: z.string().optional().describe('Restrict the search to one source id from list_documents.'),
  }),
  outputSchema: toolResultSchema(
    z.object({
      passages: z.array(
        z.object({
          text: z.string(),
          score: z.number(),
          sourceId: z.string(),
          sourceName: z.string(),
          sourceType: sourceKindSchema,
          page: z.number().optional(),
          heading: z.string().optional(),
          chunkIndex: z.number(),
          retrievedAt: z.string(),
        }),
      ),
    }),
  ),
  execute: async (inputData: { query: string; sourceId?: string }) =>
    safe(async () => {
      // Ensures the shared session's sample documents have finished ingesting
      // (and, for indexed-mode sources, finished embedding) before the first
      // search runs against them.
      await getRuntime();

      const filter = inputData.sourceId ? { sourceId: inputData.sourceId } : undefined;
      const result = await search(inputData.query, filter);
      if (!result.ok) return result;

      return { ok: true as const, data: { passages: result.data } };
    })(),
});

const evidenceOutputSchema = z.object({
  id: z.string(),
  claim: z.string(),
  kind: z.enum(['computed', 'document', 'web']),
  sourceId: z.string(),
  sourceName: z.string(),
  locator: z.string(),
  method: z.string().optional(),
  value: z.union([z.number(), z.string()]).optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  retrievedAt: z.string().optional(),
  metric: z
    .object({ name: z.string(), scope: z.string(), unit: z.enum(['ratio', 'currency', 'count', 'duration']) })
    .optional(),
  createdAt: z.string(),
});

export const recordEvidenceTool = createTool({
  id: 'record_evidence',
  description:
    'Records one fact quoted or retrieved from a document in the evidence ledger: the claim, its source, and a ' +
    'locator (page number and/or heading). Set retrieved to true when the claim came from search_documents (a ' +
    'reranked chunk, confidence "medium"), false when quoted from get_document (full context, confidence ' +
    '"high"); this tool assigns confidence by that rule, it is never passed in. Call this for every claim that ' +
    'will appear in your answer, then use the returned evidence object as-is in your structured output; do not ' +
    'retype or paraphrase it. Set "metric" when the claim states a figure for a channel/segment/region (e.g. ' +
    'name "conversion_rate", scope "channel=paid_social", value 0.03), or states a position in a ranking (name ' +
    '"conversion_rate_rank", unit "count", value 1 for "our strongest channel"), so conflict detection can match ' +
    'it against the computed figure or rank. Conflicts only compare numeric values; never invent a number the ' +
    'document does not state, and leave "metric" off purely qualitative remarks.',
  inputSchema: z.object({
    claim: z.string().describe('Human readable statement of the fact, e.g. "Acme targets mid-market SaaS teams in North America"'),
    sourceId: z.string().describe('The source id this claim came from, from list_documents.'),
    sourceName: z.string().describe('The document name, e.g. "northwind-brief.pdf".'),
    locator: z.string().describe('Where in the document, e.g. "page 2, Positioning".'),
    value: z
      .union([z.number(), z.string()])
      .optional()
      .describe('The stated figure, or the stated position for a "_rank" metric (1 = best); required as a number when "metric" is set.'),
    metric: z
      .object({
        name: z.string(),
        scope: z.string(),
        unit: z.enum(['ratio', 'currency', 'count', 'duration']),
      })
      .optional()
      .describe('Set this when the claim names or compares a metric also computable from the data, so conflict detection can find it.'),
    retrieved: z
      .boolean()
      .describe('true if this claim came from search_documents (indexed mode), false if from get_document (full mode).'),
  }),
  outputSchema: toolResultSchema(z.object({ evidence: evidenceOutputSchema })),
  execute: async (inputData: {
    claim: string;
    sourceId: string;
    sourceName: string;
    locator: string;
    value?: number | string;
    metric?: { name: string; scope: string; unit: 'ratio' | 'currency' | 'count' | 'duration' };
    retrieved: boolean;
  }) =>
    safe(async () => {
      // A keyed figure is stored as a number; "0.22" or "1" would otherwise be refused below.
      const value = inputData.metric ? (numericValue(inputData.value) ?? inputData.value) : inputData.value;
      if (inputData.metric && typeof value !== 'number') {
        return fail(
          'UNSUPPORTED',
          '"metric" was set without a numeric "value", so conflict detection could never compare this claim.',
          {
            recoverable: true,
            suggestion:
              'Set "value" to the figure the document states (a rate as a ratio) or, for a "_rank" metric, the stated position (1 = best). If the document states neither, record the claim without "metric".',
          },
        );
      }
      const { ledger } = await getRuntime();
      const evidence = await ledger.addEvidence({
        claim: inputData.claim,
        kind: 'document',
        sourceId: inputData.sourceId,
        sourceName: inputData.sourceName,
        locator: inputData.locator,
        ...(value !== undefined ? { value } : {}),
        ...(inputData.metric ? { metric: inputData.metric } : {}),
        retrieved: inputData.retrieved,
      });
      return { ok: true as const, data: { evidence } };
    })(),
});
