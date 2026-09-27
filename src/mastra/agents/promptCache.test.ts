import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@mastra/core/agent';

// D-73: every production agent must send Anthropic's prompt caching flag, or each step of
// a tool loop pays full price for the whole prompt again. Checked at the wire, with the
// Anthropic endpoint intercepted, so no request leaves the machine and no key is spent.
const bodies: { cache_control?: unknown }[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('api.anthropic.com')) return realFetch(input, init);
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'intercepted' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

async function firstRequestBody(agent: Agent): Promise<{ cache_control?: unknown }> {
  bodies.length = 0;
  await agent.generate('hello', { maxSteps: 1 }).catch(() => undefined);
  return bodies[0] ?? {};
}

describe('Anthropic prompt caching on every agent', () => {
  it('each agent with a Claude model sends top level cache_control', async () => {
    const { Agent } = await import('@mastra/core/agent');
    const { AGENT_DEFAULT_OPTIONS } = await import('../models');
    const { orchestrator } = await import('./orchestrator');
    const { dataAnalyst } = await import('./dataAnalyst');
    const { documentAgent } = await import('./documentAgent');
    const { researchAgent } = await import('./researchAgent');

    const agents: Agent[] = [orchestrator, dataAnalyst, documentAgent, researchAgent];
    for (const agent of agents) {
      // The same instructions, tools and defaults, pinned to one Claude model, so the
      // check does not depend on which provider keys this machine happens to have.
      const pinned = new Agent({
        id: `${agent.id}-cache-probe`,
        name: agent.name,
        instructions: 'probe',
        model: 'anthropic/claude-sonnet-5',
        defaultOptions: await agent.getDefaultOptions(),
      });
      const body = await firstRequestBody(pinned);
      expect(body.cache_control, agent.name).toEqual({ type: 'ephemeral' });
    }
    expect(AGENT_DEFAULT_OPTIONS.providerOptions.anthropic.cacheControl).toEqual({ type: 'ephemeral' });
    // Importing all four agents (and Mastra with them) is most of the time; under a full
    // parallel run that alone has gone past 60s.
  }, 180000);
});
