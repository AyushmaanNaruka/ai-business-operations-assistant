import { describe, expect, it } from 'vitest';
import { rebalance, route, type DocEntry } from './route';

// Defaults from .env.example: DOC_FULL_CONTEXT_TOKEN_LIMIT=25000, SESSION_DOC_TOKEN_BUDGET=60000.
const FULL_LIMIT = 25000;
const SESSION_BUDGET = 60000;

describe('route', () => {
  it('routes full just under the per-document limit', () => {
    expect(route(FULL_LIMIT - 1, 0)).toBe('full');
    expect(route(FULL_LIMIT, 0)).toBe('full');
  });

  it('routes indexed just over the per-document limit', () => {
    expect(route(FULL_LIMIT + 1, 0)).toBe('indexed');
  });

  it('routes indexed when the document itself is small but the session total would bust the budget', () => {
    expect(route(2000, SESSION_BUDGET - 1000)).toBe('indexed');
  });

  it('routes full when the document is small and the session has room', () => {
    expect(route(2000, 1000)).toBe('full');
  });
});

describe('rebalance', () => {
  it('leaves everything alone when the session is under budget', () => {
    const docs: DocEntry[] = [
      { sourceId: 'src_1', tokenCount: 1000, mode: 'full' },
      { sourceId: 'src_2', tokenCount: 2000, mode: 'full' },
    ];
    expect(rebalance(docs)).toEqual(docs);
  });

  it('flips the largest full document, not the newest, when a third document busts the budget', () => {
    const docs: DocEntry[] = [
      { sourceId: 'src_1', tokenCount: 40000, mode: 'full' }, // the largest
      { sourceId: 'src_2', tokenCount: 5000, mode: 'full' },
      { sourceId: 'src_3', tokenCount: 20000, mode: 'full' }, // the newest, smaller than src_1
    ];
    // total is 65000, over the 60000 budget.
    const result = rebalance(docs);

    const bySourceId = Object.fromEntries(result.map((d) => [d.sourceId, d.mode]));
    expect(bySourceId.src_1).toBe('indexed'); // the largest flips
    expect(bySourceId.src_2).toBe('full'); // untouched
    expect(bySourceId.src_3).toBe('full'); // untouched, even though it is the newest
  });

  it('flips more than one document if flipping just the largest is not enough to fit the budget', () => {
    // Four equal 25000-token docs (100000 total): removing any single one
    // still leaves 75000, over the 60000 budget, so a second flip is required.
    const docs: DocEntry[] = [
      { sourceId: 'a', tokenCount: 25000, mode: 'full' },
      { sourceId: 'b', tokenCount: 25000, mode: 'full' },
      { sourceId: 'c', tokenCount: 25000, mode: 'full' },
      { sourceId: 'd', tokenCount: 25000, mode: 'full' },
    ];
    const result = rebalance(docs);
    const fullTotal = result.filter((d) => d.mode === 'full').reduce((s, d) => s + d.tokenCount, 0);
    const flippedCount = result.filter((d) => d.mode === 'indexed').length;
    expect(fullTotal).toBeLessThanOrEqual(SESSION_BUDGET);
    expect(flippedCount).toBeGreaterThanOrEqual(2);
  });

  it('leaves indexed documents alone; only full ones are candidates to flip', () => {
    const docs: DocEntry[] = [
      { sourceId: 'src_1', tokenCount: 70000, mode: 'indexed' }, // already indexed, and larger
      { sourceId: 'src_2', tokenCount: 45000, mode: 'full' },
    ];
    const result = rebalance(docs);
    expect(result.find((d) => d.sourceId === 'src_1')!.mode).toBe('indexed');
    expect(result.find((d) => d.sourceId === 'src_2')!.mode).toBe('full');
  });
});
