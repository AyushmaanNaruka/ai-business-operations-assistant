import { describe, expect, it } from 'vitest';
import type { Evidence } from '@/types';
import { detectConflicts } from './conflicts';

let counter = 0;
function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  counter += 1;
  return {
    id: `E${counter}`,
    claim: 'a claim',
    kind: 'computed',
    sourceId: 'src_1',
    sourceName: 'campaigns.xlsx',
    locator: 'campaigns',
    confidence: 'high',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('detectConflicts', () => {
  it('fires when matching metric name and scope disagree beyond tolerance', () => {
    const a = makeEvidence({
      value: 0.06,
      metric: { name: 'conversion_rate', scope: 'channel=paid_social', unit: 'ratio' },
    });
    const b = makeEvidence({
      value: 0.042,
      metric: { name: 'conversion_rate', scope: 'channel=paid_social', unit: 'ratio' },
    });

    const conflicts = detectConflicts([a, b]);

    expect(conflicts).toHaveLength(1);
    expect([conflicts[0]!.a.id, conflicts[0]!.b.id].sort()).toEqual([a.id, b.id].sort());
  });

  it('stays silent when values agree within tolerance', () => {
    const a = makeEvidence({ value: 0.042, metric: { name: 'conversion_rate', scope: 'channel=email', unit: 'ratio' } });
    const b = makeEvidence({ value: 0.0421, metric: { name: 'conversion_rate', scope: 'channel=email', unit: 'ratio' } });

    expect(detectConflicts([a, b])).toHaveLength(0);
  });

  it('stays silent when scopes differ, even with the same metric name and very different values', () => {
    const a = makeEvidence({ value: 0.06, metric: { name: 'conversion_rate', scope: 'channel=email', unit: 'ratio' } });
    const b = makeEvidence({ value: 0.01, metric: { name: 'conversion_rate', scope: 'channel=paid_social', unit: 'ratio' } });

    expect(detectConflicts([a, b])).toHaveLength(0);
  });

  it('stays silent when there is no metric key at all', () => {
    const a = makeEvidence({ claim: 'targets mid-market SaaS' });
    const b = makeEvidence({ claim: 'targets mid-market SaaS, differently worded' });

    expect(detectConflicts([a, b])).toHaveLength(0);
  });

  describe('ranking claims', () => {
    const rankKey = { name: 'conversion_rate_rank', scope: 'channel=paid_social', unit: 'count' } as const;

    function claimedTop(overrides: Partial<Evidence> = {}): Evidence {
      return makeEvidence({
        kind: 'document',
        claim: 'Growth team says Paid Social is the strongest performing channel this year',
        value: 1,
        sourceName: 'customer-notes.docx',
        metric: rankKey,
        ...overrides,
      });
    }

    it('fires when a claimed rank 1 meets a computed rank 6', () => {
      const claimed = claimedTop();
      const computed = makeEvidence({ claim: 'Paid Social ranks 6th of 6 channels by conversion rate', value: 6, metric: rankKey });

      const conflicts = detectConflicts([claimed, computed]);

      expect(conflicts).toHaveLength(1);
      expect([conflicts[0]!.a.value, conflicts[0]!.b.value].sort()).toEqual([1, 6]);
    });

    it('fires on adjacent ranks that a 5% count tolerance would call equal', () => {
      const a = makeEvidence({ value: 20, metric: { ...rankKey, scope: 'campaign=x' } });
      const b = makeEvidence({ value: 21, metric: { ...rankKey, scope: 'campaign=x' } });

      expect(detectConflicts([a, b])).toHaveLength(1);
    });

    it('stays silent when the claimed and computed ranks agree', () => {
      const claimed = claimedTop();
      const computed = makeEvidence({ value: 1, metric: rankKey });

      expect(detectConflicts([claimed, computed])).toHaveLength(0);
    });

    it('stays silent when the scopes differ', () => {
      const claimed = claimedTop();
      const computed = makeEvidence({ value: 6, metric: { ...rankKey, scope: 'channel=email' } });

      expect(detectConflicts([claimed, computed])).toHaveLength(0);
    });

    it('matches keys that differ only in case, spacing or hyphens', () => {
      const claimed = claimedTop({ metric: { name: 'Conversion Rate Rank', scope: 'Channel = Paid Social', unit: 'count' } });
      const computed = makeEvidence({ value: 6, metric: { name: 'conversion_rate_rank', scope: 'channel=paid-social', unit: 'count' } });

      expect(detectConflicts([claimed, computed])).toHaveLength(1);
    });
  });

  it('compares a digit string value, as DuckDB returns for DECIMAL columns, as a number', () => {
    const asString = makeEvidence({ value: '0.030110231560257453', metric: { name: 'conversion_rate', scope: 'channel=paid_social', unit: 'ratio' } });
    const stated = makeEvidence({ kind: 'document', value: 0.06, metric: { name: 'conversion_rate', scope: 'channel=paid_social', unit: 'ratio' } });

    expect(detectConflicts([asString, stated])).toHaveLength(1);
  });

  it('never compares a quoted phrase with a number, since code cannot tell whether they agree', () => {
    const computed = makeEvidence({ value: 0.018, metric: { name: 'conversion_rate', scope: 'channel=paid_social', unit: 'ratio' } });
    const quoted = makeEvidence({
      kind: 'document',
      value: 'reported as strongest channel by the growth team, no figure given',
      metric: { name: 'conversion_rate', scope: 'channel=paid_social', unit: 'ratio' },
    });

    expect(detectConflicts([computed, quoted])).toHaveLength(0);
  });

  it('applies a relative tolerance for currency', () => {
    const agree = makeEvidence({ value: 10000, metric: { name: 'revenue', scope: 'channel=email', unit: 'currency' } });
    const stillAgree = makeEvidence({ value: 10300, metric: { name: 'revenue', scope: 'channel=email', unit: 'currency' } });
    expect(detectConflicts([agree, stillAgree])).toHaveLength(0);

    const disagree = makeEvidence({ value: 20000, metric: { name: 'revenue', scope: 'channel=email', unit: 'currency' } });
    expect(detectConflicts([agree, disagree])).toHaveLength(1);
  });
});
