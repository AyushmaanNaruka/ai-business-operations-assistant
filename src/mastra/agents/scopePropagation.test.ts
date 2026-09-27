import { describe, expect, it, vi } from 'vitest';
import { Agent } from '@mastra/core/agent';
import { MockLanguageModelV3 } from 'ai/test';
import { createSourceRegistry } from '@/modules/sources/registry';
import type { Source } from '@/types';

// D-72 end to end, with no provider: a real Mastra agent, driven by a scripted model that
// calls list_datasets, run through the real delegate(). Proves the task's source ids
// reach the tool through Mastra's RequestContext, not just that the tool honours a scope
// handed to it directly (analysis.test.ts covers that).
vi.mock('../runtime', () => {
  const table = (id: string, name: string, tableName: string): Source => ({
    id,
    name,
    kind: 'xlsx',
    origin: 'upload',
    status: 'ready',
    summary: '',
    addedAt: '2026-09-27T00:00:00.000Z',
    tables: [{ tableName, rowCount: 1, columns: [], qualityWarnings: [] }],
  });
  const registry = createSourceRegistry();
  registry.addSource(table('src_1', 'mine.xlsx', 'mine'));
  registry.addSource(table('src_2', 'theirs.xlsx', 'theirs'));
  return { getRuntime: async () => ({ registry }) };
});

const { listDatasetsTool } = await import('../tools/analysis');
const { buildTask, delegate } = await import('./contracts');

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

// Typed loosely on purpose: Mastra's model type wants a stream-shaped doGenerate, while
// the AI SDK mock returns a generate result; Mastra adapts it at runtime, as this test shows.
function scriptedModel(): never {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      call++;
      if (call === 1) {
        return {
          content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'list_datasets', input: '{}' }],
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage,
          warnings: [],
        };
      }
      return { content: [{ type: 'text', text: 'Only one table is available.' }], finishReason: { unified: 'stop', raw: 'end_turn' }, usage, warnings: [] };
    },
  }) as never;
}

describe('source scope reaches the tools through a real agent run (D-72)', () => {
  it('a delegated specialist lists only its own conversation\'s tables', async () => {
    const agent = new Agent({ id: 'scope-probe', name: 'Scope Probe', instructions: 'probe', model: scriptedModel(), tools: { list_datasets: listDatasetsTool } });

    const run = await agent.generate('x', { maxSteps: 3 });
    const unscoped = run.steps.flatMap((s) => s.toolResults).map((r) => (r as { payload?: { result?: unknown } }).payload?.result);
    expect(JSON.stringify(unscoped)).toContain('theirs');

    const scopedAgent = new Agent({ id: 'scope-probe-2', name: 'Scope Probe', instructions: 'probe', model: scriptedModel(), tools: { list_datasets: listDatasetsTool } });
    const spy = vi.spyOn(scopedAgent, 'generate');
    await delegate(scopedAgent, buildTask('Which tables?', ['src_1'], [], 'a list'), { extractGaps: async () => [] });

    const scopedRun = await spy.mock.results[0]!.value;
    const results = scopedRun.steps.flatMap((s: { toolResults: unknown[] }) => s.toolResults).map((r: { payload?: { result?: unknown } }) => r.payload?.result);
    expect(results).toEqual([{ ok: true, data: { tables: [{ tableName: 'mine', rowCount: 1, sourceName: 'mine.xlsx' }] } }]);
  });
});
