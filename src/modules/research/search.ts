import Exa from 'exa-js';
import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';

/**
 * A single web search result. Not specified in docs/05-DATA-MODEL.md, so
 * defined here per docs/04-MODULES.md M4 and docs/PROMPTBOOK.md P4.1.
 */
export type SearchHit = { title: string; url: string; snippet: string };

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

/** True for an HTTP status or message that plausibly means "quota/rate limit", not a genuine outage. */
function looksQuotaShaped(status: number | undefined, message: string): boolean {
  if (status === 429 || status === 402) return true;
  return /quota|rate.?limit|insufficient credits|too many requests/i.test(message);
}

async function searchExa(query: string, limit: number): Promise<ToolResult<SearchHit[]>> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return fail('SEARCH_QUOTA', 'EXA_API_KEY is not set; Exa is unavailable.', { recoverable: true });
  }

  try {
    const exa = new Exa(apiKey);
    const response = await exa.search(query, {
      numResults: limit,
      contents: { text: { maxCharacters: 300 } },
    });
    const hits: SearchHit[] = response.results.map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: 'text' in r && typeof r.text === 'string' ? r.text : '',
    }));
    return ok(hits);
  } catch (err) {
    const error = err as { statusCode?: number; message?: string };
    const message = error.message ?? String(err);
    if (looksQuotaShaped(error.statusCode, message)) {
      return fail('SEARCH_QUOTA', `Exa quota or rate limit reached: ${message}`, { recoverable: true });
    }
    return fail('NETWORK', `Exa search failed: ${message}`, { recoverable: true });
  }
}

async function searchTavily(query: string, limit: number): Promise<ToolResult<SearchHit[]>> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return fail('SEARCH_QUOTA', 'TAVILY_API_KEY is not set; Tavily is unavailable.', { recoverable: true });
  }

  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, max_results: limit }),
    });

    // Tavily's own documented rate-limit / plan-exhausted statuses.
    if (response.status === 429 || response.status === 432 || response.status === 433) {
      return fail('SEARCH_QUOTA', `Tavily quota or rate limit reached (HTTP ${response.status}).`, { recoverable: true });
    }
    if (!response.ok) {
      return fail('NETWORK', `Tavily search failed: HTTP ${response.status}.`, { recoverable: true });
    }

    const data = (await response.json()) as { results?: { title?: string; url: string; content?: string }[] };
    const hits: SearchHit[] = (data.results ?? []).slice(0, limit).map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: r.content ?? '',
    }));
    return ok(hits);
  } catch (err) {
    return fail('NETWORK', `Tavily search failed: ${(err as Error).message}`, { recoverable: true });
  }
}

/**
 * Searches the public web: Exa primary via `exa-js`, Tavily fallback via a
 * plain `fetch` (docs/06-RESEARCH-STACK.md 2.6, docs/04-MODULES.md M4).
 *
 * Falls through to Tavily on ANY Exa failure, not only a quota-shaped one:
 * a demo that dies on a transient Exa hiccup is exactly the failure mode
 * M4's "layered fallbacks" table exists to avoid. Which provider actually
 * answered is noted inline above each `ok()` return rather than surfaced to
 * the caller, since neither M4's surface nor SearchHit carries a provider
 * field.
 *
 * Total failure (both providers down, unconfigured, or genuinely out of
 * quota) is reported as `SEARCH_QUOTA` rather than an empty array: an empty
 * array reads as "nothing found" and invites a model to fill the gap
 * (AGENTS.md rule 2), which is exactly what must not happen here.
 */
export async function search(query: string, limit: number): Promise<ToolResult<SearchHit[]>> {
  const exaResult = await searchExa(query, limit);
  if (exaResult.ok) {
    // Provider that answered: Exa.
    return exaResult;
  }

  const tavilyResult = await searchTavily(query, limit);
  if (tavilyResult.ok) {
    // Provider that answered: Tavily (fallback).
    return tavilyResult;
  }

  return fail(
    'SEARCH_QUOTA',
    `No search provider is available. Exa: ${exaResult.error.message} Tavily: ${tavilyResult.error.message}`,
    {
      recoverable: true,
      suggestion: 'Report research as unavailable rather than answering from training data.',
    },
  );
}
