import { afterEach, describe, expect, it, vi } from 'vitest';

describe('MODELS fallback chains', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('puts Gemini first and Groq second for the reasoning tiers', async () => {
    const { MODELS } = await import('./models');
    for (const tier of [MODELS.ANALYST, MODELS.WRITER]) {
      expect(tier.map((m) => m.model)).toEqual(['google/gemini-2.5-flash', 'groq/openai/gpt-oss-120b']);
      // No retries on the primary: a daily quota 429 will not clear on a retry.
      expect(tier[0].maxRetries).toBe(0);
    }
  });

  it('keeps RERANK a plain string, since rag.ts builds a single model router from it', async () => {
    const { MODELS } = await import('./models');
    expect(typeof MODELS.RERANK).toBe('string');
    expect(typeof MODELS.ROUTER).toBe('string');
  });

  it('drops the Groq fallback when MODEL_FALLBACK=off', async () => {
    vi.stubEnv('MODEL_FALLBACK', 'off');
    const { MODELS } = await import('./models');
    expect(MODELS.ANALYST.map((m) => m.model)).toEqual(['google/gemini-2.5-flash']);
  });
});
