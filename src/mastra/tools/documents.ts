import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ToolResult } from '@/types';
import { createSession, type DuckDBSession } from '@/modules/analysis';
import { getDocument, search } from '@/modules/documents';
import { fail } from '@/modules/reliability';
import { createSourceRegistry, ingest, type SourceRegistry } from '@/modules/sources';

// mastra dev runs with its cwd set to src/mastra/public, not the project root
// (see docs/DECISIONS.md D-09); INIT_CWD is npm's original invocation
// directory and the one thing that reliably points back at the project root.
const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();

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

/**
 * One shared DuckDB session and source registry for the whole process,
 * scoped to the Document agent's tools only.
 *
 * This is a second, independent copy of the same D-15 stand-in pattern used
 * in src/mastra/tools/analysis.ts, not a bug: the Data Analyst and the
 * Document agent each get their own registry/session here rather than
 * sharing one, because there is no session manifest yet for two tool files
 * to share against. Wiring one registry that every agent reads is explicitly
 * Phase 5's job (M8, docs/03-ARCHITECTURE.md), not this file's. Until then,
 * this loads samples/northwind-brief.pdf and samples/customer-notes.docx
 * once on first tool call so the Document agent has something real to
 * answer questions about in Mastra Studio.
 */
let sessionPromise: Promise<{ session: DuckDBSession; registry: SourceRegistry }> | null = null;

async function getRuntime() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const session = await createSession('phase3-document-shared-session');
      const registry = createSourceRegistry();

      const samplePaths = [resolve(PROJECT_ROOT, 'samples/northwind-brief.pdf'), resolve(PROJECT_ROOT, 'samples/customer-notes.docx')];
      for (const samplePath of samplePaths) {
        if (!existsSync(samplePath)) continue;
        const source = ingest(session, registry, { path: samplePath });
        await waitForReady(registry, source.id);
      }

      return { session, registry };
    })().catch((err: unknown) => {
      // Do not cache a rejected promise: a single transient init failure
      // (a locked db file, a bad sample file) would otherwise permanently
      // break every tool call for the rest of the process. Let the next
      // call retry from scratch. Same fix as analysis.ts's getRuntime().
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

async function waitForReady(registry: SourceRegistry, id: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const source = registry.getSource(id);
    if (source && source.status !== 'pending') return;
    await new Promise((r) => setTimeout(r, 10));
  }
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
