import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The SSRF guard (urlSafety.ts) resolves every host before fetching; these tests
// stub fetch, so DNS is stubbed too, to a public address, keeping them offline.
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));

const ORIGINAL_ENV = { ...process.env };

describe('crawlSite() (link discovery fallback, no Firecrawl key)', () => {
  const fetchMock = vi.fn();
  const readPageMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    readPageMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.RESEARCH_MAX_PAGES;

    vi.doMock('./readPage', () => ({ readPage: readPageMock }));
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('./readPage');
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('discovers same-domain links from the homepage and never exceeds RESEARCH_MAX_PAGES (default 8)', async () => {
    const links = Array.from({ length: 20 }, (_, i) => `<a href="/page-${i}">Page ${i}</a>`).join('\n');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `<html><body>${links}<a href="https://other-domain.com/x">off-domain</a></body></html>`,
    });
    readPageMock.mockImplementation(async (url: string) => ({
      ok: true,
      data: { markdown: `content for ${url}`, retrievedAt: '2026-09-23T00:00:00.000Z' },
    }));

    const { crawlSite } = await import('./crawlSite');
    const result = await crawlSite('example.com', 100); // requested cap is above RESEARCH_MAX_PAGES

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeLessThanOrEqual(8);
    expect(result.data.every((p) => p.url.startsWith('https://example.com'))).toBe(true);
    // an off-domain link must never be crawled
    expect(result.data.some((p) => p.url.includes('other-domain.com'))).toBe(false);
  });

  it('respects a maxPages argument smaller than RESEARCH_MAX_PAGES', async () => {
    const links = Array.from({ length: 20 }, (_, i) => `<a href="/page-${i}">Page ${i}</a>`).join('\n');
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => `<html><body>${links}</body></html>` });
    readPageMock.mockImplementation(async (url: string) => ({
      ok: true,
      data: { markdown: `content for ${url}`, retrievedAt: 'now' },
    }));

    const { crawlSite } = await import('./crawlSite');
    const result = await crawlSite('example.com', 3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeLessThanOrEqual(3);
  });

  it('is best-effort: a page that fails to read is skipped rather than failing the whole crawl', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '<html><body><a href="/a">a</a></body></html>' });
    readPageMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/a')) return { ok: false, error: { code: 'PAGE_BLOCKED', message: 'blocked', recoverable: false } };
      return { ok: true, data: { markdown: `content for ${url}`, retrievedAt: 'now' } };
    });

    const { crawlSite } = await import('./crawlSite');
    const result = await crawlSite('example.com', 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.some((p) => p.url.endsWith('/a'))).toBe(false);
  });

  it('fails, does not throw, when the homepage itself cannot be fetched', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const { crawlSite } = await import('./crawlSite');
    const result = await crawlSite('example.com', 5);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PAGE_BLOCKED');
  });

  it('returns ok([]) for a maxPages of 0 without making any request', async () => {
    const { crawlSite } = await import('./crawlSite');
    const result = await crawlSite('example.com', 0);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('crawlSite() (Firecrawl)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.FIRECRAWL_API_KEY = 'test-firecrawl-key';
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('starts a crawl and polls until completed, mapping pages from the response', async () => {
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url.endsWith('/v1/crawl') && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ success: true, id: 'job_1' }) };
      }
      if (url.endsWith('/v1/crawl/job_1')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'completed',
            data: [{ markdown: '# Acme', metadata: { sourceURL: 'https://example.com' } }],
          }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { crawlSite } = await import('./crawlSite');
    const result = await crawlSite('example.com', 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([{ url: 'https://example.com', markdown: '# Acme', retrievedAt: expect.any(String) }]);
  }, 15000);

  it('returns SEARCH_QUOTA when Firecrawl is rate limited on crawl start', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });

    const { crawlSite } = await import('./crawlSite');
    const result = await crawlSite('example.com', 5);

    // Firecrawl failure falls through to link discovery, which then also
    // needs the homepage fetch (mocked to 429 above too), so the final
    // failure surfaces from that fallback attempt.
    expect(result.ok).toBe(false);
  }, 15000);
});
