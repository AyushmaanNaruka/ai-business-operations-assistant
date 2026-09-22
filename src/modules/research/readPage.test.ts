import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const SAMPLE_HTML = `
<html>
  <head><title>Acme</title></head>
  <body>
    <article>
      <h1>Acme Inc</h1>
      <p>Acme builds widgets for mid-market manufacturers across North America.</p>
      <p>Founded in 2018, Acme now serves over four hundred customers.</p>
    </article>
  </body>
</html>
`;

describe('readPage()', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.JINA_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('reads via Jina Reader first and stamps retrievedAt', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '# Acme\n\nAcme builds widgets.' });

    const { readPage } = await import('./readPage');
    const before = Date.now();
    const result = await readPage('https://acme.com');
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.markdown).toContain('Acme builds widgets.');
    expect(new Date(result.data.retrievedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(result.data.retrievedAt).getTime()).toBeLessThanOrEqual(after);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://r.jina.ai/https://acme.com');
  });

  it('falls back to fetch + readability + jsdom when Jina fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('https://r.jina.ai/')) return { ok: false, status: 503 };
      return { ok: true, status: 200, text: async () => SAMPLE_HTML };
    });

    const { readPage } = await import('./readPage');
    const result = await readPage('https://acme.com');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.markdown).toContain('Acme builds widgets for mid-market manufacturers');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back on a Jina rate limit (429), not just a hard failure', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('https://r.jina.ai/')) return { ok: false, status: 429 };
      return { ok: true, status: 200, text: async () => SAMPLE_HTML };
    });

    const { readPage } = await import('./readPage');
    const result = await readPage('https://acme.com');

    expect(result.ok).toBe(true);
  });

  it('returns a failure, never throws, when both Jina and the direct fetch fail', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('https://r.jina.ai/')) return { ok: false, status: 500 };
      return { ok: false, status: 403 };
    });

    const { readPage } = await import('./readPage');
    const result = await readPage('https://acme.com');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PAGE_BLOCKED');
  });

  it('sends an Authorization header to Jina when JINA_API_KEY is set', async () => {
    process.env.JINA_API_KEY = 'test-jina-key';
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'content' });

    const { readPage } = await import('./readPage');
    await readPage('https://acme.com');

    const [, init] = fetchMock.mock.calls[0]! as [string, { headers?: Record<string, string> }];
    expect(init.headers?.Authorization).toBe('Bearer test-jina-key');
  });
});

describe('createUrlCache / readPageCached', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.JINA_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('prevents a second fetch for the same URL within a session', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'cached content' });

    const { createUrlCache, readPageCached } = await import('./urlCache');
    const cache = createUrlCache();

    const first = await readPageCached(cache, 'https://acme.com');
    const second = await readPageCached(cache, 'https://acme.com');

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches a failed read too, so a repeated blocked page is not retried', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    const { createUrlCache, readPageCached } = await import('./urlCache');
    const cache = createUrlCache();

    const first = await readPageCached(cache, 'https://blocked.example.com');
    const second = await readPageCached(cache, 'https://blocked.example.com');

    expect(first.ok).toBe(false);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one Jina attempt + one direct-fetch attempt, then cached
  });

  it('fetches independently for two different URLs', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'content' });

    const { createUrlCache, readPageCached } = await import('./urlCache');
    const cache = createUrlCache();

    await readPageCached(cache, 'https://acme.com');
    await readPageCached(cache, 'https://other.com');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// Runs against the real r.jina.ai endpoint only when it is reachable and a
// stable target is used (docs/PROMPTBOOK.md P4.1: "a real call to r.jina.ai
// returns markdown for a live URL"). No key is required for this endpoint at
// 20 rpm, but the test still gates on JINA_API_KEY/EXA_API_KEY presence as a
// proxy for "this environment has live network/API access configured", to
// stay consistent with how the rest of the suite gates live tests.
describe('readPage() (live)', () => {
  let hasLiveNetwork = false;
  try {
    process.loadEnvFile();
  } catch {
    // no .env file to load; process.env may already carry the keys (CI, shell export)
  }
  hasLiveNetwork = Boolean(process.env.EXA_API_KEY);

  it.skipIf(!hasLiveNetwork)(
    'reads a real, stable company homepage into markdown',
    async () => {
      const { readPage } = await import('./readPage');
      const result = await readPage('https://stripe.com');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.markdown.length).toBeGreaterThan(50);
      expect(result.data.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    },
    20000,
  );
});
