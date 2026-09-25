import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import { checkPublicUrl, safeFetch } from './urlSafety';
import { readPage } from './readPage';

/** A crawled page: the same shape a research page becomes once it joins the document pipeline (marker.ts's formatWebMarker). */
export type PageRef = { url: string; markdown: string; retrievedAt: string };

/**
 * `RESEARCH_MAX_PAGES` (docs/04-MODULES.md M4): a hard cap on how many pages
 * a single research task may fetch, so one request cannot burn the month's
 * free-tier quota. Read once at module load, matching `route.ts`'s and
 * `.env.example`'s own `Number(process.env.X) || default` pattern.
 */
const RESEARCH_MAX_PAGES = Number(process.env.RESEARCH_MAX_PAGES) || 8;

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';
const FIRECRAWL_POLL_ATTEMPTS = 10;
const FIRECRAWL_POLL_DELAY_MS = 2000;

function toStartUrl(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

type FirecrawlPage = { markdown?: string; metadata?: { sourceURL?: string; url?: string } };

/**
 * Firecrawl's crawl endpoint is asynchronous: POST /v1/crawl starts a job
 * and returns a job id, then GET /v1/crawl/{id} is polled until its status
 * is 'completed' (or 'failed'). Polling is bounded to a handful of short
 * attempts rather than an open-ended loop: crawlSite is explicitly the
 * project's own lower-priority module (docs/07-BUILD-PLAN.md's cut list),
 * so this stays simple rather than growing into a real job queue.
 */
async function crawlViaFirecrawl(domain: string, maxPages: number, apiKey: string): Promise<ToolResult<PageRef[]>> {
  const startUrl = toStartUrl(domain);

  try {
    const startResponse = await fetch(`${FIRECRAWL_BASE}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url: startUrl, limit: maxPages, scrapeOptions: { formats: ['markdown'] } }),
    });

    if (startResponse.status === 429) {
      return fail('SEARCH_QUOTA', `Firecrawl quota or rate limit reached for "${domain}".`, { recoverable: true });
    }
    if (!startResponse.ok) {
      return fail('NETWORK', `Firecrawl could not start a crawl of "${domain}": HTTP ${startResponse.status}.`, { recoverable: true });
    }

    const started = (await startResponse.json()) as { success?: boolean; id?: string };
    if (!started.success || !started.id) {
      return fail('NETWORK', `Firecrawl did not accept the crawl request for "${domain}".`, { recoverable: true });
    }

    for (let attempt = 0; attempt < FIRECRAWL_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, FIRECRAWL_POLL_DELAY_MS));

      const statusResponse = await fetch(`${FIRECRAWL_BASE}/crawl/${started.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!statusResponse.ok) continue;

      const status = (await statusResponse.json()) as { status?: string; data?: FirecrawlPage[] };
      if (status.status === 'completed') {
        const now = new Date().toISOString();
        const pages: PageRef[] = (status.data ?? [])
          .filter((p): p is FirecrawlPage & { markdown: string } => Boolean(p.markdown?.trim()))
          .slice(0, maxPages)
          .map((p) => ({ url: p.metadata?.sourceURL ?? p.metadata?.url ?? startUrl, markdown: p.markdown, retrievedAt: now }));
        return ok(pages);
      }
      if (status.status === 'failed') {
        return fail('NETWORK', `Firecrawl's crawl of "${domain}" failed.`, { recoverable: true });
      }
    }

    return fail('NETWORK', `Firecrawl's crawl of "${domain}" did not complete in time.`, { recoverable: true });
  } catch (err) {
    return fail('NETWORK', `Firecrawl crawl of "${domain}" failed: ${(err as Error).message}`, { recoverable: true });
  }
}

/** Same-domain `<a href>` links found on a page of HTML, resolved to absolute URLs. A simple regex, per docs/PROMPTBOOK.md P4.2: this is the fallback path, kept deliberately unsophisticated. */
function discoverSameDomainLinks(html: string, origin: string): string[] {
  const hrefRe = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html))) {
    try {
      const resolved = new URL(match[1]!, origin);
      if (resolved.origin === origin) found.add(resolved.toString());
    } catch {
      // Malformed or non-http href (mailto:, javascript:, etc.); skip it.
    }
  }
  return [...found];
}

/**
 * The fallback crawl path when no Firecrawl key is configured: fetch the
 * homepage, extract same-domain links, and read each one sequentially with
 * `readPage`, up to the cap. Best effort: a single page failing to read
 * does not abort the crawl, it is just missing from the result.
 */
async function crawlViaDiscovery(domain: string, maxPages: number): Promise<ToolResult<PageRef[]>> {
  const startUrl = toStartUrl(domain);

  let homepageHtml: string;
  try {
    // safeFetch: the homepage is fetched from this server (D-55).
    const fetched = await safeFetch(startUrl);
    if (!fetched.ok) return fetched;
    const response = fetched.data;
    if (!response.ok) {
      return fail('PAGE_BLOCKED', `Could not fetch homepage "${startUrl}": HTTP ${response.status}.`, { recoverable: false });
    }
    homepageHtml = await response.text();
  } catch (err) {
    return fail('NETWORK', `Could not fetch homepage "${startUrl}": ${(err as Error).message}`, { recoverable: true });
  }

  const origin = new URL(startUrl).origin;
  const links = discoverSameDomainLinks(homepageHtml, origin);
  const urls = [startUrl, ...links].filter((u, i, arr) => arr.indexOf(u) === i).slice(0, maxPages);

  const pages: PageRef[] = [];
  for (const url of urls) {
    const result = await readPage(url);
    if (result.ok) pages.push({ url, markdown: result.data.markdown, retrievedAt: result.data.retrievedAt });
  }
  return ok(pages);
}

/**
 * Crawls a whole company site for a company profile (docs/04-MODULES.md
 * M4): Firecrawl when `FIRECRAWL_API_KEY` is set, otherwise homepage link
 * discovery plus sequential `readPage`. `maxPages` is always clamped to
 * `RESEARCH_MAX_PAGES`, so a caller cannot accidentally exceed the
 * per-task page cap that protects the month's search/read quota.
 */
export async function crawlSite(domain: string, maxPages: number): Promise<ToolResult<PageRef[]>> {
  const checked = await checkPublicUrl(toStartUrl(domain));
  if (!checked.ok) return checked;
  const cap = Math.max(0, Math.min(maxPages, RESEARCH_MAX_PAGES));
  if (cap === 0) return ok([]);

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (apiKey) {
    const result = await crawlViaFirecrawl(domain, cap, apiKey);
    if (result.ok) return result;
    // Fall through to link discovery on a Firecrawl failure too, not only
    // on a missing key: the same "a demo that dies on a rate limit is a
    // bad demo" reasoning as search()'s Exa-to-Tavily fallback.
  }

  return crawlViaDiscovery(domain, cap);
}
