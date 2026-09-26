import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@mastra/core/agent';
import type { Evidence } from '@/types/evidence';
import { buildTask, delegate, SpecialistResultSchema, SpecialistTaskSchema } from './contracts';

const sampleEvidence: Evidence = {
  id: 'E1',
  claim: 'conversion rate is 4.2%',
  kind: 'computed',
  sourceId: 'src_1',
  sourceName: 'campaigns.xlsx',
  locator: 'campaigns',
  method: 'SELECT SUM(conversions) / SUM(clicks) FROM campaigns',
  value: 0.042,
  confidence: 'high',
  createdAt: '2026-09-24T00:00:00.000Z',
};

/**
 * A minimal stand-in for a Mastra `Agent`: delegate() only ever calls `.generate()`
 * and reads `.name` (for its error message), so the test double only needs those two
 * members. Cast through `unknown` because a real `Agent` carries many members this
 * stub deliberately does not implement; that gap is the point of stubbing it.
 */
function fakeAgent(generateImpl: (...args: unknown[]) => unknown): Agent {
  return { name: 'Fake Specialist', generate: vi.fn(generateImpl) } as unknown as Agent;
}

describe('buildTask', () => {
  it('produces a SpecialistTask that round-trips through SpecialistTaskSchema.parse', () => {
    const task = buildTask(
      'Identify the best and worst performing campaigns',
      ['src_1'],
      [sampleEvidence],
      'ranked findings with supporting numbers',
      ['Q3 only'],
    );

    expect(() => SpecialistTaskSchema.parse(task)).not.toThrow();
    const parsed = SpecialistTaskSchema.parse(task);
    expect(parsed).toEqual(task);
  });

  it('omits constraints entirely when none are given, rather than writing an empty array', () => {
    const task = buildTask('Summarise the brief', ['src_2'], [], 'one paragraph');
    expect(task.constraints).toBeUndefined();
    expect(() => SpecialistTaskSchema.parse(task)).not.toThrow();
  });
});

describe('delegate (D-66)', () => {
  const task = buildTask('Identify the best channel', ['src_1'], [], 'one ranked finding');
  const recorded = (evidence: unknown, ok = true) => ({ payload: { toolName: 'record_evidence', result: ok ? { ok: true, data: { evidence } } : { ok: false, error: { code: 'QUERY_INVALID', message: 'bad', recoverable: true } } } });

  it('keeps the prose answer verbatim, takes evidence from record_evidence results, and sends only the task', async () => {
    const answer = 'Email is the most efficient channel at a 4.2% conversion rate [E1].';
    const agent = fakeAgent(() =>
      Promise.resolve({ steps: [{ text: 'Let me check.', toolResults: [recorded(sampleEvidence)] }, { text: answer, toolResults: [] }] }),
    );
    const extractGaps = vi.fn().mockResolvedValue(['No CLV column']);

    const result = await delegate(agent, task, { extractGaps });

    expect(result).toEqual({ answer, evidence: [sampleEvidence], gaps: ['No CLV column'], failures: [] });
    expect(extractGaps).toHaveBeenCalledWith(answer, 'Identify the best channel');
    const [prompt, options] = (agent.generate as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { maxSteps?: number; structuredOutput?: unknown }];
    expect(prompt).toContain('"objective":"Identify the best channel"');
    expect(prompt).toContain('"sourceIds":["src_1"]');
    expect(options.maxSteps).toBeGreaterThan(5);
    expect(options.structuredOutput).toBeUndefined();
  });

  it('uses the answer and gaps from a specialist that still writes JSON, without the extraction call', async () => {
    const json = '```json\n{"answer":"No CLV in the data.","evidence":[],"gaps":["no customer level rows"],"failures":[]}\n```';
    const agent = fakeAgent(() => Promise.resolve({ steps: [{ text: json, toolResults: [] }] }));
    const extractGaps = vi.fn();

    const result = await delegate(agent, task, { extractGaps });

    expect(result.answer).toBe('No CLV in the data.');
    expect(result.gaps).toEqual(['no customer level rows']);
    expect(extractGaps).not.toHaveBeenCalled();
  });

  it('ignores failed or malformed record_evidence results and other tools, and dedupes by id', async () => {
    const agent = fakeAgent(() =>
      Promise.resolve({
        steps: [
          { toolResults: [recorded(sampleEvidence), recorded(sampleEvidence), recorded(null, false), recorded({ id: 'E2' })] },
          { toolResults: [{ payload: { toolName: 'run_sql', result: { ok: true, data: { rows: [] } } } }] },
          { text: 'Answer [E1].', toolResults: [] },
        ],
      }),
    );
    const result = await delegate(agent, task, { extractGaps: async () => [] });
    expect(result.evidence).toEqual([sampleEvidence]);
  });

  it('reports non recoverable tool failures, not ones the specialist could correct', async () => {
    const hard = { code: 'SEARCH_QUOTA', message: 'quota spent', recoverable: false };
    const agent = fakeAgent(() =>
      Promise.resolve({
        steps: [
          { toolResults: [recorded(null, false), { payload: { toolName: 'web_search', result: { ok: false, error: hard } } }] },
          { text: 'Research is unavailable.', toolResults: [] },
        ],
      }),
    );
    const result = await delegate(agent, task, { extractGaps: async () => [] });
    expect(result.failures).toEqual([hard]);
  });

  it('rejects when the loop ends without any answer text', async () => {
    const agent = fakeAgent(() => Promise.resolve({ text: '', steps: [{ text: '', toolResults: [] }] }));
    await expect(delegate(agent, task, { extractGaps: async () => [] })).rejects.toThrow(/stopped before writing an answer/);
  });

  it('still returns the answer, with no gaps, when gap extraction itself fails', async () => {
    const agent = fakeAgent(() => Promise.resolve({ steps: [{ text: 'Answer.', toolResults: [] }] }));
    const result = await delegate(agent, task, { extractGaps: () => Promise.reject(new Error('rate limited')) });
    expect(result).toEqual({ answer: 'Answer.', evidence: [], gaps: [], failures: [] });
  });
});

describe('SpecialistResultSchema', () => {
  it('accepts a result with populated gaps and failures', () => {
    const result = {
      answer: 'Could not determine churn rate.',
      evidence: [],
      gaps: ['no refund_rate column in campaigns.xlsx'],
      failures: [{ code: 'NO_DATA' as const, message: 'no rows matched', recoverable: true }],
    };
    expect(() => SpecialistResultSchema.parse(result)).not.toThrow();
  });
});
