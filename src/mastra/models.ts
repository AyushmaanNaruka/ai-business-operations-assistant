/**
 * Forces `Accept-Encoding: identity` on outgoing requests to the model hosts
 * this project calls (docs/DECISIONS.md, gzip decompression fix). Every
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
// OpenAI and Anthropic are included too: identity encoding costs nothing but bytes, and the
// failure below is in the shared response reader, not in any one provider.
const GZIP_AFFECTED_HOSTS = new Set(['generativelanguage.googleapis.com', 'api.groq.com', 'api.openai.com', 'api.anthropic.com']);

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
 *
 * Four providers are supported through Mastra's model router, each switched on by its
 * own API key (docs/DECISIONS.md D-48, D-53, D-54):
 *
 *   anthropic  ANTHROPIC_API_KEY             paid, Claude
 *   openai     OPENAI_API_KEY                paid, GPT
 *   google     GOOGLE_GENERATIVE_AI_API_KEY  free tier for development, or paid
 *   groq       GROQ_API_KEY                  free tier for development, or paid
 *
 * Each tier is an ordered fallback chain built from the defaults below: only entries
 * whose provider has a key set are kept, paid providers first, so a deployment that
 * adds a paid key starts using it with no code change and keeps the free models as
 * fallbacks. Three environment variables adjust that without touching this file:
 *
 *   MODEL_PROVIDERS=anthropic,openai   allowlist: models from any other provider are
 *                                      never called, even if their key is present.
 *                                      Use it to keep company data off free tiers,
 *                                      whose terms may allow the provider to use it.
 *   MODEL_ANALYST=a/x,b/y (and MODEL_WRITER, MODEL_ROUTER, MODEL_RERANK,
 *   MODEL_EMBEDDER)                    replaces that tier's default chain.
 *   MODEL_FALLBACK=off                 keeps only the first available model per tier.
 */

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'groq';

/** The environment variable each provider's key is read from (the ones Mastra's model router itself reads). */
export const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  groq: 'GROQ_API_KEY',
};

export type ModelChain = { id: string; model: string; maxRetries: number }[];

type TierName = 'ANALYST' | 'WRITER' | 'ROUTER' | 'RERANK' | 'EMBEDDER';

/**
 * Default chains, best first. Paid models lead so a key, once added, is used; the
 * free tier chain after them is the one this project was developed and evaluated
 * against: Gemini 2.5 Flash, Gemini 3.5 Flash Lite (a separate daily quota, D-53),
 * then Groq.
 */
const DEFAULT_CHAINS: Record<TierName, string[]> = {
  // Reasoning over evidence: the orchestrator and the three specialists.
  // Sonnet 5, not Opus 5 (D-73): the Scenario A dry run ran on Sonnet 5 and met the
  // grounding bar, at 40% of Opus 5's per-token price.
  ANALYST: [
    'anthropic/claude-sonnet-5',
    'openai/gpt-5.5',
    'google/gemini-2.5-flash',
    'google/gemini-3.5-flash-lite',
    'groq/openai/gpt-oss-120b',
  ],
  // Authoring the one model step in the artifact workflow, where output quality matters most.
  WRITER: [
    'anthropic/claude-sonnet-5',
    'openai/gpt-5.5',
    'google/gemini-2.5-flash',
    'google/gemini-3.5-flash-lite',
    'groq/openai/gpt-oss-120b',
  ],
  // Cheap and fast: intent classification and other short, low stakes decisions.
  // groq/openai/gpt-oss-120b rather than the originally planned llama-3.3-70b-versatile:
  // see docs/DECISIONS.md D-24, that model is not in this project's Groq catalog.
  ROUTER: ['anthropic/claude-haiku-4-5', 'openai/gpt-5.4-mini', 'groq/openai/gpt-oss-120b', 'google/gemini-3.5-flash-lite'],
  // Re-scoring retrieved passages down to the top few. Small, fast, run often.
  RERANK: ['anthropic/claude-haiku-4-5', 'openai/gpt-5.4-mini', 'groq/openai/gpt-oss-20b', 'google/gemini-3.5-flash-lite'],
  // Embeddings for the RAG path. Anthropic and Groq offer no embedding model.
  EMBEDDER: ['google/gemini-embedding-001', 'openai/text-embedding-3-small'],
};

