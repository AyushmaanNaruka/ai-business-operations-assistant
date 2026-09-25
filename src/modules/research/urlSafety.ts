import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';

/**
 * Server side request forgery guard for every URL this system fetches on a user's
 * or a document's behalf (docs/DECISIONS.md D-55). A research request, a URL
 * source, or a link planted in an uploaded file must never make the server read
 * an internal address: cloud metadata (169.254.169.254), localhost services, or
 * the company's own private network. Only public http(s) hosts pass.
 *
 * Set RESEARCH_ALLOW_PRIVATE_URLS=1 to switch the guard off, for example to
 * research an intranet page on purpose in a trusted, single user deployment.
 */

const MAX_REDIRECTS = 5;

/** True for any address that is not publicly routable. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 || // "this" network
      a === 10 || // private
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // carrier grade NAT
      (a === 169 && b === 254) || // link local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 192 && b === 0) || // IETF protocol assignments
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') || // unique local
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') || // link local
      lower.startsWith('ff') // multicast
    );
  }
  return true; // not an IP at all: treat as unsafe
}

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) => (await lookup(hostname, { all: true })).map((r) => r.address);

function guardDisabled(): boolean {
  return process.env.RESEARCH_ALLOW_PRIVATE_URLS === '1';
}

/** Checks one URL: http(s) only, no credentials in it, and every address its host resolves to is public. */
export async function checkPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<ToolResult<URL>> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('UNSUPPORTED', `"${raw}" is not a valid web address.`, { recoverable: false });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('UNSUPPORTED', `Only http and https addresses can be read, not "${url.protocol}".`, { recoverable: false });
  }
  if (url.username || url.password) {
    return fail('UNSUPPORTED', 'Web addresses with a username or password in them are not read.', { recoverable: false });
  }
  if (guardDisabled()) return ok(url);

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const blockedMessage = `"${url.hostname}" is a private or internal address, which this system does not read.`;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return fail('UNSUPPORTED', blockedMessage, { recoverable: false });
  }
  if (isIP(host)) {
    return isPrivateAddress(host) ? fail('UNSUPPORTED', blockedMessage, { recoverable: false }) : ok(url);
  }

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch (err) {
    return fail('NETWORK', `Could not look up "${url.hostname}": ${(err as Error).message}`, { recoverable: true });
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    return fail('UNSUPPORTED', blockedMessage, { recoverable: false });
  }
  return ok(url);
}

/**
 * `fetch` for a URL that came from a user or a document. Redirects are followed by
 * hand, so every hop is checked again: a public page answering with a redirect to
 * an internal address is refused rather than followed. A DNS answer can still
 * change between this check and the connection (rebinding); closing that fully
 * needs pinning the connection to the checked address, which is not done here.
 */
export async function safeFetch(raw: string, init: RequestInit = {}, resolve: Resolver = defaultResolver): Promise<ToolResult<Response>> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await checkPublicUrl(current, resolve);
    if (!checked.ok) return checked;
    let response: Response;
    try {
      response = await fetch(checked.data.toString(), { ...init, redirect: 'manual' });
    } catch (err) {
      return fail('NETWORK', `Could not fetch "${current}": ${(err as Error).message}`, { recoverable: true });
    }
    const location = response.headers?.get?.('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, checked.data).toString();
      continue;
    }
    return ok(response);
  }
  return fail('PAGE_BLOCKED', `"${raw}" redirected more than ${MAX_REDIRECTS} times.`, { recoverable: false });
}
