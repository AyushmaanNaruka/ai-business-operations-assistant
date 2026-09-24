import { describe, expect, it } from 'vitest';
import type { Evidence } from '@/types/evidence';
import type { Finding } from '@/types/finding';
import { validatePlan } from './validate';

// Realistic fixtures: campaign-analytics style claims, the kind M2/M4/M5 would actually
// produce, so these tests double as documentation of what a real plan looks like.

const E1: Evidence = {
  id: 'E1',
  claim: 'Email converts at 4.2 percent',
  kind: 'computed',
  sourceId: 'src_1',
  sourceName: 'campaigns.xlsx',
  locator: 'computed',
  method: "SELECT SUM(conversions)::FLOAT / SUM(clicks) FROM campaigns WHERE channel = 'email'",
  value: 4.2,
  confidence: 'high',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const E2: Evidence = {
  id: 'E2',
  claim: 'Blended conversion rate is 2.1 percent',
  kind: 'computed',
  sourceId: 'src_1',
  sourceName: 'campaigns.xlsx',
  locator: 'computed',
  method: 'SELECT SUM(conversions)::FLOAT / SUM(clicks) FROM campaigns',
  value: 2.1,
  confidence: 'high',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const E3: Evidence = {
  id: 'E3',
  claim: 'Paid social spend rose 60 percent since June',
  kind: 'computed',
  sourceId: 'src_1',
  sourceName: 'campaigns.xlsx',
  locator: 'computed',
  method: "SELECT SUM(spend) FROM campaigns WHERE channel = 'paid_social' GROUP BY month",
  value: 60,
  confidence: 'high',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const F1: Finding = {
  id: 'F1',
  statement: 'Email converts at twice the blended average, on a fraction of the spend',
  evidenceIds: ['E1', 'E2'],
  reasoning: 'Email conversion rate is double the blended rate across all channels',
  soWhat: 'There is untested headroom to shift budget toward email',
  confidence: 'high',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const context = { evidence: [E1, E2, E3], findings: [F1] };

function makeSlide(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: 'Email converts at twice the blended average, on a tenth of the spend',
    bullets: ['4.2% vs 2.1% blended [E1, E2]'],
    notes: 'Walk through the comparison slowly, this is the headline number of the deck.',
    evidenceIds: ['E1', 'E2'],
    ...overrides,
  };
}

describe('validatePlan: structural rejections (schema level)', () => {
  it('rejects a deck with fewer than 5 slides (min 5 slides rule)', () => {
    const plan = {
      title: 'Q3 Review',
      slides: [makeSlide(), makeSlide(), makeSlide()],
    };
    const errors = validatePlan(plan, 'deck', context);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('slides'))).toBe(true);
  });

  it('rejects a summary with 2 findings instead of exactly 3 (exact-length-3 rule)', () => {
    const plan = {
      title: 'Q3 Snapshot',
      asOfDate: '2026-09-20',
      situation: 'Paid social spend rose while revenue stayed flat.',
      findings: [
        { statement: 'Email outperforms blended average', evidenceIds: ['E1'] },
        { statement: 'Paid social spend rose sharply', evidenceIds: ['E3'] },
      ],
      recommendation: {
        statement: 'Shift budget toward email',
        expectedEffect: 'Higher conversions per dollar',
        evidenceIds: ['E1'],
      },
      sources: [{ evidenceId: 'E1', claim: 'Email conversion rate', sourceName: 'campaigns.xlsx', locator: 'computed' }],
    };
    const errors = validatePlan(plan, 'summary', context);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('findings'))).toBe(true);
  });

  it('rejects a workbook calculation cell with a raw value instead of a formula (leading "=" rule)', () => {
    const plan = {
      title: 'Q3 Workbook',
      generatedAt: '2026-09-20',
      summary: {
        headline: [{ label: 'Email conversion rate', value: 4.2, evidenceIds: ['E1'] }],
        findings: ['Email outperforms blended average', 'Paid social spend rose sharply'],
      },
      recommendations: [
        {
          findingId: 'F1',
          recommendation: 'Shift budget toward email',
          rationale: 'Email converts at twice the blended average',
          supportingDataRange: 'Data!A2:K500',
          confidence: 'medium',
        },
      ],
      calculations: [{ label: 'Email conversion rate', formula: '0.042', evidenceIds: ['E1'] }],
      sources: [{ evidenceId: 'E1', claim: 'Email conversion rate', sourceName: 'campaigns.xlsx', locator: 'computed' }],
    };
    const errors = validatePlan(plan, 'workbook', context);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.toLowerCase().includes('formula'))).toBe(true);
  });

  it('rejects a report recommendation with no evidenceIds and isJudgment left false (evidence-or-judgment refine)', () => {
    const plan = {
      title: 'Q3 Performance Report',
      executiveSummary: 'Email is outperforming; paid social spend has outrun its returns.',
      whatWeLookedAt: 'campaigns.xlsx, Jan to Aug 2026',
      findings: [{ statement: 'Email converts at twice the blended average', evidenceIds: ['E1', 'E2'], soWhat: 'Headroom exists' }],
      whatIsNotWorking: 'Paid social spend rose 60 percent since June while revenue stayed flat',
      recommendations: [
        {
          statement: 'Cap paid social spend at the current level',
          findingIds: ['F1'],
          expectedEffect: 'Frees budget for email',
          measurement: 'Track spend versus revenue monthly',
          isJudgment: false,
          // no evidenceIds
        },
      ],
      method: 'Conversion rates computed from campaigns.xlsx via DuckDB',
      sources: [{ evidenceId: 'E1', claim: 'Email conversion rate', sourceName: 'campaigns.xlsx', locator: 'computed' }],
    };
    const errors = validatePlan(plan, 'report', context);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('recommendations'))).toBe(true);
  });
});

