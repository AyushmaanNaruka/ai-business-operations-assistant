import type { ToolResult } from '@/types';
import { readPage, type PageContent } from './readPage';

/**
 * A per-session cache of `readPage` results, keyed by URL (docs/04-MODULES.md
 * M4: "URL cache per session"). Re-reading the same URL within a session
 * costs nothing, whether the earlier read succeeded or failed: caching a
 * failure too means a page reported as `PAGE_BLOCKED` a minute ago is not
 * retried on every follow-up question in the same conversation.
 */
export type UrlCache = {
  get(url: string): ToolResult<PageContent> | undefined;
  set(url: string, result: ToolResult<PageContent>): void;
  has(url: string): boolean;
};

/** Plain `Map` factory, one per research session (per docs/04-MODULES.md M4's stated surface). */
export function createUrlCache(): UrlCache {
  const store = new Map<string, ToolResult<PageContent>>();
  return {
    get: (url) => store.get(url),
    set: (url, result) => {
      store.set(url, result);
    },
    has: (url) => store.has(url),
  };
}

/** `readPage`, wrapped with a session `UrlCache`: a second call for the same URL never re-fetches. */
export async function readPageCached(cache: UrlCache, url: string): Promise<ToolResult<PageContent>> {
  const cached = cache.get(url);
  if (cached) return cached;

  const result = await readPage(url);
  cache.set(url, result);
  return result;
}
