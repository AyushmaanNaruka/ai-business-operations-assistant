/**
 * Forces `Accept-Encoding: identity` on outgoing requests to the two live model
 * hosts this project calls (docs/DECISIONS.md, gzip decompression fix). Every
 * MODELS.* string below is resolved lazily by Mastra's own model router (never
 * turned into a provider instance in this file, so `new
 * ModelRouterLanguageModel(MODELS.RERANK)` in src/modules/documents/rag.ts keeps
 * working: that call needs the plain string), which reads `globalThis.fetch` at
 * call time rather than accepting a per-agent fetch override here, so the only
 * place to intervene is the global itself, installed once as this module's own
 * import-time side effect (every agent file imports MODELS from here before
 * constructing its Agent, so this always runs first).
 *
 * P5.7 verification traced a real, reproducing failure through the live
 * orchestrator: `Agent.generate()` against `gemini-2.5-flash`, through Mastra's
 * own streaming response reader (`@mastra/core`'s `createStream`/`Object.start`,
 * not a plain `generateText`), threw `AI_JSONParseError` on a `responseBody`
 * that is still raw gzip (starts with bytes `1F 8B 08`, gzip's own magic
 * number) with `responseHeaders: {}`. That combination means the response
 * stream Mastra's reader consumed was never handed through undici's transparent
 * gunzip, whatever un-set the response's own header the moment it did. Refusing
 * the compressed encoding on the request removes the failure mode entirely: the
 * server has nothing to gzip, so there is nothing to fail to un-gzip, regardless
 * of which body-reading path a caller takes. Confirmed fixed against the live
 * API (see this session's report for before/after).
 */
const GZIP_AFFECTED_HOSTS = new Set(['generativelanguage.googleapis.com', 'api.groq.com']);

function installIdentityEncodingFetchPatch(): void {
  const g = globalThis as { fetch: typeof fetch; __identityEncodingFetchPatched__?: boolean };
  if (g.__identityEncodingFetchPatched__) return; // idempotent: tests may import models.ts more than once
  const originalFetch = g.fetch.bind(g);

  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let hostname: string;
    try {
      hostname = new URL(input instanceof Request ? input.url : input).hostname;
    } catch {
      return originalFetch(input, init);
    }
    if (!GZIP_AFFECTED_HOSTS.has(hostname)) return originalFetch(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('accept-encoding', 'identity');
    return originalFetch(input, { ...init, headers });
  }) as typeof fetch;

  g.__identityEncodingFetchPatched__ = true;
}

installIdentityEncodingFetchPatch();

/**
 * Model tiers, not model names. Every agent and tool in this codebase imports MODELS.*
 * and never a hardcoded model string, so swapping provider or model is a one file
 * change. Enforced by convention: `grep -r "gemini\|llama\|groq/" src --include=*.ts`
 * should return only this file.
 */
export const MODELS = {
  // Cheap and fast. Intent classification and other short, low stakes decisions.
  // groq/openai/gpt-oss-120b, not the originally planned llama-3.3-70b-versatile:
  // see docs/DECISIONS.md D-24, that model is not in this project's live Groq
  // account's model catalog.
  ROUTER: 'groq/openai/gpt-oss-120b',
  // Reasoning over evidence: the data analyst, document and research agents, synthesis.
  ANALYST: 'google/gemini-2.5-flash',
  // Authoring the one model step in the artifact workflow, where output quality matters most.
  WRITER: 'google/gemini-2.5-flash',
  // Re-scoring retrieved passages down to the top few. Small, fast, run often.
  // groq/openai/gpt-oss-20b, not the originally planned llama-3.1-8b-instant:
  // see docs/DECISIONS.md D-24, same account-catalog issue as ROUTER above.
  RERANK: 'groq/openai/gpt-oss-20b',
} as const;
