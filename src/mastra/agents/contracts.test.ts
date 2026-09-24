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

describe('delegate', () => {
  it('resolves with the validated SpecialistResult when the agent returns a well formed object', async () => {
    const wellFormed = {
      answer: 'Email is the most efficient channel at a 4.2% conversion rate [E1].',
      evidence: [sampleEvidence],
      gaps: [],
      failures: [],
    };
    const agent = fakeAgent(() => Promise.resolve({ object: wellFormed }));

    const task = buildTask('Identify the best channel', ['src_1'], [], 'one ranked finding');
    const result = await delegate(agent, task);

    expect(result).toEqual(wellFormed);
    expect(agent.generate).toHaveBeenCalledTimes(1);

    // The task travels as the entire user message, serialised, with no chat history
    // attached (docs/03-ARCHITECTURE.md 3.2): the prompt must carry the task's own
    // fields and nothing that looks like prior conversation turns.
    const [prompt] = (agent.generate as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(prompt).toContain('"objective":"Identify the best channel"');
    expect(prompt).toContain('"sourceIds":["src_1"]');
  });

  it('rejects a malformed result (gaps missing) instead of passing it through', async () => {
    const malformed = {
      answer: 'Some answer.',
      evidence: [],
      // gaps is missing entirely
      failures: [],
    };
    const agent = fakeAgent(() => Promise.resolve({ object: malformed }));

    const task = buildTask('Identify the best channel', ['src_1'], [], 'one ranked finding');
    await expect(delegate(agent, task)).rejects.toThrow(/SpecialistResultSchema/);
  });

  it('rejects a malformed result (evidence has the wrong type) instead of passing it through', async () => {
    const malformed = {
      answer: 'Some answer.',
      evidence: 'E1, E2', // should be Evidence[], not a string
      gaps: [],
      failures: [],
    };
    const agent = fakeAgent(() => Promise.resolve({ object: malformed }));

    const task = buildTask('Identify the best channel', ['src_1'], [], 'one ranked finding');
    await expect(delegate(agent, task)).rejects.toThrow(/SpecialistResultSchema/);
  });

  it('rejects when the agent returns no object at all', async () => {
    const agent = fakeAgent(() => Promise.resolve({ object: undefined }));
    const task = buildTask('Identify the best channel', ['src_1'], [], 'one ranked finding');
    await expect(delegate(agent, task)).rejects.toThrow(/SpecialistResultSchema/);
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