const TIER_ENV: Record<TierName, string> = {
  ANALYST: 'MODEL_ANALYST',
  WRITER: 'MODEL_WRITER',
  ROUTER: 'MODEL_ROUTER',
  RERANK: 'MODEL_RERANK',
  EMBEDDER: 'MODEL_EMBEDDER',
};

type Env = Record<string, string | undefined>;

export function providerOf(model: string): ProviderId | null {
  const provider = model.split('/')[0];
  return provider && provider in PROVIDER_KEY_ENV ? (provider as ProviderId) : null;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Providers that may be called: the MODEL_PROVIDERS allowlist when set, otherwise all four. */
export function allowedProviders(env: Env): Set<ProviderId> {
  const listed = splitList(env.MODEL_PROVIDERS)
    .map((p) => p.toLowerCase())
    .filter((p): p is ProviderId => p in PROVIDER_KEY_ENV);
  return new Set(listed.length > 0 ? listed : (Object.keys(PROVIDER_KEY_ENV) as ProviderId[]));
}

function hasKey(env: Env, provider: ProviderId): boolean {
  return (env[PROVIDER_KEY_ENV[provider]] ?? '').trim().length > 0;
}

/**
 * The ordered model ids a tier will try. Entries from a provider outside the
 * allowlist are always dropped. Entries whose provider has no key are dropped too,
 * unless that would leave nothing, in which case the allowlisted chain is kept as is
 * so the first call fails with the provider's own clear "missing API key" error
 * instead of a silent empty chain.
 */
export function resolveTierModels(tier: TierName, env: Env): string[] {
  const allowed = allowedProviders(env);
  const configured = splitList(env[TIER_ENV[tier]]);
  const candidates = (configured.length > 0 ? configured : DEFAULT_CHAINS[tier]).filter((m) => {
    const provider = providerOf(m);
    return provider !== null && allowed.has(provider);
  });
  const available = candidates.filter((m) => hasKey(env, providerOf(m)!));
  const chain = available.length > 0 ? available : candidates;
  return env.MODEL_FALLBACK === 'off' ? chain.slice(0, 1) : chain;
}

/**
 * `maxRetries` per entry: 0 on Gemini, whose free tier quota is per day, so a 429
 * does not clear on a retry and only delays the next entry (D-48); 1 elsewhere, since
 * a paid provider's 429 or overload does clear quickly; and at least 1 on the last
 * entry, which has nothing after it.
 */
function toChain(models: string[]): ModelChain {
  return models.map((model, i) => ({
    id: model.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    model,
    maxRetries: i === models.length - 1 || providerOf(model) !== 'google' ? 1 : 0,
  }));
}

export function buildModelTiers(env: Env) {
  return {
    ROUTER: toChain(resolveTierModels('ROUTER', env)),
    ANALYST: toChain(resolveTierModels('ANALYST', env)),
    WRITER: toChain(resolveTierModels('WRITER', env)),
    // Plain strings: src/modules/documents/rag.ts hands these to
    // `new ModelRouterLanguageModel(...)` / `new ModelRouterEmbeddingModel(...)`,
    // which each take exactly one model id, so only the first available entry is used.
    RERANK: resolveTierModels('RERANK', env)[0] ?? DEFAULT_CHAINS.RERANK[0]!,
    EMBEDDER: resolveTierModels('EMBEDDER', env)[0] ?? DEFAULT_CHAINS.EMBEDDER[0]!,
  };
}

export const MODELS = buildModelTiers(process.env);

/** What the chat UI may show about the models in use: ids only, never keys. */
export function describeModels(): { analyst: string[]; router: string | undefined } {
  return { analyst: MODELS.ANALYST.map((m) => m.model), router: MODELS.ROUTER[0]?.model };
}

/**
 * D-60 (D-62 widened the detection, same fix): on a tool-calling call (specialist
 * delegation, artifact authoring, an agent whose tools are declared but currently
 * unusable, e.g. the research agent with no search keys), Groq's `openai/gpt-oss-120b`
 * rejects `jsonPromptInjection: true` (contracts.ts's `delegate()`, artifactSteps.ts's
 * `authorPlanOnce`) two different ways, both discarding an already well-formed answer:
 *
 * 1. It answers by calling a tool named "json" that was never declared (prompt
 *    injection deliberately avoids registering one, to sidestep a separate, confirmed
 *    Gemini conflict below): "Tool call validation failed: ... attempted to call tool
 *    'json' which was not in request.tools" (400, isRetryable: false).
 * 2. When the agent has other real tools declared, Groq's API rejects the call outright
 *    before the model even runs: "json mode cannot be combined with tool/function
 *    calling". `jsonPromptInjection: true` avoids this exact conflict on Gemini (the
 *    reason it was chosen at all, D-38) but not on Groq, whose API is stricter about
 *    the same request shape.
 *
 * Retrying the same call with `jsonPromptInjection` left off resolves both: Mastra's
 * native structured-output mode on a tool-calling model registers a *real* "json" tool
 * and forces tool_choice to it (pure function-calling, no separate JSON response mode
 * to conflict with the agent's other tools), so whichever model actually serves the
 * retry gets a request that matches what it wants to call. Only retried on these two
 * exact failure signatures, once, so a genuinely malformed model response (any other
 * error) still surfaces as before. Both are Gemini-quota-exhaustion-shaped: they only
 * bite once the fallback chain (D-53) reaches Groq, which is otherwise silent in normal
 * operation.
 */
const GROQ_JSON_STRUCTURED_OUTPUT_FALLBACK_ERROR =
  /attempted to call tool ['"]json['"] which was not in request\.tools|json mode cannot be combined with tool\/function calling/i;

function isGroqJsonStructuredOutputFallbackError(err: unknown): boolean {
  return err instanceof Error && GROQ_JSON_STRUCTURED_OUTPUT_FALLBACK_ERROR.test(err.message);
}

/**
 * Agent loop step budgets (D-63). Mastra's default is 5, which a specialist spends on
 * list_datasets, describe_dataset and a couple of run_sql attempts before it ever
 * writes its answer: the run then ends on `finishReason: "tool-calls"` with an empty
 * `object`, surfacing as a PARSE_FAILED gap. Gemini 2.5 Flash usually fits in 5; the
 * fallback models (D-53) retry SQL more and did not, measured live.
 */
/**
 * Default call options for every agent (D-73): Anthropic prompt caching. The request
 * level `cacheControl` becomes Anthropic's automatic caching, so each step of a tool
 * loop reads the previous step's prefix (instructions, tools, earlier tool results) from
 * cache at a tenth of the input price instead of paying for it again. Measured before
 * this, every call in the Scenario A dry run had zero cached tokens and input was about
 * 80% of the spend. Keyed by provider, so it is inert on OpenAI (which caches
 * automatically), Gemini and Groq.
 */
export const AGENT_DEFAULT_OPTIONS = {
  providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' as const } } },
};

export const SPECIALIST_MAX_STEPS = 12;
export const ORCHESTRATOR_MAX_STEPS = 10;

export type StructuredOutputAgent = { generate: (prompt: string, options: unknown) => Promise<{ object: unknown }> };

export async function generateStructuredOutput(
  agent: StructuredOutputAgent,
  prompt: string,
  schema: unknown,
): Promise<unknown> {
  try {
    return (await agent.generate(prompt, { structuredOutput: { schema, jsonPromptInjection: true }, maxSteps: SPECIALIST_MAX_STEPS })).object;
  } catch (err) {
    if (!isGroqJsonStructuredOutputFallbackError(err)) throw err;
    return (await agent.generate(prompt, { structuredOutput: { schema }, maxSteps: SPECIALIST_MAX_STEPS })).object;
  }
}
