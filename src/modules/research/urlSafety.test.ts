import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPublicUrl, isPrivateAddress, safeFetch, type Resolver } from './urlSafety';

const publicDns: Resolver = async () => ['93.184.216.34'];
const privateDns: Resolver = async () => ['10.0.0.5'];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isPrivateAddress', () => {
  it('flags loopback, private, link local, CGNAT and IPv6 internal ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('passes public addresses', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('checkPublicUrl', () => {
  it('accepts a public https URL', async () => {
    const result = await checkPublicUrl('https://example.com/about', publicDns);
    expect(result.ok).toBe(true);
  });

  it('refuses cloud metadata, localhost and private hosts', async () => {
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:4111/api', 'http://[::1]/', 'http://intranet.corp.internal/']) {
      const result = await checkPublicUrl(url, publicDns);
      expect(result.ok, url).toBe(false);
    }
  });

  it('refuses a public looking name that resolves to a private address', async () => {
    const result = await checkPublicUrl('https://sneaky.example.com/', privateDns);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/private or internal/);
  });

  it('refuses non http schemes and embedded credentials', async () => {
    expect((await checkPublicUrl('file:///etc/passwd', publicDns)).ok).toBe(false);
    expect((await checkPublicUrl('ftp://example.com/', publicDns)).ok).toBe(false);
    expect((await checkPublicUrl('https://user:pass@example.com/', publicDns)).ok).toBe(false);
  });

  it('can be switched off for a trusted deployment', async () => {
    vi.stubEnv('RESEARCH_ALLOW_PRIVATE_URLS', '1');
    expect((await checkPublicUrl('http://localhost:8080/', publicDns)).ok).toBe(true);
  });
});

describe('safeFetch', () => {
  it('refuses a redirect from a public page to an internal address', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await safeFetch('https://example.com/', {}, publicDns);
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect between public pages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/new' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await safeFetch('https://example.com/old', {}, publicDns);
    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://example.com/new');
  });
});
