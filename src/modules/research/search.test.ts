import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Loaded here, before ORIGINAL_ENV is captured, so the mocked describe blocks'
// process.env = { ...ORIGINAL_ENV } resets below restore the real .env keys
// rather than wiping them out before the live describe block runs.
try {
  process.loadEnvFile();
} catch {
  // no .env file to load; process.env may already carry the keys (CI, shell export)
}

const ORIGINAL_ENV = { ...process.env };

describe('search()', () => {
  const exaSearchMock = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    exaSearchMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);

    vi.doMock('exa-js', () => ({
      default: vi.fn().mockImplementation(function ExaMock() {
        return { search: exaSearchMock };
      }),
    }));
    vi.resetModules();

    process.env.EXA_API_KEY = 'test-exa-key';
    process.env.TAVILY_API_KEY = 'test-tavily-key';
  });

  afterEach(() => {
    vi.doUnmock('exa-js');
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns Exa results without calling Tavily when Exa succeeds', async () => {
    exaSearchMock.mockResolvedValue({
      results: [{ title: 'Acme', url: 'https://acme.com', text: 'Acme is a company.' }],
    });

    const { search } = await import('./search');
    const result = await search('acme inc', 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([{ title: 'Acme', url: 'https://acme.com', snippet: 'Acme is a company.' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls through to Tavily when Exa fails', async () => {
    exaSearchMock.mockRejectedValue(Object.assign(new Error('rate limited'), { statusCode: 429 }));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ title: 'Acme', url: 'https://acme.com', content: 'Acme snippet.' }] }),
    });

    const { search } = await import('./search');
    const result = await search('acme inc', 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([{ title: 'Acme', url: 'https://acme.com', snippet: 'Acme snippet.' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.tavily.com/search');
  });

  it('falls through to Tavily on a non-quota Exa failure too', async () => {
    exaSearchMock.mockRejectedValue(new Error('socket hang up'));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    });

    const { search } = await import('./search');
    const result = await search('acme inc', 5);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns SEARCH_QUOTA, not an empty array, when both providers fail', async () => {
    exaSearchMock.mockRejectedValue(Object.assign(new Error('quota exceeded'), { statusCode: 402 }));
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    const { search } = await import('./search');
    const result = await search('acme inc', 5);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SEARCH_QUOTA');
  });

  it('returns SEARCH_QUOTA, distinguishable from a genuinely empty result set, when both keys are unset', async () => {
    delete process.env.EXA_API_KEY;
    delete process.env.TAVILY_API_KEY;

    const { search } = await import('./search');
    const result = await search('acme inc', 5);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SEARCH_QUOTA');
    expect(exaSearchMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a genuinely empty result set from a working provider stays ok([]), not a failure', async () => {
    exaSearchMock.mockResolvedValue({ results: [] });

    const { search } = await import('./search');
    const result = await search('a query with no results at all', 5);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });
});

// Runs against the real Exa API only when a real key is present (docs/PROMPTBOOK.md
// P4.1: "if real EXA_API_KEY/TAVILY_API_KEY are present... add ONE small live test").
describe('search() (live)', () => {
  const hasLiveKeys = Boolean(ORIGINAL_ENV.EXA_API_KEY) && Boolean(ORIGINAL_ENV.TAVILY_API_KEY);

  it.skipIf(!hasLiveKeys)(
    'finds at least one real result for a well-known company',
    async () => {
      const { search } = await import('./search');
      const result = await search('Stripe payments company', 3);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0]!.url).toMatch(/^https?:\/\//);
    },
    15000,
  );
});
