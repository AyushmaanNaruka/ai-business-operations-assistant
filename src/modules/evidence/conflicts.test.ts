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

  it('applies a relative tolerance for currency', () => {
    const agree = makeEvidence({ value: 10000, metric: { name: 'revenue', scope: 'channel=email', unit: 'currency' } });
    const stillAgree = makeEvidence({ value: 10300, metric: { name: 'revenue', scope: 'channel=email', unit: 'currency' } });
    expect(detectConflicts([agree, stillAgree])).toHaveLength(0);

    const disagree = makeEvidence({ value: 20000, metric: { name: 'revenue', scope: 'channel=email', unit: 'currency' } });
    expect(detectConflicts([agree, disagree])).toHaveLength(1);
  });
});