describe('validatePlan: evidence id existence (house rule a)', () => {
  it('rejects a reference to an evidence id that does not exist in the gathered evidence, naming the id and path', () => {
    const plan = {
      title: 'Q3 Snapshot',
      asOfDate: '2026-09-20',
      situation: 'Paid social spend rose while revenue stayed flat.',
      findings: [
        { statement: 'Email outperforms blended average', evidenceIds: ['E1'] },
        { statement: 'Paid social spend rose sharply', evidenceIds: ['E99'] },
        { statement: 'Segment level ROAS is not available', evidenceIds: ['E3'] },
      ],
      recommendation: {
        statement: 'Shift budget toward email',
        expectedEffect: 'Higher conversions per dollar',
        evidenceIds: ['E1'],
      },
      sources: [{ evidenceId: 'E1', claim: 'Email conversion rate', sourceName: 'campaigns.xlsx', locator: 'computed' }],
    };
    const errors = validatePlan(plan, 'summary', context);
    expect(errors).toContain('Evidence id E99 referenced at plan.findings[1].evidenceIds[0] does not exist in the gathered evidence.');
  });
});

describe('validatePlan: finding id existence (house rule b)', () => {
  it('rejects a findingIds reference to a finding that does not exist, naming the id and path', () => {
    const plan = {
      title: 'Q3 Performance Report',
      executiveSummary: 'Email is outperforming; paid social spend has outrun its returns.',
      whatWeLookedAt: 'campaigns.xlsx, Jan to Aug 2026',
      findings: [{ statement: 'Email converts at twice the blended average', evidenceIds: ['E1', 'E2'], soWhat: 'Headroom exists' }],
      whatIsNotWorking: 'Paid social spend rose 60 percent since June while revenue stayed flat',
      recommendations: [
        {
          statement: 'Cap paid social spend at the current level',
          findingIds: ['F99'],
          expectedEffect: 'Frees budget for email',
          measurement: 'Track spend versus revenue monthly',
          isJudgment: false,
          evidenceIds: ['E3'],
        },
      ],
      method: 'Conversion rates computed from campaigns.xlsx via DuckDB',
      sources: [{ evidenceId: 'E1', claim: 'Email conversion rate', sourceName: 'campaigns.xlsx', locator: 'computed' }],
    };
    const errors = validatePlan(plan, 'report', context);
    expect(errors).toContain(
      'Finding id F99 referenced at plan.recommendations[0].findingIds[0] does not exist in the gathered findings.',
    );
  });

  it('rejects a scalar findingId reference to a finding that does not exist, naming the id and path', () => {
    const plan = {
      title: 'Q3 Workbook',
      generatedAt: '2026-09-20',
      summary: {
        headline: [{ label: 'Email conversion rate', value: 4.2, evidenceIds: ['E1'] }],
        findings: ['Email outperforms blended average', 'Paid social spend rose sharply'],
      },
      recommendations: [
        {
          findingId: 'F99',
          recommendation: 'Shift budget toward email',
          rationale: 'Email converts at twice the blended average',
          supportingDataRange: 'Data!A2:K500',
          confidence: 'medium',
        },
      ],
      calculations: [{ label: 'Email conversion rate', formula: '=SUM(Data!D2:D50)/SUM(Data!C2:C50)', evidenceIds: ['E1'] }],
      sources: [{ evidenceId: 'E1', claim: 'Email conversion rate', sourceName: 'campaigns.xlsx', locator: 'computed' }],
    };
    const errors = validatePlan(plan, 'workbook', context);
    expect(errors).toContain('Finding id F99 referenced at plan.recommendations[0].findingId does not exist in the gathered findings.');
  });
});

