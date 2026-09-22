import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ToolResult } from '@/types';
import { crawlSite, createUrlCache, readPageCached, search, type UrlCache } from '@/modules/research';
import { fail } from '@/modules/reliability';

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

/**
 * Wraps a tool's execute body so an unexpected throw (a fetch that rejects
 * in a way `readPage`/`search`/`crawlSite` did not already catch, a bad SDK
 * response shape, etc.) becomes a ToolResult failure instead of reaching
 * the agent loop. AGENTS.md rule 5: tools return ToolResult<T>, they never
 * throw. Mirrors src/mastra/tools/analysis.ts's and
 * src/mastra/tools/documents.ts's safe() exactly.
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
 * One shared URL cache for the whole process, the same D-15 stand-in
 * pattern as analysis.ts's and documents.ts's shared DuckDB session: a real
 * per-session cache is M8's job (Phase 5), not this file's. Until then,
 * `read_page` and `crawl_site` share this cache within one process, so a
 * page read once by either tool is never re-fetched by the other.
 */
let cache: UrlCache | undefined;
function getUrlCache(): UrlCache {
  if (!cache) cache = createUrlCache();
  return cache;
}

export const webSearchTool = createTool({
  id: 'web_search',
  description:
    'Searches the public web for a company, topic or claim. Exa primary, Tavily fallback. Returns titles, ' +
    'URLs and short snippets, not full page content; call read_page on a promising result for the actual text. ' +
    'A SEARCH_QUOTA failure means both providers are unavailable: stop and report this as a gap, never answer ' +
    'from training data.',
  inputSchema: z.object({
    query: z.string().describe('What to search for, in natural language.'),
    limit: z.number().int().min(1).max(10).default(5).describe('Maximum number of results to return.'),
  }),
  outputSchema: toolResultSchema(
    z.object({
      hits: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })),
    }),
  ),
  execute: async (inputData: { query: string; limit: number }) =>
    safe(async () => {
      const result = await search(inputData.query, inputData.limit);
      if (!result.ok) return result;
      return { ok: true as const, data: { hits: result.data } };
    })(),
});

export const readPageTool = createTool({
  id: 'read_page',
  description:
    'Reads a single web page into clean markdown, plus the moment it was retrieved (retrievedAt). Jina Reader ' +
    'first, a local extractor as fallback if that fails. Cached for this session: reading the same URL a ' +
    'second time costs nothing and returns the same retrievedAt as the first read.',
  inputSchema: z.object({ url: z.string().describe('The exact page URL to read.') }),
  outputSchema: toolResultSchema(
    z.object({ url: z.string(), markdown: z.string(), retrievedAt: z.string() }),
  ),
  execute: async (inputData: { url: string }) =>
    safe(async () => {
      const result = await readPageCached(getUrlCache(), inputData.url);
      if (!result.ok) return result;
      return { ok: true as const, data: { url: inputData.url, markdown: result.data.markdown, retrievedAt: result.data.retrievedAt } };
    })(),
});

export const crawlSiteTool = createTool({
  id: 'crawl_site',
  description:
    'Crawls a handful of pages from a whole company site (capped by RESEARCH_MAX_PAGES). Firecrawl when ' +
    'configured, otherwise homepage link discovery plus sequential page reads. Prefer read_page for a single ' +
    'known URL (the homepage, the pricing page); use crawl_site only when you need several pages from one ' +
    'site at once and do not already know their URLs.',
  inputSchema: z.object({
    domain: z.string().describe('The company domain or homepage URL, e.g. "acme.com" or "https://acme.com".'),
    maxPages: z.number().int().min(1).max(20).default(5).describe('Maximum pages to crawl, clamped to RESEARCH_MAX_PAGES.'),
  }),
  outputSchema: toolResultSchema(
    z.object({
      pages: z.array(z.object({ url: z.string(), markdown: z.string(), retrievedAt: z.string() })),
    }),
  ),
  execute: async (inputData: { domain: string; maxPages: number }) =>
    safe(async () => {
      const result = await crawlSite(inputData.domain, inputData.maxPages);
      if (!result.ok) return result;
      return { ok: true as const, data: { pages: result.data } };
    })(),
});
