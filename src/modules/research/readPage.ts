import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';

export type PageContent = { markdown: string; retrievedAt: string };

async function readPageViaJina(url: string): Promise<ToolResult<PageContent>> {
  const apiKey = process.env.JINA_API_KEY;
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  try {
    // Jina Reader: a plain fetch to a URL prefix, no SDK, no key required at
    // 20 rpm (docs/06-RESEARCH-STACK.md 2.6). It returns model-ready
    // Markdown directly as the response body, not JSON.
    const response = await fetch(`https://r.jina.ai/${url}`, { headers });

    if (response.status === 429) {
      return fail('RATE_LIMIT', `Jina Reader rate limited "${url}".`, { recoverable: true });
    }
    if (!response.ok) {
      return fail('PAGE_BLOCKED', `Jina Reader returned HTTP ${response.status} for "${url}".`, { recoverable: true });
    }

    const markdown = await response.text();
    if (!markdown.trim()) {
      return fail('PAGE_BLOCKED', `Jina Reader returned no content for "${url}".`, { recoverable: true });
    }

    return ok({ markdown, retrievedAt: new Date().toISOString() });
  } catch (err) {
    return fail('NETWORK', `Jina Reader request failed for "${url}": ${(err as Error).message}`, { recoverable: true });
  }
}

/** Collapses Readability's plain textContent into paragraph-separated text. Deliberately simple, per docs/PROMPTBOOK.md P4.1: this is the local fallback, not the primary path. */
function textContentToMarkdown(textContent: string): string {
  return textContent
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter((p) => p.length > 0)
    .join('\n\n');
}

async function readPageViaReadability(url: string): Promise<ToolResult<PageContent>> {
  let html: string;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return fail('PAGE_BLOCKED', `Could not fetch "${url}" directly either: HTTP ${response.status}.`, { recoverable: false });
    }
    html = await response.text();
  } catch (err) {
    return fail('NETWORK', `Could not fetch "${url}" directly: ${(err as Error).message}`, { recoverable: true });
  }

  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const textContent = article?.textContent?.trim();
    if (!textContent) {
      return fail('PAGE_BLOCKED', `Could not extract readable content from "${url}".`, { recoverable: false });
    }
    return ok({ markdown: textContentToMarkdown(textContent), retrievedAt: new Date().toISOString() });
  } catch (err) {
    return fail('PAGE_BLOCKED', `Could not parse "${url}" as readable content: ${(err as Error).message}`, { recoverable: false });
  }
}

/**
 * Reads a single web page and returns clean markdown plus the moment it was
 * read (docs/04-MODULES.md M4). Jina Reader first (no key needed); on
 * failure or a rate limit, falls back to a plain fetch plus
 * `@mozilla/readability` plus `jsdom` (docs/06-RESEARCH-STACK.md 2.6's
 * "Local fallback" row).
 *
 * `retrievedAt` is stamped at the moment this call actually ran, not
 * inherited from a cache entry: callers that want a session-wide cache wrap
 * this with `readPageCached()` (urlCache.ts), which is what keeps a cached
 * hit's `retrievedAt` honestly pinned to when the page was first read.
 */
export async function readPage(url: string): Promise<ToolResult<PageContent>> {
  const jina = await readPageViaJina(url);
  if (jina.ok) return jina;

  return readPageViaReadability(url);
}