describe('validatePlan: chart data matches its cited evidence (house rule c)', () => {
  it('rejects a chart data point whose value does not match any of its cited evidence values', () => {
    const plan = {
      title: 'Q3 Review',
      slides: [
        makeSlide(),
        makeSlide({
          chart: {
            kind: 'bar',
            title: 'Conversion rate by channel',
            data: [
              { label: 'Email', value: 4.2, evidenceIds: ['E1'] },
              { label: 'Blended', value: 9.9, evidenceIds: ['E2'] }, // E2's value is 2.1, not 9.9
            ],
            evidenceIds: ['E1', 'E2'],
          },
        }),
        makeSlide(),
        makeSlide(),
        makeSlide(),
      ],
    };
    const errors = validatePlan(plan, 'deck', context);
    expect(errors.some((e) => e.includes('Conversion rate by channel') && e.includes('Blended') && e.includes('9.9'))).toBe(true);
  });

  it('accepts a chart data point whose value matches its cited evidence value (no false positive)', () => {
    const plan = {
      title: 'Q3 Review',
      slides: [
        makeSlide(),
        makeSlide({
          chart: {
            kind: 'bar',
            title: 'Conversion rate by channel',
            data: [
              { label: 'Email', value: 4.2, evidenceIds: ['E1'] },
              { label: 'Blended', value: 2.1, evidenceIds: ['E2'] },
            ],
            evidenceIds: ['E1', 'E2'],
          },
        }),
        makeSlide(),
        makeSlide(),
        makeSlide(),
      ],
    };
    const errors = validatePlan(plan, 'deck', context);
    expect(errors).toEqual([]);
  });
});

describe('validatePlan: placeholder or empty text (house rule d)', () => {
  it('rejects a placeholder string such as "TBD" in a required text field', () => {
    const plan = {
      title: 'Q3 Performance Report',
      executiveSummary: 'TBD',
      whatWeLookedAt: 'campaigns.xlsx, Jan to Aug 2026',
      findings: [{ statement: 'Email converts at twice the blended average', evidenceIds: ['E1', 'E2'], soWhat: 'Headroom exists' }],
      whatIsNotWorking: 'Paid social spend rose 60 percent since June while revenue stayed flat',
      recommendations: [
        {
          statement: 'Cap paid social spend at the current level',
          findingIds: ['F1'],
          expectedEffect: 'Frees budget for email',
          measurement: 'Track spend versus revenue monthly',
          isJudgment: false,
          evidenceIds: ['E3'],
        },
      ],
      method: 'Conversion rates computed from campaigns.xlsx via DuckDB',
      sources: [{ evidenceId: 'E1', claim: 'Email conversion rate', sourceName: 'campaigns.xlsx', locator: 'computed' }],
    };
    const errors = validatePlan(plan, 'report', context);
    expect(errors).toContain('Placeholder or empty text at plan.executiveSummary: "TBD"');
  });
});

describe('validatePlan: a fully valid plan', () => {
  it('passes a complete, well grounded report plan with an empty error array', () => {
    const plan = {
      title: 'Q3 Channel Performance Review',
      preparedFor: 'Northwind Retail',
      dateRange: 'January to August 2026',
      executiveSummary:
        'Email converts at twice the blended average on a fraction of the spend. Paid social spend rose 60 percent since June while revenue stayed flat. We recommend capping paid social spend and reallocating toward email.',
      whatWeLookedAt: 'campaigns.xlsx, 1,240 rows, January to August 2026, channel-level spend and conversions',
      findings: [
        {
          statement: 'Email converts at twice the blended average, on a fraction of the spend',
          evidenceIds: ['E1', 'E2'],
          soWhat: 'There is untested headroom to shift budget toward email',
        },
      ],
      whatIsNotWorking: 'Paid social spend rose 60 percent since June while revenue stayed flat',
      recommendations: [
        {
          statement: 'Cap paid social spend at the current level and reallocate the difference to email',
          findingIds: ['F1'],
          expectedEffect: 'Frees roughly 60 percent of the recent spend increase for a higher converting channel',
          measurement: 'Track blended conversion rate and revenue per dollar of spend monthly',
          isJudgment: false,
          evidenceIds: ['E1', 'E2', 'E3'],
        },
      ],
      method: 'Conversion rates computed from campaigns.xlsx via DuckDB SQL aggregation, grouped by channel',
      sources: [
        { evidenceId: 'E1', claim: 'Email converts at 4.2 percent', sourceName: 'campaigns.xlsx', locator: 'computed', method: 'SQL' },
        {
          evidenceId: 'E2',
          claim: 'Blended conversion rate is 2.1 percent',
          sourceName: 'campaigns.xlsx',
          locator: 'computed',
          method: 'SQL',
        },
        { evidenceId: 'E3', claim: 'Paid social spend rose 60 percent', sourceName: 'campaigns.xlsx', locator: 'computed', method: 'SQL' },
      ],
      charts: [
        {
          kind: 'bar',
          title: 'Conversion rate by channel',
          data: [
            { label: 'Email', value: 4.2, evidenceIds: ['E1'] },
            { label: 'Blended average', value: 2.1, evidenceIds: ['E2'] },
          ],
          evidenceIds: ['E1', 'E2'],
        },
      ],
    };
    const errors = validatePlan(plan, 'report', context);
    expect(errors).toEqual([]);
  });
});
