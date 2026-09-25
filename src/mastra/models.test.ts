import { describe, expect, it } from 'vitest';
import { allowedProviders, buildModelTiers, providerOf, resolveTierModels } from './models';

const FREE = { GOOGLE_GENERATIVE_AI_API_KEY: 'g', GROQ_API_KEY: 'q' };
const ALL = { ...FREE, ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' };

describe('model tiers', () => {
  it('with only free keys, keeps the chain the project was built against', () => {
    const tiers = buildModelTiers(FREE);
    for (const tier of [tiers.ANALYST, tiers.WRITER]) {
      expect(tier.map((m) => m.model)).toEqual([
        'google/gemini-2.5-flash',
        'google/gemini-3.5-flash-lite',
        'groq/openai/gpt-oss-120b',
      ]);
      // No retries on either Gemini entry: a daily quota 429 will not clear on a retry.
      expect(tier.map((m) => m.maxRetries)).toEqual([0, 0, 1]);
    }
    expect(tiers.ROUTER.map((m) => m.model)).toEqual(['groq/openai/gpt-oss-120b', 'google/gemini-3.5-flash-lite']);
    expect(tiers.RERANK).toBe('groq/openai/gpt-oss-20b');
    expect(tiers.EMBEDDER).toBe('google/gemini-embedding-001');
  });

  it('puts paid providers first once their keys are set, free models after as fallbacks', () => {
    const tiers = buildModelTiers(ALL);
    expect(tiers.ANALYST.map((m) => m.model).slice(0, 2)).toEqual(['anthropic/claude-opus-5', 'openai/gpt-5.5']);
    expect(tiers.ANALYST.at(-1)!.model).toBe('groq/openai/gpt-oss-120b');
    expect(tiers.ROUTER[0]!.model).toBe('anthropic/claude-haiku-4-5');
    expect(tiers.RERANK).toBe('anthropic/claude-haiku-4-5');
  });

  it('uses OpenAI embeddings when OpenAI is the only provider with a key', () => {
    const tiers = buildModelTiers({ OPENAI_API_KEY: 'o' });
    expect(tiers.ANALYST.map((m) => m.model)).toEqual(['openai/gpt-5.5']);
    expect(tiers.EMBEDDER).toBe('openai/text-embedding-3-small');
  });

  it('never calls a provider outside MODEL_PROVIDERS, even when its key is present', () => {
    const env = { ...ALL, MODEL_PROVIDERS: 'anthropic, openai' };
    expect([...allowedProviders(env)].sort()).toEqual(['anthropic', 'openai']);
    const analyst = resolveTierModels('ANALYST', env);
    expect(analyst).toEqual(['anthropic/claude-opus-5', 'openai/gpt-5.5']);
    expect(analyst.some((m) => m.startsWith('google/') || m.startsWith('groq/'))).toBe(false);
  });

  it('lets a tier be replaced by an env var, still filtered by keys and allowlist', () => {
    const env = { ...ALL, MODEL_ANALYST: 'openai/gpt-5.6, anthropic/claude-sonnet-5, unknown/model', MODEL_PROVIDERS: 'openai,anthropic' };
    expect(resolveTierModels('ANALYST', env)).toEqual(['openai/gpt-5.6', 'anthropic/claude-sonnet-5']);
  });

  it('MODEL_FALLBACK=off keeps only the first available model', () => {
    expect(resolveTierModels('ANALYST', { ...FREE, MODEL_FALLBACK: 'off' })).toEqual(['google/gemini-2.5-flash']);
  });

  it('with no keys at all, keeps the chain so the first call reports the missing key clearly', () => {
    expect(resolveTierModels('ANALYST', {}).length).toBeGreaterThan(0);
  });

  it('reads the provider from a model id', () => {
    expect(providerOf('groq/openai/gpt-oss-120b')).toBe('groq');
    expect(providerOf('anthropic/claude-opus-5')).toBe('anthropic');
    expect(providerOf('mistral/large')).toBeNull();
  });
});
